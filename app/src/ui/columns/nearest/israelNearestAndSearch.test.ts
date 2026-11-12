// Port of efb-212Tests/ViewModelTests/IsraelNearestAndSearchTests.swift: the NRST, search and adapter cases (12 of 18).
// Not here: the four closingNotams cases (L3/S1: NOTAM feed types and matching) and the two IsraelAerodromeSection
// sheet-text cases (U4b). See app/docs/port-notes/U4.md.
import type { IsraelAviationDatabase } from '../../../data/aviation/israelDatabase';
import type {
  IsraelAerodrome,
  IsraelAerodromeReviewStatus,
  IsraelAerodromeRunway,
  IsraelAerodromeType,
  IsraelAerodromeUse,
  IsraelPPR,
} from '../../../data/aviation/israelTypes';
import { WHOLE_COUNTRY } from '../../../data/aviation/israelTypes';
import { distanceNm, isLandable, type Airport, type Coordinate, type Region } from '../../../domain/core';
import { openBundledIsrael } from '../../../../tests/data/aviation/israelBundled';
import { createAirportSearch, searchSlice } from '../search/search';
import {
  NOT_LANDABLE_USES,
  frequencyType,
  israelAirport,
  israelFrequency,
  israelSurface,
} from './israelAerodromeAdapter';
import { entryIsPrivateUse, isClosedByNotam, requiresPPR } from './logic';
import { createNearestRefresher } from './refresh';
import { defaultAirportQueries, type AirportQueries, type NotamClosureLookup } from './sources';
import { regionSlice } from '../../state/region';
import { nearest, type NearestData } from './store';
import { kpao } from './__fixtures__/swiftAirports';

const runway = (designator: string, length: number, width = 30, surface = 'asphalt'): IsraelAerodromeRunway => ({
  id: 1,
  designator,
  lengthMetres: length,
  widthMetres: width,
  surface,
  headingA: 100,
  headingB: 280,
  headingIsTrue: true,
});

function aerodrome(
  code: string,
  o: {
    he?: string;
    lat: number;
    lon: number;
    type?: IsraelAerodromeType;
    use?: IsraelAerodromeUse;
    ppr?: IsraelPPR;
    runways?: IsraelAerodromeRunway[];
    review?: IsraelAerodromeReviewStatus;
  },
): IsraelAerodrome {
  return {
    id: code.length,
    code,
    nameHebrew: o.he ?? '\u05E9\u05D3\u05D4',
    nameEnglish: `${code} field`,
    type: o.type ?? 'airport',
    use: o.use ?? 'civil',
    latitude: o.lat,
    longitude: o.lon,
    elevationFeet: 100,
    circuitAltitudeFeet: 800,
    circuitDirection: null,
    hours: null,
    ppr: o.ppr ?? 'no',
    pprText: null,
    remarks: null,
    sources: {
      identity: 'AIP 1/26 p1',
      runways: 'AIP 1/26 p2',
      frequencies: null,
      circuit: null,
      hours: null,
      remarks: null,
    },
    uncertainGroups: [],
    notes: null,
    reviewStatus: o.review ?? 'unreviewed',
    runways: o.runways ?? [runway('10/28', 1000)],
    frequencies: [],
  };
}

/** Ownship near Herzliya. */
const here: Coordinate = { lat: 32.18, lon: 34.83 };
const HERZLIYA_HE = '\u05D4\u05E8\u05E6\u05DC\u05D9\u05D4';

const AERODROMES = [
  aerodrome('LLHZ', { he: HERZLIYA_HE, lat: 32.1794, lon: 34.8344 }),
  aerodrome('LLRS', {
    he: '\u05E8\u05D0\u05E9\u05D5\u05DF \u05DC\u05E6\u05D9\u05D5\u05DF',
    lat: 31.9675,
    lon: 34.7536,
    ppr: 'yes',
    runways: [runway('18/36', 660, 9)],
  }),
  aerodrome('ICHILOV', {
    lat: 32.08,
    lon: 34.79,
    type: 'heliport',
    use: 'hospital',
    runways: [runway('08/26', 28, 30, 'concrete')],
  }),
  aerodrome('LLES', { lat: 32.44, lon: 35.0, use: 'uas' }),
  aerodrome('ULTRA', { lat: 32.18, lon: 34.83, use: 'ultralight' }), // closest field of all, ultralight only
  aerodrome('GVULT', { lat: 31.2275, lon: 34.4603, use: 'agricultural', ppr: 'yes', runways: [] }),
  aerodrome('LLEK', { lat: 31.84, lon: 34.82, use: 'military', runways: [runway('?', 2450, 30, 'unknown')] }),
  aerodrome('LLBG', {
    he: '\u05D1\u05DF \u05D2\u05D5\u05E8\u05D9\u05D5\u05DF',
    lat: 32.0094,
    lon: 34.8856,
    runways: [runway('08/26', 4062, 45)],
  }),
];

/** MockIsraelAviationDatabase: nearest by distance, search by code prefix, English or Hebrew name. */
const israelDb: Pick<IsraelAviationDatabase, 'nearestAerodromes' | 'searchAerodromes'> = {
  nearestAerodromes: async (c, count) =>
    [...AERODROMES]
      .sort(
        (a, b) =>
          distanceNm(c, { lat: a.latitude, lon: a.longitude }) - distanceNm(c, { lat: b.latitude, lon: b.longitude }),
      )
      .slice(0, count),
  searchAerodromes: async (query, limit) => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return AERODROMES.filter(
      (a) => a.code.toLowerCase().startsWith(q) || a.nameEnglish.toLowerCase().includes(q) || a.nameHebrew.includes(q),
    ).slice(0, limit);
  },
};

/** MockDatabaseManager: `nearestAirports` is the list prefix, `searchAirports` matches ICAO or name. */
const usDb = (airports: Airport[]) =>
  ({
    nearestAirports: async (_c: Coordinate, count: number) => airports.slice(0, count),
    searchAirports: async (query: string) =>
      airports.filter(
        (a) => a.icao.includes(query.toUpperCase()) || a.name.toLowerCase().includes(query.toLowerCase()),
      ),
  }) as unknown as AirportQueries['aviation'];

function viewModel(o: { region?: Region; notams?: () => Promise<NotamClosureLookup>; us?: Airport[] } = {}) {
  const store = nearest.make({
    entries: [],
    loading: false,
    error: null,
    ownship: null,
    directTo: () => {},
  });
  const regionStore = regionSlice.make({ region: o.region ?? 'israel' }); // AppState.region
  const queries: AirportQueries = {
    ...defaultAirportQueries,
    aviation: usDb(o.us ?? []),
    israel: israelDb,
    fetchNotamClosures: o.notams ?? null,
  };
  const refresher = createNearestRefresher(store, queries);
  const update = (position: Coordinate) => refresher.update(position, regionStore.getState().region);
  return { store, regionStore, update };
}

const codes = (s: NearestData) => s.entries.map((e) => e.airport.icao);
/** Let the NOTAM fetch's promise callbacks run (no wall-clock wait). */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Israel NRST and Search Tests', () => {
  // MARK: - NRST in Israel

  test('nrstListsLandableAerodromesNearestFirstAndSkipsTheRest', async () => {
    const { store, update } = viewModel();
    await update(here);
    // heliport, UAS strip, no-runway strip and unknown-surface military field are dropped
    expect(codes(store.getState())).toEqual(['LLHZ', 'LLBG', 'LLRS']);
    const distances = store.getState().entries.map((e) => e.distance); // nautical miles
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(Math.abs(distances[0]! - 0.1)).toBeLessThan(0.2);
  });

  test('nrstExcludesUltralightOnlyStrips', async () => {
    const { store, update } = viewModel();
    await update(here);
    expect(codes(store.getState())).not.toContain('ULTRA');
    expect(codes(store.getState())[0]).toBe('LLHZ');
    expect(NOT_LANDABLE_USES.has('ultralight')).toBe(true);
  });

  test('theBundledUltralightStripsAreMarkedUltralightAndSkippedByNrst', async () => {
    const { db, close } = await openBundledIsrael();
    try {
      const rishon = await db.aerodrome('LLRS');
      const einVered = await db.aerodrome('LLEV');
      expect(rishon?.use).toBe('ultralight');
      expect(einVered?.use).toBe('ultralight');
      const store = nearest.make({ ...nearest.store.getState(), entries: [] });
      const refresher = createNearestRefresher(store, { ...defaultAirportQueries, israel: db });
      await refresher.update({ lat: 31.9675, lon: 34.7536 }, 'israel'); // on the LLRS reference point
      expect(codes(store.getState())).not.toContain('LLRS');
      expect(codes(store.getState())).not.toContain('LLEV');
      expect(store.getState().entries.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test('nrstFlagsPPRFromTheAIPAndNothingElse', async () => {
    const { store, update } = viewModel();
    await update(here);
    const byCode = new Map(store.getState().entries.map((e) => [e.airport.icao, e]));
    expect(requiresPPR(byCode.get('LLRS')!)).toBe(true);
    expect(requiresPPR(byCode.get('LLHZ')!)).toBe(false);
    expect(byCode.get('LLRS')?.israel?.isReviewed).toBe(false);
    expect(isClosedByNotam(byCode.get('LLHZ')!)).toBe(false); // no feed: no closure claim either way
    expect(entryIsPrivateUse(byCode.get('LLHZ')!)).toBe(false); // PPR is its own tag, not the US private-use flag
  });

  test('switchingRegionRequeriesWithoutMoving', async () => {
    const { store, regionStore, update } = viewModel({ region: 'us', us: [kpao] });
    await update(here);
    expect(codes(store.getState())).toEqual(['KPAO']);
    expect(store.getState().entries[0]?.israel ?? null).toBeNull();
    regionStore.setState({ region: 'israel' });
    await update(here); // same spot
    expect(codes(store.getState())).toEqual(['LLHZ', 'LLBG', 'LLRS']);
  });

  test('nrstFlagsAFieldAFreshNotamNamesClosed', async () => {
    // TODO(L3/S1): the lookup stands in for closingNotams over a fresh feed with "LLHZ AD CLSD TO ALL FLT" (C1/26).
    const lookup: NotamClosureLookup = (code) => (code === 'LLHZ' ? ['C1/26'] : []);
    const { store, update } = viewModel({ notams: async () => lookup });
    await update(here);
    await flush();
    expect(isClosedByNotam(store.getState().entries[0]!)).toBe(true);
    expect(store.getState().entries[0]?.israel?.closureNotamIDs).toEqual(['C1/26']);
    expect(isClosedByNotam(store.getState().entries.find((e) => e.airport.icao === 'LLBG')!)).toBe(false);
  });

  test('aFailedNotamFetchLeavesTheListUnflaggedNotBroken', async () => {
    const { store, update } = viewModel({ notams: () => Promise.reject(new Error('notConfigured')) });
    await update(here);
    await flush();
    expect(store.getState().entries).toHaveLength(3);
    expect(store.getState().entries.every((e) => !isClosedByNotam(e))).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  test('aNotamFetchThatThrowsBeforeReturningAPromiseLeavesTheListUnflaggedAndNoError', async () => {
    const notams = jest.fn((): Promise<NotamClosureLookup> => {
      throw new Error('synchronous failure');
    });
    const { store, update } = viewModel({ notams });
    await update(here);
    await flush();
    expect(notams).toHaveBeenCalledTimes(1);
    expect(store.getState().entries).toHaveLength(3);
    expect(store.getState().error).toBeNull(); // not reported as an airport refresh failure
  });

  test('theNotamFeedRefreshesOnItsOwnClockWhileOwnshipStaysWithinHalfANauticalMile', async () => {
    let clock = 1_000_000;
    let closed = false;
    const notams = jest.fn(
      async (): Promise<NotamClosureLookup> => (code) => (closed && code === 'LLHZ' ? ['C2/26'] : []),
    );
    const store = nearest.make({ entries: [], loading: false, error: null, ownship: null, directTo: () => {} });
    const refresher = createNearestRefresher(store, {
      ...defaultAirportQueries,
      aviation: usDb([]),
      israel: israelDb,
      fetchNotamClosures: notams,
      now: () => clock,
    });
    await refresher.update(here, 'israel');
    await flush();
    expect(notams).toHaveBeenCalledTimes(1);
    expect(isClosedByNotam(store.getState().entries[0]!)).toBe(false);
    closed = true;
    clock += 24 * 3_600_000; // far past the refresh interval
    await refresher.update({ lat: here.lat + 0.001, lon: here.lon }, 'israel'); // 0.06 NM: no airport requery
    await flush();
    expect(notams).toHaveBeenCalledTimes(2);
    expect(isClosedByNotam(store.getState().entries[0]!)).toBe(true);
  });

  // MARK: - Search

  function search(region: () => Region) {
    const store = searchSlice.make();
    const s = createAirportSearch(store, { queries: () => ({ aviation: usDb([kpao]), israel: israelDb }), region });
    const run = async (query: string) => {
      s.setQuery(query);
      await jest.advanceTimersByTimeAsync(300);
      return store.getState().results.map((a) => a.icao);
    };
    return run;
  }

  describe('search', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('searchInIsraelFindsByHebrewEnglishAndCode', async () => {
      const run = search(() => 'israel');
      expect(await run(HERZLIYA_HE)).toEqual(['LLHZ']);
      expect(await run('LLBG field')).toEqual(['LLBG']);
      expect(await run('llrs')).toEqual(['LLRS']);
    });

    test('searchOutsideIsraelStillUsesTheAviationDatabase', async () => {
      const run = search(() => 'us');
      expect(await run('Palo')).toEqual(['KPAO']);
      expect(await run(HERZLIYA_HE)).toEqual([]);
    });
  });

  // MARK: - Adapter units

  test('runwayLengthsConvertFromMetresToFeet', () => {
    const airport = israelAirport(aerodrome('LLHZ', { lat: 32.18, lon: 34.83, runways: [runway('10/28', 903, 18)] }));
    const r = airport.runways[0]!;
    expect(r.length === 2963 && r.width === 59).toBe(true); // feet
    expect(r.baseEndID === '10' && r.reciprocalEndID === '28').toBe(true);
    expect(r.surface).toBe('asphalt');
    expect(airport.elevation).toBe(100); // feet MSL
  });

  test('frequencyRolesFollowTheAIPWording', () => {
    expect(frequencyType('TWR primary')).toBe('tower');
    expect(frequencyType('GND west of RWY 21')).toBe('ground');
    expect(frequencyType('ATIS arrival')).toBe('atis');
    expect(frequencyType('Airstrip operator channel (Teyman)')).toBe('ctaf');
    expect(frequencyType('Emergency')).toBe('other');
  });

  test('militaryFieldsMapToMilitaryOwnershipAndHeliportsToHeliports', () => {
    const mil = israelAirport(aerodrome('LLEK', { lat: 31.8, lon: 34.8, use: 'military' }));
    expect(mil.ownership).toBe('military');
    const pad = israelAirport(aerodrome('ICHILOV', { lat: 32.0, lon: 34.8, type: 'heliport', use: 'hospital' }));
    expect(pad.type).toBe('heliport');
    expect(isLandable(pad)).toBe(false);
  });

  // JS-only checks of the adapter against the Swift semantics (review N7, N8).

  test.each([
    ['10/28', '10', '28'],
    ['H1', 'H1', ''], // no slash
    ['?', '?', ''],
    ['/09', '09', ''], // split(separator:maxSplits:) omits the empty leading part
    ['09/', '09', ''],
    ['09//27', '09', '/27'], // one split, the rest kept as is
    ['//09/27', '09', '27'],
    ['/', '/', ''], // no parts: baseEndID falls back to the designator
  ])('runway ends of %j split like Swift split(separator: "/", maxSplits: 1)', (designator, base, reciprocal) => {
    const airport = israelAirport(aerodrome('LLXX', { lat: 32, lon: 34.8, runways: [runway(designator, 900)] }));
    expect(airport.runways[0]).toMatchObject({ id: designator, baseEndID: base, reciprocalEndID: reciprocal });
  });

  test.each([
    ['asphalt', 'asphalt'],
    ['concrete+asphalt', 'concrete'],
    ['asphalt/concrete', 'asphalt'],
    ['+asphalt', 'asphalt'],
    ['grass', 'turf'],
    ['gravel', 'gravel'],
    ['dirt', 'dirt'],
    ['unknown', 'other'],
    ['', 'other'],
  ])('surface %j maps to %s (composites take their first part)', (text, surface) => {
    expect(israelSurface(text)).toBe(surface);
  });

  test('the bundled composite surfaces map to their first part', async () => {
    const { db, close } = await openBundledIsrael();
    try {
      const surfaces = (await db.aerodromesIn(WHOLE_COUNTRY)).flatMap((a) => a.runways.map((r) => r.surface));
      expect(surfaces.filter((s) => s === 'concrete+asphalt')).toHaveLength(5);
      expect(surfaces.filter((s) => s === 'asphalt/concrete')).toHaveLength(2);
      expect(israelSurface('concrete+asphalt')).toBe('concrete');
      expect(israelSurface('asphalt/concrete')).toBe('asphalt');
      const mhz = (await db.aerodromesIn(WHOLE_COUNTRY)).flatMap((a) => a.frequencies.map((f) => f.mhz));
      expect(mhz.every((m) => /^\d+\.\d+$/.test(m))).toBe(true); // plain decimals: Swift Double(_:) and the regex agree
    } finally {
      await close();
    }
  });

  test('israelFrequency keeps the MHz, takes the role from the AIP wording and names the Hebrew callsign', () => {
    const at = aerodrome('LLHZ', { lat: 32.18, lon: 34.83 });
    const source = { id: 7, mhz: '122.200', service: 'TWR primary', callsignHebrew: HERZLIYA_HE };
    expect(israelFrequency(source, at)).toEqual({
      id: 'LLHZ-7',
      type: 'tower',
      frequency: 122.2,
      name: `TWR primary (${HERZLIYA_HE})`,
    });
    expect(
      israelFrequency({ ...source, service: 'Airstrip operator channel', callsignHebrew: null }, at),
    ).toMatchObject({
      type: 'ctaf',
      name: 'Airstrip operator channel',
    });
    expect(israelFrequency({ ...source, mhz: '' }, at)).toBeNull();
    expect(israelFrequency({ ...source, mhz: 'n/a' }, at)).toBeNull();
    const withFrequencies = israelAirport({ ...at, frequencies: [source, { ...source, id: 8, mhz: '?' }] });
    expect(withFrequencies.frequencies.map((f) => f.id)).toEqual(['LLHZ-7']);
  });
});
