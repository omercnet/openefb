// Port of Services/IsraelAircraftNetworkPreference.swift: which Israeli route network an aircraft usually flies (CVFR for GA,
// the sport-aviation LSA network for LSA and ultralight aircraft). The planner preselects it from the active aircraft.
// Kept beside the profile, not in it: one string per aircraft, keyed by the profile id, so renaming keeps it.
// L3 ports the planner side; both read the same keys.
import { ROUTE_NETWORKS, type IsraelRouteNetwork } from '../../data/aviation/israelTypes';
import type { Preferences } from '../ports/preferences';

export interface AircraftNetworkPreference {
  /** Null when the pilot has not said (the planner then starts on CVFR). */
  get(aircraftId: string): Promise<IsraelRouteNetwork | null>;
  /** Pass null to clear the preference. */
  set(aircraftId: string, network: IsraelRouteNetwork | null): Promise<void>;
}

export const routeNetworkKey = (aircraftId: string): string => `israel.routeNetwork.${aircraftId}`;

export function preferencesNetworkPreference(prefs: Preferences): AircraftNetworkPreference {
  return {
    async get(aircraftId) {
      const raw = await prefs.get(routeNetworkKey(aircraftId));
      return ROUTE_NETWORKS.find((network) => network === raw) ?? null;
    },
    set: (aircraftId, network) =>
      network === null ? prefs.remove(routeNetworkKey(aircraftId)) : prefs.set(routeNetworkKey(aircraftId), network),
  };
}
