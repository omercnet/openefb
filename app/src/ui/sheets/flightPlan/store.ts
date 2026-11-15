// ViewModels/FlightPlanViewModel.swift as a Zustand store: search and pick a departure and a destination airport, compute
// distance, ETE and fuel from the active aircraft, publish the plan to the app's navigation state and the map, and keep
// saved plans (FlightPlanRecord) most recently used first. The pure steps live in logic.ts.
//
// JS-only: the aviation database and the plan repository are async. Each field's search carries a token and only the
// latest may write; loading a saved plan carries a generation that clear, a pick or a newer load supersedes.
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { uuidv4 } from '../../../data/ids';
import type { AircraftProfile, FlightPlanRecord } from '../../../data/models';
import type { Repository } from '../../../data/repositories/table';
import type { Airport, Coordinate } from '../../../domain/core';
import type { ActiveNavigation } from '../../../domain/route/navigation';
import {
  SEARCH_LIMIT,
  activeAircraft,
  airportCoordinate,
  formattedETE,
  planRecord,
  publishPlan,
  publishesRoute,
  routeBounds,
  routeEstimate,
  searchableQuery,
  withdrawPlan,
  type RouteBounds,
} from './logic';

// MARK: - Dependencies

/** The slice of the aviation database the planner reads (DatabaseServiceProtocol); AviationDatabase satisfies it. */
export interface FlightPlanDatabase {
  airport: (icao: string) => Promise<Airport | null>;
  searchAirports: (query: string, limit?: number) => Promise<Airport[]>;
}

/** The plan repository (D2 `flightPlanRepository`, ordered by last use); stands in for the SwiftData ModelContext. */
export type FlightPlanRepository = Pick<Repository<FlightPlanRecord>, 'insert' | 'list' | 'update' | 'remove'>;

/** AppState's navigation fields: read before every write so a Direct-To flown meanwhile is seen. */
export interface FlightPlanNavigation {
  current(): ActiveNavigation;
  set(navigation: ActiveNavigation): void;
}

/** MapService calls: the magenta great-circle line with its two pins, and the camera fit around it. */
export interface FlightPlanMap {
  /** updateRoute + addRoutePins + setVisibleCoordinateBounds(bounds, ROUTE_EDGE_PADDING). */
  showRoute(departure: Coordinate, destination: Coordinate, bounds: RouteBounds): void;
  clearRoute(): void;
}

export interface FlightPlanDeps {
  /** The app-wide aviation database (AppState.getOrCreateDatabaseService). A rejected query reads as no result. */
  database: FlightPlanDatabase;
  /** Saved plans. Used only after configure(), like the ModelContext Swift receives there. */
  plans: FlightPlanRepository;
  /** The aircraft profiles (the aircraft store's list), read on each calculation; the active one gives speed and burn. */
  aircraft: () => readonly AircraftProfile[];
  navigation: FlightPlanNavigation;
  /** null: no map yet (Swift's optional mapService); the plan still publishes to navigation. */
  map?: FlightPlanMap | null;
  /** Epoch ms. */
  now: () => number;
  newId?: () => string;
}

// MARK: - State

export interface FlightPlanState {
  // Search
  departureQuery: string;
  destinationQuery: string;
  departureResults: Airport[];
  destinationResults: Airport[];

  // Selected airports
  selectedDeparture: Airport | null;
  selectedDestination: Airport | null;

  // Computed plan data
  /** Nautical miles. */
  distanceNM: number;
  /** Seconds. */
  estimatedTimeSeconds: number;
  /** Gallons; null without an active aircraft with a positive fuel burn. */
  estimatedFuelGallons: number | null;

  // Saved plans
  /** Most recently used first. */
  savedPlans: FlightPlanRecord[];
  activePlanID: string | null;

  // Actions
  /** onAppear: start using the plan repository, load the saved plans and restore the most recent one. */
  configure(): Promise<void>;
  /** The departure field's binding: set the text and search (`onChange(of: departureQuery)`). */
  setDepartureQuery(query: string): Promise<void>;
  setDestinationQuery(query: string): Promise<void>;
  /** Search with the current departure query; fewer than 2 characters or a failed query empties the results. */
  searchDeparture(): Promise<void>;
  searchDestination(): Promise<void>;
  selectDeparture(airport: Airport): void;
  selectDestination(airport: Airport): void;
  /**
   * Distance, ETE and fuel, then the route line and the AppState summary. `replacesDirectTo` false (the restore when the
   * planner opens) leaves an active Direct-To and its live numbers alone.
   */
  calculateAndDrawRoute(replacesDirectTo?: boolean): void;
  savePlan(): Promise<void>;
  loadSavedPlans(): Promise<void>;
  /** Pick a saved plan: look its airports up again, mark it used now and route it. */
  loadPlan(record: FlightPlanRecord, replacesDirectTo?: boolean): Promise<void>;
  /** The restore when the planner opens; never cancels an active Direct-To. */
  loadMostRecentPlan(): Promise<void>;
  /** Clear the planner and the plan's navigation fields. The saved plans stay. */
  clearPlan(): void;
  /** Delete a saved plan; deleting the active one clears the planner first. */
  deletePlan(record: FlightPlanRecord): Promise<void>;
  /** ETE as "h:mm". */
  formattedETE(): string;
  /** The store's clock (the saved rows' relative time). */
  now(): number;
}

export function createFlightPlanStore(deps: FlightPlanDeps): StoreApi<FlightPlanState> {
  const newId = deps.newId ?? uuidv4;
  /** Swift's modelContext: nil until configure(). */
  let configured = false;
  const searchTokens = { departure: 0, destination: 0 };
  /** Bumped by loadPlan, clearPlan and the picks; a plan lookup whose number is no longer current writes nothing. */
  let generation = 0;
  /** Plans deleted while a load of them may still be pending: a late lookup must not bring them back. */
  const deletedPlanIDs = new Set<string>();

  return createStore<FlightPlanState>()((set, get) => {
    const search = async (field: 'departure' | 'destination', query: string): Promise<Airport[] | null> => {
      const token = ++searchTokens[field];
      const searchable = searchableQuery(query);
      let results: Airport[] = [];
      if (searchable !== null) {
        try {
          results = await deps.database.searchAirports(searchable, SEARCH_LIMIT);
        } catch {
          results = [];
        }
      }
      return token === searchTokens[field] ? results : null;
    };

    const lookup = (icao: string): Promise<Airport | null> => deps.database.airport(icao).catch(() => null);

    /** A pick or a clear makes pending searches and plan loads stale. */
    const supersede = () => {
      generation += 1;
      searchTokens.departure += 1;
      searchTokens.destination += 1;
    };

    const routeIfComplete = () => {
      const s = get();
      if (s.selectedDeparture && s.selectedDestination) s.calculateAndDrawRoute();
    };

    return {
      departureQuery: '',
      destinationQuery: '',
      departureResults: [],
      destinationResults: [],
      selectedDeparture: null,
      selectedDestination: null,
      distanceNM: 0,
      estimatedTimeSeconds: 0,
      estimatedFuelGallons: null,
      savedPlans: [],
      activePlanID: null,

      async configure() {
        if (configured) return;
        configured = true;
        const mine = generation;
        await get().loadSavedPlans();
        // JS-only guard: a pick or Clear made while the saved plans were loading is the pilot's route, not to be replaced by
        // the restored plan (Swift loads synchronously, so nothing can happen in between).
        if (mine !== generation) return;
        if (get().savedPlans.length > 0) await get().loadMostRecentPlan();
      },

      async setDepartureQuery(query) {
        set({ departureQuery: query });
        await get().searchDeparture();
      },

      async setDestinationQuery(query) {
        set({ destinationQuery: query });
        await get().searchDestination();
      },

      async searchDeparture() {
        const results = await search('departure', get().departureQuery);
        if (results) set({ departureResults: results });
      },

      async searchDestination() {
        const results = await search('destination', get().destinationQuery);
        if (results) set({ destinationResults: results });
      },

      selectDeparture(airport) {
        supersede();
        set({ selectedDeparture: airport, departureQuery: airport.icao, departureResults: [] });
        routeIfComplete();
      },

      selectDestination(airport) {
        supersede();
        set({ selectedDestination: airport, destinationQuery: airport.icao, destinationResults: [] });
        routeIfComplete();
      },

      calculateAndDrawRoute(replacesDirectTo = true) {
        const { selectedDeparture: departure, selectedDestination: destination } = get();
        if (!departure || !destination) return;
        const aircraft = configured ? activeAircraft(deps.aircraft()) : null;
        const estimate = routeEstimate(departure, destination, aircraft);
        set(estimate);

        const navigation = deps.navigation.current();
        if (!publishesRoute(replacesDirectTo, navigation)) return;
        deps.map?.showRoute(
          airportCoordinate(departure),
          airportCoordinate(destination),
          routeBounds(departure, destination),
        );
        deps.navigation.set(publishPlan(navigation, { ...estimate, departure, destination }));
      },

      async savePlan() {
        const s = get();
        if (!s.selectedDeparture || !s.selectedDestination || !configured) return;
        const record = planRecord(
          {
            departure: s.selectedDeparture,
            destination: s.selectedDestination,
            distanceNM: s.distanceNM,
            estimatedTimeSeconds: s.estimatedTimeSeconds,
            estimatedFuelGallons: s.estimatedFuelGallons,
          },
          { now: deps.now, newId },
        );
        const mine = generation;
        try {
          await deps.plans.insert(record);
        } catch {
          return; // try? context.save(): a failed write shows nothing
        }
        // JS-only guard: Clear or another pick while the insert was pending ends this plan's turn as the active one.
        if (mine === generation) set({ activePlanID: record.id });
        await get().loadSavedPlans();
      },

      async loadSavedPlans() {
        if (!configured) return;
        const plans = await deps.plans.list().catch(() => [] as FlightPlanRecord[]);
        set({ savedPlans: plans });
      },

      async loadPlan(record, replacesDirectTo = true) {
        supersede();
        const mine = generation;
        const [departure, destination] = await Promise.all([
          lookup(record.departureICAO),
          lookup(record.destinationICAO),
        ]);
        if (mine !== generation || deletedPlanIDs.has(record.id)) return;
        const lastUsedAt = deps.now();
        set((s) => ({
          selectedDeparture: departure,
          selectedDestination: destination,
          departureQuery: record.departureICAO,
          destinationQuery: record.destinationICAO,
          activePlanID: record.id,
          // The row is the same object in Swift, so the list shows the new time without a reload (and keeps its order).
          savedPlans: s.savedPlans.map((p) => (p.id === record.id ? { ...p, lastUsedAt } : p)),
        }));
        if (departure && destination) get().calculateAndDrawRoute(replacesDirectTo);
        if (configured) await deps.plans.update(record.id, { lastUsedAt }).catch(() => null);
      },

      async loadMostRecentPlan() {
        const first = get().savedPlans[0];
        if (first) await get().loadPlan(first, false);
      },

      clearPlan() {
        supersede();
        set({
          departureQuery: '',
          destinationQuery: '',
          selectedDeparture: null,
          selectedDestination: null,
          departureResults: [],
          destinationResults: [],
          distanceNM: 0,
          estimatedTimeSeconds: 0,
          estimatedFuelGallons: null,
          activePlanID: null,
        });
        deps.map?.clearRoute();
        deps.navigation.set(withdrawPlan(deps.navigation.current()));
      },

      async deletePlan(record) {
        if (!configured) return;
        deletedPlanIDs.add(record.id); // a load of this plan that is still looking up its airports must not restore it
        let removed = true;
        await deps.plans.remove(record.id).catch(() => {
          removed = false;
        });
        if (!removed) {
          deletedPlanIDs.delete(record.id); // a failed delete changes nothing
          return;
        }
        if (record.id === get().activePlanID) get().clearPlan();
        await get().loadSavedPlans();
      },

      formattedETE() {
        return formattedETE(get().estimatedTimeSeconds);
      },

      now() {
        return deps.now();
      },
    };
  });
}

// MARK: - Context

const FlightPlanContext = createContext<StoreApi<FlightPlanState> | null>(null);

/** Supplies the plan store to FlightPlanSheet: I1 with the real services, the route and tests with fixtures. */
export const FlightPlanProvider = ({ store, children }: { store: StoreApi<FlightPlanState>; children: ReactNode }) =>
  createElement(FlightPlanContext.Provider, { value: store }, children);

export function useFlightPlanStore(): StoreApi<FlightPlanState> {
  const store = useContext(FlightPlanContext);
  if (!store) throw new Error('FlightPlanSheet needs a FlightPlanProvider');
  return store;
}

/** Zustand's rule applies: the selector returns a field or a primitive, never a fresh object. */
export const useFlightPlan = <S>(selector: (state: FlightPlanState) => S): S =>
  useStore(useFlightPlanStore(), selector);
