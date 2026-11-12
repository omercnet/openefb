// Port of ServiceTests/PirepServiceTests.swift (19 tests). The captured AWC entries are read in place from the Swift test.
import { AppFailure } from '../domain/errors';
import {
  EARTH_RADIUS_NM,
  filterPireps,
  formatInt,
  parsePireps,
  pirepAltitudeText,
  pirepBoundingBox,
  pirepBoundingBoxes,
  pirepIcingSummary,
  pirepId,
  pirepIsUrgent,
  pirepSkySummary,
  pirepTurbulenceSummary,
  pirepWindSummary,
  type Pirep,
} from './pirep';
import { PirepService } from './pirepService';
import { swiftRawFixture } from './swiftFixtures';
import { fakeFetch } from './testSupport';

const fixture = swiftRawFixture('ServiceTests/PirepServiceTests.swift', 'fixture');
const kden = { lat: 39.8617, lon: -104.6731 };
const degreesPerNM = 180 / (Math.PI * EARTH_RADIUS_NM); // degrees latitude per NM
const now = 1_793_390_000_000;

const parsed = () => parsePireps(fixture);
const byAircraft = (type: string) => parsed().find((p) => p.aircraftType === type) as Pirep;

function makePirep(northNM: number, ageSeconds: number, raw = 'TEST UA'): Pirep {
  return {
    observationTime: now - ageSeconds * 1000,
    reportType: 'PIREP',
    aircraftType: 'C172',
    latitude: kden.lat + northNM * degreesPerNM,
    longitude: kden.lon,
    altitude: 6500,
    altitudeQualifier: null,
    clouds: [],
    weather: null,
    temperature: null,
    windDirection: null,
    windSpeed: null,
    turbulence: [],
    icing: [],
    rawText: raw,
  };
}

// MARK: Parsing

test('parsesEveryRealEntry', () => {
  expect(parsed()).toHaveLength(8);
});

test('urgentPirepIsFlaggedWithDescentAltitude', () => {
  const roc = parsed()[0];
  expect(pirepIsUrgent(roc)).toBe(true);
  expect(roc.reportType).toBe('Urgent PIREP');
  expect(roc.aircraftType).toBe('CL30');
  expect(roc.altitude).toBe(500); // FL005 -> 500 ft MSL
  expect(roc.altitudeQualifier).toBe('DURD');
  expect(roc.observationTime).toBe(1_793_386_320_000);
  expect(roc.turbulence).toEqual([]); // free-text "+/- 15 KTS" is not coded
  expect(roc.weather).toBeNull();
});

test('nonUrgentTypesAreNotFlagged', () => {
  const entries = parsed();
  expect(entries.filter(pirepIsUrgent)).toHaveLength(1);
  const airep = entries.find((p) => p.reportType === 'AIREP') as Pirep;
  expect(pirepIsUrgent(airep)).toBe(false);
  expect(airep.altitude).toBe(30000);
  expect(airep.windDirection).toBe(205); // degrees true
  expect(airep.windSpeed).toBe(33); // knots
});

test('climbDescentReportsWithoutLevelHaveNoAltitude', () => {
  const rvs = byAircraft('P28A');
  expect(rvs.altitude).toBeNull();
  expect(rvs.altitudeQualifier).toBe('DURD');
  expect(pirepAltitudeText(rvs)).toBe('Descending');
  // AWC encodes unreported tops as 0.
  expect(rvs.clouds).toEqual([
    { cover: 'SCT', base: 1300, top: null },
    { cover: 'SCT', base: 2300, top: null },
  ]);
  const jax = byAircraft('B752');
  expect(jax.altitude).toBeNull();
  expect(jax.altitudeQualifier).toBe('DURC');
  expect(jax.clouds).toEqual([{ cover: 'BKN', base: 4500, top: 6500 }]);
});

test('unknownLevelAndNegativeIcing', () => {
  const mck = byAircraft('BE65');
  expect(mck.altitude).toBeNull();
  expect(mck.altitudeQualifier).toBe('UNKN');
  expect(mck.icing).toEqual([{ intensity: 'NEG', type: null, frequency: null, base: null, top: null }]);
  expect(pirepIcingSummary(mck)).toBe('NEG');
  expect(pirepTurbulenceSummary(mck)).toBeNull();
});

test('icingLayerBasesAreHundredsOfFeet', () => {
  const glh = byAircraft('F2TH');
  expect(glh.altitude).toBe(23000);
  expect(glh.altitudeQualifier).toBeNull();
  expect(glh.temperature).toBe(-23);
  expect(glh.icing).toEqual([{ intensity: 'LGT', type: 'MIXED', frequency: null, base: 23000, top: 25000 }]);
});

test('multipleTurbulenceGroupsAreSummarized', () => {
  const fnt = byAircraft('E75S');
  expect(fnt.turbulence).toHaveLength(2);
  expect(pirepTurbulenceSummary(fnt)).toBe('MOD CHOP, NEG');
});

test('presentWeatherIsKeptAndBlankIsNil', () => {
  expect(byAircraft('CRJ7').weather).toBe('FU');
  expect(byAircraft('F2TH').weather).toBeNull();
});

test('entriesMissingPositionTimeOrTextAreDropped', () => {
  const json = `[{"obsTime":1793386320,"lat":null,"lon":-77.5,"rawOb":"NO LAT"},
   {"lat":43.1,"lon":-77.5,"rawOb":"NO TIME"},
   {"obsTime":1793386320,"lat":43.1,"lon":-77.5,"rawOb":""},
   {"obsTime":1793386320,"lat":43.1,"lon":-77.5,"rawOb":"MINIMAL UA"}]`;
  const entries = parsePireps(json);
  expect(entries).toHaveLength(1);
  const only = entries[0];
  expect(only.rawText).toBe('MINIMAL UA');
  expect(only.reportType).toBe('PIREP');
  expect(only.aircraftType).toBeNull();
  expect(only.altitude).toBeNull();
  expect(pirepAltitudeText(only)).toBe('Alt unknown');
  expect(only.clouds).toEqual([]);
});

test('emptyBodyIsNoReports', () => {
  expect(parsePireps('')).toEqual([]);
});

test('nonArrayBodyThrows', () => {
  expect(() => parsePireps('{"error":"bad"}')).toThrow(AppFailure);
});

// MARK: Filtering boundaries

test('radiusBoundaryIs50NM', () => {
  const reports = [
    makePirep(49.0, 60, 'INSIDE'),
    makePirep(49.999, 60, 'EDGE'),
    makePirep(50.001, 60, 'OUTSIDE'),
    makePirep(-50.001, 60, 'OUTSIDE SOUTH'),
  ];
  expect(new Set(filterPireps(reports, kden, 50, 7200, now).map((p) => p.rawText))).toEqual(
    new Set(['INSIDE', 'EDGE']),
  );
});

test('ageBoundaryIsInclusiveAtTwoHours', () => {
  const reports = [
    makePirep(0, 7199, 'FRESH'),
    makePirep(0, 7200, 'EDGE'),
    makePirep(0, 7201, 'OLD'),
    makePirep(0, -600, 'FUTURE'),
  ];
  expect(filterPireps(reports, kden, 50, 7200, now).map((p) => p.rawText)).toEqual(['FRESH', 'EDGE']);
});

test('resultsAreNewestFirst', () => {
  const reports = [makePirep(1, 3000, 'B'), makePirep(2, 100, 'A'), makePirep(3, 6000, 'C')];
  expect(filterPireps(reports, kden, 50, 7200, now).map((p) => p.rawText)).toEqual(['A', 'B', 'C']);
});

test('boundingBoxEnclosesRadius', () => {
  const box = pirepBoundingBox(kden, 60).split(',').map(Number);
  expect(box).toHaveLength(4);
  expect(Math.abs(box[0] - (kden.lat - 1))).toBeLessThan(0.01); // 60 NM is about 1 degree latitude
  expect(Math.abs(box[2] - (kden.lat + 1))).toBeLessThan(0.01);
  expect(box[1]).toBeLessThan(kden.lon - 1.25); // wider in longitude at 40N
  expect(box[3]).toBeGreaterThan(kden.lon + 1.25);
});

// MARK: Service

test('serviceQueriesBoundingBoxAndFiltersLocally', async () => {
  const t = 1_800_000_000;
  const json = `[{"obsTime":${t - 600},"acType":"C172","lat":39.9,"lon":-104.7,"fltLvl":85,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"DEN UA /OV DEN"},
   {"obsTime":${t - 300},"acType":"PC12","lat":41.2,"lon":-104.7,"fltLvl":120,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"CYS UA /OV CYS"},
   {"obsTime":${t - 9000},"acType":"SR22","lat":39.8,"lon":-104.6,"fltLvl":95,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"OLD UA"}]`;
  const fetch = fakeFetch(() => ({ body: json }));
  const pireps = await new PirepService({ fetch, now: () => t * 1000 }).fetchPireps(kden, 50, 7200);
  expect(pireps.map((p) => p.aircraftType)).toEqual(['C172']); // CYS is ~80 NM away, SR22 is 2.5 h old
  const url = fetch.calls[0].url;
  expect(url).toContain('age=2.00');
  expect(url).toContain('format=json');
  expect(url).toContain('bbox=');
});

test('serviceTreatsNoContentAsEmpty', async () => {
  expect(await new PirepService({ fetch: fakeFetch(() => ({ status: 204 })) }).fetchPireps(kden, 50, 7200)).toEqual([]);
});

test('serviceMapsOfflineToNetworkUnavailable', async () => {
  const fetch = fakeFetch(() => {
    throw new TypeError('Network request failed');
  });
  await expect(new PirepService({ fetch }).fetchPireps(kden, 50, 7200)).rejects.toMatchObject({
    error: { kind: 'networkUnavailable' },
  });
});

test('serviceRejectsServerError', async () => {
  const fetch = fakeFetch(() => ({ status: 502, body: '<html>502 Bad Gateway</html>' }));
  await expect(new PirepService({ fetch }).fetchPireps(kden, 50, 7200)).rejects.toBeInstanceOf(AppFailure);
});

// JS-only guards and display helpers (port notes S1d)

test('non-finite query values are refused before any request', async () => {
  const fetch = fakeFetch(() => ({ body: '[]' }));
  const service = new PirepService({ fetch });
  await expect(service.fetchPireps({ lat: Number.NaN, lon: 0 }, 50, 7200)).rejects.toBeInstanceOf(AppFailure);
  await expect(service.fetchPireps(kden, Number.POSITIVE_INFINITY, 7200)).rejects.toBeInstanceOf(AppFailure);
  expect(fetch.calls).toHaveLength(0);
});

test('display summaries use English digit grouping and the same wording as Swift', () => {
  expect(formatInt(12345)).toBe('12,345');
  expect(formatInt(-1234567)).toBe('-1,234,567');
  expect(formatInt(12)).toBe('12');
  const base = makePirep(0, 0);
  expect(pirepAltitudeText({ ...base, altitude: 12000 })).toBe('12,000 ft MSL');
  expect(pirepAltitudeText({ ...base, altitude: 5000, altitudeQualifier: 'DURC' })).toBe('5,000 ft MSL (climbing)');
  expect(pirepAltitudeText({ ...base, altitude: null, altitudeQualifier: 'DURC' })).toBe('Climbing');
  expect(
    pirepSkySummary({
      ...base,
      clouds: [
        { cover: 'BKN', base: 4500, top: 6500 },
        { cover: 'OVC', base: null, top: null },
      ],
    }),
  ).toBe('BKN 4,500 ft tops 6,500 ft, OVC');
  expect(pirepSkySummary(base)).toBeNull();
  expect(pirepWindSummary({ ...base, windSpeed: 12, windDirection: 90 })).toBe('090\u00b0 12 kt');
  expect(pirepWindSummary({ ...base, windSpeed: 12 })).toBe('VRB 12 kt');
  expect(pirepWindSummary(base)).toBeNull();
  const cond = (base: number | null, top: number | null) => ({
    ...base_(),
    turbulence: [{ intensity: 'MOD', type: 'CAT', frequency: 'OCNL', base, top }],
  });
  function base_() {
    return makePirep(0, 0);
  }
  expect(pirepTurbulenceSummary(cond(5000, 9000))).toBe('MOD OCNL CAT 5,000\u20139,000 ft');
  expect(pirepTurbulenceSummary(cond(5000, null))).toBe('MOD OCNL CAT from 5,000 ft');
  expect(pirepTurbulenceSummary(cond(null, 9000))).toBe('MOD OCNL CAT to 9,000 ft');
  expect(pirepId({ ...base, observationTime: 1_793_386_320_000, rawText: 'X' })).toBe('1793386320.0-X');
});

test('a report with a non-object clouds entry or a boolean number is parsed without it', () => {
  const [p] = parsePireps(
    '[{"obsTime":"1793386320","lat":"43.1","lon":-77.5,"rawOb":"X","clouds":[1],"temp":true,"fltLvl":"85","fltLvlType":"OTHER"}]',
  );
  expect(p.observationTime).toBe(1_793_386_320_000);
  expect(p.latitude).toBe(43.1);
  expect(p.clouds).toEqual([]);
  expect(p.temperature).toBeNull();
  expect(p.altitude).toBe(8500);
});

// Review follow-ups (PR #54): the antimeridian
test('a circle that crosses the antimeridian is queried as two boxes and one box otherwise', () => {
  const east = pirepBoundingBoxes({ lat: -17.7, lon: 179.9 }, 60); // Fiji
  expect(east).toHaveLength(2);
  const [a, b] = east.map((s) => s.split(',').map(Number));
  expect(a[3]).toBe(180);
  expect(b[1]).toBe(-180);
  expect(b[3]).toBeLessThan(-178);
  const west = pirepBoundingBoxes({ lat: 52, lon: -179.9 }, 60);
  expect(west).toHaveLength(2);
  expect(west[0].split(',').map(Number)[1]).toBe(-180);
  expect(west[1].split(',').map(Number)[3]).toBe(180);
  expect(pirepBoundingBoxes(kden, 60)).toHaveLength(1);
  expect(pirepBoundingBoxes({ lat: 89.9, lon: 0 }, 600)).toEqual(['79.900,-180.000,90.000,180.000']);
});

test('a report on the far side of the antimeridian is found, and one returned by both boxes appears once', async () => {
  const t = 1_800_000_000;
  const entry = (lon: number, raw: string) =>
    `{"obsTime":${t - 300},"acType":"C172","lat":-17.7,"lon":${lon},"fltLvl":85,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"${raw}"}`;
  const fetch = fakeFetch(() => ({ body: `[${entry(-179.95, 'FAR SIDE')},${entry(179.95, 'NEAR SIDE')}]` }));
  const near = { lat: -17.7, lon: 179.9 };
  const pireps = await new PirepService({ fetch, now: () => t * 1000 }).fetchPireps(near, 60, 7200);
  expect(fetch.calls).toHaveLength(2);
  expect(pireps.map((p) => p.rawText).sort()).toEqual(['FAR SIDE', 'NEAR SIDE']); // both boxes returned both: deduped
});

test('a longitude outside -180..180 is wrapped before the boxes are built', () => {
  expect(pirepBoundingBoxes({ lat: 0, lon: 190 }, 60)).toEqual(pirepBoundingBoxes({ lat: 0, lon: -170 }, 60));
  expect(pirepBoundingBoxes({ lat: 0, lon: -540.5 }, 60)).toEqual(pirepBoundingBoxes({ lat: 0, lon: 179.5 }, 60));
});
