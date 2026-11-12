// Ports of efb-212Tests/ViewModelTests/NearestAirportViewModelTests.swift (all 8), the NearestAirportEntry part of
// ServiceTests/LandableAirportFilterTests.militaryIsFlaggedMilNotPvtAndStillListed, and the JS-only refresh policy
// (move threshold, region switch, request token, failures keep the list).
import type { Airport as AviationAirport } from '../../../data/aviation/types';
import { makeAirport, type Airport } from '../../../domain/core';
import { kpao, ksfo, ksql, rwy } from './__fixtures__/swiftAirports';
import { FIXTURE_AIRPORTS, FIXTURE_OWNSHIP, createFakeAviationDatabase } from './fixture';
import {
  bearingText,
  distanceText,
  entryId,
  entryIsMilitary,
  entryExtras,
  entryIsPrivateUse,
  rowRunwayText,
  runwaySummary,
  type NearestAirportEntry,
} from './logic';
import { printfFixed } from '../../flightLog/logic';
import { createNearestRefresher } from './refresh';
import { defaultAirportQueries, type AirportQueries } from './sources';
import { nearest, type NearestData } from './store';

const EMPTY: NearestData = {
  entries: [],
  loading: false,
  error: null,
  ownship: null,
  directTo: () => {},
};

/** A query answer released by hand, for ordering async responses. */
const deferred = () => Promise.withResolvers<AviationAirport[]>();

const queriesWith = (nearestAirports: AirportQueries['aviation']['nearestAirports']): AirportQueries => ({
  ...defaultAirportQueries,
  aviation: { ...defaultAirportQueries.aviation, nearestAirports },
});

const icaos = (s: NearestData) => s.entries.map((e) => e.airport.icao);

describe('NearestAirportViewModel Tests', () => {
  test('nearestAirportEntryIdentifiable', () => {
    expect(entryId({ airport: kpao, distance: 0, bearing: 0 })).toBe('KPAO');
  });

  test('nearestAirportEntryDistance', () => {
    const entry: NearestAirportEntry = { airport: ksql, distance: 5.3, bearing: 315.0 };
    expect(entry.distance).toBe(5.3); // nautical miles
    expect(entry.bearing).toBe(315.0); // degrees true
  });

  test('viewModelInitialization', () => {
    const store = nearest.make(EMPTY);
    createNearestRefresher(store, defaultAirportQueries);
    expect(store.getState().entries[0] ?? null).toBeNull();
    expect(store.getState().entries).toEqual([]);
    expect(store.getState().loading).toBe(false);
  });

  test('airportRunwayData', () => {
    expect(kpao.runways[0]?.length).toBe(2443); // feet
    expect(kpao.runways[0]?.surface).toBe('asphalt');
    expect(kpao.frequencies[0]?.frequency).toBe(118.6); // MHz
  });

  test('airportCTAF', () => {
    expect(kpao.ctafFrequency).toBe(118.6); // MHz
    expect(ksfo.ctafFrequency ?? null).toBeNull();
  });

  test('airportTowerDetection', () => {
    expect(ksfo.frequencies.some((f) => f.type === 'tower')).toBe(true);
    expect(ksql.frequencies.some((f) => f.type === 'tower')).toBe(false);
  });
});

describe('Landable Airport Filter Tests (NearestAirportEntry)', () => {
  test('militaryIsFlaggedMilNotPvtAndStillListed', () => {
    const moffett = makeAirport({
      icao: 'KNUQ',
      name: 'Moffett',
      latitude: 37.4,
      longitude: -122.0,
      elevation: 32,
      type: 'airport',
      ownership: 'military',
      runways: [rwy('14R/32L', 9200, 200, 'asphalt', 37.4, -122.0)],
    });
    const entry: NearestAirportEntry = { airport: moffett, distance: 3, bearing: 90 };
    expect(entryIsMilitary(entry) && !entryIsPrivateUse(entry)).toBe(true);
  });
});

test('entryExtras: the computed properties the footer speaks', () => {
  const knuq = FIXTURE_AIRPORTS.find((a) => a.icao === 'KNUQ')!;
  expect(entryExtras({ airport: knuq, distance: 6.1, bearing: 126 })).toEqual({
    runwaySummary: "9197' CONC",
    isPrivateUse: true,
    isMilitary: false,
    requiresPPR: false,
    isClosedByNotam: false,
  });
  const israeli = {
    airport: kpao,
    distance: 1,
    bearing: 1,
    israel: { requiresPPR: true, closureNotamIDs: ['C1/26'], isReviewed: true },
  };
  expect(entryExtras(israeli)).toMatchObject({ requiresPPR: true, isClosedByNotam: true });
});

describe('row text', () => {
  const entry = (airport: Airport): NearestAirportEntry => ({ airport, distance: 0, bearing: 0 });

  test('runway summary has no grouping; the row groups thousands and puts two spaces after the ident', () => {
    expect(runwaySummary(entry(kpao))).toBe("2443' ASPH");
    expect(rowRunwayText(entry(ksfo))).toBe("10L/28R  11,870' ASPH");
    const bare = makeAirport({ ...kpao, runways: [] });
    expect(runwaySummary(entry(bare))).toBeNull();
    expect(rowRunwayText(entry(bare))).toBe('no runway data');
  });

  test('distance and bearing print like String(format:) with printf rounding', () => {
    expect(distanceText(2.03)).toBe('2.0 NM');
    expect(distanceText(20.55)).toBe('20.6 NM'); // binary 20.550000000000000711 rounds up
    expect(printfFixed(2.25, 1)).toBe('2.2'); // exact tie: to even (toFixed says 2.3)
    expect(printfFixed(116.5, 0)).toBe('116');
    // Not ties: 0.35 * 10 is exactly 3.5 in floating point, but the binary value 0.34999999999999997 is below the tie.
    expect([0.35, 0.45, 0.05, 1.15].map(distanceText)).toEqual(['0.3 NM', '0.5 NM', '0.1 NM', '1.1 NM']);
    expect(bearingText(8.2)).toBe('008\u00B0');
    expect(bearingText(359.6)).toBe('360\u00B0'); // Swift prints 360 too (preserved)
    expect(distanceText(Number.NaN)).toBe('nan NM');
  });
});

describe('refresh policy', () => {
  test('the fixture reproduces the reference list from the fixture ownship', async () => {
    const store = nearest.make(EMPTY);
    await createNearestRefresher(store, defaultAirportQueries).update(FIXTURE_OWNSHIP, 'us');
    const rows = store
      .getState()
      .entries.map((e) => `${e.airport.icao} ${distanceText(e.distance)} ${bearingText(e.bearing)}`);
    expect(rows).toEqual([
      'KPAO 2.0 NM 116\u00B0',
      'KSQL 5.1 NM 295\u00B0',
      'KNUQ 6.1 NM 126\u00B0',
      'KHWD 11.1 NM 008\u00B0',
      'KSJC 12.7 NM 122\u00B0',
      'KSFO 13.6 NM 309\u00B0',
      'KOAK 15.1 NM 348\u00B0',
      'KHAF 16.7 NM 278\u00B0',
      'KRHV 18.1 NM 118\u00B0',
      'KLVK 20.6 NM 050\u00B0',
    ]);
    expect(store.getState().entries.map(rowRunwayText)).toEqual([
      "13/31  2,441' ASPH",
      "12/30  2,621' ASPH",
      "14L/32R  9,197' CONC",
      "10R/28L  5,694' ASPH",
      "12L/30R  11,000' CONC",
      "10L/28R  11,870' ASPH",
      "12/30  10,520' ASPH",
      "12/30  5,000' ASPH",
      "13L/31R  3,100' ASPH",
      "07L/25R  5,253' ASPH",
    ]);
    // The default store is seeded with the same list, so the footer's NRST cell shows KPAO before any refresh.
    expect(nearest.store.getState().entries).toEqual(store.getState().entries);
    expect(FIXTURE_AIRPORTS.some((a) => a.type === 'heliport')).toBe(true); // and the filter dropped it
  });

  test('requeries only after ownship moves 0.5 NM, or the region changes', async () => {
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    await refresher.update({ lat: 37.5, lon: -122.2 }, 'us');
    await refresher.update({ lat: 37.5 + 0.4 / 60, lon: -122.2 }, 'us'); // 0.4 NM north
    expect(query).toHaveBeenCalledTimes(1);
    await refresher.update({ lat: 37.5 + 0.6 / 60, lon: -122.2 }, 'us'); // 0.6 NM from the last query
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith({ lat: 37.5 + 0.6 / 60, lon: -122.2 }, 40);
  });

  test('a fix during an in-flight query near its position sends no second query', async () => {
    const pending = deferred();
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    query.mockReturnValueOnce(pending.promise);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    const first = refresher.update(FIXTURE_OWNSHIP, 'us');
    expect(store.getState().loading).toBe(true);
    await refresher.update({ lat: FIXTURE_OWNSHIP.lat + 0.1 / 60, lon: FIXTURE_OWNSHIP.lon }, 'us');
    expect(query).toHaveBeenCalledTimes(1);
    pending.resolve([...FIXTURE_AIRPORTS]);
    await first;
    expect(store.getState().loading).toBe(false);
    expect(icaos(store.getState())[0]).toBe('KPAO');
  });

  test("a failure after a region change clears the other region's list and the next fix requeries", async () => {
    const israel = {
      nearestAerodromes: jest.fn().mockRejectedValue(new Error('israel database missing')),
      searchAerodromes: jest.fn().mockResolvedValue([]),
    };
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, { ...defaultAirportQueries, israel });
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    expect(store.getState().entries.length).toBeGreaterThan(0);
    await refresher.update(FIXTURE_OWNSHIP, 'israel'); // same spot, other region, fails
    expect(store.getState().entries).toEqual([]); // never US airports listed as the Israeli nearest
    expect(store.getState().error).toBe('israel database missing');
    await refresher.update(FIXTURE_OWNSHIP, 'israel'); // same spot again: retried
    expect(israel.nearestAerodromes).toHaveBeenCalledTimes(2);
  });

  test("a first query that fails clears the store's seed instead of showing it as this region's list", async () => {
    const store = nearest.make({ ...EMPTY, entries: [{ airport: kpao, distance: 2, bearing: 116 }] }); // the seeded default
    const query = jest.fn().mockRejectedValue(new Error('database is locked'));
    await createNearestRefresher(store, queriesWith(query)).update(FIXTURE_OWNSHIP, 'us');
    expect(store.getState().entries).toEqual([]);
    expect(store.getState().error).toBe('database is locked');
  });

  test("a region change drops the other region's list at once, with no position and with a late old answer", async () => {
    const slow = deferred();
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    expect(store.getState().entries.length).toBeGreaterThan(0);
    refresher.setRegion('israel'); // the hook calls this even before there is a position
    expect(store.getState().entries).toEqual([]);
    refresher.setRegion('israel'); // idempotent
    // A US query still in flight when the region flips must not repopulate it.
    query.mockReturnValueOnce(slow.promise);
    const late = refresher.update({ lat: 40, lon: -100 }, 'us');
    refresher.setRegion('israel');
    slow.resolve(FIXTURE_AIRPORTS);
    await late;
    expect(store.getState().entries).toEqual([]);
  });

  test('a failed refresh of the same region keeps its list', async () => {
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    const before = store.getState().entries;
    refresher.setRegion('us');
    expect(store.getState().entries).toBe(before);
  });

  test('a slow earlier query never overwrites a later one', async () => {
    const slow = deferred();
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    query.mockReturnValueOnce(slow.promise);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    const first = refresher.update({ lat: 37.0, lon: -122.0 }, 'us');
    await refresher.update(FIXTURE_OWNSHIP, 'us'); // second, answered first
    expect(icaos(store.getState())[0]).toBe('KPAO');
    slow.resolve(FIXTURE_AIRPORTS.filter((a) => a.icao === 'KSFO')); // the first answer arrives late
    await first;
    expect(icaos(store.getState())).toHaveLength(10);
    expect(icaos(store.getState())[0]).toBe('KPAO');
    expect(store.getState().loading).toBe(false);
  });

  test('a rejecting query keeps the previous list, reports the error, and the next fix retries', async () => {
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    const before = store.getState().entries;
    query.mockRejectedValueOnce(new Error('database is locked'));
    const moved = { lat: FIXTURE_OWNSHIP.lat + 1 / 60, lon: FIXTURE_OWNSHIP.lon };
    await refresher.update(moved, 'us');
    expect(store.getState().entries).toBe(before); // never a failure cached as an empty list
    expect(store.getState().error).toBe('database is locked');
    expect(store.getState().loading).toBe(false);
    await refresher.update(moved, 'us'); // same spot: retried, since the failed query does not count
    expect(query).toHaveBeenCalledTimes(3);
    expect(store.getState().error).toBeNull();
  });

  test('a synchronous throw is handled like a rejection', async () => {
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(
      store,
      queriesWith(() => {
        throw new Error('closed');
      }),
    );
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    expect(store.getState()).toMatchObject({ entries: [], loading: false, error: 'closed' });
  });

  test('an earlier failure arriving after a later success does not set the error', async () => {
    const slow = deferred();
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    query.mockReturnValueOnce(slow.promise);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queriesWith(query));
    const first = refresher.update({ lat: 37.0, lon: -122.0 }, 'us');
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    slow.reject(new Error('late failure'));
    await first;
    expect(store.getState().error).toBeNull();
    expect(icaos(store.getState())[0]).toBe('KPAO');
  });

  test('swapping the queries while a slow query is in flight: the old answer never overwrites the new list', async () => {
    const slow = deferred();
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(
      store,
      queriesWith(() => slow.promise),
    );
    const first = refresher.update(FIXTURE_OWNSHIP, 'us');
    const swapped = jest.fn(async () => FIXTURE_AIRPORTS.filter((a) => a.icao === 'KSQL'));
    refresher.setQueries(queriesWith(swapped));
    await refresher.update(FIXTURE_OWNSHIP, 'us'); // same spot: the swap forgot the move threshold
    expect(swapped).toHaveBeenCalledTimes(1);
    expect(icaos(store.getState())).toEqual(['KSQL']);
    slow.resolve([...FIXTURE_AIRPORTS]); // the old database answers late
    await first;
    expect(icaos(store.getState())).toEqual(['KSQL']);
    expect(store.getState().loading).toBe(false);
  });

  test('setting the same queries object again changes nothing', async () => {
    const query = jest.fn(createFakeAviationDatabase().nearestAirports);
    const queries = queriesWith(query);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queries);
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    refresher.setQueries(queries);
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('a fresh queries object holding the same sources neither drops an in-flight answer nor requeries', async () => {
    const slow = deferred();
    const query = jest.fn(() => slow.promise);
    const queries = queriesWith(query);
    const store = nearest.make(EMPTY);
    const refresher = createNearestRefresher(store, queries);
    const first = refresher.update(FIXTURE_OWNSHIP, 'us');
    refresher.setQueries({ ...queries }); // e.g. an inline provider value, rebuilt on the next render
    await refresher.update(FIXTURE_OWNSHIP, 'us');
    slow.resolve([...FIXTURE_AIRPORTS]);
    await first;
    expect(query).toHaveBeenCalledTimes(1);
    expect(icaos(store.getState())[0]).toBe('KPAO');
  });
});
