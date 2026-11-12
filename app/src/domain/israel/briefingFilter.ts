// Port of Services/IsraelBriefingFilter.swift: pure filtering and ordering for the Israel NOTAM briefing (flight window,
// distance from the route or ownship, aerodrome, and the closures-first order). No UI and no I/O.
// Times are epoch ms; positions are { lat, lon } degrees; distances nautical miles.
import { NETWORK_CLOSURE_KINDS, type IsraelRouteNetwork } from '../../data/aviation/israelTypes';
import type { ActiveRoute } from '../route/activeRoute';
import {
  closureCovers,
  closureKinds,
  closureSeverity,
  notamIsSuperseded,
  type IsraelLatLon,
  type IsraelNotam,
  type IsraelRouteClosure,
} from './notamTypes';
import { planNetwork, planPointCodes, planPoints, planTotalETESeconds, type IsraelRoutePlan } from './routePlanner';

// MARK: - Inputs

/** The planned route as the briefing needs it. */
export interface BriefingRoute {
  /** Point codes in order, departure first (reporting points and ICAO aerodromes). */
  codes: string[];
  points: IsraelLatLon[];
  /** Planned off-block time (epoch ms); null when there is no plan (active route only). */
  departure: number | null;
  eteSeconds: number | null;
  /** The route network the plan is flown on; decides which route closures count as closures for this pilot. */
  network: IsraelRouteNetwork;
}

/** Swift memberwise init defaults: no departure, no ETE, CVFR. */
export const makeBriefingRoute = (
  r: Pick<BriefingRoute, 'codes' | 'points'> & Partial<BriefingRoute>,
): BriefingRoute => ({ departure: null, eteSeconds: null, network: 'cvfr', ...r });

/** 4-letter ICAO codes on the route: the aerodromes whose NOTAMs matter next. */
export const briefingRouteAerodromes = (route: BriefingRoute): Set<string> =>
  new Set(route.codes.map((c) => c.toUpperCase()).filter((c) => c.length === 4 && c.startsWith('LL')));

/** From the Israel flight-plan screen: the planned route with its departure time (epoch ms) and ETE. */
export const briefingRouteFromPlan = (plan: IsraelRoutePlan, departure: number): BriefingRoute => ({
  codes: planPointCodes(plan),
  points: planPoints(plan).map((p) => ({ lat: p.latitude, lon: p.longitude })),
  departure,
  eteSeconds: planTotalETESeconds(plan),
  network: planNetwork(plan),
});

/**
 * From the activated route: no departure time or ETE (the window then defaults to now +3 h). `departurePoint` is the
 * first leg's start, which ActiveRoute does not carry. null for a route without legs. Network: CVFR (Swift default).
 */
export function briefingRouteFromActive(
  active: ActiveRoute,
  departurePoint: IsraelLatLon | null,
): BriefingRoute | null {
  if (active.legs.length === 0) return null;
  const codes = [active.legs[0].fromCode];
  const points = departurePoint ? [departurePoint] : [];
  for (const leg of active.legs) {
    codes.push(leg.toCode);
    points.push({ lat: leg.toLatitude, lon: leg.toLongitude });
  }
  return makeBriefingRoute({ codes, points });
}

/** When the pilot will be flying (epoch ms). A NOTAM is relevant when its validity overlaps this window. */
export interface BriefingWindow {
  start: number;
  end: number;
}

/** seconds */
export const DEFAULT_WINDOW_LENGTH_SECONDS = 3 * 3600;

/** Planned departure plus ETE when the plan has both, otherwise now to +3 h. */
export function flightWindow(route: BriefingRoute | null, now: number): BriefingWindow {
  const departure = route?.departure ?? null;
  const ete = route?.eteSeconds ?? null;
  if (departure !== null && ete !== null && ete > 0) return { start: departure, end: departure + ete * 1000 };
  return { start: now, end: now + DEFAULT_WINDOW_LENGTH_SECONDS * 1000 };
}

/** PERM is always valid; otherwise the validity interval must touch the window. A missing end means open-ended. */
export function windowIncludes(window: BriefingWindow, notam: IsraelNotam): boolean {
  if (notam.permanent) return true;
  const from = notam.validFrom ?? -Infinity;
  const to = notam.validTo ?? Infinity;
  return from <= window.end && to >= window.start;
}

export type BriefingReference =
  { kind: 'none' } | { kind: 'route'; route: BriefingRoute } | { kind: 'ownship'; point: IsraelLatLon };

export interface BriefingQuery {
  window: BriefingWindow;
  reference: BriefingReference;
  /** Corridor half-width around the route or ownship, nautical miles. */
  corridorNM: number;
  /** ICAO location filter ("LLHZ"); empty = all. */
  aerodrome: string;
  /** Aerodromes on the planned route; their NOTAMs sort right after the closures. */
  routeAerodromes: ReadonlySet<string>;
  /** The pilot's route network: only closures of its route kinds are red or amber. */
  network: IsraelRouteNetwork;
}

/** Swift memberwise init defaults: no reference, 25 NM, all aerodromes, CVFR. */
export const makeBriefingQuery = (q: Pick<BriefingQuery, 'window'> & Partial<BriefingQuery>): BriefingQuery => ({
  reference: { kind: 'none' },
  corridorNM: 25,
  aerodrome: '',
  routeAerodromes: new Set<string>(),
  network: 'cvfr',
  ...q,
});

// MARK: - Output

/** How a NOTAM's route closures are ranked: red full, amber partial, then unreadable ("check NOTAM"). */
export type BriefingClosureClass = 'full' | 'partial' | 'check' | 'none';
const CLOSURE_RANK: Record<BriefingClosureClass, number> = { full: 0, partial: 1, check: 2, none: 3 };

export type BriefingSection = 'closures' | 'routeAerodromes' | 'other';
/** Display order (Swift CaseIterable order). */
export const BRIEFING_SECTIONS: readonly BriefingSection[] = ['closures', 'routeAerodromes', 'other'];
const SECTION_RANK: Record<BriefingSection, number> = { closures: 0, routeAerodromes: 1, other: 2 };
export const BRIEFING_SECTION_TITLE: Record<BriefingSection, string> = {
  closures: 'Closures',
  routeAerodromes: 'Aerodromes on route',
  other: 'Other NOTAMs',
};

export interface BriefingRow {
  notam: IsraelNotam;
  closure: BriefingClosureClass;
  /** A closure the relay could not read in full, or E) that reads like a closure with nothing drawable. */
  needsCheck: boolean;
  section: BriefingSection;
  /** Gap between the NOTAM's area and the route or ownship (NM); 0 = inside; null = no reference or no area. */
  distanceNM: number | null;
  /** Route kinds closed by this NOTAM when none of them is the pilot's network. Empty otherwise. */
  otherRouteKinds: string[];
}

/** Row identity (Swift Identifiable). */
export const briefingRowId = (row: BriefingRow): string => row.notam.rowId;

// MARK: - Filter

/** Swift trimmingCharacters(in: .whitespaces): spaces (Unicode Zs) and tab, not newlines. */
const trimWhitespaces = (text: string): string => text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '');

export function briefingRows(notams: readonly IsraelNotam[], query: BriefingQuery): BriefingRow[] {
  const aerodrome = trimWhitespaces(query.aerodrome).toUpperCase();
  const result: BriefingRow[] = [];
  for (const notam of notams) {
    if (notamIsSuperseded(notam) || notam.type?.toUpperCase() === 'NOTAMC') continue;
    if (!windowIncludes(query.window, notam)) continue;
    if (aerodrome !== '' && !matchesAerodrome(notam, aerodrome)) continue;

    let distance: number | null = null;
    const gap = briefingDistanceNM(notam, query.reference);
    if (gap !== null) {
      if (gap > query.corridorNM) continue;
      distance = gap;
    }

    const closure = closureClass(notam, query.network);
    const check = needsCheck(notam, query.network);
    const onRoute = isOnRoute(notam, query.routeAerodromes);
    const section: BriefingSection = closure !== 'none' || check ? 'closures' : onRoute ? 'routeAerodromes' : 'other';
    result.push({
      notam,
      closure,
      needsCheck: check,
      section,
      distanceNM: distance,
      otherRouteKinds: otherRouteKinds(notam, query.network),
    });
  }
  return result.sort(briefingOrder);
}

/** Comparator: section, then closure rank, then earliest start, then id. */
export function briefingOrder(a: BriefingRow, b: BriefingRow): number {
  if (a.section !== b.section) return SECTION_RANK[a.section] - SECTION_RANK[b.section];
  const rankA = CLOSURE_RANK[a.closure === 'none' && a.needsCheck ? 'check' : a.closure];
  const rankB = CLOSURE_RANK[b.closure === 'none' && b.needsCheck ? 'check' : b.closure];
  if (rankA !== rankB) return rankA - rankB;
  const fromA = a.notam.validFrom ?? -Infinity;
  const fromB = b.notam.validFrom ?? -Infinity;
  if (fromA !== fromB) return fromA < fromB ? -1 : 1;
  if (a.notam.id === b.notam.id) return 0;
  return a.notam.id < b.notam.id ? -1 : 1;
}

// MARK: Classification

/** Whether a closure names one of the route kinds of the pilot's network. */
export const closureAppliesTo = (closure: IsraelRouteClosure, network: IsraelRouteNetwork): boolean =>
  NETWORK_CLOSURE_KINDS[network].some((kind) => closureCovers(closure, kind));

/**
 * The closure's severity for the pilot's own network only: a HEL, ultralight or ATS route closure does not close a
 * CVFR pilot's route.
 */
export function closureClass(notam: IsraelNotam, network: IsraelRouteNetwork = 'cvfr'): BriefingClosureClass {
  const severities = notam.closures.filter((c) => closureAppliesTo(c, network)).map(closureSeverity);
  if (severities.includes('full')) return 'full';
  if (severities.includes('partial')) return 'partial';
  if (severities.includes('check')) return 'check';
  return 'none';
}

/** Route kinds this NOTAM closes that are not the pilot's network, in order. Empty when it also closes the pilot's. */
export function otherRouteKinds(notam: IsraelNotam, network: IsraelRouteNetwork = 'cvfr'): string[] {
  if (notam.closures.some((c) => closureAppliesTo(c, network))) return [];
  const kinds: string[] = [];
  for (const closure of notam.closures) {
    for (const kind of closureKinds(closure)) if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** True when a closure is present that the app cannot fully read or draw. */
export function needsCheck(notam: IsraelNotam, network: IsraelRouteNetwork = 'cvfr'): boolean {
  if (notam.closures.some((c) => closureSeverity(c) === 'check' && closureAppliesTo(c, network))) return true;
  return notam.closures.length === 0 && looksLikeRouteClosure(notam.e ?? notam.raw);
}

/** "ATS RTE J14 CLSD" with no chain behind it. */
export function looksLikeRouteClosure(text: string): boolean {
  const upper = text.toUpperCase();
  return upper.includes('CLSD') && (upper.includes('RTE') || upper.includes('ROUTE'));
}

/** `aerodrome` is expected upper-case and trimmed (as briefingRows passes it). */
export function matchesAerodrome(notam: IsraelNotam, aerodrome: string): boolean {
  if (notam.location.toUpperCase() === aerodrome || notam.a?.toUpperCase() === aerodrome) return true;
  return (notam.e ?? '').toUpperCase().includes(aerodrome);
}

export function isOnRoute(notam: IsraelNotam, aerodromes: ReadonlySet<string>): boolean {
  if (aerodromes.size === 0) return false;
  if (aerodromes.has(notam.location.toUpperCase())) return true;
  const a = notam.a?.toUpperCase();
  return a !== undefined && aerodromes.has(a);
}

// MARK: Geometry

/** The NOTAM's area from E) geometry, falling back to the Q-line circle. */
type Area = { kind: 'circle'; centre: IsraelLatLon; radiusNM: number } | { kind: 'polygon'; ring: IsraelLatLon[] };

function areaOf(notam: IsraelNotam): Area | null {
  const { polygon, circle } = notam.geometry;
  if (polygon && polygon.length >= 3) return { kind: 'polygon', ring: polygon };
  if (circle) return { kind: 'circle', centre: circle.centre, radiusNM: circle.radiusNM };
  const centre = notam.q?.centre ?? null;
  const radius = notam.q?.radiusNM ?? null;
  if (centre !== null && radius !== null) return { kind: 'circle', centre, radiusNM: radius };
  return null;
}

/**
 * Gap between the NOTAM's area and the reference, NM (0 when they touch or overlap). null when there is no reference
 * or the NOTAM has no area, so such NOTAMs are kept, not dropped.
 */
export function briefingDistanceNM(notam: IsraelNotam, reference: BriefingReference): number | null {
  const area = areaOf(notam);
  if (area === null) return null;
  let referencePoints: IsraelLatLon[];
  switch (reference.kind) {
    case 'none':
      return null;
    case 'ownship':
      referencePoints = [reference.point];
      break;
    case 'route':
      referencePoints = reference.route.points;
      break;
  }
  const origin = referencePoints[0];
  if (origin === undefined) return null;
  const line = referencePoints.map((p) => project(p, origin));

  if (area.kind === 'circle') {
    return Math.max(0, distanceToPolyline(project(area.centre, origin), line) - area.radiusNM);
  }
  return distancePolygonToPolyline(
    area.ring.map((p) => project(p, origin)),
    line,
  );
}

/** Planar NM coordinates around `origin` (equirectangular; accurate to well under 1% across Israel). */
interface Pt {
  x: number;
  y: number;
}

function project(p: IsraelLatLon, origin: IsraelLatLon): Pt {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return { x: (p.lon - origin.lon) * cosLat * 60, y: (p.lat - origin.lat) * 60 };
}

const distance = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceToPolyline(p: Pt, line: readonly Pt[]): number {
  if (line.length <= 1) return line.length === 1 ? distance(p, line[0]) : Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]));
  return best;
}

function polygonContains(polygon: readonly Pt[], p: Pt): boolean {
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    j = i;
  }
  return inside;
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper crossing only: touching or collinear segments do not count (Swift parity). */
function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function distancePolygonToPolyline(polygon: readonly Pt[], line: readonly Pt[]): number {
  if (line.some((p) => polygonContains(polygon, p))) return 0;
  const edges = polygon.map((a, i): [Pt, Pt] => [a, polygon[(i + 1) % polygon.length]]);
  for (let i = 0; i + 1 < line.length; i += 1) {
    if (edges.some(([c, d]) => segmentsIntersect(line[i], line[i + 1], c, d))) return 0;
  }
  let best = Infinity;
  for (const vertex of polygon) best = Math.min(best, distanceToPolyline(vertex, line));
  for (const p of line) for (const [a, b] of edges) best = Math.min(best, distanceToSegment(p, a, b));
  return best;
}
