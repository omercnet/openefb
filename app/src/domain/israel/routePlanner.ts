// Port of Services/IsraelRoutePlanner.swift: shortest-path routing over the published Israeli CVFR / LSA network.
// Pure: it takes the points, segments and the NOTAM closure marks as input and never touches the database or the
// network. Rules (domestic AIP A-07 / A-11):
//  - A segment is flown only in a direction CAAI publishes an altitude for.
//  - By-request and military segments are excluded unless the pilot overrides, and a route using one is never fileable.
//  - A segment fully closed by a NOTAM for the departure window is excluded; a partial closure stays with a caution.
// Times are epoch ms; durations named `...Seconds` are seconds, as in Swift.
import type { Coordinate } from '../core/geometry';
import {
  segmentAltitude,
  type IsraelReportingPoint,
  type IsraelRouteAltitude,
  type IsraelRouteNetwork,
  type IsraelRouteSegment,
} from '../../data/aviation/israelTypes';
import type { IsraelClosureLeg } from './closureMapper';
import { weekendState, type IsraelDayOverride } from './lsaTimeRules';

const EARTH_RADIUS_NM = 3440.065;

export interface IsraelRouteOptions {
  /** Allow dashed segments that need real-time ATC approval. The route is then not fileable. */
  allowByRequest: boolean;
  /** Allow blue military segments (civil use only with IAF approval). Not fileable either. */
  allowMilitary: boolean;
  /** Planned off-block time (epoch ms). With it, sport-aviation weekend rules apply. null skips the time rules. */
  departure: number | null;
  /** The pilot's holiday declaration for the departure day. */
  dayOverride: IsraelDayOverride;
  /** The NOTAM check covers departure to departure + this (seconds). */
  closureWindow: number;
}

export function makeRouteOptions(overrides: Partial<IsraelRouteOptions> = {}): IsraelRouteOptions {
  return {
    allowByRequest: false,
    allowMilitary: false,
    departure: null,
    dayOverride: 'none',
    closureWindow: 3 * 3600,
    ...overrides,
  };
}

/** Why a leg needs the pilot's attention. */
export type IsraelRouteCaution =
  | { kind: 'byRequest' }
  | { kind: 'military' }
  | { kind: 'partialClosure'; notamID: string; text: string }
  | { kind: 'checkNotam'; notamID: string }
  | { kind: 'weekendStartUnconfirmed' }
  | { kind: 'notInUse' }
  | { kind: 'specialConditions'; text: string | null }
  | { kind: 'smallAircraftOnly' };

/** `blocksFiling` legs make the whole plan unfileable. */
export function cautionBlocksFiling(c: IsraelRouteCaution): boolean {
  switch (c.kind) {
    case 'byRequest':
    case 'military':
    case 'checkNotam':
    case 'weekendStartUnconfirmed':
    case 'notInUse':
      return true;
    case 'partialClosure':
    case 'specialConditions':
    case 'smallAircraftOnly':
      return false;
  }
}

/** Short badge text for the legs table. */
export function cautionBadge(c: IsraelRouteCaution): string {
  switch (c.kind) {
    case 'byRequest':
      return 'BY REQUEST';
    case 'military':
      return 'MILITARY';
    case 'partialClosure':
      return 'PARTIAL CLSD';
    case 'checkNotam':
      return 'CHECK NOTAM';
    case 'weekendStartUnconfirmed':
      return 'WEEKEND START?';
    case 'notInUse':
      return 'NOT IN USE';
    case 'specialConditions':
      return 'SPECIAL';
    case 'smallAircraftOnly':
      return 'SMALL A/C';
  }
}

export interface IsraelRouteLeg {
  segment: IsraelRouteSegment;
  from: IsraelReportingPoint;
  to: IsraelReportingPoint;
  /** true when flown in the published from -> to direction. */
  forward: boolean;
  /** Published altitude for the direction flown. */
  altitude: IsraelRouteAltitude | null;
  distanceNM: number;
  /** Seconds at the planning cruise speed. */
  eteSeconds: number;
  cautions: readonly IsraelRouteCaution[];
}

/** The segment id: unique per leg, a shortest path never repeats a segment. */
export const legId = (leg: IsraelRouteLeg): number => leg.segment.id;
/** The polyline in the direction flown. */
export const legPolyline = (leg: IsraelRouteLeg): Coordinate[] =>
  leg.forward ? leg.segment.polyline : [...leg.segment.polyline].reverse();
/** Bearing in the direction flown, degrees true. */
export const legBearingTrue = (leg: IsraelRouteLeg): number =>
  leg.forward ? leg.segment.bearingTrue : (leg.segment.bearingTrue + 180) % 360;
/** "2500" or "2500/3500"; "---" when unpublished (cannot happen for a routed leg). */
export const legAltitudeText = (leg: IsraelRouteLeg): string => leg.altitude?.published ?? '---';

export interface IsraelRoutePlan {
  legs: readonly IsraelRouteLeg[];
  /** Knots, used for every leg's ETE. */
  cruiseSpeedKnots: number;
}

/** Every point along the route in order, departure first. */
export function planPoints(plan: IsraelRoutePlan): IsraelReportingPoint[] {
  const first = plan.legs[0];
  return first ? [first.from, ...plan.legs.map((l) => l.to)] : [];
}
export const planPointCodes = (plan: IsraelRoutePlan): string[] => planPoints(plan).map((p) => p.code);
export const planTotalDistanceNM = (plan: IsraelRoutePlan): number => plan.legs.reduce((s, l) => s + l.distanceNM, 0);
export const planTotalETESeconds = (plan: IsraelRoutePlan): number => plan.legs.reduce((s, l) => s + l.eteSeconds, 0);
/** No leg carries a caution that blocks filing. */
export const planIsFileable = (plan: IsraelRoutePlan): boolean =>
  !plan.legs.some((l) => l.cautions.some(cautionBlocksFiling));
/** The whole polyline, departure to destination. */
export const planPolyline = (plan: IsraelRoutePlan): Coordinate[] => plan.legs.flatMap(legPolyline);
/** The network the plan is flown on (CVFR when the plan has no legs). */
export const planNetwork = (plan: IsraelRoutePlan): IsraelRouteNetwork => plan.legs[0]?.segment.network ?? 'cvfr';

export type IsraelNoRouteReason = 'closed' | 'oneWay' | 'restricted' | 'notInUse' | 'disconnected';

export type IsraelRouteErrorInfo =
  { kind: 'unknownPoint'; code: string } | { kind: 'noRoute'; from: string; to: string; reason: IsraelNoRouteReason };

/** Thrown by `route`/`returnRoute`. `message` is the English errorDescription, `info` the Swift enum case. */
export class IsraelRouteError extends Error {
  constructor(readonly info: IsraelRouteErrorInfo) {
    super(israelRouteErrorDescription(info));
    this.name = 'IsraelRouteError';
  }

  /** The fpl.co.il wording pilots know. */
  get hebrewDescription(): string {
    return this.info.kind === 'unknownPoint'
      ? `${this.info.code} אינה נקודה ברשת הנתיבים`
      : `לא נמצא נתיב פתוח בין ${this.info.from} ל-${this.info.to}`;
  }
}

export function israelRouteErrorDescription(info: IsraelRouteErrorInfo): string {
  if (info.kind === 'unknownPoint') return `${info.code} is not on the route network.`;
  const base = `No open route between ${info.from} and ${info.to}`;
  switch (info.reason) {
    case 'closed':
      return `${base}: the only routes are closed by NOTAM.`;
    case 'oneWay':
      return `${base}: the only routes are one-way against this direction.`;
    case 'restricted':
      return `${base}: the only routes need ATC or IAF approval.`;
    case 'notInUse':
      return `${base}: the only routes are weekend-only and the departure is not in a weekend.`;
    case 'disconnected':
      return `${base}.`;
  }
}

/** What the NOTAM feed says about a segment for the planned window. */
export type IsraelSegmentClosure =
  | { kind: 'full'; notamID: string }
  | { kind: 'partial'; notamID: string; text: string }
  | { kind: 'check'; notamID: string };

/** full > check > partial, like the chart. */
export function closureRank(c: IsraelSegmentClosure): number {
  return c.kind === 'full' ? 2 : c.kind === 'check' ? 1 : 0;
}

/**
 * A closure the planner could not place on the network in full: a point code it does not know, or a leg with no
 * published segment. It may still close the planned route, so filing is blocked until the pilot reads the NOTAM.
 */
export interface IsraelUnresolvedClosure {
  notamID: string;
  /** Point codes the network does not know, in chain order. */
  unknownCodes: string[];
  /** Legs between known points with no published segment. */
  unmatchedLegs: IsraelClosureLeg[];
}

/** The NOTAM closure marks for a planned window: what landed on segments, and what did not. */
export interface IsraelClosureMarks {
  /** Segment id -> closure state. */
  segments: Map<number, IsraelSegmentClosure>;
  /** Closures (one per NOTAM) that could not be placed in full. Each blocks filing. */
  unresolved: IsraelUnresolvedClosure[];
}

export const emptyClosureMarks = (): IsraelClosureMarks => ({ segments: new Map(), unresolved: [] });

interface Edge {
  segment: IsraelRouteSegment;
  forward: boolean;
  toCode: string;
  lengthNM: number;
}

type Graph = Map<string, Edge[]>;

/** Polyline length, NM. */
export function polylineLengthNm(polyline: readonly Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) total += haversineNm(polyline[i - 1], polyline[i]);
  return total;
}

/** Great-circle distance, NM (haversine with asin, as Swift's planner has it). */
export function haversineNm(a: Coordinate, b: Coordinate): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function syntheticPoint(id: number, code: string, at: Coordinate): IsraelReportingPoint {
  return {
    id,
    code,
    nameEnglish: null,
    nameHebrew: null,
    kind: 'onRequest',
    latitude: at.lat,
    longitude: at.lon,
    network: 'cvfr',
  };
}

export class IsraelRoutePlanner {
  private readonly pointsByCode = new Map<string, IsraelReportingPoint>();

  /**
   * @param points the published reporting points and ARPs (duplicated codes resolve to the copy segments use).
   * @param segments the network.
   * @param closures segment id -> closure state for the planned window.
   */
  constructor(
    points: readonly IsraelReportingPoint[],
    private readonly segments: readonly IsraelRouteSegment[],
    private readonly closures: ReadonlyMap<number, IsraelSegmentClosure> = new Map(),
  ) {
    for (const p of points) this.pointsByCode.set(p.code.toUpperCase(), p);
    // "LLNV" names two ARPs; the one the segments reference wins.
    const referenced = new Set(segments.flatMap((s) => [s.fromPointID, s.toPointID]));
    for (const p of points) if (referenced.has(p.id)) this.pointsByCode.set(p.code.toUpperCase(), p);
  }

  knowsPoint(code: string): boolean {
    return this.pointsByCode.has(code.toUpperCase());
  }

  point(code: string): IsraelReportingPoint | null {
    return this.pointsByCode.get(code.toUpperCase()) ?? null;
  }

  /**
   * Shortest open route from `from` through each `via` to `to`; throws IsraelRouteError.
   * `cruiseSpeedKnots` is the aircraft profile's cruise speed for the ETE.
   */
  route(
    from: string,
    to: string,
    cruiseSpeedKnots: number,
    options: IsraelRouteOptions = makeRouteOptions(),
    via: readonly string[] = [],
  ): IsraelRoutePlan {
    const stops = [from, ...via, to].map((c) => c.toUpperCase());
    for (const code of stops) if (!this.knowsPoint(code)) throw new IsraelRouteError({ kind: 'unknownPoint', code });
    const graph = this.adjacency(options, false, false, false);
    const legs: IsraelRouteLeg[] = [];
    let elapsed = 0; // seconds since departure, for the time rules
    for (let i = 0; i + 1 < stops.length; i++) {
      const start = stops[i];
      const end = stops[i + 1];
      if (start === end) continue;
      const path = this.shortestPath(graph, start, end);
      if (!path) {
        throw new IsraelRouteError({
          kind: 'noRoute',
          from: start,
          to: end,
          reason: this.diagnose(start, end, options),
        });
      }
      for (const edge of path) {
        const legStart = options.departure === null ? null : options.departure + elapsed * 1000;
        const leg = this.makeLeg(edge, cruiseSpeedKnots, legStart, options.dayOverride);
        legs.push(leg);
        elapsed += leg.eteSeconds;
      }
    }
    return { legs, cruiseSpeedKnots };
  }

  /** The same stops in reverse order, re-routed: one-way segments make the return differ. */
  returnRoute(plan: IsraelRoutePlan, options: IsraelRouteOptions = makeRouteOptions()): IsraelRoutePlan {
    const codes = planPointCodes(plan);
    if (codes.length < 2) return plan;
    return this.route(codes[codes.length - 1], codes[0], plan.cruiseSpeedKnots, options);
  }

  private adjacency(
    options: IsraelRouteOptions,
    ignoreClosures: boolean,
    ignoreDirection: boolean,
    ignoreTimeRules: boolean,
  ): Graph {
    const graph: Graph = new Map();
    const push = (code: string, edge: Edge): void => {
      const list = graph.get(code);
      if (list) list.push(edge);
      else graph.set(code, [edge]);
    };
    // A weekend-only sport-aviation route is out when the departure is not in a weekend by any published rule.
    // Later legs are marked per leg instead, because the flight may cross into or out of a weekend.
    const weekdayDeparture =
      options.departure !== null && weekendState(options.departure, options.dayOverride) === 'notInUse';
    for (const segment of this.segments) {
      if (segment.isByRequest && !options.allowByRequest) continue;
      if (segment.isMilitary && !options.allowMilitary) continue;
      if (!ignoreTimeRules && weekdayDeparture && segment.network === 'lsa' && segment.activity === 'weekend') continue;
      if (!ignoreClosures && this.closures.get(segment.id)?.kind === 'full') continue;
      const lengthNM = segment.lengthNM ?? polylineLengthNm(segment.polyline);
      const from = segment.fromCode.toUpperCase();
      const to = segment.toCode.toUpperCase();
      if (ignoreDirection || segment.altitudeForward !== null)
        push(from, { segment, forward: true, toCode: to, lengthNM });
      if (ignoreDirection || segment.altitudeReverse !== null)
        push(to, { segment, forward: false, toCode: from, lengthNM });
    }
    return graph;
  }

  /** Dijkstra on distance. Returns the edges in order, or null when `to` is unreachable. */
  private shortestPath(graph: Graph, from: string, to: string): Edge[] | null {
    const distance = new Map<string, number>([[from, 0]]);
    const previous = new Map<string, Edge>();
    const settled = new Set<string>();
    const frontier: { code: string; distance: number }[] = [{ code: from, distance: 0 }];
    while (frontier.length > 0) {
      // First minimum wins on ties, like Swift's indices.min(by:).
      let index = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i].distance < frontier[index].distance) index = i;
      const [current] = frontier.splice(index, 1);
      if (settled.has(current.code)) continue;
      settled.add(current.code);
      if (current.code === to) break;
      for (const edge of graph.get(current.code) ?? []) {
        if (settled.has(edge.toCode)) continue;
        const candidate = current.distance + edge.lengthNM;
        if (candidate < (distance.get(edge.toCode) ?? Infinity)) {
          distance.set(edge.toCode, candidate);
          previous.set(edge.toCode, edge);
          frontier.push({ code: edge.toCode, distance: candidate });
        }
      }
    }
    if (!settled.has(to)) return null;
    const path: Edge[] = [];
    let cursor = to;
    while (cursor !== from) {
      const edge = previous.get(cursor);
      if (!edge) break;
      path.push(edge);
      cursor = edge.forward ? edge.segment.fromCode.toUpperCase() : edge.segment.toCode.toUpperCase();
    }
    return path.reverse();
  }

  /** Relax the rules one at a time to tell the pilot which one cut the route. */
  private diagnose(from: string, to: string, options: IsraelRouteOptions): IsraelNoRouteReason {
    const reaches = (o: IsraelRouteOptions, ignoreClosures: boolean, ignoreDirection: boolean): boolean =>
      this.shortestPath(this.adjacency(o, ignoreClosures, ignoreDirection, true), from, to) !== null;
    if (reaches(options, false, false)) return 'notInUse';
    if (reaches(options, true, false)) return 'closed';
    if (reaches(options, true, true)) return 'oneWay';
    if (reaches({ ...options, allowByRequest: true, allowMilitary: true }, true, true)) return 'restricted';
    return 'disconnected';
  }

  /** `legStart` is when this leg is flown (departure + the legs before it), epoch ms; null skips the time rules. */
  private makeLeg(
    edge: Edge,
    cruiseSpeedKnots: number,
    legStart: number | null,
    dayOverride: IsraelDayOverride,
  ): IsraelRouteLeg {
    const { segment } = edge;
    const fromCode = edge.forward ? segment.fromCode : segment.toCode;
    const poly = segment.polyline;
    const first = poly[0] ?? { lat: 0, lon: 0 };
    const last = poly[poly.length - 1] ?? { lat: 0, lon: 0 };
    // A segment may reference a point the caller did not supply: synthesise from the polyline end.
    const from = this.point(fromCode) ?? syntheticPoint(segment.fromPointID, fromCode, edge.forward ? first : last);
    const to = this.point(edge.toCode) ?? syntheticPoint(segment.toPointID, edge.toCode, edge.forward ? last : first);
    const cautions: IsraelRouteCaution[] = [];
    if (segment.isByRequest) cautions.push({ kind: 'byRequest' });
    if (segment.isMilitary) cautions.push({ kind: 'military' });
    const closure = this.closures.get(segment.id);
    if (closure?.kind === 'partial')
      cautions.push({ kind: 'partialClosure', notamID: closure.notamID, text: closure.text });
    else if (closure?.kind === 'check') cautions.push({ kind: 'checkNotam', notamID: closure.notamID });
    if (segment.network === 'lsa') {
      switch (segment.activity) {
        case 'all_week':
          break;
        case 'weekend':
          if (legStart !== null) {
            const state = weekendState(legStart, dayOverride);
            if (state === 'startUnconfirmed') cautions.push({ kind: 'weekendStartUnconfirmed' });
            else if (state === 'notInUse') cautions.push({ kind: 'notInUse' });
          }
          break;
        case 'special':
        case 'unspecified':
          cautions.push({ kind: 'specialConditions', text: segment.activitySource });
          break;
      }
      if (segment.smallOnly) cautions.push({ kind: 'smallAircraftOnly' });
    }
    const speed = Math.max(cruiseSpeedKnots, 1);
    return {
      segment,
      from,
      to,
      forward: edge.forward,
      altitude: segmentAltitude(segment, edge.forward),
      distanceNM: edge.lengthNM,
      eteSeconds: (edge.lengthNM / speed) * 3600,
      cautions,
    };
  }
}
