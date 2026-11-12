// The NOTAM closure half of Services/IsraelChartFeatures.swift (IsraelChartFeatureBuilder.closures and helpers) plus
// the closure status of IsraelChartOverlay. The closure mapper (IsraelNotamClosureMapper) and the feed types are L3/S1;
// they are not on main, so this file declares the minimal structural inputs it reads. L3's IsraelRouteClosure and
// IsraelClosureMatch<IsraelRouteSegment> are assignable to them. Times are epoch ms.
import { evaluateFreshness, type FreshnessLevel } from '../../core';
import type { IsraelChartSegmentFeature } from './chartFeatures';
import { midpoint, textRotation } from './chartFeatures';

export type IsraelClosureSeverity = 'full' | 'partial' | 'check';

/** One altitude limit from a NOTAM closure clause (Swift IsraelAltitudeLimit). */
export interface IsraelAltitudeLimitInput {
  /** AT, BLW, ABV or BTN */
  op: string;
  lowerFt: number | null;
  upperFt: number | null;
  /** AMSL, AGL, or FL (already converted to feet) */
  ref: string | null;
}

export interface IsraelAvailableAltitudeInput extends IsraelAltitudeLimitInput {
  direction: string | null;
}

/** The fields of IsraelRouteClosure the chart reads. */
export interface IsraelRouteClosureInput {
  notamId: string;
  routeKind: string;
  routeName?: string | null;
  chain: readonly string[];
  validFrom: number | null;
  validTo: number | null;
  schedule: string | null;
  routeKinds?: readonly string[] | null;
  closedAltitudes?: readonly IsraelAltitudeLimitInput[] | null;
  availableAltitudes?: readonly IsraelAvailableAltitudeInput[] | null;
  exceptions?: readonly string[] | null;
  partial?: boolean | null;
  parsed?: boolean | null;
  raw?: string | null;
}

/** One closure mapped onto the CVFR network: the mapper's IsraelClosureMatch, segments by id. */
export interface IsraelClosureMatchInput {
  closure: IsraelRouteClosureInput;
  segments: readonly { id: number }[];
}

/** A NOTAM closure applied to a segment (Swift IsraelChartClosureMark). */
export interface IsraelChartClosureMark {
  notamID: string;
  /** "CLSD to 13:30Z"; partial closures carry their altitudes; unread ones say "CHECK NOTAM". */
  text: string;
  schedule: string | null;
  /** Red (full) or amber (partial, check NOTAM). */
  severity: IsraelClosureSeverity;
  /** Extra lines for the tap sheet: exceptions as written, or the unread clause. */
  notes: string[];
}

/** Closed segments with the freshness that decides whether they may be drawn at all. */
export interface IsraelChartClosureSet {
  /** Segment id -> mark. Empty when the feed is stale, absent, or closes nothing. */
  marks: ReadonlyMap<number, IsraelChartClosureMark>;
  /** When the relay scraped the IAA (null when no feed). */
  generatedAt: number | null;
  freshness: FreshnessLevel;
}

/** A closed segment as drawn: casing along the polyline and a label at its midpoint. */
export interface IsraelChartClosureFeature {
  segmentID: number;
  polyline: { lat: number; lon: number }[];
  mark: IsraelChartClosureMark;
  labelCoordinate: { lat: number; lon: number };
  rotationDegrees: number;
}

/** What the layer panel says about the closures layer (Swift IsraelClosureStatus). */
export type IsraelClosureStatus =
  { kind: 'noFeed' } | { kind: 'loaded'; generatedAt: number; level: FreshnessLevel; closedSegments: number };

/** Closures older than this (by scrape time) are never drawn. `notam` expires at 6 h. */
export const DRAWABLE_FRESHNESS: readonly FreshnessLevel[] = ['fresh', 'old'];
/** Only CVFR route closures belong on this chart. */
export const CHART_ROUTE_KIND = 'CVFR';

export const NO_CLOSURES: IsraelChartClosureSet = Object.freeze({
  marks: new Map<number, IsraelChartClosureMark>(),
  generatedAt: null,
  freshness: 'unknown' as FreshnessLevel,
});

// MARK: Closure model helpers (IsraelNotamService.swift; L3 has the same helpers in notamTypes)

export function closureSeverity(closure: IsraelRouteClosureInput): IsraelClosureSeverity {
  if (closure.parsed === false) return 'check';
  return closure.partial === true ? 'partial' : 'full';
}

export function closureCovers(closure: IsraelRouteClosureInput, kind: string): boolean {
  const listed = (closure.routeKinds ?? []).map((k) => k.toUpperCase());
  const kinds = listed.length === 0 ? [closure.routeKind.toUpperCase()] : listed;
  return kinds.includes(kind.toUpperCase());
}

/** Chart text for a closure altitude: "2500", "BLW 1500", "ABV FL100", "1000-2000", "800 AGL". */
export function altitudeChartText(limit: IsraelAltitudeLimitInput): string {
  const value = (feet: number): string => (limit.ref === 'FL' ? `FL${Math.trunc(feet / 100)}` : String(feet));
  const suffix = limit.ref === 'AGL' ? ' AGL' : '';
  const { op, lowerFt: lo, upperFt: hi } = limit;
  if (op === 'BTN' && lo !== null && hi !== null) return `${value(lo)}-${value(hi)}${suffix}`;
  if (op === 'BLW' && hi !== null) return `BLW ${value(hi)}${suffix}`;
  if (op === 'ABV' && lo !== null) return `ABV ${value(lo)}${suffix}`;
  if (lo !== null) return value(lo) + suffix;
  if (hi !== null) return value(hi) + suffix;
  return op;
}

// MARK: Builder

/** full > check > partial: when several closures cover a segment, the most restrictive reading is drawn. */
export const closureRank = (severity: IsraelClosureSeverity): number => ({ full: 3, check: 2, partial: 1 })[severity];

/** "1h20m", "45m": age of the relay's scrape. */
export function dataAgeText(generatedAt: number, now: number): string {
  const minutes = Math.max(0, Math.trunc((now - generatedAt) / 60_000));
  return minutes >= 60 ? `${Math.trunc(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "HH:mm'Z'" on the same UTC day as `now`, else "d MMM HH:mm'Z'" (en_US_POSIX). */
function utcEndText(end: number, now: number): string {
  const e = new Date(end);
  const n = new Date(now);
  const hhmm = `${String(e.getUTCHours()).padStart(2, '0')}:${String(e.getUTCMinutes()).padStart(2, '0')}Z`;
  const sameDay =
    e.getUTCFullYear() === n.getUTCFullYear() &&
    e.getUTCMonth() === n.getUTCMonth() &&
    e.getUTCDate() === n.getUTCDate();
  return sameDay ? hhmm : `${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${hhmm}`;
}

/**
 * Full: "CLSD to 13:30Z", "CLSD to 3 Nov 13:30Z", "CLSD" (no end). Partial: "CLSD 2500 (middle dot) AVBL 3000 to
 * 13:30Z", "CLSD EXC to 13:30Z". Unread: "CHECK NOTAM". With `dataAge`, "... (data 1h20m old)".
 */
export function closureText(closure: IsraelRouteClosureInput, now: number, dataAge: string | null = null): string {
  const severity = closureSeverity(closure);
  let text: string;
  if (severity === 'check') {
    text = 'CHECK NOTAM';
  } else if (severity === 'full') {
    text = 'CLSD';
  } else {
    const closed = (closure.closedAltitudes ?? []).map(altitudeChartText);
    const open = (closure.availableAltitudes ?? []).map(altitudeChartText);
    const parts = [closed.length === 0 ? 'CLSD' : `CLSD ${closed.join('/')}`];
    if (open.length > 0) parts.push(`AVBL ${open.join('/')}`);
    if ((closure.exceptions ?? []).length > 0) parts.push('EXC');
    // "CLSD EXC" reads better than "CLSD (dot) EXC" when exceptions are the only condition.
    text = parts.join(closed.length === 0 && open.length === 0 ? ' ' : ' \u00B7 ');
  }
  if (severity !== 'check' && closure.validTo !== null) text += ` to ${utcEndText(closure.validTo, now)}`;
  if (dataAge !== null) text += ` (data ${dataAge} old)`;
  return text;
}

/** Lines for the tap sheet under the closure label: exceptions as written, or why the pilot must read the NOTAM. */
export function closureNotes(closure: IsraelRouteClosureInput): string[] {
  const notes = (closure.exceptions ?? []).map((e) => `EXC ${e}`);
  if (closureSeverity(closure) === 'check') {
    notes.push(`Possible closure not read in full: read NOTAM ${closure.notamId}.`);
    const raw = closure.raw ?? '';
    if (raw !== '') notes.push(raw);
  }
  return notes;
}

/**
 * Swift `closures(from:network:now:)`. `report` is null when no feed is held. `matches` is the closure mapper's output
 * for the report's closures at `now` (L3 mapClosures). A feed past the NOTAM expiry yields no marks: an old closure set
 * must never read as current. The CVFR filter runs here (Swift filtered before mapping; the mapper maps each closure on
 * its own, so filtering its output is the same). JS-only guard: matches outside their validity window at `now` are
 * dropped again, which is a no-op on mapper output.
 */
export function israelClosureSet(
  report: { generatedAt: number } | null,
  matches: readonly IsraelClosureMatchInput[],
  now: number,
): IsraelChartClosureSet {
  if (report === null) return NO_CLOSURES;
  const freshness = evaluateFreshness('notam', { observed: report.generatedAt, now }).level;
  const marks = new Map<number, IsraelChartClosureMark>();
  if (!DRAWABLE_FRESHNESS.includes(freshness)) return { marks, generatedAt: report.generatedAt, freshness };
  // Past its useful life but not expired: still drawn, and every label says how old the data is.
  const ageNote = freshness === 'old' ? dataAgeText(report.generatedAt, now) : null;
  for (const { closure, segments } of matches) {
    if (!closureCovers(closure, CHART_ROUTE_KIND)) continue;
    if (
      (closure.validFrom !== null && now < closure.validFrom) ||
      (closure.validTo !== null && now > closure.validTo)
    ) {
      continue;
    }
    const mark: IsraelChartClosureMark = {
      notamID: closure.notamId,
      text: closureText(closure, now, ageNote),
      schedule: closure.schedule,
      severity: closureSeverity(closure),
      notes: closureNotes(closure),
    };
    for (const segment of segments) {
      const existing = marks.get(segment.id);
      if (existing !== undefined && closureRank(existing.severity) >= closureRank(mark.severity)) continue;
      marks.set(segment.id, mark);
    }
  }
  return { marks, generatedAt: report.generatedAt, freshness };
}

/** Closed segments with their labels. Segments not in `segments` (outside the loaded data) are skipped. */
export function closureFeatures(
  segments: readonly IsraelChartSegmentFeature[],
  marks: ReadonlyMap<number, IsraelChartClosureMark>,
): IsraelChartClosureFeature[] {
  const out: IsraelChartClosureFeature[] = [];
  for (const segment of segments) {
    const mark = marks.get(segment.id);
    const mid = midpoint(segment.polyline);
    if (mark === undefined || mid === null) continue;
    out.push({
      segmentID: segment.id,
      polyline: segment.polyline,
      mark,
      labelCoordinate: mid,
      rotationDegrees: textRotation(segment.bearingTrue),
    });
  }
  return out;
}

/** IsraelChartOverlay.applyClosures: the layer panel status for a closure set. */
export const israelClosureStatus = (set: IsraelChartClosureSet): IsraelClosureStatus =>
  set.generatedAt === null
    ? { kind: 'noFeed' }
    : { kind: 'loaded', generatedAt: set.generatedAt, level: set.freshness, closedSegments: set.marks.size };
