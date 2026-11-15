// Connects the live services to the UI slices (Swift: MapContainerView.initializeServices and its onChange handlers,
// LocationService writing AppState, MapViewModel's network monitor). One call at launch, after startup; it returns the
// teardown. Every slice it writes takes a plain object, so tests pass fresh stores and fakes.
import type { StoreApi } from 'zustand';
import type { NetworkStatusSource } from '../../adapters/network';
import type { Airport, Region } from '../../domain/core';
import type { LocationSource } from '../../domain/ports/location';
import { LocationService, initialOwnshipState, type OwnshipState } from '../../domain/location/locationService';
import { evaluateGpsStatus, gpsFixFromLocation, isGpsStale } from '../../domain/location/gpsStatus';
import {
  NO_NAVIGATION,
  sequenceActiveRoute,
  setDirectTo,
  updateActiveRouteProgress,
  type ActiveNavigation,
  type NavigationFix,
} from '../../domain/route/navigation';
import { nearest, type NearestData } from '../columns/nearest/store';
import { flightLog, type FlightLogData } from '../flightLog/store';
import type { AppState } from '../state/appStore';
import { appStore } from '../state/appStore';
import { gps, type GpsData } from '../state/gps';
import { ownship, type OwnshipData } from '../state/ownship';
import { regionSlice, type RegionData } from '../state/region';

export interface LiveDataStores {
  app: StoreApi<AppState>;
  flightLog: StoreApi<FlightLogData>;
  gps: StoreApi<GpsData>;
  nearest: StoreApi<NearestData>;
  ownship: StoreApi<OwnshipData>;
  region: StoreApi<RegionData>;
}

export const liveStores = (): LiveDataStores => ({
  app: appStore,
  flightLog: flightLog.store,
  gps: gps.store,
  nearest: nearest.store,
  ownship: ownship.store,
  region: regionSlice.store,
});

export interface LiveDataDeps {
  location: LocationSource;
  network: NetworkStatusSource;
  region: Region;
  /** Epoch ms. */
  clock?: () => number;
  stores?: LiveDataStores;
}

/** How often the status and clock are re-evaluated: a fix older than 5 s turns stale without any new update. */
export const TICK_MS = 1000;

const navigationFix = (state: OwnshipState): NavigationFix | null => {
  const fix = state.ownshipPosition;
  if (!fix) return null;
  return {
    position: { lat: fix.lat, lon: fix.lon },
    altitudeFeet: fix.verticalAccuracyM >= 0 ? state.altitudeFt : null,
    groundSpeedKt: state.groundSpeedKt,
  };
};

export function startLiveData(deps: LiveDataDeps): () => void {
  const clock = deps.clock ?? Date.now;
  const stores = deps.stores ?? liveStores();

  stores.region.setState({ region: deps.region });
  stores.flightLog.setState({ region: deps.region });

  const navigation = (): ActiveNavigation => stores.app.getState().navigation;
  const projectNavigation = (nav: ActiveNavigation): void => {
    stores.flightLog.setState({
      directTo: nav.directTo?.icao ?? null,
      activeFlightPlan: nav.activeFlightPlan,
      activeRoute: nav.activeRoute,
      planDeparture: nav.planDeparture,
      planDestination: nav.planDestination,
      distanceToNext: nav.distanceToNext,
      bearingToNext: nav.bearingToNext,
      estimatedTimeEnroute: nav.estimatedTimeEnroute,
    });
  };
  const publishNavigation = (nav: ActiveNavigation): void => {
    stores.app.getState().setNavigation(nav);
    projectNavigation(nav);
  };
  // The app store outlives a remount and the flight log was just reset: show the active Direct-To or route at once.
  projectNavigation(navigation());
  // A plan activated from the planner writes the app store directly: the strip follows it.
  const stopNavigation = stores.app.subscribe((state, previous) => {
    if (state.navigation !== previous.navigation) projectNavigation(state.navigation);
  });

  /** Status and the map's ownship, evaluated at `now`: the same inputs as every update, so the tick can re-run it. */
  const publishPosition = (state: OwnshipState, now: number): void => {
    const fix = state.ownshipPosition;
    const gpsFix = fix ? gpsFixFromLocation(fix, state.gpsStationary) : null;
    const status = evaluateGpsStatus(gpsFix, state.gpsAvailable, now);
    stores.gps.setState({ status, failure: state.gpsFailure });
    stores.ownship.setState({
      input: {
        position: fix ? { lat: fix.lat, lon: fix.lon } : null,
        trackDeg: state.trackDeg,
        groundSpeedKt: state.groundSpeedKt,
        timestamp: fix ? fix.timestampMs : null,
        stale: isGpsStale(status),
      },
    });
    stores.flightLog.setState({
      gpsAvailable: state.gpsAvailable,
      ownshipFix: gpsFix,
      hasPosition: fix !== null,
      hasAltitude: fix !== null && fix.verticalAccuracyM >= 0,
      groundSpeed: state.groundSpeedKt,
      track: state.trackDeg,
      altitude: state.altitudeFt,
      verticalSpeed: state.verticalSpeedFpm,
      nowMs: now,
    });
  };

  let latest = initialOwnshipState();
  const locationService = new LocationService(deps.location, {
    clock,
    onChange: (state) => {
      latest = state;
      publishPosition(state, clock());
      stores.nearest.setState({
        ownship: state.ownshipPosition ? { lat: state.ownshipPosition.lat, lon: state.ownshipPosition.lon } : null,
      });
    },
    // AppState.updateActiveRouteProgress on every applied fix.
    onFix: (nowMs) =>
      publishNavigation(updateActiveRouteProgress(navigation(), navigationFix(locationService.state), nowMs)),
  });

  stores.nearest.setState({
    directTo: (airport: Airport) =>
      publishNavigation(setDirectTo(navigation(), airport, navigationFix(latest), clock())),
  });
  stores.flightLog.setState({
    actions: {
      ...stores.flightLog.getState().actions,
      clear: () => publishNavigation(NO_NAVIGATION),
      openBriefing: () => stores.app.getState().setPresentingBriefing(true),
      sequenceRoute: (forward) =>
        publishNavigation(sequenceActiveRoute(navigation(), forward, navigationFix(latest), clock())),
    },
  });

  const stopNetwork = deps.network.subscribe((isOffline) => stores.flightLog.setState({ isOffline }));
  const tick = setInterval(() => publishPosition(latest, clock()), TICK_MS);
  locationService.start();

  return () => {
    clearInterval(tick);
    stopNavigation();
    stopNetwork();
    locationService.stop();
  };
}
