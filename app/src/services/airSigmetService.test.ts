// Port of ServiceTests/AirSigmetServiceTests.swift (12 tests): AIRMET/SIGMET/G-AIRMET parsing, validity windows, hazard
// colors and service caching. The real aviationweather.gov captures are read in place from the Swift test file.
import { AppFailure } from '../domain/errors';
import {
  ADVISORY_COLORS,
  advisoryColorHex,
  hazardFromApiCode,
  isAdvisoryValid,
  parseAirSigmets,
  parseGAirmets,
  validAdvisories,
  type AdvisorySnapshot,
} from './airSigmet';
import { AirSigmetService } from './airSigmetService';
import { swiftRawFixture } from './swiftFixtures';
import { fakeFetch, TestClock, type FakeFetch } from './testSupport';

const SWIFT_TESTS = 'ServiceTests/AirSigmetServiceTests.swift';
const airSigmetJSON = swiftRawFixture(SWIFT_TESTS, 'airSigmetJSON');
const gAirmetJSON = swiftRawFixture(SWIFT_TESTS, 'gAirmetJSON');

const utc = (s: string) => Date.parse(s);

// MARK: SIGMET parsing

test('parsesConvectiveSigmet', () => {
  const advisories = parseAirSigmets(airSigmetJSON);
  const sigmet = advisories[0];
  expect(advisories).toHaveLength(1);
  expect(sigmet.kind).toBe('SIGMET');
  expect(sigmet.hazard).toBe('convective');
  expect(sigmet.hazardCode).toBe('CONVECTIVE');
  expect(sigmet.validFrom).toBe(1_793_386_500_000); // 18:55Z
  expect(sigmet.validTo).toBe(1_793_393_700_000); // 20:55Z
  expect(sigmet.floorFeet).toBeNull(); // altitudeLow1 null
  expect(sigmet.ceilingFeet).toBe(32000); // TOPS TO FL320
  expect(sigmet.boundaries[0]).toEqual([38.068, -95.695]); // {"lon":-95.695,"lat":38.068}
  expect(sigmet.boundaries).toHaveLength(4);
  expect(sigmet.text?.includes('CONVECTIVE SIGMET 50C')).toBe(true);
  expect(advisoryColorHex(sigmet.kind, sigmet.hazard)).toBe(ADVISORY_COLORS.red);
});

test('emptyBodyMeansNoAdvisories', () => {
  // airsigmet answers HTTP 204 with an empty body when nothing matches
  expect(parseAirSigmets('')).toEqual([]);
  expect(parseGAirmets('')).toEqual([]);
});

test('skipsUnknownTypesAndDegenerateAreas', () => {
  const json = `[{"airSigmetType":"OUTLOOK","hazard":"CONVECTIVE","validTimeFrom":1,"validTimeTo":2,
    "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2},{"lat":1,"lon":2}]},
   {"airSigmetType":"AIRMET","hazard":"TURB","validTimeFrom":1,"validTimeTo":2,
    "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2}]}]`;
  expect(parseAirSigmets(json)).toEqual([]);
});

// MARK: G-AIRMET parsing

test('parsesGAirmetAreasAndDropsFreezingLevels', () => {
  const advisories = parseGAirmets(gAirmetJSON);
  expect(advisories.map((a) => a.hazardCode)).toEqual(['TURB-LO', 'IFR', 'MT_OBSC', 'ICE']);
  expect(advisories.every((a) => a.kind === 'G-AIRMET')).toBe(true);
  expect(new Set(advisories.map((a) => a.id)).size).toBe(advisories.length);

  const turbulence = advisories[0];
  expect(turbulence.hazard).toBe('turbulence');
  expect(turbulence.floorFeet).toBe(0); // "SFC"
  expect(turbulence.ceilingFeet).toBe(6000); // "060" hundreds of feet
  expect(turbulence.boundaries[0]).toEqual([46.97, -69.88]); // string coords
  expect(turbulence.boundaries).toHaveLength(14);

  const icing = advisories[3];
  expect(icing.hazard).toBe('icing');
  expect(icing.floorFeet).toBe(11000); // base "FZL", fzlbase "110"
  expect(icing.ceilingFeet).toBe(22000);

  expect(advisories[1].hazard).toBe('ifr');
  expect(advisories[1].floorFeet).toBeNull();
  expect(advisories[2].hazard).toBe('mountainObscuration');
});

test('gAirmetSnapshotValidNinetyMinutesAroundValidTime', () => {
  const advisory = parseGAirmets(gAirmetJSON)[0];
  // validTime 18:00Z, expireTime 21:00Z
  expect(advisory.validFrom).toBe(utc('2026-10-30T16:30:00Z'));
  expect(advisory.validTo).toBe(utc('2026-10-30T19:30:00Z'));
});

test('gAirmetWindowCappedAtExpireTime', () => {
  const json = `[{"tag":"1W","validTime":"2026-10-30T18:00:00.000Z","hazard":"IFR","geometryType":"AREA",
    "expireTime":1793386800,"product":"SIERRA",
    "coords":[{"lat":"40.0","lon":"-100.0"},{"lat":"41.0","lon":"-100.0"},{"lat":"41.0","lon":"-99.0"}]}]`;
  expect(parseGAirmets(json)[0].validTo).toBe(1_793_386_800_000); // 19:00Z, before 19:30Z
});

// MARK: Validity filtering

test('snapshotShowsOnlyCurrentlyValidAdvisories', () => {
  const advisories = [...parseAirSigmets(airSigmetJSON), ...parseGAirmets(gAirmetJSON)];
  const snapshot: AdvisorySnapshot = { advisories, fetchedAt: 1_793_387_000_000 };

  // 18:00Z: G-AIRMETs only (SIGMET starts 18:55Z)
  const at1800 = validAdvisories(snapshot, utc('2026-10-30T18:00:00Z'));
  expect(at1800).toHaveLength(4);
  expect(at1800.some((a) => a.kind === 'SIGMET')).toBe(false);

  // 19:00Z: both
  expect(validAdvisories(snapshot, utc('2026-10-30T19:00:00Z'))).toHaveLength(5);

  // 20:00Z: G-AIRMET snapshot window over, SIGMET still valid
  expect(validAdvisories(snapshot, utc('2026-10-30T20:00:00Z')).map((a) => a.kind)).toEqual(['SIGMET']);

  // 21:00Z: everything expired
  expect(validAdvisories(snapshot, utc('2026-10-30T21:00:00Z'))).toEqual([]);

  // Boundaries are inclusive
  const sigmet = advisories[0];
  expect(isAdvisoryValid(sigmet, sigmet.validFrom)).toBe(true);
  expect(isAdvisoryValid(sigmet, sigmet.validTo)).toBe(true);
  expect(isAdvisoryValid(sigmet, sigmet.validTo + 1000)).toBe(false);
});

// MARK: Hazard mapping

test('mapsHazardCodesFromBothEndpoints', () => {
  expect(hazardFromApiCode('CONVECTIVE')).toBe('convective');
  expect(hazardFromApiCode('IFR')).toBe('ifr');
  expect(hazardFromApiCode('MTN OBSCN')).toBe('mountainObscuration');
  expect(hazardFromApiCode('MT_OBSC')).toBe('mountainObscuration');
  expect(hazardFromApiCode('TURB')).toBe('turbulence');
  expect(hazardFromApiCode('TURB-HI')).toBe('turbulence');
  expect(hazardFromApiCode('TURB-LO')).toBe('turbulence');
  expect(hazardFromApiCode('LLWS')).toBe('turbulence');
  expect(hazardFromApiCode('ICE')).toBe('icing');
  expect(hazardFromApiCode('SFC_WND')).toBe('other');
});

test('mapsHazardsToColors', () => {
  const { red, purple, orange, blue, brown, gray } = ADVISORY_COLORS;
  expect(advisoryColorHex('SIGMET', 'convective')).toBe(red);
  // Non-convective SIGMETs (severe turbulence/icing) are red too
  expect(advisoryColorHex('SIGMET', 'turbulence')).toBe(red);
  expect(advisoryColorHex('SIGMET', 'icing')).toBe(red);
  expect(advisoryColorHex('G-AIRMET', 'ifr')).toBe(purple);
  expect(advisoryColorHex('G-AIRMET', 'turbulence')).toBe(orange);
  expect(advisoryColorHex('AIRMET', 'icing')).toBe(blue);
  expect(advisoryColorHex('AIRMET', 'mountainObscuration')).toBe(brown);
  expect(advisoryColorHex('G-AIRMET', 'other')).toBe(gray);
  const all = [red, purple, orange, blue, brown, gray];
  expect(new Set(all).size).toBe(all.length);
});

// MARK: Service (network stubbed)

const T0 = 1_793_387_000_000;

function makeFetch(gAirmetStatus: { value: number }): FakeFetch {
  return fakeFetch((url) =>
    url.includes('/gairmet')
      ? { status: gAirmetStatus.value, body: gAirmetJSON }
      : { status: 200, body: airSigmetJSON },
  );
}

test('serviceFetchesBothFeedsAndCachesForTenMinutes', async () => {
  const fetch = makeFetch({ value: 200 });
  const clock = new TestClock(T0);
  const service = new AirSigmetService({ fetch, now: clock.now });

  const first = await service.currentAdvisories();
  expect(first.advisories).toHaveLength(5);
  expect(first.fetchedAt).toBe(T0);
  expect(fetch.calls).toHaveLength(2);

  clock.advance(9 * 60);
  await service.currentAdvisories();
  expect(fetch.calls).toHaveLength(2);

  clock.advance(2 * 60);
  const refreshed = await service.currentAdvisories();
  expect(fetch.calls).toHaveLength(4);
  expect(refreshed.fetchedAt).toBe(first.fetchedAt + 11 * 60_000);
});

test('partialFailureKeepsLastGoodSnapshot', async () => {
  const status = { value: 200 };
  const clock = new TestClock(T0);
  const service = new AirSigmetService({ fetch: makeFetch(status), now: clock.now });

  const first = await service.currentAdvisories();
  status.value = 500;
  clock.advance(15 * 60);
  const stale = await service.currentAdvisories();
  expect(stale).toEqual(first); // SIGMETs alone are not published as a fresh snapshot
});

test('serviceThrowsWithoutAnyGoodFetch', async () => {
  const service = new AirSigmetService({ fetch: makeFetch({ value: 503 }) });
  await expect(service.currentAdvisories()).rejects.toBeInstanceOf(AppFailure);
});

// JS-only guards (port notes S1b)

test('concurrent callers share one refresh', async () => {
  const fetch = makeFetch({ value: 200 });
  const service = new AirSigmetService({ fetch, now: () => T0 });
  const [a, b] = await Promise.all([service.currentAdvisories(), service.currentAdvisories()]);
  expect(b).toBe(a);
  expect(fetch.calls).toHaveLength(2);
});

test('a failed refresh is not cached: the next call tries again', async () => {
  const status = { value: 503 };
  const fetch = makeFetch(status);
  const service = new AirSigmetService({ fetch, now: () => T0 });
  await expect(service.currentAdvisories()).rejects.toBeInstanceOf(AppFailure);
  status.value = 200;
  expect((await service.currentAdvisories()).advisories).toHaveLength(5);
});

test('a throwing fetch and a non-JSON body both reject with weatherFetchFailed', async () => {
  const throwing = new AirSigmetService({
    fetch: fakeFetch(() => {
      throw new Error('offline');
    }),
  });
  await expect(throwing.currentAdvisories()).rejects.toMatchObject({ error: { kind: 'weatherFetchFailed' } });
  const html = new AirSigmetService({ fetch: fakeFetch(() => ({ body: '<html>' })) });
  await expect(html.currentAdvisories()).rejects.toMatchObject({ error: { kind: 'weatherFetchFailed' } });
  expect(() => parseAirSigmets('{"a":1}')).toThrow();
  expect(() => parseAirSigmets('[1]')).toThrow();
});

test('non-finite and blank numbers read as missing, not as zero', () => {
  const json = `[{"airSigmetType":"AIRMET","hazard":"ICE","validTimeFrom":"","validTimeTo":2,
    "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2},{"lat":1,"lon":2}]},
   {"airSigmetType":"AIRMET","hazard":"ICE","validTimeFrom":1,"validTimeTo":2,"altitudeLow1":"nan","altitudeHi1":"5000.9",
    "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2},{"lat":"x","lon":2},{"lat":1,"lon":2}]}]`;
  const advisories = parseAirSigmets(json);
  expect(advisories).toHaveLength(1);
  expect(advisories[0].floorFeet).toBeNull();
  expect(advisories[0].ceilingFeet).toBe(5000);
  expect(advisories[0].boundaries).toHaveLength(3);
});
