// FAKE data for the US flight plan sheet: the Swift test airports (KPAO, KSQL, KOAK; FlightPlanViewModelTests' fixtures,
// with KMOD from the summary card preview), MockDatabaseManager and UnavailableDatabaseService as async fakes, an
// in-memory plan repository with the D2 order (last used first), and a navigation port over a plain ActiveNavigation.
// Used by the tests and by the flight-plan route. Nothing here is real aviation data beyond the airport positions.
import { newAircraftProfile, newFlightPlanRecord } from '../../../data/defaults';
import type { AircraftProfile, FlightPlanRecord } from '../../../data/models';
import { AppFailure } from '../../../domain/errors';
import { makeAirport, type Airport } from '../../../domain/core';
import { NO_NAVIGATION, type ActiveNavigation } from '../../../domain/route/navigation';
import { byLastUsed } from './logic';
import {
  createFlightPlanStore,
  type FlightPlanDatabase,
  type FlightPlanDeps,
  type FlightPlanMap,
  type FlightPlanNavigation,
  type FlightPlanRepository,
  type FlightPlanState,
} from './store';
import type { StoreApi } from 'zustand';

/** 2026-11-12T06:26Z, the capture seed's clock (the other sheets' FIXTURE_NOW). */
export const FIXTURE_NOW = Date.UTC(2026, 10, 12, 6, 26);

/** FlightPlanViewModelTests.airport: a public airport at 5 ft with nothing else filled in. */
export const usAirport = (icao: string, name: string, latitude: number, longitude: number): Airport =>
  makeAirport({ icao, name, latitude, longitude, elevation: 5, type: 'airport', ownership: 'public' });

export const KPAO = usAirport('KPAO', 'Palo Alto', 37.4611, -122.115);
export const KSQL = usAirport('KSQL', 'San Carlos', 37.5119, -122.2494);
export const KOAK = usAirport('KOAK', 'Oakland Intl', 37.7213, -122.2208);
export const KMOD = usAirport('KMOD', 'Modesto City-County-Harry Sham Fld', 37.6258, -120.9544);
export const FIXTURE_AIRPORTS: readonly Airport[] = [KPAO, KSQL, KOAK, KMOD];

/** The active aircraft of the fixture: 120 kt, 9 gph (the Swift tests' N4543A). */
export const FIXTURE_AIRCRAFT: AircraftProfile = newAircraftProfile('N4543A', {
  newId: () => 'aircraft-n4543a',
  now: () => FIXTURE_NOW,
  aircraftType: 'C172',
  cruiseSpeedKts: 120,
  fuelBurnGPH: 9,
  isActive: true,
});

/** MockDatabaseManager: `searchAirports` matches the upper-cased query in the ICAO or the query in the name (any case). */
export function createFakeAviationDatabase(airports: readonly Airport[] = FIXTURE_AIRPORTS): FlightPlanDatabase {
  return {
    airport: async (icao) => airports.find((a) => a.icao === icao) ?? null,
    searchAirports: async (query) =>
      airports.filter(
        (a) => a.icao.includes(query.toUpperCase()) || a.name.toLowerCase().includes(query.toLowerCase()),
      ),
  };
}

/** UnavailableDatabaseService: every query fails (EFBError.databaseCorrupted). */
export function createUnavailableAviationDatabase(): FlightPlanDatabase {
  const fail = async (): Promise<never> => {
    throw new AppFailure({ kind: 'databaseCorrupted' });
  };
  return { airport: fail, searchAirports: fail };
}

/** An in-memory plan repository in flightPlanRepository's order (last used first, then insertion). */
export function createMemoryPlanRepository(seed: readonly FlightPlanRecord[] = []) {
  let rows = seed.map((r) => ({ ...r }));
  const repository: FlightPlanRepository & { get(id: string): Promise<FlightPlanRecord | null> } = {
    async insert(record) {
      if (rows.some((r) => r.id === record.id)) throw new Error(`duplicate id ${record.id}`);
      rows.push({ ...record });
    },
    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    async list() {
      return byLastUsed(rows).map((r) => ({ ...r }));
    },
    async update(id, patch) {
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...patch };
      return { ...rows[index] };
    },
    async remove(id) {
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      return rows.length < before;
    },
  };
  return repository;
}

/** AppState's navigation fields as a plain value behind the plan's navigation port. */
export function createFakeNavigation(initial: ActiveNavigation = NO_NAVIGATION) {
  let state = initial;
  const navigation: FlightPlanNavigation & {
    readonly state: ActiveNavigation;
    patch(p: Partial<ActiveNavigation>): void;
  } = {
    current: () => state,
    set: (next) => {
      state = next;
    },
    get state() {
      return state;
    },
    patch: (p) => {
      state = { ...state, ...p };
    },
  };
  return navigation;
}

/** A map port that records its calls. */
export function createRecordingMap() {
  const calls: string[] = [];
  const map: FlightPlanMap & { calls: string[] } = {
    calls,
    showRoute: (departure, destination) =>
      calls.push(`show ${departure.lat},${departure.lon} ${destination.lat},${destination.lon}`),
    clearRoute: () => calls.push('clear'),
  };
  return map;
}

/** Two saved plans as savePlan writes them with FIXTURE_AIRCRAFT; KPAO to KSQL used most recently (2 hours ago). */
export const FIXTURE_SAVED_PLANS: readonly FlightPlanRecord[] = [
  newFlightPlanRecord({
    newId: () => 'plan-kpao-ksql',
    now: () => FIXTURE_NOW - 2 * 3600_000,
    departureICAO: 'KPAO',
    departureName: 'Palo Alto',
    departureLatitude: KPAO.latitude,
    departureLongitude: KPAO.longitude,
    destinationICAO: 'KSQL',
    destinationName: 'San Carlos',
    destinationLatitude: KSQL.latitude,
    destinationLongitude: KSQL.longitude,
    cruiseSpeedKts: 120,
    totalDistanceNM: 7.09,
    estimatedTimeSeconds: 212.8,
    estimatedFuelGallons: 0.53,
  }),
  newFlightPlanRecord({
    newId: () => 'plan-ksql-kmod',
    now: () => FIXTURE_NOW - 3 * 86_400_000,
    departureICAO: 'KSQL',
    departureName: 'San Carlos',
    departureLatitude: KSQL.latitude,
    departureLongitude: KSQL.longitude,
    destinationICAO: 'KMOD',
    destinationName: 'Modesto City-County-Harry Sham Fld',
    destinationLatitude: KMOD.latitude,
    destinationLongitude: KMOD.longitude,
    cruiseSpeedKts: 120,
    totalDistanceNM: 62.01,
    estimatedTimeSeconds: 1860.2,
    estimatedFuelGallons: 4.65,
  }),
];

export interface FixtureOptions {
  /** Saved plans in the repository (none by default: the empty planner). */
  plans?: readonly FlightPlanRecord[];
  aircraft?: readonly AircraftProfile[];
  navigation?: ActiveNavigation;
}

/** The plan store over the fixture: fake database, in-memory repository, fake navigation, no map. */
export function createFixtureFlightPlanStore(options: FixtureOptions = {}, overrides: Partial<FlightPlanDeps> = {}) {
  const plans = createMemoryPlanRepository(options.plans ?? []);
  const navigation = createFakeNavigation(options.navigation);
  const aircraft = options.aircraft ?? [FIXTURE_AIRCRAFT];
  let ids = 0;
  const store: StoreApi<FlightPlanState> = createFlightPlanStore({
    database: createFakeAviationDatabase(),
    plans,
    aircraft: () => aircraft,
    navigation,
    map: null,
    now: () => FIXTURE_NOW,
    newId: () => `plan-${++ids}`,
    ...overrides,
  });
  return { store, plans, navigation };
}
