// The US flight planner on the live app (FlightPlanViewModel's environment): the aviation database for the airport search,
// the plan repository, the aircraft list, the app's navigation state and the map's camera.
import type { StoreApi } from 'zustand';
import { flightPlanRepository } from '../../data/repositories';
import type { Db } from '../../data/db';
import type { AircraftProfile } from '../../data/models';
import { createFlightPlanStore, type FlightPlanDatabase, type FlightPlanState } from '../sheets/flightPlan/store';
import type { AppState } from '../state/appStore';

export interface UsPlannerDeps {
  aviation: FlightPlanDatabase | null;
  userDb: Db;
  aircraft: () => readonly AircraftProfile[];
  app: StoreApi<AppState>;
  now?: () => number;
}

export function createLiveFlightPlanStore(deps: UsPlannerDeps): StoreApi<FlightPlanState> {
  const { app } = deps;
  return createFlightPlanStore({
    // Without the aviation database nothing can be searched: the fields stay empty rather than failing.
    database: deps.aviation ?? { airport: async () => null, searchAirports: async () => [] },
    plans: flightPlanRepository(deps.userDb),
    aircraft: deps.aircraft,
    navigation: {
      current: () => app.getState().navigation,
      set: (navigation) => app.getState().setNavigation(navigation),
    },
    // MapService.updateRoute + pins: the line itself is the app's navigation route; the camera fits the plan.
    map: {
      showRoute: (_departure, _destination, bounds) =>
        app.getState().requestMapFrame({
          south: bounds.sw.lat,
          west: bounds.sw.lon,
          north: bounds.ne.lat,
          east: bounds.ne.lon,
        }),
      clearRoute: () => undefined,
    },
    now: deps.now ?? Date.now,
  });
}
