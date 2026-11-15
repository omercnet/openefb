// Port of efb-212Tests/ViewModelTests/FlightPlanViewModelTests.swift (24 of 24): search thresholds and failure handling,
// route math with and without an active aircraft profile, AppState summary propagation, persistence, and the plan
// lifecycle (save / load / clear / delete). Same names and inputs. The SwiftData in-memory container is the in-memory
// plan repository of fixture.ts; AppState's navigation fields are a plain ActiveNavigation behind the navigation port;
// MockDatabaseManager and UnavailableDatabaseService are the fixture's fake databases. No map is attached (as in Swift).
import { newAircraftProfile, newFlightPlanRecord } from '../../../data/defaults';
import type { AircraftProfile } from '../../../data/models';
import type { Airport } from '../../../domain/core';
import { makeActiveRoute, makeLeg } from '../../../domain/route/activeRoute';
import {
  KOAK,
  KPAO,
  KSQL,
  createFakeAviationDatabase,
  createFakeNavigation,
  createMemoryPlanRepository,
  createUnavailableAviationDatabase,
} from './fixture';
import { createFlightPlanStore } from './store';

// MARK: - Fixtures

const kpao = KPAO;
const ksql = KSQL;
const koak = KOAK;

async function makeHarness(configure = true) {
  const aircraft: AircraftProfile[] = [];
  const plans = createMemoryPlanRepository();
  const navigation = createFakeNavigation();
  const store = createFlightPlanStore({
    database: createFakeAviationDatabase([kpao, ksql, koak]),
    plans,
    aircraft: () => aircraft,
    navigation,
    map: null,
    now: () => Date.now(),
  });
  if (configure) await store.getState().configure();
  const vm = () => store.getState();
  /** AppState's navigation fields. */
  const appState = () => navigation.state;
  return { store, vm, appState, navigation, plans, aircraft };
}

/** Great-circle distance reference computed independently of the view model's helper. */
function haversineNM(a: Airport, b: Airport): number {
  const r = 3440.065; // Earth radius, nautical miles
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(h));
}

function addActiveAircraft(list: AircraftProfile[], speed: number | null, burn: number | null, active = true) {
  const aircraft = newAircraftProfile('N4543A', { cruiseSpeedKts: speed, fuelBurnGPH: burn, isActive: active });
  list.push(aircraft);
  return aircraft;
}

describe('FlightPlanViewModel Tests', () => {
  // MARK: - Search

  test('searchRequiresAtLeastTwoCharacters', async () => {
    const h = await makeHarness();

    h.store.setState({ departureQuery: 'K' });
    await h.vm().searchDeparture();
    expect(h.vm().departureResults).toEqual([]);

    h.store.setState({ departureQuery: 'KP' });
    await h.vm().searchDeparture();
    expect(h.vm().departureResults.map((a) => a.icao)).toEqual(['KPAO']);

    // Shrinking the query again clears stale results instead of leaving them on screen.
    h.store.setState({ departureQuery: 'K' });
    await h.vm().searchDeparture();
    expect(h.vm().departureResults).toEqual([]);
  });

  test('destinationSearchIsIndependentOfDeparture', async () => {
    const h = await makeHarness();
    h.store.setState({ departureQuery: 'KPAO' });
    await h.vm().searchDeparture();

    h.store.setState({ destinationQuery: 'Oakland' });
    await h.vm().searchDestination();

    expect(h.vm().destinationResults.map((a) => a.icao)).toEqual(['KOAK']);
    expect(h.vm().departureResults.map((a) => a.icao)).toEqual(['KPAO']);
  });

  test('searchFailureYieldsEmptyResultsNotStaleOnes', async () => {
    const navigation = createFakeNavigation();
    const store = createFlightPlanStore({
      database: createUnavailableAviationDatabase(),
      plans: createMemoryPlanRepository(),
      aircraft: () => [],
      navigation,
      now: () => Date.now(),
    });
    store.setState({ departureResults: [kpao], departureQuery: 'KPAO' });

    await store.getState().searchDeparture();

    expect(store.getState().departureResults).toEqual([]);
  });

  // MARK: - Selection

  test('selectingAirportFillsQueryAndClearsResults', async () => {
    const h = await makeHarness();
    h.store.setState({ departureResults: [kpao, ksql] });

    h.vm().selectDeparture(kpao);

    expect(h.vm().selectedDeparture?.icao).toBe('KPAO');
    expect(h.vm().departureQuery).toBe('KPAO');
    expect(h.vm().departureResults).toEqual([]);
    // Only one end chosen: nothing is calculated or published yet.
    expect(h.vm().distanceNM).toBe(0);
    expect(h.appState().activeFlightPlan).toBe(false);
  });

  // MARK: - Route math

  test('selectingBothEndsComputesDistanceAndPublishesSummaryToAppState', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(ksql);

    const expected = haversineNM(kpao, ksql);
    expect(Math.abs(h.vm().distanceNM - expected)).toBeLessThan(0.1); // nautical miles
    expect(h.vm().distanceNM > 5 && h.vm().distanceNM < 9).toBe(true);

    expect(h.appState().activeFlightPlan).toBe(true);
    expect(h.appState().planDeparture).toBe('KPAO');
    expect(h.appState().planDestination).toBe('KSQL');
    expect(h.appState().distanceToNext).toBe(h.vm().distanceNM);
    expect(h.appState().estimatedTimeEnroute).toBe(h.vm().estimatedTimeSeconds);
    // The destination is published so every fix can refresh DTG/ETE from ownship.
    expect(h.appState().planDestinationCoordinate?.lat).toBe(ksql.latitude);
    expect(h.appState().planDestinationCoordinate?.lon).toBe(ksql.longitude);
  });

  test('withoutAircraftProfileUsesDefault100KnotsAndNoFuel', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(koak);

    const expectedETE = (haversineNM(kpao, koak) / 100.0) * 3600; // seconds at 100 kt
    expect(Math.abs(h.vm().estimatedTimeSeconds - expectedETE)).toBeLessThan(10);
    expect(h.vm().estimatedFuelGallons).toBeNull();
    expect(h.appState().planFuelGallons).toBeNull();
  });

  test('activeAircraftSuppliesSpeedAndFuelBurn', async () => {
    const h = await makeHarness();
    addActiveAircraft(h.aircraft, 120, 9);

    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(koak);

    const distance = haversineNM(kpao, koak);
    expect(Math.abs(h.vm().estimatedTimeSeconds - (distance / 120) * 3600)).toBeLessThan(10);
    const fuel = h.vm().estimatedFuelGallons;
    if (fuel === null) throw new Error('expected a fuel estimate');
    expect(Math.abs(fuel - (distance / 120) * 9)).toBeLessThan(0.05); // gallons
    expect(h.appState().planFuelGallons).toBe(fuel);
  });

  test('inactiveAircraftIsIgnored', async () => {
    const h = await makeHarness();
    addActiveAircraft(h.aircraft, 200, 20, false);

    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(koak);

    const distance = haversineNM(kpao, koak);
    expect(Math.abs(h.vm().estimatedTimeSeconds - (distance / 100) * 3600)).toBeLessThan(10);
    expect(h.vm().estimatedFuelGallons).toBeNull();
  });

  test('zeroOrMissingCruiseSpeedFallsBackToDefault', async () => {
    const h = await makeHarness();
    addActiveAircraft(h.aircraft, 0, 8);

    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(koak);

    // A zero cruise speed must not divide by zero or produce an infinite ETE.
    expect(Number.isFinite(h.vm().estimatedTimeSeconds)).toBe(true);
    const distance = haversineNM(kpao, koak);
    expect(Math.abs(h.vm().estimatedTimeSeconds - (distance / 100) * 3600)).toBeLessThan(10);
  });

  test('zeroBurnRateYieldsNoFuelEstimate', async () => {
    const h = await makeHarness();
    addActiveAircraft(h.aircraft, 110, 0);

    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(koak);

    expect(h.vm().estimatedFuelGallons).toBeNull();
  });

  test('sameAirportBothEndsGivesZeroDistanceWithoutCrashing', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(kpao);

    expect(h.vm().distanceNM).toBe(0);
    expect(h.vm().estimatedTimeSeconds).toBe(0);
    expect(h.vm().formattedETE()).toBe('0:00');
  });

  // MARK: - ETE formatting

  test('formattedETETruncatesToWholeMinutes', async () => {
    const h = await makeHarness(false);
    const cases: [number, string][] = [
      [0, '0:00'],
      [59, '0:00'],
      [60, '0:01'],
      [3599, '0:59'],
      [3600, '1:00'],
      [7500, '2:05'],
    ];
    for (const [seconds, text] of cases) {
      h.store.setState({ estimatedTimeSeconds: seconds });
      expect([seconds, h.vm().formattedETE()]).toEqual([seconds, text]);
    }
  });

  // MARK: - Persistence

  test('savePlanPersistsRouteAndMarksItActive', async () => {
    const h = await makeHarness();
    addActiveAircraft(h.aircraft, 120, 9);
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(ksql);

    await h.vm().savePlan();

    const record = h.vm().savedPlans[0];
    expect(record).toBeDefined();
    expect(h.vm().savedPlans).toHaveLength(1);
    expect(record.departureICAO).toBe('KPAO');
    expect(record.destinationICAO).toBe('KSQL');
    expect(record.destinationLatitude).toBe(ksql.latitude);
    expect(Math.abs(record.cruiseSpeedKts - 120)).toBeLessThan(0.01); // knots, recovered from distance / ETE
    expect(record.totalDistanceNM).toBe(h.vm().distanceNM);
    expect(h.vm().activePlanID).toBe(record.id);
  });

  test('savePlanWithoutBothAirportsDoesNothing', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);

    await h.vm().savePlan();

    expect(h.vm().savedPlans).toEqual([]);
    expect(h.vm().activePlanID).toBeNull();
  });

  test('savedPlansAreOrderedMostRecentlyUsedFirst', async () => {
    const h = await makeHarness();
    for (const [index, destination] of [ksql, koak].entries()) {
      await h.plans.insert(
        newFlightPlanRecord({
          departureICAO: 'KPAO',
          destinationICAO: destination.icao,
          lastUsedAt: (1_700_000_000 + index * 100) * 1000,
        }),
      );
    }

    await h.vm().loadSavedPlans();

    expect(h.vm().savedPlans.map((p) => p.destinationICAO)).toEqual(['KOAK', 'KSQL']);
  });

  test('configureRestoresMostRecentPlanFromDatabaseAirports', async () => {
    const h = await makeHarness(false);
    const old = newFlightPlanRecord({
      departureICAO: 'KPAO',
      destinationICAO: 'KSQL',
      lastUsedAt: 1_700_000_000_000,
    });
    const recent = newFlightPlanRecord({
      departureICAO: 'KSQL',
      destinationICAO: 'KOAK',
      lastUsedAt: 1_700_100_000_000,
    });
    await h.plans.insert(old);
    await h.plans.insert(recent);

    await h.vm().configure();

    expect(h.vm().selectedDeparture?.icao).toBe('KSQL');
    expect(h.vm().selectedDestination?.icao).toBe('KOAK');
    expect(h.vm().activePlanID).toBe(recent.id);
    expect(h.appState().planDestination).toBe('KOAK');
  });

  /** Opening the planner restores the last plan; it must not cancel a Direct-To being flown. */
  test('restoringTheLastPlanKeepsAnActiveDirectTo', async () => {
    const h = await makeHarness(false);
    await h.plans.insert(newFlightPlanRecord({ departureICAO: 'KPAO', destinationICAO: 'KOAK' }));
    h.navigation.patch({
      directTo: ksql,
      activeFlightPlan: true,
      distanceToNext: 4.2, // nautical miles, to KSQL
      bearingToNext: 295, // degrees true
      estimatedTimeEnroute: 168, // seconds
    });

    await h.vm().configure();

    expect(h.appState().directTo?.icao).toBe('KSQL');
    expect(h.appState().distanceToNext).toBe(4.2);
    expect(h.appState().bearingToNext).toBe(295);
    expect(h.appState().estimatedTimeEnroute).toBe(168);
    expect(h.appState().planDestination).toBeNull(); // the plan is in the planner, not on the map
    expect(h.vm().selectedDestination?.icao).toBe('KOAK');
  });

  /** Clearing the planner while a Direct-To is flown leaves the Direct-To and its numbers alone. */
  test('clearingThePlannerKeepsAnActiveDirectTo', async () => {
    const h = await makeHarness();
    h.navigation.patch({
      directTo: ksql,
      activeFlightPlan: true,
      distanceToNext: 4.2, // nautical miles
      bearingToNext: 295, // degrees true
      estimatedTimeEnroute: 168, // seconds
    });

    h.vm().clearPlan();

    expect(h.appState().directTo?.icao).toBe('KSQL');
    expect(h.appState().activeFlightPlan).toBe(true);
    expect(h.appState().distanceToNext).toBe(4.2);
    expect(h.appState().bearingToNext).toBe(295);
    expect(h.appState().estimatedTimeEnroute).toBe(168);
  });

  /** A route left active from Israel must not keep steering progress once a US plan is chosen. */
  test('choosingAUSPlanDropsALeftoverIsraelRoute', async () => {
    const h = await makeHarness();
    h.navigation.patch({
      activeRoute: makeActiveRoute([
        makeLeg({
          segmentID: 1,
          fromCode: 'AAAAA',
          toCode: 'BBBBB',
          fromLatitude: 32.0,
          fromLongitude: 34.8,
          toLatitude: 32.3,
          toLongitude: 34.8,
          altitudeText: '2500',
          distanceNM: 18,
        }),
      ]),
    });
    const saved = newFlightPlanRecord({ departureICAO: 'KPAO', destinationICAO: 'KOAK' });
    await h.plans.insert(saved);

    await h.vm().loadPlan(saved);

    expect(h.appState().activeRoute).toBeNull();
    expect(h.appState().planDestination).toBe('KOAK');
  });

  /** Picking a saved plan by hand does replace the Direct-To. */
  test('loadingAPlanByHandReplacesTheDirectTo', async () => {
    const h = await makeHarness();
    const saved = newFlightPlanRecord({ departureICAO: 'KPAO', destinationICAO: 'KOAK' });
    await h.plans.insert(saved);
    h.navigation.patch({ directTo: ksql, activeFlightPlan: true });

    await h.vm().loadPlan(saved);

    expect(h.appState().directTo).toBeNull();
    expect(h.appState().planDestination).toBe('KOAK');
    expect(Math.abs((h.appState().distanceToNext ?? 0) - haversineNM(kpao, koak))).toBeLessThan(0.5);
  });

  test('loadingPlanWhoseAirportIsGoneDoesNotPublishARoute', async () => {
    const h = await makeHarness();
    const record = newFlightPlanRecord({
      departureICAO: 'KPAO',
      destinationICAO: 'KGONE', // removed from a newer aviation database
    });
    await h.plans.insert(record);

    await h.vm().loadPlan(record);

    expect(h.vm().selectedDeparture?.icao).toBe('KPAO');
    expect(h.vm().selectedDestination).toBeNull();
    expect(h.appState().activeFlightPlan).toBe(false);
  });

  test('loadingPlanTouchesLastUsedAt', async () => {
    const h = await makeHarness();
    const record = newFlightPlanRecord({
      departureICAO: 'KPAO',
      destinationICAO: 'KSQL',
      lastUsedAt: 1_000_000_000_000,
    });
    await h.plans.insert(record);

    await h.vm().loadPlan(record);

    const stored = await h.plans.get(record.id);
    expect(stored?.lastUsedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  // MARK: - Clear / delete

  test('clearPlanResetsViewModelAndAppState', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(ksql);
    await h.vm().savePlan();
    expect(h.appState().activeFlightPlan).toBe(true);

    h.vm().clearPlan();

    expect(h.vm().selectedDeparture === null && h.vm().selectedDestination === null).toBe(true);
    expect(h.vm().departureQuery === '' && h.vm().destinationQuery === '').toBe(true);
    expect(h.vm().distanceNM === 0 && h.vm().estimatedTimeSeconds === 0).toBe(true);
    expect(h.vm().estimatedFuelGallons).toBeNull();
    expect(h.vm().activePlanID).toBeNull();
    expect(h.appState().activeFlightPlan).toBe(false);
    expect(h.appState().distanceToNext).toBeNull();
    expect(h.appState().estimatedTimeEnroute).toBeNull();
    expect(h.appState().planDeparture).toBeNull();
    expect(h.appState().planDestination).toBeNull();
    expect(h.appState().planDestinationCoordinate).toBeNull();
    expect(h.appState().bearingToNext).toBeNull();
    expect(h.appState().planFuelGallons).toBeNull();
    // Clearing the active plan does not delete it from storage.
    expect(h.vm().savedPlans).toHaveLength(1);
  });

  test('deletingActivePlanAlsoClearsItWhileDeletingOtherPlanKeepsActive', async () => {
    const h = await makeHarness();
    h.vm().selectDeparture(kpao);
    h.vm().selectDestination(ksql);
    await h.vm().savePlan();
    const active = h.vm().savedPlans[0];
    expect(active).toBeDefined();

    const other = newFlightPlanRecord({ departureICAO: 'KPAO', destinationICAO: 'KOAK', lastUsedAt: 1000 });
    await h.plans.insert(other);
    await h.vm().loadSavedPlans();
    expect(h.vm().savedPlans).toHaveLength(2);

    await h.vm().deletePlan(other);
    expect(h.vm().savedPlans.map((p) => p.id)).toEqual([active.id]);
    expect(h.vm().activePlanID).toBe(active.id);
    expect(h.appState().activeFlightPlan).toBe(true);

    await h.vm().deletePlan(active);
    expect(h.vm().savedPlans).toEqual([]);
    expect(h.vm().activePlanID).toBeNull();
    expect(h.appState().activeFlightPlan).toBe(false);
  });
});
