// The Israel flight plan on the live app (IsraelFlightPlanViewModel's dependencies): the Israel database, the NOTAM feed,
// the profiles, the route network preference, and AppState's navigation for activate and clear.
import type { StoreApi } from 'zustand';
import type { Preferences } from '../../domain/ports/preferences';
import { routeNetworkKey } from '../../domain/profiles/networkPreference';
import { AppFailure } from '../../domain/errors';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { NetworkPreferenceStore } from '../../domain/israel/aircraftNetworkPreference';
import { legToCoordinate } from '../../domain/route/activeRoute';
import { NO_NAVIGATION } from '../../domain/route/navigation';
import type { IsraelNotamServiceLike } from '../../services/israelNotamService';
import type { AircraftProfile, PilotProfile } from '../../data/models';
import type { AppState } from '../state/appStore';
import type { PlanActivation } from '../sheets/israelPlan/logic';
import { createIsraelPlanStore, type IsraelPlanState } from '../sheets/israelPlan/store';

/**
 * IsraelAircraftNetworkPreference over the preferences. The planner reads it synchronously, so the aircraft's stored
 * choices are loaded first (`warm`); a write goes to the cache at once and to the store behind it.
 */
export function createPlannerNetworkStore(
  prefs: Preferences,
  log: (message: string) => void = () => undefined,
): NetworkPreferenceStore & { warm(aircraftIds: readonly string[]): Promise<void> } {
  const cache = new Map<string, string>();
  const run = (work: Promise<unknown>) => work.catch((e) => log(`Could not save the route network: ${String(e)}`));
  return {
    async warm(ids) {
      await Promise.all(
        ids.map(async (id) => {
          const key = routeNetworkKey(id);
          try {
            const value = await prefs.get(key);
            if (value !== null) cache.set(key, value);
          } catch (e) {
            log(`Could not read the route network: ${String(e)}`);
          }
        }),
      );
    },
    getString: (key) => cache.get(key) ?? null,
    setString(key, value) {
      cache.set(key, value);
      void run(prefs.set(key, value));
    },
    remove(key) {
      cache.delete(key);
      void run(prefs.remove(key));
    },
  };
}

export interface LivePlannerDeps {
  israel: Pick<
    IsraelAviationDatabase,
    'metadata' | 'reportingPoint' | 'reportingPoints' | 'routeSegments' | 'searchAerodromes'
  > | null;
  notam: Pick<IsraelNotamServiceLike, 'fetchFeed'> | null;
  /** The aircraft and pilot lists as the profile stores hold them. */
  profiles: () => { aircraft: AircraftProfile[]; pilots: PilotProfile[] };
  networkPreferences: NetworkPreferenceStore | null;
  app: StoreApi<AppState>;
  now?: () => number;
  signal?: (name: string, parameters?: Record<string, string>) => void;
}

/** AppState.activeRoute and friends from an activated plan (IsraelFlightPlanViewModel.activate). */
export function navigationFromActivation(activation: PlanActivation) {
  const last = activation.activeRoute.legs[activation.activeRoute.legs.length - 1];
  return {
    ...NO_NAVIGATION,
    activeFlightPlan: true as const,
    activeRoute: activation.activeRoute,
    planDeparture: activation.planDeparture,
    planDestination: activation.planDestination,
    planDestinationCoordinate: last ? legToCoordinate(last) : null,
    planFuelGallons: activation.fuelGallons,
    distanceToNext: activation.distanceToNext,
    bearingToNext: activation.bearingToNext,
    estimatedTimeEnroute: activation.estimatedTimeEnroute,
  };
}

export function createLiveIsraelPlanStore(deps: LivePlannerDeps): StoreApi<IsraelPlanState> {
  const { israel, app } = deps;
  return createIsraelPlanStore({
    database: async () => {
      // Swift's databaseProvider throws when the bundled Israel database cannot be opened.
      if (!israel) throw new AppFailure({ kind: 'databaseCorrupted' });
      return israel;
    },
    fetchNotams: deps.notam ? () => deps.notam!.fetchFeed() : null,
    now: deps.now ?? Date.now,
    profiles: deps.profiles,
    networkPreferences: deps.networkPreferences,
    navigation: {
      activate: (activation) => app.getState().setNavigation(navigationFromActivation(activation)),
      hasActiveRoute: () => app.getState().navigation.activeRoute !== null,
      clear: () => app.getState().setNavigation(NO_NAVIGATION),
    },
    // The route line follows the app store's navigation (ui/map/navigationRoute); the LSA emphasis is not drawn yet.
    map: null,
    ...(deps.signal ? { signal: deps.signal } : {}),
    openBriefing: (route) => app.getState().openBriefing(route),
  });
}
