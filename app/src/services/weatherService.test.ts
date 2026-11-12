// Port of ServiceTests/WeatherServiceTests.swift (21 tests; 2 staleness cases belong to L1's WeatherCache),
// ServiceTests/WeatherParsingTests.swift (5) and CharacterizationTests/WeatherCacheClockCharacterizationTests.swift (7).
import { makeWeatherCache, weatherCacheAge, weatherCacheIsStale } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { computeFlightCategory, parseMetarResponse } from './weather';
import { WeatherService } from './weatherService';
import { fakeFetch, TestClock, type FakeFetch, type StubReply } from './testSupport';

let counter = 0;
const newId = () => `id-${++counter}`;
const t0 = 1_800_000_000_000;

const requestedIDs = (url: string): string[] =>
  decodeURIComponent(/[?&]ids=([^&]*)/.exec(url)?.[1] ?? '')
    .split(',')
    .filter((s) => s !== '');
const metarJSON = (ids: string[]) =>
  `[${ids.map((id) => `{"icaoId":"${id}","fltCat":"VFR","visib":"10+"}`).join(',')}]`;

function computedCategory(ceilingFeet: number | null, visibilitySM: string | null) {
  const fields = ['"icaoId":"KTST"'];
  if (visibilitySM !== null) fields.push(`"visib":"${visibilitySM}"`);
  if (ceilingFeet !== null) fields.push(`"clouds":[{"cover":"BKN","base":${ceilingFeet}}]`);
  return parseMetarResponse(`[{${fields.join(',')}}]`, 0, newId)[0].flightCategory;
}

const service = (fetch: FakeFetch, clock?: TestClock) => new WeatherService({ fetch, now: clock?.now, newId });
const echo = () => fakeFetch((url): StubReply => ({ body: metarJSON(requestedIDs(url)) }));

// MARK: Flight category thresholds (FAA: ceiling and visibility, worst wins)

test.each([
  [3001, 'vfr'],
  [3000, 'mvfr'],
  [1000, 'mvfr'],
  [999, 'ifr'],
  [500, 'ifr'],
  [499, 'lifr'],
] as const)('ceilingBoundaries %p', (ceiling, expected) => {
  expect(computedCategory(ceiling, '10')).toBe(expected);
});

test.each([
  ['6', 'vfr'],
  ['5', 'mvfr'],
  ['3', 'mvfr'],
  ['2.9', 'ifr'],
  ['1', 'ifr'],
  ['0.5', 'lifr'],
] as const)('visibilityBoundaries %p', (visibility, expected) => {
  expect(computedCategory(null, visibility)).toBe(expected);
});

test('worseOfCeilingAndVisibilityWins', () => {
  expect(computedCategory(8000, '2')).toBe('ifr'); // ceiling alone would be VFR, visibility alone IFR
  expect(computedCategory(300, '10')).toBe('lifr'); // ceiling alone LIFR, visibility alone VFR
});

test('noCeilingAndNoVisibilityDefaultsToVFR', () => {
  expect(computedCategory(null, null)).toBe('vfr');
});

test('noaaFlightCategoryOverridesComputedOne', () => {
  // NOAA says LIFR even though the numbers alone would say VFR; the report is authoritative.
  expect(parseMetarResponse('[{"icaoId":"KTST","fltCat":"LIFR","visib":"10"}]', 0, newId)[0].flightCategory).toBe(
    'lifr',
  );
});

test('entriesWithoutStationIdAreDropped', () => {
  expect(
    parseMetarResponse('[{"fltCat":"VFR"},{"icaoId":"KPAO","fltCat":"VFR"}]', 0, newId).map((w) => w.stationID),
  ).toEqual(['KPAO']);
});

test('nonArrayPayloadThrowsWeatherFetchFailed', () => {
  expect(() => parseMetarResponse('{"error":"nope"}', 0, newId)).toThrow(AppFailure);
});

// MARK: fetchMETAR failures

test('serverErrorThrowsAndLeavesCacheEmpty', async () => {
  const s = service(fakeFetch(() => ({ status: 500 })));
  await expect(s.fetchMETAR('KPAO')).rejects.toBeInstanceOf(AppFailure);
  expect(s.cachedWeather('KPAO')).toBeNull();
});

test('emptyArrayForUnknownStationThrows', async () => {
  await expect(service(fakeFetch(() => ({ body: '[]' }))).fetchMETAR('KZZZ')).rejects.toBeInstanceOf(AppFailure);
});

test('transportFailureSurfacesAsAnError', async () => {
  const s = service(
    fakeFetch(() => {
      throw new TypeError('Network request failed');
    }),
  );
  await expect(s.fetchMETAR('KPAO')).rejects.toThrow();
});

// MARK: Cache

test('secondFetchWithinFifteenMinutesIsServedFromCache', async () => {
  const fetch = echo();
  const s = service(fetch);
  const first = await s.fetchMETAR('KPAO');
  const second = await s.fetchMETAR('KPAO');
  expect(fetch.calls).toHaveLength(1);
  expect(second).toEqual(first);
});

test('clearingCacheForcesANetworkFetch', async () => {
  const fetch = echo();
  const s = service(fetch);
  await s.fetchMETAR('KPAO');
  s.clearCache('KPAO');
  await s.fetchMETAR('KPAO');
  expect(fetch.calls).toHaveLength(2);
});

// MARK: Batch fetch

test('emptyStationListMakesNoRequest', async () => {
  const fetch = fakeFetch(() => ({ body: '[]' }));
  expect(await service(fetch).fetchWeatherForStations([])).toEqual([]);
  expect(fetch.calls).toHaveLength(0);
});

const ids45 = Array.from({ length: 45 }, (_, i) => `K${String(i).padStart(3, '0')}`);

test('largeStationListIsSplitIntoBatchesOfForty', async () => {
  const fetch = echo();
  const results = await service(fetch).fetchWeatherForStations(ids45);
  expect(results).toHaveLength(45);
  expect(fetch.calls).toHaveLength(2);
  expect(fetch.calls.map((c) => requestedIDs(c.url).length)).toEqual([40, 5]);
});

test('batchFetchSkipsCachedStationsAndOnlyRequestsTheRest', async () => {
  const fetch = echo();
  const s = service(fetch);
  await s.fetchMETAR('KPAO');
  const results = await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  expect(new Set(results.map((r) => r.stationID))).toEqual(new Set(['KPAO', 'KSQL']));
  expect(fetch.calls).toHaveLength(2);
  expect(requestedIDs(fetch.calls[1].url)).toEqual(['KSQL']);
});

test('failedBatchDoesNotLoseTheOtherBatch', async () => {
  const fetch = fakeFetch((url, call): StubReply =>
    call === 1 ? { status: 503 } : { body: metarJSON(requestedIDs(url)) },
  );
  const results = await service(fetch).fetchWeatherForStations(ids45);
  expect(results).toHaveLength(5);
  expect(new Set(results.map((r) => r.stationID))).toEqual(new Set(ids45.slice(-5)));
});

// MARK: TAF

test('fetchTAFReturnsRawText', async () => {
  const body = '[{"icaoId":"KPAO","rawTAF":"TAF KPAO 301130Z 3012/3112 33008KT P6SM SKC"}]';
  expect(await service(fakeFetch(() => ({ body }))).fetchTAF('KPAO')).toBe(
    'TAF KPAO 301130Z 3012/3112 33008KT P6SM SKC',
  );
});

test('fetchTAFWithoutRawTextThrows', async () => {
  await expect(service(fakeFetch(() => ({ body: '[{"icaoId":"KPAO"}]' }))).fetchTAF('KPAO')).rejects.toBeInstanceOf(
    AppFailure,
  );
});

test('fetchTAFHTTPErrorThrows', async () => {
  await expect(service(fakeFetch(() => ({ status: 404 }))).fetchTAF('KPAO')).rejects.toBeInstanceOf(AppFailure);
});

// MARK: WeatherCache staleness (the model is L1's; the Swift tests live in this suite)

test('stalenessThresholdIsSixtyMinutes', () => {
  const now = Date.now();
  expect(weatherCacheIsStale(makeWeatherCache({ id: 'a', stationID: 'KPAO', fetchedAt: now - 3_590_000 }), now)).toBe(
    false,
  );
  expect(weatherCacheIsStale(makeWeatherCache({ id: 'a', stationID: 'KPAO', fetchedAt: now - 3_610_000 }), now)).toBe(
    true,
  );
});

test('ageGrowsWithTimeSinceFetch', () => {
  const now = Date.now();
  const age = weatherCacheAge(makeWeatherCache({ id: 'a', stationID: 'KPAO', fetchedAt: now - 7_200_000 }), now);
  expect(age).toBeGreaterThan(7195);
  expect(age).toBeLessThan(7210);
});

// MARK: Parsing of real NOAA shapes (WeatherParsingTests)

const kpaoJSON = `[{"icaoId":"KPAO","obsTime":1793332020,"reportTime":"2026-10-30T04:00:00.000Z",
  "temp":14,"dewp":9.4,"wdir":330,"wspd":6,"visib":"10+","fltCat":"VFR",
  "rawOb":"METAR KPAO 300253Z 33006KT 10SM BKN180 14/09 A3002",
  "clouds":[{"cover":"BKN","base":18000}]}]`;

test('parsesEpochObsTimeAsObservationTime', () => {
  const wx = parseMetarResponse(kpaoJSON, 0, newId)[0];
  expect(wx.observationTime).toBe(1_793_332_020_000);
  expect(wx.stationID).toBe('KPAO');
  expect(wx.ceiling).toBe(18000);
  expect(wx.visibility).toBe('10+');
  expect(wx.flightCategory).toBe('vfr');
  expect(wx.windDirection).toBe(330);
});

test('fallsBackToReportTimeWhenObsTimeMissing', () => {
  const wx = parseMetarResponse(
    '[{"icaoId":"KSQL","reportTime":"2026-10-30T04:00:00.000Z","fltCat":"MVFR"}]',
    0,
    newId,
  )[0];
  expect(wx.observationTime).toBe(Date.parse('2026-10-30T04:00:00Z'));
  expect(wx.flightCategory).toBe('mvfr');
});

test('missingTimesLeaveObservationTimeNil', () => {
  expect(parseMetarResponse('[{"icaoId":"KSQL"}]', 0, newId)[0].observationTime).toBeNull();
});

test('computesCategoryFromLowestCeilingWhenNoFltCat', () => {
  const wx = parseMetarResponse(
    '[{"icaoId":"KSFO","visib":10,"clouds":[{"cover":"FEW","base":400},{"cover":"OVC","base":800}]}]',
    0,
    newId,
  )[0];
  expect(wx.ceiling).toBe(800); // FEW is not a ceiling
  expect(wx.flightCategory).toBe('ifr'); // 500-999 ft
});

test('cachedWeatherReturnsEntryStoredByFetchUntilCleared', async () => {
  const s = service(fakeFetch(() => ({ body: kpaoJSON })));
  expect(s.cachedWeather('KPAO')).toBeNull();
  const fetched = await s.fetchMETAR('KPAO');
  expect(s.cachedWeather('KPAO')).toEqual(fetched);
  s.clearCache('KPAO');
  expect(s.cachedWeather('KPAO')).toBeNull();
});

// MARK: Cache window characterization

test('fetchStampsFetchedAtFromTheInjectedClock', async () => {
  const wx = await service(echo(), new TestClock(t0)).fetchMETAR('KPAO');
  expect(wx.fetchedAt).toBe(t0);
});

test('entryIsServedFromCacheAt899SecondsAndRefetchedAtExactly900', async () => {
  const clock = new TestClock(t0);
  const fetch = echo();
  const s = service(fetch, clock);
  await s.fetchMETAR('KPAO');
  expect(fetch.calls).toHaveLength(1);
  clock.advance(899);
  await s.fetchMETAR('KPAO');
  expect(fetch.calls).toHaveLength(1);
  clock.advance(1); // exactly 900 s: the comparison is strictly "<", so this refetches
  await s.fetchMETAR('KPAO');
  expect(fetch.calls).toHaveLength(2);
});

test('batchPathUsesTheSameBoundary', async () => {
  const clock = new TestClock(t0);
  const fetch = echo();
  const s = service(fetch, clock);
  await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  expect(fetch.calls).toHaveLength(1);
  clock.advance(899);
  await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  expect(fetch.calls).toHaveLength(1);
  clock.advance(1);
  await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  expect(fetch.calls).toHaveLength(2);
});

function switchable(): { fetch: FakeFetch; failing: { on: boolean } } {
  const failing = { on: false };
  const fetch = fakeFetch((url): StubReply => (failing.on ? { status: 500 } : { body: metarJSON(requestedIDs(url)) }));
  return { fetch, failing };
}

test('singleFetchAfterExpiryThrowsOnNetworkFailureInsteadOfServingTheStaleEntry', async () => {
  const clock = new TestClock(t0);
  const { fetch, failing } = switchable();
  const s = service(fetch, clock);
  await s.fetchMETAR('KPAO');
  clock.advance(901);
  failing.on = true;
  await expect(s.fetchMETAR('KPAO')).rejects.toThrow();
  // The stale entry is still there for callers that ask for it explicitly (the sheet's fallback).
  expect(s.cachedWeather('KPAO')?.fetchedAt).toBe(t0);
});

test('batchAfterExpiryServesStaleStationsFromCacheWhenTheBatchFails', async () => {
  const clock = new TestClock(t0);
  const { fetch, failing } = switchable();
  const s = service(fetch, clock);
  await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  clock.advance(901);
  failing.on = true;
  const results = await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  // efb-dv5: offline, expired stations are returned with their original fetch time instead of being dropped.
  expect(new Set(results.map((r) => r.stationID))).toEqual(new Set(['KPAO', 'KSQL']));
  expect(results.every((r) => r.fetchedAt === t0)).toBe(true);
});

test('partialBatchResultKeepsFreshStationsAndServesTheFailedExpiredOneFromCache', async () => {
  const clock = new TestClock(t0);
  const { fetch, failing } = switchable();
  const s = service(fetch, clock);
  await s.fetchWeatherForStations(['KPAO']);
  clock.advance(500);
  await s.fetchWeatherForStations(['KSQL']); // fetched later, so still fresh below
  clock.advance(401); // KPAO 901 s old, KSQL 401 s old
  failing.on = true;
  const results = await s.fetchWeatherForStations(['KPAO', 'KSQL']);
  // The fresh station first, then the expired one served from cache.
  expect(results.map((r) => r.stationID)).toEqual(['KSQL', 'KPAO']);
  expect(results.find((r) => r.stationID === 'KPAO')?.fetchedAt).toBe(t0);
});

test('cachedWeatherServesEntriesOfAnyAge', async () => {
  const clock = new TestClock(t0);
  const s = service(echo(), clock);
  await s.fetchMETAR('KPAO');
  clock.advance(10 * 3600);
  expect(s.cachedWeather('KPAO')?.fetchedAt).toBe(t0);
});

// JS-only guards (port notes S1d)

test('a station id cannot add a query parameter, and ids are percent-encoded', async () => {
  const fetch = echo();
  await service(fetch).fetchMETAR('KPAO&format=raw');
  expect(fetch.calls[0].url).toBe('https://aviationweather.gov/api/data/metar?ids=KPAO%26format%3Draw&format=json');
});

test('numeric edge cases in a METAR entry', () => {
  const [a, b] = parseMetarResponse(
    '[{"icaoId":"A","wdir":"VRB","wspd":6.7,"wgst":"12","temp":"x","altim":29.92,"visib":3,"obsTime":"1793332020","clouds":[{"cover":"OVC","base":1500.5},{"cover":"BKN","base":900}]},{"icaoId":"B","altim":1017,"clouds":"none","fltCat":"weird"}]',
    5,
    newId,
  );
  expect(a.windDirection).toBeNull();
  expect(a.windSpeed).toBe(6);
  expect(a.windGust).toBe(12);
  expect(a.temperature).toBeNull();
  expect(a.altimeterHPa).toBeCloseTo(29.92 * 33.8639, 6);
  expect(a.visibility).toBe('3.0');
  expect(a.observationTime).toBe(1_793_332_020_000);
  expect(a.ceiling).toBe(900); // a non-integral base is skipped, as Swift `as? Int` does
  expect(b.altimeterHPa).toBe(1017);
  expect(b.ceiling).toBeNull();
  expect(b.flightCategory).toBe('vfr');
  expect(computeFlightCategory(null, 'x')).toBe('vfr');
  expect(a.fetchedAt).toBe(5);
});

test('a non-JSON body from the batch endpoint loses only that batch', async () => {
  const fetch = fakeFetch((url, call): StubReply =>
    call === 1 ? { body: '<html>' } : { body: metarJSON(requestedIDs(url)) },
  );
  expect(await service(fetch).fetchWeatherForStations(ids45)).toHaveLength(5);
});
