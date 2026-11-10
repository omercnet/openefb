// Port of efb-212Tests/ServiceTests/CVFRDebriefTests.swift (34 cases, same data). IL-DEBRIEF: route matching (planned
// and unplanned), time-weighted altitude adherence with aerodrome exclusion zones and two-number altitudes,
// reporting-point passage, Hebrew/English position-report matching, and the unrolled profile (distance axis,
// excluded zones, verdict).
// Two cases wait on ports that are not on main yet and are test.todo: the RecordingDatabase route-leg round trip (data
// track) and the bundled LLHZ -> LLIB route (needs the L3 IsraelRoutePlanner and the bundled Israel database).
import { polylineLengthNm } from './cvfrDebrief';
import {
  adherence,
  aerodromeExclusionNM,
  buildCVFRDebrief,
  cvfrPassageId,
  deviationFeet,
  excursions,
  excursionSeconds,
  legAdherence,
  legFromCode,
  legPublishedAltitude,
  matchPlanned,
  matchUnplanned,
  passage,
  promptFacts,
  publishedAltitudes,
  verdictFindings,
  verdictHeadline,
  type CVFRDebrief,
  type CVFRRouteLeg,
} from './cvfrDebrief';
import { loadCVFRDebrief, resolveStoredLegs } from './cvfrDebriefLoader';
import { buildPrompt } from './flightSummaryBuilder';
import { mentions, vocabulary } from './transcriptTextMatcher';
import type {
  CVFRTrackPoint,
  CVFRTranscriptSegment,
  FlightMetadata,
  IsraelReportingPoint,
  IsraelRouteSegment,
} from './types';

// MARK: Fixtures

/** Swift: Date(timeIntervalSince1970: 1_700_000_000). */
const t0 = 1_700_000_000_000;
const flightID = 'cvfr-test-flight';
const at = (second: number): number => t0 + second * 1000;

/** One segment along lat 32.0 (west -> east between the given longitudes). */
function segment(
  id: number,
  from: string,
  to: string,
  lon0: number,
  lon1: number,
  options: { lat?: number; forward?: string | null; reverse?: string | null } = {},
): IsraelRouteSegment {
  const { lat = 32.0, forward = '1500', reverse = '2500' } = options;
  const altitude = (published: string | null) => {
    if (published === null) return null;
    const feet = Number(published);
    return { published, feet: Number.isInteger(feet) ? feet : null };
  };
  return {
    id,
    fromCode: from,
    toCode: to,
    altitudeForward: altitude(forward),
    altitudeReverse: altitude(reverse),
    polyline: [
      { lat, lon: lon0 },
      { lat, lon: lon1 },
    ],
  };
}

function point(p: {
  lat?: number;
  lon: number;
  altitude?: number;
  second: number;
  course?: number;
  speed?: number;
}): CVFRTrackPoint {
  return {
    timestamp: at(p.second),
    latitude: p.lat ?? 32.0,
    longitude: p.lon,
    altitudeFeet: p.altitude ?? 1500,
    groundSpeedKnots: p.speed ?? 90,
    courseDegrees: p.course ?? 90,
  };
}

/** Eastbound track along lat 32.0, one point per second, from lon0 to lon1 in `count` steps. */
function eastbound(
  lon0: number,
  lon1: number,
  count: number,
  start = 0,
  altitude: (i: number) => number = () => 1500,
): CVFRTrackPoint[] {
  return Array.from({ length: count }, (_, i) =>
    point({ lon: lon0 + ((lon1 - lon0) * i) / Math.max(1, count - 1), altitude: altitude(i), second: start + i }),
  );
}

const transcript = (text: string, second: number): CVFRTranscriptSegment => ({ timestamp: at(second), text });

function reportingPoint(code: string, en: string | null, he: string | null, lon: number): IsraelReportingPoint {
  return { id: 1, code, nameEnglish: en, nameHebrew: he, kind: 'compulsory', latitude: 32.0, longitude: lon };
}

const byCode = (...points: IsraelReportingPoint[]) => new Map(points.map((p) => [p.code, p]));

// MARK: Published altitudes

test('parses one and two number altitudes', () => {
  expect(publishedAltitudes('3500')).toEqual([3500]);
  expect(publishedAltitudes('2500/3500')).toEqual([2500, 3500]);
  expect(publishedAltitudes('---')).toEqual([]);
});

test('two number altitude compares against the nearer value', () => {
  const published = [2500, 3500];
  expect(deviationFeet(2600, published)).toBe(100);
  expect(deviationFeet(3300, published)).toBe(-200);
  // 3000 is equidistant; either side is acceptable, the magnitude is 500.
  expect(Math.abs(deviationFeet(3000, published))).toBe(500);
});

// MARK: Adherence maths

test('adherence is time weighted with max deviation', () => {
  // 60 s on 1500 (0 ft), 40 s on 1750 (+250 ft), 20 s on 2000 (+500 ft); published 1500.
  const samples = eastbound(34.8, 35.0, 120, 0, (i) => (i < 60 ? 1500 : i < 100 ? 1750 : 2000));
  const result = adherence(samples, [1500])!;
  expect(result).not.toBeNull();
  expect(result.fractionWithin200).toBe(0.5); // 60 / 120 s
  expect(Math.abs(result.fractionWithin300 - 100 / 120)).toBeLessThan(1e-9);
  expect(result.maxDeviationFeet).toBe(500);
  expect(result.sampledSeconds).toBe(120);
});

test('below published altitude gives negative max deviation', () => {
  const samples = eastbound(34.8, 35.0, 30, 0, () => 1100);
  const result = adherence(samples, [1500])!;
  expect(result).not.toBeNull();
  expect(result.maxDeviationFeet).toBe(-400);
  expect(result.fractionWithin300).toBe(0);
});

test('a gap in the track is not credited beyond ten seconds', () => {
  // A good sample, then a 10-minute gap, then a bad one: the gap is not blamed on either side.
  const samples = [point({ lon: 34.8, altitude: 1500, second: 0 }), point({ lon: 34.9, altitude: 3000, second: 600 })];
  const result = adherence(samples, [1500])!;
  expect(result).not.toBeNull();
  expect(result.sampledSeconds).toBe(11); // 10 s credited to the first sample + 1 s to the last
});

test('aerodrome ends are excluded from the adherence', () => {
  // Leg ends at an aerodrome (LLIB); the last 3 NM are flown 3500 ft too high (a traffic pattern climb).
  const leg: CVFRRouteLeg = { segment: segment(1, 'ALPHA', 'LLIB', 34.8, 35.3), forward: true };
  const cutoffLon = 35.3 - 3.0 / (60 * Math.cos((32.0 * Math.PI) / 180));
  const track = eastbound(34.8, 35.3, 200, 0, (i) => {
    const lon = 34.8 + (0.5 * i) / 199;
    return lon > cutoffLon + 0.002 ? 5000 : 1500; // high only well inside the 3 NM zone
  });
  const result = legAdherence(track, leg, '1500')!;
  expect(result).not.toBeNull();
  expect(result.fractionWithin200).toBe(1);
  expect(result.maxDeviationFeet).toBe(0);
  // Without the exclusion the same track is clearly off.
  const unfiltered = adherence(track, [1500])!;
  expect(unfiltered).not.toBeNull();
  expect(unfiltered.fractionWithin200).toBeLessThan(1);
});

test('aerodrome start and end are both excluded but en route points are not', () => {
  const leg: CVFRRouteLeg = { segment: segment(1, 'LLHZ', 'LLIB', 34.8, 35.3), forward: true };
  const nm = 3.0 / (60 * Math.cos((32.0 * Math.PI) / 180));
  const track = eastbound(34.8, 35.3, 200, 0, (i) => {
    const lon = 34.8 + (0.5 * i) / 199;
    return lon < 34.8 + nm || lon > 35.3 - nm ? 900 : 2000; // 500 ft above published only en route
  });
  const result = legAdherence(track, leg, '1500')!;
  expect(result).not.toBeNull();
  expect(result.maxDeviationFeet).toBe(500);
  expect(result.fractionWithin300).toBe(0);
});

// MARK: Route matching

test('planned match follows the legs in order', () => {
  const legs: CVFRRouteLeg[] = [
    { segment: segment(1, 'A', 'B', 34.8, 35.0), forward: true },
    { segment: segment(2, 'B', 'C', 35.0, 35.2), forward: true },
  ];
  const matched = matchPlanned(eastbound(34.8, 35.2, 80), legs);
  expect(matched.map((m) => legFromCode(m.leg))).toEqual(['A', 'B']);
  expect(matched.reduce((sum, m) => sum + m.points.length, 0)).toBe(80);
});

test('planned match ignores track more than one NM off the route', () => {
  const legs: CVFRRouteLeg[] = [{ segment: segment(1, 'A', 'B', 34.8, 35.0), forward: true }];
  // 0.05 degrees of latitude = 3 NM north of the route.
  const off = Array.from({ length: 20 }, (_, i) => point({ lat: 32.05, lon: 34.85 + i * 0.005, second: i }));
  expect(matchPlanned(off, legs)).toEqual([]);
});

test('unplanned match picks the segment and the direction flown', () => {
  const segments = [
    segment(1, 'A', 'B', 34.8, 35.2),
    segment(2, 'X', 'Y', 34.8, 35.2, { lat: 32.5 }), // 30 NM north: never matched
  ];
  const west = Array.from({ length: 60 }, (_, i) =>
    point({ lon: 35.1 - i * 0.002, altitude: 2500, second: i, course: 270 }),
  );
  const matched = matchUnplanned(west, segments);
  expect(matched).toHaveLength(1);
  expect(matched[0].leg.segment.id).toBe(1);
  expect(matched[0].leg.forward).toBe(false);
  expect(legFromCode(matched[0].leg)).toBe('B');
  // Flown against the published direction, so the reverse altitude (2500) is the reference.
  expect(legPublishedAltitude(matched[0].leg)).toBe('2500');
});

test('unplanned match drops brief crossings and far track', () => {
  const segments = [segment(1, 'A', 'B', 34.8, 35.2)];
  // 10 s within 1 NM of the route, then gone.
  const crossing = Array.from({ length: 10 }, (_, i) =>
    point({ lat: 31.97 + i * 0.006, lon: 35.0, second: i, course: 0 }),
  );
  expect(matchUnplanned(crossing, segments)).toEqual([]);
  const far = Array.from({ length: 60 }, (_, i) => point({ lat: 33.0, lon: 34.8 + i * 0.005, second: i }));
  expect(matchUnplanned(far, segments)).toEqual([]);
});

test('unplanned runs on the same leg are merged across a gap', () => {
  const segments = [segment(1, 'A', 'B', 34.8, 35.4)];
  // Two 40 s runs on the same segment separated by a stretch 3 NM north of it.
  const first = eastbound(34.85, 34.95, 40);
  const detour = Array.from({ length: 10 }, (_, i) => point({ lat: 32.05, lon: 34.95 + i * 0.002, second: 40 + i }));
  const second = eastbound(35.0, 35.1, 40, 50);
  const matched = matchUnplanned([...first, ...detour, ...second], segments);
  expect(matched).toHaveLength(1);
  expect(matched[0].points).toHaveLength(80);
});

// MARK: Reporting points

const tavor = reportingPoint('TAVOR', 'Tavor', 'תבור', 35.0);
/** Eastbound on lat 32.0 at 1 Hz; closest to TAVOR at 60 s. */
const tavorTrack = () => Array.from({ length: 121 }, (_, i) => point({ lon: 34.94 + i * 0.001, second: i }));

test('passage gives time and distance at closest approach', () => {
  // Track passes 0.01 deg of latitude (0.6 NM) south of the point at second 60.
  const track = Array.from({ length: 121 }, (_, i) => point({ lat: 31.99, lon: 34.94 + i * 0.001, second: i }));
  const result = passage(tavor, track, [])!;
  expect(result).not.toBeNull();
  expect(result.time).toBe(at(60));
  expect(Math.abs(result.distanceNM - 0.6)).toBeLessThan(0.05);
  expect(result.reported).toBe(false);
});

test('position report counts only within two minutes of passage', () => {
  const track = tavorTrack();
  expect(passage(tavor, track, [transcript('Tavor, Cessna four x-ray, 1500 feet', 60 + 100)])?.reported).toBe(true);
  expect(passage(tavor, track, [transcript('Tavor, Cessna four x-ray', 60 + 300)])?.reported).toBe(false);
  expect(passage(tavor, track, [transcript('Afula is next', 60)])?.reported).toBe(false);
});

test('report window is a parameter and defaults to two minutes', () => {
  const track = tavorTrack();
  const report = [transcript('Tavor, Cessna four x-ray', 60 + 200)]; // 200 s after the passage
  expect(passage(tavor, track, report)?.reported).toBe(false);
  expect(passage(tavor, track, report, 300)?.reported).toBe(true);
  expect(passage(tavor, track, [transcript('Tavor, Cessna four x-ray', 60 + 100)], 30)?.reported).toBe(false);
});

/** A 400 s eastbound track over lat 32.0 whose closest approach to TAVOR (lon 35.0) is at about 200 s, and a position
 * report heard 200 s after that: outside the built-in 120 s window, inside a 300 s one. */
function lateReportFixture() {
  return {
    track: eastbound(34.8, 35.2, 400),
    transcript: [transcript('Tavor, Cessna four x-ray', 400)],
    segments: [segment(1, 'ALPHA', 'TAVOR', 34.8, 35.2)],
    points: byCode(reportingPoint('ALPHA', 'Alpha', null, 34.8), tavor),
  };
}

test('the report window reaches the passage through the builder', () => {
  const f = lateReportFixture();
  const input = {
    trackPoints: f.track,
    transcript: f.transcript,
    plannedLegs: null,
    segments: f.segments,
    points: f.points,
  };
  expect(buildCVFRDebrief(input).points.find((p) => p.code === 'TAVOR')?.reported).toBe(false);
  expect(buildCVFRDebrief({ ...input, reportWindow: 300 }).points.find((p) => p.code === 'TAVOR')?.reported).toBe(true);
});

test('the report window reaches the passage through the loader', async () => {
  const f = lateReportFixture();
  // In-memory sources stand in for the RecordingDatabase and MockIsraelAviationDatabase of the Swift test.
  const recording = {
    trackPoints: async (id: string) => (id === flightID ? f.track : []),
    transcriptSegments: async (id: string) => (id === flightID ? f.transcript : []),
    routeLegs: async () => [],
  };
  const network = { routeSegments: async () => f.segments, reportingPoints: async () => [...f.points.values()] };
  const builtIn = await loadCVFRDebrief(flightID, recording, network);
  expect(builtIn).not.toBeNull();
  expect(builtIn!.points.find((p) => p.code === 'TAVOR')?.reported).toBe(false);
  const widened = await loadCVFRDebrief(flightID, recording, network, 300);
  expect(widened).not.toBeNull();
  expect(widened!.points.find((p) => p.code === 'TAVOR')?.reported).toBe(true);
  // A flight with no track gets no CVFR debrief.
  expect(await loadCVFRDebrief('other-flight', recording, network)).toBeNull();
  // A flight whose first fix is outside the Israel box (US coordinates) gets none either.
  const usTrack = f.track.map((p) => ({ ...p, latitude: 37.46, longitude: -122.12 }));
  const usRecording = { ...recording, trackPoints: async () => usTrack };
  expect(await loadCVFRDebrief(flightID, usRecording, network)).toBeNull();
});

// MARK: Hebrew and English text

test('hebrew matching ignores niqqud and final letter forms', () => {
  const p = reportingPoint('YRCHM', 'Yeroham', 'ירוחם', 34.9);
  expect(mentions(p, 'מעל יְרוֹחָם בגובה אלף וחמש מאות')).toBe(true);
  // Final mem written in its medial form (a recogniser slip) still matches.
  expect(mentions(p, 'מעל ירוחמ עכשיו')).toBe(true);
  // Maqaf and punctuation are word separators.
  expect(mentions(p, 'דיווח־ירוחם, אלפא')).toBe(true);
  expect(mentions(p, 'מעל ירוחמים')).toBe(false);
});

test('english matching is case insensitive by whole word and accepts the code', () => {
  const p = reportingPoint('AFFEK', 'Afek', 'אפק', 35.1);
  expect(mentions(p, 'passing AFEK at one thousand five hundred')).toBe(true);
  expect(mentions(p, 'affek, 4X-ABC')).toBe(true);
  expect(mentions(p, 'the afeka tower')).toBe(false);
});

test('vocabulary lists hebrew and english names once and skips aerodromes', () => {
  const points: IsraelReportingPoint[] = [
    reportingPoint('AFFEK', 'Afek', 'אפק', 35.1),
    reportingPoint('AFFE2', 'Afek', 'אפק', 35.2),
    {
      id: 3,
      code: 'LLHZ',
      nameEnglish: 'Herzliya',
      nameHebrew: 'הרצליה',
      kind: 'arp',
      latitude: 32.18,
      longitude: 34.83,
    },
  ];
  expect(vocabulary(points)).toEqual(['Afek', 'אפק']);
});

// MARK: Plan legs and the database

test('stored legs resolve to the flown direction', () => {
  const segments = [segment(1, 'A', 'B', 34.8, 35.0)];
  const resolved = resolveStoredLegs(
    [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ],
    segments,
  );
  expect(resolved?.map((leg) => leg.forward)).toEqual([true, false]);
  expect(resolveStoredLegs([], segments)).toBeNull();
  expect(resolveStoredLegs([{ from: 'A', to: 'Z' }], segments)).toBeNull();
});

// Swift routeLegsRoundTripThroughTheRecordingDatabase: saveRouteLegs replaces, routeLegs reads in order,
// deleteFlightData clears. Belongs with the RecordingDatabase port (data track).
test.todo('route legs round trip through the recording database');

// MARK: Observations and prompt facts

const alphaBravoPoints = () =>
  byCode(reportingPoint('ALPHA', 'Alpha', null, 34.8), reportingPoint('BRAVO', 'Bravo', 'ברבו', 35.2));

test('debrief observations and prompt facts come from the numbers', () => {
  // 300 ft too high all the way: 0% within 200, 100% within 300.
  const debrief = buildCVFRDebrief({
    trackPoints: eastbound(34.8, 35.2, 100, 0, () => 1800),
    transcript: [transcript('ברבו, אלפא', 99)],
    plannedLegs: null,
    segments: [segment(1, 'ALPHA', 'BRAVO', 34.8, 35.2)],
    points: alphaBravoPoints(),
  });
  expect(debrief.fromPlan).toBe(false);
  expect(debrief.legs).toHaveLength(1);
  expect(debrief.legs[0].adherence?.fractionWithin200).toBe(0);
  expect(debrief.legs[0].adherence?.fractionWithin300).toBe(1);
  expect(debrief.points.map((p) => p.code)).toEqual(['ALPHA', 'BRAVO']);
  expect(debrief.points.find((p) => p.code === 'BRAVO')?.reported).toBe(true);
  expect(debrief.observations.length).toBeGreaterThanOrEqual(2);
  expect(debrief.observations.length).toBeLessThanOrEqual(3);
  const facts = promptFacts(debrief);
  expect(facts).not.toBeNull();
  expect(facts).toContain('Leg ALPHA-BRAVO published 1500: 0% within 200ft, 100% within 300ft, max deviation 300ft');
  expect(facts).toContain('Point BRAVO');
  expect(facts).toContain('position report heard');
});

test('a flight with no transcript says the radio was not checked instead of none heard', () => {
  const debrief = buildCVFRDebrief({
    trackPoints: eastbound(34.8, 35.2, 100),
    transcript: [],
    plannedLegs: null,
    segments: [segment(1, 'ALPHA', 'BRAVO', 34.8, 35.2)],
    points: alphaBravoPoints(),
  });
  expect(debrief.transcriptAvailable).toBe(false);
  expect(debrief.observations.some((o) => o.includes('could not be checked'))).toBe(true);
  expect(debrief.observations.some((o) => o.includes('heard at') || o.includes('none heard'))).toBe(false);
  const facts = promptFacts(debrief);
  expect(facts).not.toBeNull();
  expect(facts).toContain('not checked (no transcript)');
  expect(facts).not.toContain('not heard');
});

test('prompt carries the CVFR facts and US flights are unchanged', () => {
  const metadata: FlightMetadata = {
    aircraftType: null,
    pilotName: null,
    departureICAO: 'LLHZ',
    arrivalICAO: 'LLIB',
    date: t0,
    durationSeconds: 600,
  };
  const base = { trackPoints: [], transcriptSegments: [], phaseMarkers: [], metadata };
  const plain = buildPrompt(base);
  expect(buildPrompt({ ...base, cvfrFacts: null })).toBe(plain);
  expect(plain).not.toContain('CVFR');
  expect(buildPrompt({ ...base, cvfrFacts: '[CVFR ROUTE] Leg A-B' })).toContain('[CVFR ROUTE] Leg A-B');
});

// MARK: Unrolled profile and verdict

const alpha = reportingPoint('ALPHA', 'Alpha', 'אלפא', 34.8);
const bravo = reportingPoint('BRAVO', 'Bravo', 'ברבו', 35.0);
const charlie = reportingPoint('CHARL', 'Charlie', "צ'רלי", 35.2);

/** ALPHA -> BRAVO -> CHARL eastbound on lat 32.0 (published 1500 both legs), flown at 1 Hz for 400 s; BRAVO is passed
 * at about 200 s. `altitude` is per sample index, feet MSL. */
function threePointDebrief(
  transcriptSegments: CVFRTranscriptSegment[],
  altitude: (i: number) => number = () => 1500,
): CVFRDebrief {
  const legs: CVFRRouteLeg[] = [
    { segment: segment(1, 'ALPHA', 'BRAVO', 34.8, 35.0), forward: true },
    { segment: segment(2, 'BRAVO', 'CHARL', 35.0, 35.2), forward: true },
  ];
  return buildCVFRDebrief({
    trackPoints: eastbound(34.8, 35.2, 400, 0, altitude),
    transcript: transcriptSegments,
    plannedLegs: legs,
    segments: legs.map((leg) => leg.segment),
    points: byCode(alpha, bravo, charlie),
  });
}

test('profile distances are monotonic and cumulative across legs', () => {
  const debrief = threePointDebrief([]);
  const legLength = polylineLengthNm([
    { lat: 32.0, lon: 34.8 },
    { lat: 32.0, lon: 35.0 },
  ]); // NM
  expect(debrief.legs).toHaveLength(2);
  expect(debrief.legs[0].startDistanceNM).toBe(0);
  expect(Math.abs(debrief.legs[0].endDistanceNM - legLength)).toBeLessThan(1e-9);
  expect(debrief.legs[1].startDistanceNM).toBe(debrief.legs[0].endDistanceNM);
  expect(Math.abs(debrief.legs[1].endDistanceNM - 2 * legLength)).toBeLessThan(1e-9);

  expect(debrief.profile).toHaveLength(400);
  const distances = debrief.profile.map((s) => s.distanceNM);
  expect(distances.slice(1).every((d, i) => distances[i] <= d)).toBe(true);
  expect(distances[0]).toBeLessThan(0.01);
  expect(Math.abs(distances[distances.length - 1] - 2 * legLength)).toBeLessThan(0.01);
  // Leg 2's samples sit beyond leg 1's length: the axis is cumulative, not per leg.
  const second = debrief.profile.filter((s) => s.legIndex === 1);
  expect(second.length).toBeGreaterThan(0);
  expect(second.every((s) => s.distanceNM >= legLength - 1e-9 && s.distanceNM <= 2 * legLength + 1e-9)).toBe(true);
  expect(debrief.profile.every((s) => !s.excluded)).toBe(true); // no aerodrome on this route
});

test('profile samples inside an aerodrome zone are excluded', () => {
  const legs: CVFRRouteLeg[] = [
    { segment: segment(1, 'LLHZ', 'ALPHA', 34.8, 35.0), forward: true },
    { segment: segment(2, 'ALPHA', 'BRAVO', 35.0, 35.2), forward: true },
  ];
  const debrief = buildCVFRDebrief({
    trackPoints: eastbound(34.8, 35.2, 400),
    transcript: [],
    plannedLegs: legs,
    segments: legs.map((leg) => leg.segment),
    points: new Map(),
  });
  const excluded = debrief.profile.filter((s) => s.excluded);
  expect(excluded.length).toBeGreaterThan(0);
  // Only the first 3 NM of the leg leaving LLHZ; the en-route leg is scored throughout.
  expect(excluded.every((s) => s.legIndex === 0 && s.distanceNM < aerodromeExclusionNM + 0.05)).toBe(true);
  const scoredOnFirstLeg = debrief.profile.filter((s) => s.legIndex === 0 && !s.excluded);
  expect(scoredOnFirstLeg.length).toBeGreaterThan(0);
  expect(scoredOnFirstLeg.every((s) => s.distanceNM > aerodromeExclusionNM - 0.05)).toBe(true);
  expect(debrief.profile.filter((s) => s.legIndex === 1).every((s) => !s.excluded)).toBe(true);
});

test('a point sits at its leg boundary along the route', () => {
  const debrief = threePointDebrief([]);
  expect(debrief.points.map((p) => p.code)).toEqual(['ALPHA', 'BRAVO', 'CHARL']);
  expect(debrief.points[0].distanceAlongRouteNM).toBe(0);
  expect(debrief.points[1].distanceAlongRouteNM).toBe(debrief.legs[0].endDistanceNM);
  expect(debrief.points[2].distanceAlongRouteNM).toBe(debrief.legs[1].endDistanceNM);
  // The passage itself is still the closest approach, not the axis position.
  expect(debrief.points[1].distanceNM).toBeLessThan(0.1);
});

test('verdict picks the low leg and the report not heard', () => {
  // Leg 2 flown 330 ft low for 120 samples (250...369 s): 40% within ±300 ft. CHARL never named on the radio.
  const debrief = threePointDebrief([transcript('Alpha, four x-ray', 0), transcript('Bravo, four x-ray', 200)], (i) =>
    i >= 250 && i < 370 ? 1170 : 1500,
  );
  expect(debrief.points.find((p) => p.code === 'BRAVO')?.reportTime).toBe(at(200));
  const findings = verdictFindings(debrief);
  expect(findings).toEqual(['BRAVO to CHARL: 330 ft low, 2 min', 'CHARL report not heard']);
  expect(verdictHeadline(findings.length)).toBe('Two things to look at.');
  const found = excursions(debrief);
  expect(found).toHaveLength(1);
  expect(found[0].legIndex).toBe(1);
  expect(excursionSeconds(found[0])).toBe(119);
});

test('verdict is empty when every leg held and every report was heard', () => {
  const debrief = threePointDebrief([transcript('Alpha', 0), transcript('Bravo', 200), transcript('Charlie', 399)]);
  expect(verdictFindings(debrief)).toEqual([]);
  expect(verdictHeadline(0)).toBe('Nothing to look at.');
  // Without a transcript nothing is "not heard": the radio was not checked.
  expect(verdictFindings(threePointDebrief([]))).toEqual([]);
});

/** HOME -> XRAY -> HOME: out east along lat 32.0 (0...199 s), back west along lat 32.03 (200...399 s), 1.8 NM apart so
 * each run matches only its own leg; 1500 ft published and flown both ways. HOME sits on the outbound line at lon
 * 34.8, XRAY between the two lines at lon 35.0. One position report naming XRAY at 200 s. */
function outAndBackDebrief(home: IsraelReportingPoint): CVFRDebrief {
  const legs: CVFRRouteLeg[] = [
    { segment: segment(1, home.code, 'XRAY', 34.8, 35.0), forward: true },
    { segment: segment(2, home.code, 'XRAY', 34.8, 35.0, { lat: 32.03, reverse: '1500' }), forward: false },
  ];
  const out = eastbound(34.8, 35.0, 200);
  const back = Array.from({ length: 200 }, (_, i) =>
    point({ lat: 32.03, lon: 35.0 - (0.2 * i) / 199, second: 200 + i, course: 270 }),
  );
  const xray: IsraelReportingPoint = {
    id: 2,
    code: 'XRAY',
    nameEnglish: 'Xray',
    nameHebrew: null,
    kind: 'compulsory',
    latitude: 32.015,
    longitude: 35.0,
  };
  return buildCVFRDebrief({
    trackPoints: [...out, ...back],
    transcript: [transcript('Xray, four x-ray', 200)],
    plannedLegs: legs,
    segments: legs.map((leg) => leg.segment),
    points: byCode(home, xray),
  });
}

test('an out and back route gives one passage per visit of the home point', () => {
  const home: IsraelReportingPoint = {
    id: 1,
    code: 'LLHZ',
    nameEnglish: 'Herzliya',
    nameHebrew: 'הרצליה',
    kind: 'arp',
    latitude: 32.0,
    longitude: 34.8,
  };
  const debrief = outAndBackDebrief(home);
  expect(debrief.legs).toHaveLength(2);
  expect(debrief.points.map((p) => p.code)).toEqual(['LLHZ', 'XRAY', 'LLHZ']);
  const departure = debrief.points[0];
  const arrival = debrief.points[2];
  expect(departure.time).toBe(t0);
  // The return leg ends back over LLHZ's longitude: the last visit is the end of the track, not the departure.
  expect(arrival.time).toBe(at(399));
  expect(departure.time).not.toBe(arrival.time);
  expect(Math.abs(arrival.distanceNM - 1.8)).toBeLessThan(0.05);
  expect(new Set(debrief.points.map(cvfrPassageId)).size).toBe(debrief.points.length);
});

test('a point missed on both visits is one finding', () => {
  const debrief = outAndBackDebrief(reportingPoint('ALPHA', 'Alpha', 'אלפא', 34.8));
  expect(debrief.points.map((p) => p.code)).toEqual(['ALPHA', 'XRAY', 'ALPHA']);
  expect(debrief.points.map((p) => p.reported)).toEqual([false, true, false]);
  const findings = verdictFindings(debrief);
  expect(findings).toEqual(['ALPHA report not heard']);
  expect(new Set(findings).size).toBe(findings.length);
});

test('a track gap closes an excursion', () => {
  // Two low stretches (1100 ft against 1500, 5 s sampling) separated by a 5-minute gap in the track.
  const seconds = [0, 5, 10, 310, 315, 320];
  const debrief: CVFRDebrief = {
    fromPlan: true,
    legs: [
      {
        fromCode: 'ALPHA',
        toCode: 'BRAVO',
        publishedAltitude: '1500',
        startTime: t0,
        endTime: at(320),
        adherence: null,
        startDistanceNM: 0,
        endDistanceNM: 0,
      },
    ],
    points: [],
    observations: [],
    transcriptAvailable: true,
    profile: seconds.map((second, index) => ({
      distanceNM: index,
      altitudeFeet: 1100,
      legIndex: 0,
      excluded: false,
      time: at(second),
    })),
  };
  const found = excursions(debrief);
  expect(found).toHaveLength(2);
  expect(found.map((e) => e.sampleRange)).toEqual([
    { lower: 0, upper: 2 },
    { lower: 3, upper: 5 },
  ]);
  expect(found.map(excursionSeconds)).toEqual([10, 10]);
});

// MARK: Bundled network

// Swift plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes: plans LLHZ -> LLIB with IsraelRoutePlanner
// over the bundled Israel database, flies it 150 ft high and expects every measured leg 100% within ±200 ft, the
// points LLHZ ... LLIB within 0.5 NM, and an unplanned match of the same track. Needs the L3 planner and a Node-side
// opener for the bundled database.
test.todo('planned LLHZ to LLIB flown high is measured against the bundled altitudes');
