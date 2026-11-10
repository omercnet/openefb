// Port of efb-212/Services/Debrief/CVFRDebrief.swift (CVFRDebriefBuilder and CVFRDebriefVerdict). Debrief of a
// recorded flight against the Israel CVFR route network (IL-DEBRIEF):
// - match the GPS track to route legs (the activated plan's legs, or the nearest segments);
// - per leg, time-weighted altitude adherence against the published altitude for the direction flown;
// - per reporting point on the route, the closest approach and whether a position report was heard;
// - the flown altitude on one distance axis along the matched legs (the unrolled debrief) and its verdict.
// Every number here comes from code, never from the language model.
// Units: feet MSL, nautical miles, degrees true. Timestamps are epoch ms; durations and windows are seconds.

import { distanceNm, type Coordinate } from '../geo';
import { mentions } from './transcriptTextMatcher';
import type { CVFRTrackPoint, CVFRTranscriptSegment, IsraelReportingPoint, IsraelRouteSegment } from './types';

// MARK: - Result types

/** One route leg the flight was matched to, with its altitude adherence. */
export interface CVFRLegDebrief {
  fromCode: string;
  toCode: string;
  /** Published altitude for the direction flown, verbatim ("2500" or "2500/3500"); null when CAAI publishes none. */
  publishedAltitude: string | null;
  startTime: number;
  endTime: number;
  /** null when every point fell inside the aerodrome exclusion zones or no altitude is published. */
  adherence: CVFRAltitudeAdherence | null;
  /** Where the leg starts and ends on the debrief's distance axis: cumulative along the matched legs. NM. */
  startDistanceNM: number;
  endDistanceNM: number;
}

/** Time-weighted altitude adherence on one leg, outside the 3 NM aerodrome exclusion zones. */
export interface CVFRAltitudeAdherence {
  /** Share of the leg's time (0...1) flown within ±200 ft / ±300 ft of the published altitude. */
  fractionWithin200: number;
  fractionWithin300: number;
  /** The largest deviation, signed: positive = above the published altitude. Feet. */
  maxDeviationFeet: number;
  /** Seconds of track that counted (after the exclusion zones). */
  sampledSeconds: number;
}

/** Passage of one reporting point on the route. */
export interface CVFRPointPassage {
  code: string;
  nameEnglish: string | null;
  nameHebrew: string | null;
  /** Time of closest approach. */
  time: number;
  /** Closest distance. NM. */
  distanceNM: number;
  /** A transcript segment within the report window of `time` named the point (code, English or Hebrew name). */
  reported: boolean;
  /** Where the point sits on the distance axis (a leg boundary). NM. null when built outside `buildCVFRDebrief`. */
  distanceAlongRouteNM: number | null;
  /** When the report naming the point was heard (the first matching segment); null when not heard. */
  reportTime: number | null;
}

/** One track point on the debrief's distance axis. */
export interface CVFRProfileSample {
  /** Along the matched legs, cumulative over legs. NM. Never decreases: an orbit stacks at one distance. */
  distanceNM: number;
  /** Feet MSL. */
  altitudeFeet: number;
  /** Index into `CVFRDebrief.legs`. */
  legIndex: number;
  /** Inside the 3 NM aerodrome zone of the leg: not scored. */
  excluded: boolean;
  time: number;
}

/** A scored stretch of the profile flown outside ±200 ft of the published altitude, on one leg, one side. */
export interface CVFRAltitudeExcursion {
  legIndex: number;
  /** Inclusive indices into `CVFRDebrief.profile`. */
  sampleRange: { lower: number; upper: number };
  /** The largest deviation in the stretch, signed: positive = above. Feet. */
  deviationFeet: number;
  startTime: number;
  endTime: number;
}

/** The CVFR section of a flight debrief. `legs` is empty when the track never came within 1 NM of a route. */
export interface CVFRDebrief {
  /** True when the legs came from the plan activated for the flight, false when matched from the track alone. */
  fromPlan: boolean;
  legs: CVFRLegDebrief[];
  points: CVFRPointPassage[];
  /** 2-3 plain-language observations, generated from the numbers above. */
  observations: string[];
  /** False when the flight has no transcript segments: position reports were then not checked, which is not the
   * same as "not heard". */
  transcriptAvailable: boolean;
  /** The flown altitude on the distance axis, for the unrolled debrief. */
  profile: CVFRProfileSample[];
}

/** Swift `CVFRLegDebrief.id`. */
export const cvfrLegId = (leg: CVFRLegDebrief): string => `${leg.fromCode}-${leg.toCode}-${leg.startTime}`;
/** Swift `CVFRPointPassage.id`: unique per visit (an out-and-back route passes the same point twice). */
export const cvfrPassageId = (p: CVFRPointPassage): string => `${p.code}-${p.time}`;
/** Swift `CVFRAltitudeExcursion.seconds`. */
export const excursionSeconds = (e: CVFRAltitudeExcursion): number => (e.endTime - e.startTime) / 1000;
/** Swift `CVFRDebrief.isEmpty`. */
export const isCVFRDebriefEmpty = (d: CVFRDebrief): boolean => d.legs.length === 0;

// MARK: - Matching input

/** A route leg to match the track against: a segment flown in one direction. */
export interface CVFRRouteLeg {
  segment: IsraelRouteSegment;
  forward: boolean;
}

export const legFromCode = (leg: CVFRRouteLeg): string => (leg.forward ? leg.segment.fromCode : leg.segment.toCode);
export const legToCode = (leg: CVFRRouteLeg): string => (leg.forward ? leg.segment.toCode : leg.segment.fromCode);
/** Polyline in the direction flown. */
export const legPolyline = (leg: CVFRRouteLeg): Coordinate[] =>
  leg.forward ? leg.segment.polyline : [...leg.segment.polyline].reverse();
export const legPublishedAltitude = (leg: CVFRRouteLeg): string | null =>
  (leg.forward ? leg.segment.altitudeForward : leg.segment.altitudeReverse)?.published ?? null;
/** Segments are equal by id (the database row), as in Swift. */
export const sameRouteLeg = (a: CVFRRouteLeg, b: CVFRRouteLeg): boolean =>
  a.segment.id === b.segment.id && a.forward === b.forward;

/** A run of consecutive track points on one leg. */
export interface CVFRMatchedLeg {
  leg: CVFRRouteLeg;
  points: CVFRTrackPoint[];
}

// MARK: - Constants

/** A track point counts as on a route when within this distance of its polyline. NM. */
export const matchRadiusNM = 1.0;
/** Track within this distance of an aerodrome endpoint is excluded from the altitude maths. NM. */
export const aerodromeExclusionNM = 3.0;
/** Reporting tolerance bands. Feet. */
export const tightBandFeet = 200.0;
export const wideBandFeet = 300.0;
/** A transcript segment counts as a position report within this window of the closest approach. Seconds. The
 * built-in value; the remote parameter cvfrReportWindowSeconds can move it inside its range. */
export const reportWindowSeconds = 120;
/** Gaps between samples longer than this are not credited to the earlier sample. Seconds. */
export const maxSampleWeightSeconds = 10;
/** Unplanned matching ignores runs shorter than this (route crossings, GPS noise). Seconds. */
export const minimumRunSeconds = 30;
/** A point within this much of the nearest leg's distance may belong to a later leg (a junction). NM. */
export const junctionToleranceNM = 0.01;

/** Swift `Double.rounded()`: half away from zero (Math.round rounds -0.5 up). */
const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
const coord = (p: { latitude: number; longitude: number }): Coordinate => ({ lat: p.latitude, lon: p.longitude });

// MARK: - Entry point

export interface BuildCVFRDebriefInput {
  trackPoints: readonly CVFRTrackPoint[];
  transcript: readonly CVFRTranscriptSegment[];
  /** The activated plan's legs when the flight had one; otherwise the track is matched to `segments`. */
  plannedLegs: readonly CVFRRouteLeg[] | null;
  /** The whole network. */
  segments: readonly IsraelRouteSegment[];
  /** Reporting points by code. */
  points: ReadonlyMap<string, IsraelReportingPoint>;
  /** Position-report window. Seconds. */
  reportWindow?: number;
}

/** Full debrief. */
export function buildCVFRDebrief(input: BuildCVFRDebriefInput): CVFRDebrief {
  const { trackPoints, transcript, plannedLegs, segments, points } = input;
  const reportWindow = input.reportWindow ?? reportWindowSeconds;
  const matched =
    plannedLegs && plannedLegs.length > 0
      ? matchPlanned(trackPoints, plannedLegs)
      : matchUnplanned(trackPoints, segments);
  const legs: CVFRLegDebrief[] = [];
  const profile: CVFRProfileSample[] = [];
  let furthest = 0; // NM along the route
  matched.forEach((run, index) => {
    const leg = legDebrief(run, legs.at(-1)?.endDistanceNM ?? 0);
    legs.push(leg);
    const polyline = legPolyline(run.leg);
    const zones = aerodromeEnds(run.leg, polyline);
    for (const point of run.points) {
      const coordinate = coord(point);
      // Clamped to the leg, so the axis never runs backwards across a leg boundary either.
      furthest = Math.max(furthest, leg.startDistanceNM + alongTrackNM(coordinate, polyline));
      profile.push({
        distanceNM: furthest,
        altitudeFeet: point.altitudeFeet,
        legIndex: index,
        excluded: isInAerodromeZone(coordinate, zones),
        time: point.timestamp,
      });
    }
  });

  const passages: CVFRPointPassage[] = [];
  for (const stop of routeStops(legs)) {
    const point = points.get(stop.code);
    if (!point) continue;
    const found = passage(point, trackPoints, transcript, reportWindow, stop.window);
    if (!found) continue;
    passages.push({ ...found, distanceAlongRouteNM: stop.distanceNM });
  }

  const transcriptAvailable = transcript.length > 0;
  return {
    fromPlan: plannedLegs !== null && plannedLegs.length > 0,
    legs,
    points: passages,
    observations: observations(legs, passages, transcriptAvailable),
    transcriptAvailable,
    profile,
  };
}

// MARK: - Route matching

/** Match the track to the plan's legs in order: each point goes to the nearest leg (within 1 NM) at or after the leg
 * the previous point was on, so a route that doubles back over itself stays in sequence. */
export function matchPlanned(trackPoints: readonly CVFRTrackPoint[], legs: readonly CVFRRouteLeg[]): CVFRMatchedLeg[] {
  if (legs.length === 0) return [];
  const polylines = legs.map(legPolyline);
  const runs: { index: number; points: CVFRTrackPoint[] }[] = [];
  let cursor = 0;
  for (const point of trackPoints) {
    const coordinate = coord(point);
    // Prefer the current or next leg; look further ahead only when neither is within range (a gap in the track
    // skipped a whole leg).
    const within = (start: number, end: number) => {
      const found: { index: number; distance: number }[] = [];
      for (let index = start; index < end; index++) {
        const distance = distanceToPolylineNM(coordinate, polylines[index]);
        if (distance <= matchRadiusNM) found.push({ index, distance });
      }
      return found;
    };
    let candidates = within(cursor, Math.min(legs.length, cursor + 2));
    if (candidates.length === 0) candidates = within(cursor, legs.length);
    if (candidates.length === 0) continue;
    // Nearest leg; at a junction (within junctionToleranceNM of the best) the later leg wins.
    const nearest = Math.min(...candidates.map((c) => c.distance));
    const best = Math.max(...candidates.filter((c) => c.distance <= nearest + junctionToleranceNM).map((c) => c.index));
    cursor = best;
    const last = runs.at(-1);
    if (last && last.index === best) last.points.push(point);
    else runs.push({ index: best, points: [point] });
  }
  return runs.map((run) => ({ leg: legs[run.index], points: run.points }));
}

/** Match the track to the nearest segment within 1 NM, in the direction the aircraft was moving along it. Runs
 * shorter than minimumRunSeconds are dropped (crossing another route, GPS scatter) and neighbouring runs on the same
 * leg are merged. */
export function matchUnplanned(
  trackPoints: readonly CVFRTrackPoint[],
  segments: readonly IsraelRouteSegment[],
): CVFRMatchedLeg[] {
  if (segments.length === 0) return [];
  const runs: CVFRMatchedLeg[] = [];
  let previous: CVFRTrackPoint | null = null;
  for (const point of trackPoints) {
    const coordinate = coord(point);
    const course = trackCourse(point, previous);
    let best: { segment: IsraelRouteSegment; distance: number; forward: boolean } | null = null;
    for (const segment of segments) {
      const { distance, bearing } = nearestEdge(coordinate, segment.polyline);
      if (distance > matchRadiusNM || !(distance < (best?.distance ?? Infinity))) continue;
      const forward = course === null ? true : angularDifference(course, bearing) <= 90;
      best = { segment, distance, forward };
    }
    previous = point;
    if (!best) continue;
    const leg: CVFRRouteLeg = { segment: best.segment, forward: best.forward };
    const last = runs.at(-1);
    if (last && sameRouteLeg(last.leg, leg)) last.points.push(point);
    else runs.push({ leg, points: [point] });
  }

  const kept = runs.filter((run) => {
    const first = run.points[0];
    const last = run.points.at(-1);
    return first !== undefined && last !== undefined && (last.timestamp - first.timestamp) / 1000 >= minimumRunSeconds;
  });
  const merged: CVFRMatchedLeg[] = [];
  for (const run of kept) {
    const last = merged.at(-1);
    if (last && sameRouteLeg(last.leg, run.leg))
      merged[merged.length - 1] = { leg: run.leg, points: [...last.points, ...run.points] };
    else merged.push(run);
  }
  return merged;
}

/** Inclusive time window, epoch ms; ±Infinity for open ends. */
export interface TimeWindow {
  lower: number;
  upper: number;
}

/** The reporting points along the debriefed legs, in order, without repeats of consecutive codes, each at its leg
 * boundary on the distance axis (NM). `window` spans the legs that touch the stop (from the start of the leg arriving
 * there to the end of the leg leaving it; open-ended before the first leg and after the last), so a point visited
 * twice (out and back) gets one passage per visit. */
export function routeStops(
  legs: readonly CVFRLegDebrief[],
): { code: string; distanceNM: number; window: TimeWindow }[] {
  const stops: { code: string; distanceNM: number; window: TimeWindow }[] = [];
  legs.forEach((leg, index) => {
    const last = stops.at(-1);
    if (last && last.code === leg.fromCode) {
      last.window = { lower: last.window.lower, upper: Math.max(last.window.upper, leg.endTime) };
    } else {
      const lower = index === 0 ? -Infinity : leg.startTime;
      stops.push({ code: leg.fromCode, distanceNM: leg.startDistanceNM, window: { lower, upper: leg.endTime } });
    }
    const upper = index === legs.length - 1 ? Infinity : leg.endTime;
    stops.push({ code: leg.toCode, distanceNM: leg.endDistanceNM, window: { lower: leg.startTime, upper } });
  });
  return stops;
}

// MARK: - Altitude adherence

/** `startDistanceNM` places the leg on the distance axis; it ends one polyline length later. NM. */
export function legDebrief(matched: CVFRMatchedLeg, startDistanceNM = 0): CVFRLegDebrief {
  const start = matched.points[0]?.timestamp ?? -Infinity;
  const end = matched.points.at(-1)?.timestamp ?? start;
  const published = legPublishedAltitude(matched.leg);
  return {
    fromCode: legFromCode(matched.leg),
    toCode: legToCode(matched.leg),
    publishedAltitude: published,
    startTime: start,
    endTime: end,
    adherence: published === null ? null : legAdherence(matched.points, matched.leg, published),
    startDistanceNM,
    endDistanceNM: startDistanceNM + polylineLengthNm(legPolyline(matched.leg)),
  };
}

/** Time-weighted adherence of `points` to `publishedText` on `leg`; points within 3 NM of an aerodrome endpoint are
 * excluded. null when nothing is left to measure or the text has no number. */
export function legAdherence(
  points: readonly CVFRTrackPoint[],
  leg: CVFRRouteLeg,
  publishedText: string,
): CVFRAltitudeAdherence | null {
  const published = publishedAltitudes(publishedText);
  if (published.length === 0) return null;
  const zones = aerodromeEnds(leg, legPolyline(leg));
  const sampled = points.filter((point) => !isInAerodromeZone(coord(point), zones));
  return adherence(sampled, published);
}

/** The leg's aerodrome endpoints (none where both ends are route points). `polyline` is the leg's polyline in the
 * direction flown. */
export function aerodromeEnds(leg: CVFRRouteLeg, polyline: readonly Coordinate[]): Coordinate[] {
  const ends: Coordinate[] = [];
  const first = polyline[0];
  const last = polyline.at(-1);
  if (isAerodromeCode(legFromCode(leg)) && first) ends.push(first);
  if (isAerodromeCode(legToCode(leg)) && last) ends.push(last);
  return ends;
}

/** Within 3 NM of one of `zones` (aerodrome endpoints): not scored. */
export function isInAerodromeZone(coordinate: Coordinate, zones: readonly Coordinate[]): boolean {
  return zones.some((zone) => distanceNm(coordinate, zone) < aerodromeExclusionNM);
}

/** Core maths: each sample is weighted by the time to the next sample (capped), and compared against the nearer
 * published altitude. */
export function adherence(
  samples: readonly CVFRTrackPoint[],
  published: readonly number[],
): CVFRAltitudeAdherence | null {
  if (samples.length === 0 || published.length === 0) return null;
  let total = 0;
  let within200 = 0;
  let within300 = 0;
  let maxDeviation = 0;
  samples.forEach((sample, index) => {
    const next = samples[index + 1];
    const weight = next ? Math.min(maxSampleWeightSeconds, Math.max(0, (next.timestamp - sample.timestamp) / 1000)) : 1;
    const deviation = deviationFeet(sample.altitudeFeet, published);
    total += weight;
    if (Math.abs(deviation) <= tightBandFeet) within200 += weight;
    if (Math.abs(deviation) <= wideBandFeet) within300 += weight;
    if (Math.abs(deviation) > Math.abs(maxDeviation)) maxDeviation = deviation;
  });
  if (!(total > 0)) return null;
  return {
    fractionWithin200: within200 / total,
    fractionWithin300: within300 / total,
    maxDeviationFeet: maxDeviation,
    sampledSeconds: total,
  };
}

/** Signed deviation from the nearer published altitude. Feet. */
export function deviationFeet(altitude: number, published: readonly number[]): number {
  let best = altitude - published[0];
  for (const value of published.slice(1)) {
    if (Math.abs(altitude - value) < Math.abs(best)) best = altitude - value;
  }
  return best;
}

/** "2500" -> [2500]; "2500/3500" -> [2500, 3500]. Feet MSL. */
export function publishedAltitudes(text: string): number[] {
  return text
    .split(/\P{N}+/u)
    .filter((part) => part !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

/** Aerodrome endpoints carry the ICAO code (LLxx); route points carry five-letter codes. */
export function isAerodromeCode(code: string): boolean {
  return Array.from(code).length === 4 && code.toUpperCase().startsWith('LL');
}

// MARK: - Reporting points

/** Closest approach to `point` among the track points timed inside `window`, and whether a report naming it was
 * heard within `reportWindow` seconds of that time. `distanceAlongRouteNM` is null here; the builder sets it. */
export function passage(
  point: IsraelReportingPoint,
  trackPoints: readonly CVFRTrackPoint[],
  transcript: readonly CVFRTranscriptSegment[],
  reportWindow: number = reportWindowSeconds,
  window: TimeWindow = { lower: -Infinity, upper: Infinity },
): CVFRPointPassage | null {
  const target = coord(point);
  let closest: { time: number; distance: number } | null = null;
  for (const sample of trackPoints) {
    if (sample.timestamp < window.lower || sample.timestamp > window.upper) continue;
    const distance = distanceNm(coord(sample), target);
    if (distance < (closest?.distance ?? Infinity)) closest = { time: sample.timestamp, distance };
  }
  if (!closest) return null;
  const at = closest.time;
  const report = transcript.find(
    (segment) => Math.abs(segment.timestamp - at) / 1000 <= reportWindow && mentions(point, segment.text),
  );
  return {
    code: point.code,
    nameEnglish: point.nameEnglish,
    nameHebrew: point.nameHebrew,
    time: closest.time,
    distanceNM: closest.distance,
    reported: report !== undefined,
    distanceAlongRouteNM: null,
    reportTime: report?.timestamp ?? null,
  };
}

// MARK: - Observations

/** 2-3 plain-language sentences about the numbers. Empty when no leg matched. */
export function observations(
  legs: readonly CVFRLegDebrief[],
  points: readonly CVFRPointPassage[],
  transcriptAvailable = true,
): string[] {
  if (legs.length === 0) return [];
  const lines: string[] = [];
  const measured = legs.flatMap((leg) => (leg.adherence ? [{ leg, adherence: leg.adherence }] : []));
  if (measured.length === 0) {
    lines.push('No leg had enough track outside the aerodrome zones to measure altitude.');
  } else {
    const totalSeconds = measured.reduce((sum, m) => sum + m.adherence.sampledSeconds, 0);
    const within200 =
      measured.reduce((sum, m) => sum + m.adherence.fractionWithin200 * m.adherence.sampledSeconds, 0) / totalSeconds;
    const within300 =
      measured.reduce((sum, m) => sum + m.adherence.fractionWithin300 * m.adherence.sampledSeconds, 0) / totalSeconds;
    lines.push(
      `Altitude was within ±200 ft of the published altitude for ${percent(within200)} of the route and within ±300 ft for ${percent(within300)}.`,
    );

    // The first leg with the lowest ±200 ft share (Swift min(by:)).
    const worst = measured.reduce((a, b) => (b.adherence.fractionWithin200 < a.adherence.fractionWithin200 ? b : a));
    const { leg, adherence: a } = worst;
    const direction = a.maxDeviationFeet >= 0 ? 'above' : 'below';
    const published = leg.publishedAltitude ?? '---';
    const largest = roundHalfAway(Math.abs(a.maxDeviationFeet));
    if (a.fractionWithin200 >= 0.9) {
      lines.push(
        `Every leg held altitude well; the largest deviation was ${largest} ft ${direction} ${published} ft on ${leg.fromCode}–${leg.toCode}.`,
      );
    } else {
      lines.push(
        `${leg.fromCode}–${leg.toCode} was the weakest leg: ${percent(a.fractionWithin200)} within ±200 ft of ${published} ft, up to ${largest} ft ${direction}.`,
      );
    }
  }

  const reportable = points.filter((p) => !isAerodromeCode(p.code));
  if (!transcriptAvailable) {
    // Nothing was transcribed (recording off, no speech recognised, or transcription failed): the radio was not
    // checked. Never turn "not transcribed" into "not heard".
    if (reportable.length > 0) {
      lines.push('No cockpit audio was transcribed, so position reports could not be checked.');
    }
  } else if (reportable.length > 0) {
    const missed = reportable.filter((p) => !p.reported);
    if (missed.length === 0) {
      lines.push(`A position report was heard at all ${reportable.length} reporting points.`);
    } else {
      const names = missed.map((p) => p.code).join(', ');
      lines.push(
        `Position reports were heard at ${reportable.length - missed.length} of ${reportable.length} reporting points; none heard near ${names}.`,
      );
    }
  }
  return lines.slice(0, 3);
}

/** 0.456 -> "46%". */
export function percent(fraction: number): string {
  return `${roundHalfAway(fraction * 100)}%`;
}

// MARK: - Excursions

/** The scored stretches of `debrief.profile` outside ±200 ft of the leg's published altitude, in order. A stretch
 * ends at a sample back inside the band, an excluded sample, a new leg, a change of side, or a gap in the track
 * longer than maxSampleWeightSeconds (no data is not time outside the band). */
export function excursions(debrief: CVFRDebrief): CVFRAltitudeExcursion[] {
  const published = debrief.legs.map((leg) =>
    leg.publishedAltitude === null ? [] : publishedAltitudes(leg.publishedAltitude),
  );
  const result: CVFRAltitudeExcursion[] = [];
  let open: CVFRAltitudeExcursion | null = null;
  for (const [index, sample] of debrief.profile.entries()) {
    if (index > 0 && (sample.time - debrief.profile[index - 1].time) / 1000 > maxSampleWeightSeconds) {
      if (open) result.push(open);
      open = null;
    }
    const reference = published[sample.legIndex] ?? [];
    const deviation = reference.length === 0 || sample.excluded ? 0 : deviationFeet(sample.altitudeFeet, reference);
    if (!(Math.abs(deviation) > tightBandFeet)) {
      if (open) result.push(open);
      open = null;
      continue;
    }
    if (open && open.legIndex === sample.legIndex && open.deviationFeet > 0 === deviation > 0) {
      open.sampleRange = { lower: open.sampleRange.lower, upper: index };
      open.endTime = sample.time;
      if (Math.abs(deviation) > Math.abs(open.deviationFeet)) open.deviationFeet = deviation;
    } else {
      if (open) result.push(open);
      open = {
        legIndex: sample.legIndex,
        sampleRange: { lower: index, upper: index },
        deviationFeet: deviation,
        startTime: sample.time,
        endTime: sample.time,
      };
    }
  }
  if (open) result.push(open);
  return result;
}

// MARK: - Prompt facts

const hhmmUTC = (epochMs: number): string => {
  const d = new Date(epochMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** The CVFR facts for the flight summary prompt, so the AI debrief can mention them without inventing numbers. null
 * when no leg matched. */
export function promptFacts(debrief: CVFRDebrief): string | null {
  if (isCVFRDebriefEmpty(debrief)) return null;
  const lines = [
    `[CVFR ROUTE] Israel CVFR route ${debrief.fromPlan ? '(planned)' : '(matched from track)'}. Altitudes feet MSL.`,
  ];
  for (const leg of debrief.legs) {
    let line = `Leg ${leg.fromCode}-${leg.toCode} published ${leg.publishedAltitude ?? 'none'}`;
    const a = leg.adherence;
    if (a) {
      line += `: ${percent(a.fractionWithin200)} within 200ft, ${percent(a.fractionWithin300)} within 300ft, max deviation ${roundHalfAway(a.maxDeviationFeet)}ft`;
    } else {
      line += ': not measured';
    }
    lines.push(line);
  }
  for (const point of debrief.points) {
    const report = debrief.transcriptAvailable
      ? point.reported
        ? 'heard'
        : 'not heard'
      : 'not checked (no transcript)';
    lines.push(
      `Point ${point.code} ${hhmmUTC(point.time)}Z closest ${point.distanceNM.toFixed(1)}NM, position report ${report}`,
    );
  }
  return lines.join('\n');
}

// MARK: - Geometry (nautical miles, equirectangular around the query point)

/** Distance from a point to a polyline. NM. */
export function distanceToPolylineNM(point: Coordinate, polyline: readonly Coordinate[]): number {
  return nearestEdgeProjection(point, polyline).distance;
}

/** The nearest polyline edge: its distance (NM) and bearing (degrees true, in polyline order). */
export function nearestEdge(point: Coordinate, polyline: readonly Coordinate[]): { distance: number; bearing: number } {
  const { distance, bearing } = nearestEdgeProjection(point, polyline);
  return { distance, bearing };
}

/** How far along `polyline` the point projects onto its nearest edge, 0...polyline length. NM. */
export function alongTrackNM(point: Coordinate, polyline: readonly Coordinate[]): number {
  const edge = nearestEdgeProjection(point, polyline);
  if (edge.index + 1 >= polyline.length) return 0;
  let before = 0;
  for (let i = 0; i < edge.index; i++) before += distanceNm(polyline[i], polyline[i + 1]);
  return before + edge.fraction * distanceNm(polyline[edge.index], polyline[edge.index + 1]);
}

/** The nearest edge's distance (NM), bearing (degrees true), index (its first vertex) and the projection's fraction
 * along it (0...1). */
function nearestEdgeProjection(
  point: Coordinate,
  polyline: readonly Coordinate[],
): { distance: number; bearing: number; index: number; fraction: number } {
  const first = polyline[0];
  if (!first) return { distance: Infinity, bearing: 0, index: 0, fraction: 0 };
  if (polyline.length === 1) return { distance: distanceNm(point, first), bearing: 0, index: 0, fraction: 0 };
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const project = (c: Coordinate) => ({ x: (c.lon - point.lon) * 60 * cosLat, y: (c.lat - point.lat) * 60 });
  let best = { distance: Infinity, bearing: 0, index: 0, fraction: 0 };
  for (let index = 0; index + 1 < polyline.length; index++) {
    const pa = project(polyline[index]);
    const pb = project(polyline[index + 1]);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, -(pa.x * dx + pa.y * dy) / lengthSquared)) : 0;
    const cx = pa.x + t * dx;
    const cy = pa.y + t * dy;
    const distance = Math.sqrt(cx * cx + cy * cy);
    if (distance < best.distance) {
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      best = { distance, bearing, index, fraction: t };
    }
  }
  return best;
}

/** Course over ground, degrees true: the recorded course, else the bearing from the previous sample. */
export function trackCourse(point: CVFRTrackPoint, previous: CVFRTrackPoint | null): number | null {
  if (point.courseDegrees >= 0 && point.groundSpeedKnots > 5) return point.courseDegrees;
  if (!previous) return null;
  const cosLat = Math.cos((point.latitude * Math.PI) / 180);
  const dx = (point.longitude - previous.longitude) * cosLat;
  const dy = point.latitude - previous.latitude;
  if (dx === 0 && dy === 0) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two bearings, degrees 0...180. */
export function angularDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// MARK: - Verdict

/** A leg is low when less than this share of its measured time was within ±300 ft (the table's amber rule). */
export const lowLegFraction = 0.8;
export const maximumFindings = 2;

/** The one line above the unrolled debrief: at most two findings to look at, never an overall score. Low legs
 * (worst first) and points whose report was not heard (aerodromes are not reporting points; nothing is "not heard"
 * without a transcript). The worst leg and the first missed report come first, so two findings of different kinds
 * both show. */
export function verdictFindings(debrief: CVFRDebrief): string[] {
  const all = excursions(debrief);
  const lowLegs = debrief.legs
    .flatMap((leg, index) =>
      leg.adherence && leg.adherence.fractionWithin300 < lowLegFraction ? [{ index, adherence: leg.adherence }] : [],
    )
    .sort((a, b) => a.adherence.fractionWithin300 - b.adherence.fractionWithin300)
    .map((low) =>
      legFinding(
        debrief.legs[low.index],
        low.adherence,
        all.filter((e) => e.legIndex === low.index),
      ),
    );
  const notHeard = debrief.transcriptAvailable
    ? debrief.points.filter((p) => !p.reported && !isAerodromeCode(p.code)).map((p) => `${p.code} report not heard`)
    : [];
  const firsts = [lowLegs[0], notHeard[0]].filter((f): f is string => f !== undefined);
  const rest = [...lowLegs.slice(1), ...notHeard.slice(1)];
  // A point passed twice (out and back) and missed both times is one finding, not two.
  return [...new Set([...firsts, ...rest])].slice(0, maximumFindings);
}

/** "TAVOR to DESHE: 330 ft low, 4 min" from the leg's longest excursion; the ±300 ft share when it has none. */
export function legFinding(
  leg: CVFRLegDebrief,
  adherence: CVFRAltitudeAdherence,
  legExcursions: readonly CVFRAltitudeExcursion[],
): string {
  const name = `${leg.fromCode} to ${leg.toCode}`;
  const top = longest(legExcursions);
  if (!top) return `${name}: ${percent(adherence.fractionWithin300)} within 300 ft`;
  return `${name}: ${deviationText(top.deviationFeet)}, ${durationText(excursionSeconds(top))}`;
}

/** The excursion that lasted longest; the larger deviation breaks a tie; the first wins a full tie. */
export function longest(list: readonly CVFRAltitudeExcursion[]): CVFRAltitudeExcursion | null {
  let best: CVFRAltitudeExcursion | null = null;
  for (const e of list) {
    if (!best) {
      best = e;
      continue;
    }
    const s = excursionSeconds(e);
    const bs = excursionSeconds(best);
    if (bs < s || (bs === s && Math.abs(best.deviationFeet) < Math.abs(e.deviationFeet))) best = e;
  }
  return best;
}

/** "330 ft low" / "250 ft high". Feet. */
export function deviationText(deviation: number): string {
  return `${roundHalfAway(Math.abs(deviation))} ft ${deviation < 0 ? 'low' : 'high'}`;
}

/** "4 min" from a minute up, "45 s" below. Seconds. */
export function durationText(seconds: number): string {
  return seconds >= 60 ? `${roundHalfAway(seconds / 60)} min` : `${roundHalfAway(seconds)} s`;
}

export function verdictHeadline(count: number): string {
  if (count === 0) return 'Nothing to look at.';
  if (count === 1) return 'One thing to look at.';
  return 'Two things to look at.';
}

/** Length of a polyline: the sum of its great-circle edges, nautical miles (IsraelRoutePlanner.length). */
// TODO(L1): use the core geometry helper once L1 lands one.
export function polylineLengthNm(polyline: readonly Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) total += distanceNm(polyline[i - 1]!, polyline[i]!);
  return total;
}
