// Port of ServiceTests/WindsAloftServiceTests.swift (21 tests). The captured FD bulletins are read in place from the Swift
// test file (their column positions matter, so they must not be retyped).
import { AppFailure } from '../domain/errors';
import {
  blankLevel,
  decodeGroup,
  forUsePeriod,
  isInForUsePeriod,
  levelIsForecast,
  nearestStation,
  parseBulletin,
  resolveDdhhmm,
  type WindsAloftBulletin,
  type WindsAloftLevel,
} from './windsAloft';
import { WindsAloftService } from './windsAloftService';
import { WINDS_ALOFT_STATIONS } from './windsAloftStations';
import { swiftRawFixture } from './swiftFixtures';
import { fakeFetch } from './testSupport';

const SWIFT = 'ServiceTests/WindsAloftServiceTests.swift';
const conus06 = swiftRawFixture(SWIFT, 'conus06');
const conus12Header = swiftRawFixture(SWIFT, 'conus12Header');
const hawaii06 = swiftRawFixture(SWIFT, 'hawaii06');
const alaska06 = swiftRawFixture(SWIFT, 'alaska06');

const date = (iso: string) => Date.parse(iso);
const reference = date('2026-10-30T16:00:00Z');
const kpao = { lat: 37.4611, lon: -122.115 };
const phnl = { lat: 21.3187, lon: -157.9225 };
const kden = { lat: 39.8617, lon: -104.6731 };
const panc = { lat: 61.1743, lon: -149.9962 };

function level(b: WindsAloftBulletin, station: string, altitude: number): WindsAloftLevel {
  const found = b.rows.get(station)?.find((l) => l.altitude === altitude);
  if (!found) throw new Error(`no ${station} ${altitude}`);
  return found;
}

// MARK: Group decoding

test('decodesWindOnlyGroupWithoutTemperature', () => {
  const l = decodeGroup('2106', 3000);
  expect(l?.direction).toBe(210); // degrees true
  expect(l?.speed).toBe(6); // knots
  expect(l?.temperature).toBeNull(); // 3000 ft group carries no temperature
  expect(l?.isLightAndVariable).toBe(false);
});

test('decodesSignedTemperatureGroup', () => {
  const warm = decodeGroup('1330+09', 6000);
  expect([warm?.direction, warm?.speed, warm?.temperature]).toEqual([130, 30, 9]);
  expect(decodeGroup('2022-09', 18000)?.temperature).toBe(-9);
});

test('lightAndVariable', () => {
  const plain = decodeGroup('9900', 6000) as WindsAloftLevel;
  expect(plain.isLightAndVariable).toBe(true);
  expect(plain.direction).toBeNull();
  expect(plain.temperature).toBeNull();
  expect(levelIsForecast(plain)).toBe(true);
  const withTemp = decodeGroup('9900+02', 12000);
  expect(withTemp?.isLightAndVariable).toBe(true);
  expect(withTemp?.temperature).toBe(2);
});

test('directionPlus50EncodesSpeedPlus100Knots', () => {
  const synthetic = decodeGroup('7315', 30000);
  expect([synthetic?.direction, synthetic?.speed]).toEqual([230, 115]);
  // Real groups from the 2026-10-30 bulletins.
  const mqt = decodeGroup('780054', 34000);
  expect([mqt?.direction, mqt?.speed, mqt?.temperature]).toEqual([280, 100, -54]);
  const anc = decodeGroup('7001-31', 24000);
  expect([anc?.direction, anc?.speed, anc?.temperature]).toEqual([200, 101, -31]);
});

test('sixDigitGroupsAboveFL240HaveImpliedNegativeTemperature', () => {
  const l = decodeGroup('234862', 39000);
  expect([l?.direction, l?.speed, l?.temperature]).toEqual([230, 48, -62]);
});

test('rejectsMalformedGroups', () => {
  expect(decodeGroup('12A4', 3000)).toBeNull();
  expect(decodeGroup('9100', 3000)).toBeNull(); // 91 is neither 01-36, 51-86 nor 99
  expect(decodeGroup('21065', 3000)).toBeNull();
  expect(decodeGroup('1910*05', 6000)).toBeNull();
});

// MARK: Bulletin parsing

test('parsesHeaderTimesAndLevels', () => {
  const b = parseBulletin(conus06, reference);
  expect(b.levels).toEqual([3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]);
  expect(b.issued).toBe(date('2026-10-30T14:00:00Z'));
  expect(b.basedOn).toBe(date('2026-10-30T12:00:00Z'));
  expect(b.validTime).toBe(date('2026-10-30T18:00:00Z'));
  expect(b.forUseStart).toBe(date('2026-10-30T14:00:00Z'));
  expect(b.forUseEnd).toBe(date('2026-10-30T21:00:00Z'));
  expect(b.rows.size).toBe(9);
  expect(b.rows.has('000')).toBe(false);
  expect(b.rows.has('FD1')).toBe(false);
});

test('forUsePeriodSpanningMidnight', () => {
  const b = parseBulletin(conus12Header, reference);
  expect(b.validTime).toBe(date('2026-10-31T00:00:00Z'));
  expect(b.forUseStart).toBe(date('2026-10-30T21:00:00Z'));
  expect(b.forUseEnd).toBe(date('2026-10-31T06:00:00Z'));
});

test('fullRowDecodesEveryColumn', () => {
  const sfo = parseBulletin(conus06, reference).rows.get('SFO') as WindsAloftLevel[];
  expect(sfo.map((l) => l.direction)).toEqual([210, 190, 240, 230, 220, 230, 230, 230, 230]);
  expect(sfo.map((l) => l.speed)).toEqual([6, 10, 11, 16, 27, 34, 44, 45, 48]);
  expect(sfo.map((l) => l.temperature)).toEqual([null, 5, 0, -7, -19, -28, -44, -54, -62]);
});

test('blankLowLevelColumnsAreNotForecast', () => {
  const b = parseBulletin(conus06, reference);
  // ABQ (5,355 ft): 3000 and 6000 blank.
  expect(levelIsForecast(level(b, 'ABQ', 3000))).toBe(false);
  expect(levelIsForecast(level(b, 'ABQ', 6000))).toBe(false);
  const abq9 = level(b, 'ABQ', 9000);
  expect([abq9.direction, abq9.speed, abq9.temperature]).toEqual([140, 10, 7]);
  // ALS (7,539 ft): first three blank, then light and variable at 12000.
  expect(
    b.rows
      .get('ALS')
      ?.slice(0, 3)
      .every((l) => !levelIsForecast(l)),
  ).toBe(true);
  const als12 = level(b, 'ALS', 12000);
  expect(als12.isLightAndVariable && als12.temperature === 2).toBe(true);
  // AMA: 3000 blank, 6000 wind without temperature (within 2,500 ft of elevation).
  expect(levelIsForecast(level(b, 'AMA', 3000))).toBe(false);
  const ama6 = level(b, 'AMA', 6000);
  expect([ama6.direction, ama6.speed, ama6.temperature]).toEqual([180, 12, null]);
  const ama9 = level(b, 'AMA', 9000);
  expect([ama9.direction, ama9.temperature]).toEqual([180, 5]);
  // BIH: 9900 with no temperature at 6000.
  const bih6 = level(b, 'BIH', 6000);
  expect(bih6.isLightAndVariable && bih6.temperature === null).toBe(true);
});

test('highSpeedGroupsInRealRows', () => {
  const b = parseBulletin(conus06, reference);
  const gld39 = level(b, 'GLD', 39000);
  expect([gld39.direction, gld39.speed, gld39.temperature]).toEqual([220, 102, -62]);
  const mqt34 = level(b, 'MQT', 34000);
  expect([mqt34.direction, mqt34.speed, mqt34.temperature]).toEqual([280, 100, -54]);
  const alaska = parseBulletin(alaska06, reference);
  const anc24 = level(alaska, 'ANC', 24000);
  expect([anc24.direction, anc24.speed, anc24.temperature]).toEqual([200, 101, -31]);
  const anc30 = level(alaska, 'ANC', 30000);
  expect([anc30.direction, anc30.speed, anc30.temperature]).toEqual([200, 108, -44]);
});

test('hawaiiLevelSetFromHeader', () => {
  const b = parseBulletin(hawaii06, reference);
  expect(b.levels).toEqual([1000, 1500, 2000, 3000, 6000, 9000, 12000, 15000, 18000, 24000]);
  const lny = b.rows.get('LNY') as WindsAloftLevel[];
  expect(!levelIsForecast(lny[0]) && !levelIsForecast(lny[1])).toBe(true);
  expect([lny[2].direction, lny[2].speed, lny[2].temperature]).toEqual([70, 29, null]);
  const hnl24 = level(b, 'HNL', 24000);
  expect([hnl24.direction, hnl24.speed, hnl24.temperature]).toEqual([270, 25, -15]);
});

test('textWithoutHeaderRowThrows', () => {
  expect(() => parseBulletin('<html>502 Bad Gateway</html>', reference)).toThrow(AppFailure);
});

test('dayOfMonthResolvesAcrossMonthBoundaries', () => {
  expect(resolveDdhhmm('302200Z', date('2026-11-01T01:00:00Z'))).toBe(date('2026-10-30T22:00:00Z'));
  expect(resolveDdhhmm('010500Z', date('2026-10-31T23:00:00Z'))).toBe(date('2026-11-01T05:00:00Z'));
  expect(resolveDdhhmm('321200Z', reference)).toBeNull();
});

// MARK: Nearest station

test('bundledTableCoversAllBulletinStations', () => {
  const ids = WINDS_ALOFT_STATIONS.map((s) => s.id);
  expect(ids).toHaveLength(233);
  expect(new Set(ids).size).toBe(ids.length);
});

test('nearestStationSelection', () => {
  const stations = WINDS_ALOFT_STATIONS;
  const paloAlto = nearestStation(kpao, stations);
  expect(paloAlto?.station.id).toBe('SFO');
  expect(paloAlto?.distanceNM).toBeGreaterThan(14);
  expect(paloAlto?.distanceNM).toBeLessThan(17); // nautical miles
  expect(nearestStation(kden, stations)?.station.id).toBe('DEN');
  const honolulu = nearestStation(phnl, stations);
  expect(honolulu?.station.id).toBe('HNL');
  expect(honolulu?.station.region).toBe('hawaii');
  expect(nearestStation(panc, stations)?.station.region).toBe('alaska');
  expect(nearestStation(kpao, [])).toBeNull();
});

// MARK: Service

const T = date('2026-10-30T16:00:00Z');

test('serviceReturnsNearestStationLevels', async () => {
  const fetch = fakeFetch(() => ({ body: conus06 }));
  const report = await new WindsAloftService({ fetch, now: () => T }).fetchWindsAloft(kpao, 12);
  expect(report.station.id).toBe('SFO');
  expect(report.forecast).toBe(12);
  expect(report.levels).toHaveLength(9);
  expect(report.levels[0].direction).toBe(210);
  expect(report.levels[0].speed).toBe(6);
  const url = fetch.calls[0].url;
  expect(url).toContain('region=all');
  expect(url).toContain('level=low');
  expect(url).toContain('fcst=12');
});

test('serviceRequestsRegionOfNearestStation', async () => {
  const fetch = fakeFetch(() => ({ body: hawaii06 }));
  const report = await new WindsAloftService({ fetch, now: () => T }).fetchWindsAloft(phnl, 6);
  expect(report.station.id).toBe('HNL');
  expect(fetch.calls[0].url).toContain('region=hawaii');
  expect(fetch.calls[0].url).toContain('fcst=06');
});

test('serviceFallsBackWhenNearestStationMissingFromBulletin', async () => {
  const sfo = WINDS_ALOFT_STATIONS.find((s) => s.id === 'SFO') as (typeof WINDS_ALOFT_STATIONS)[number];
  const missing = {
    id: 'ZZZ',
    name: 'Not in bulletin',
    latitude: kpao.lat,
    longitude: kpao.lon,
    elevation: 0,
    region: 'conus' as const,
  };
  const service = new WindsAloftService({
    fetch: fakeFetch(() => ({ body: conus06 })),
    stations: [missing, sfo],
    now: () => T,
  });
  expect((await service.fetchWindsAloft(kpao, 6)).station.id).toBe('SFO');
});

test('serviceMapsOfflineToNetworkUnavailable', async () => {
  const fetch = fakeFetch(() => {
    throw new TypeError('Network request failed');
  });
  await expect(new WindsAloftService({ fetch }).fetchWindsAloft(kpao, 6)).rejects.toMatchObject({
    error: { kind: 'networkUnavailable' },
  });
});

test('forUsePeriodCheck', () => {
  const b = parseBulletin(conus06, reference);
  const report = { forUseStart: b.forUseStart, forUseEnd: b.forUseEnd };
  expect(isInForUsePeriod(report, date('2026-10-30T14:00:00Z'))).toBe(true);
  expect(isInForUsePeriod(report, date('2026-10-30T21:00:00Z'))).toBe(true);
  expect(isInForUsePeriod(report, date('2026-10-30T21:01:00Z'))).toBe(false);
  expect(isInForUsePeriod(report, date('2026-10-30T13:59:00Z'))).toBe(false);
  expect(isInForUsePeriod({ forUseStart: null, forUseEnd: null }, T)).toBe(false);
});

// JS-only guards (port notes S1d)

test('a bulletin is cached for 30 minutes, refetched after, and refetched once its FOR USE window has ended', async () => {
  const fetch = fakeFetch(() => ({ body: conus06 }));
  let now = T;
  const service = new WindsAloftService({ fetch, now: () => now });
  await service.fetchWindsAloft(kpao, 6);
  now = T + 29 * 60_000;
  await service.fetchWindsAloft(kpao, 6);
  expect(fetch.calls).toHaveLength(1);
  now = T + 31 * 60_000;
  await service.fetchWindsAloft(kpao, 6);
  expect(fetch.calls).toHaveLength(2);
  now = date('2026-10-30T20:55:00Z');
  await service.fetchWindsAloft(kpao, 6); // refetched (stale), cached with a FOR USE end of 21:00Z
  expect(fetch.calls).toHaveLength(3);
  now = date('2026-10-30T21:05:00Z'); // only 10 minutes old, but past the FOR USE end
  await service.fetchWindsAloft(kpao, 6);
  expect(fetch.calls).toHaveLength(4);
});

test('concurrent callers share one download; a failed download is not cached', async () => {
  let fail = true;
  const fetch = fakeFetch(() => (fail ? { status: 503 } : { body: conus06 }));
  const service = new WindsAloftService({ fetch, now: () => T });
  await expect(
    Promise.all([service.fetchWindsAloft(kpao, 6), service.fetchWindsAloft(kpao, 6)]),
  ).rejects.toBeInstanceOf(AppFailure);
  expect(fetch.calls).toHaveLength(1);
  fail = false;
  expect((await service.fetchWindsAloft(kpao, 6)).station.id).toBe('SFO');
});

test('an empty station table is a failure, not a crash', async () => {
  const service = new WindsAloftService({ fetch: fakeFetch(() => ({ body: conus06 })), stations: [] });
  await expect(service.fetchWindsAloft(kpao, 6)).rejects.toBeInstanceOf(AppFailure);
});

test('for-use windows: bad text, hour 24, and day boundaries', () => {
  const valid = date('2026-10-30T18:00:00Z');
  expect(forUsePeriod('nonsense', valid)).toEqual([null, null]);
  expect(forUsePeriod('1400-2400Z.', valid)).toEqual([date('2026-10-30T14:00:00Z'), date('2026-10-31T00:00:00Z')]);
  expect(forUsePeriod('2100-0600Z.', date('2026-10-31T00:00:00Z'))).toEqual([
    date('2026-10-30T21:00:00Z'),
    date('2026-10-31T06:00:00Z'),
  ]);
  expect(forUsePeriod('2500-0600', valid)[0]).toBeNull();
  expect(blankLevel(3000)).toEqual({
    altitude: 3000,
    direction: null,
    speed: null,
    temperature: null,
    isLightAndVariable: false,
  });
  expect(resolveDdhhmm('3112', reference)).toBeNull();
  expect(resolveDdhhmm('310000', date('2026-11-15T00:00:00Z'))).toBe(date('2026-10-31T00:00:00Z')); // November has 30 days
});

test('a malformed row or a line ending other than LF does not break the bulletin', () => {
  const text = conus06.replaceAll('\n', '\r\n');
  const b = parseBulletin(text, reference);
  expect(b.rows.size).toBe(9);
  expect(b.rows.get('SFO')?.[1].temperature).toBe(5);
});
