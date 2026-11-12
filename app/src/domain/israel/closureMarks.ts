// Port of IsraelRoutePlanner.closures(from:...) and its helpers (Services/IsraelRoutePlanner.swift): the NOTAM closure
// marks for a planned departure window, built on the closure mapper.
// Not in this module: Swift reads `IsraelNotamReport` (S1) for the feed and its freshness, and the chart builder
// (`IsraelChartFeatureBuilder`) for the drawable-freshness set and the closure label text. Here the caller passes the
// report's freshness level and the closures, and a `closureText` function for partial-closure labels.
import {
  NETWORK_CLOSURE_KINDS,
  type IsraelReportingPoint,
  type IsraelRouteNetwork,
  type IsraelRouteSegment,
} from '../../data/aviation/israelTypes';
import type { FreshnessLevel } from '../core/freshness';
import { isFullyMapped, mapClosures, type IsraelRouteSegmentLookup } from './closureMapper';
import { closureCovers, closureSeverity, type IsraelRouteClosure } from './notamTypes';
import { closureRank, emptyClosureMarks, type IsraelClosureMarks, type IsraelSegmentClosure } from './routePlanner';

/** Levels at which a NOTAM feed is trusted enough to mark the network (Swift IsraelChartFeatureBuilder.drawableFreshness). */
export const DRAWABLE_FRESHNESS: readonly FreshnessLevel[] = ['fresh', 'old'];

/** The slice of IsraelNotamReport the planner reads. */
export interface ClosureReport {
  freshnessLevel: FreshnessLevel;
  closures: readonly IsraelRouteClosure[];
}

/** In-memory network for the closure mapper: points by code, segments by (from, to) (Swift IsraelChartNetwork). */
export class IsraelNetworkLookup implements IsraelRouteSegmentLookup<IsraelRouteSegment> {
  private readonly pointCodes: ReadonlySet<string>;
  private readonly segmentsByCodes = new Map<string, IsraelRouteSegment>();

  constructor(points: readonly IsraelReportingPoint[], segments: readonly IsraelRouteSegment[]) {
    this.pointCodes = new Set(points.map((p) => p.code.toUpperCase()));
    for (const s of segments) this.segmentsByCodes.set(IsraelNetworkLookup.key(s.fromCode, s.toCode), s);
  }

  knowsPoint(code: string): boolean {
    return this.pointCodes.has(code.toUpperCase());
  }

  segment(from: string, to: string): IsraelRouteSegment | null {
    return this.segmentsByCodes.get(IsraelNetworkLookup.key(from, to)) ?? null;
  }

  private static key(from: string, to: string): string {
    return `${from.toUpperCase()}>${to.toUpperCase()}`;
  }
}

/** The validity window meets [startMs, endMs]. A missing bound is open-ended; the D) schedule is not evaluated. */
export function closureOverlaps(closure: IsraelRouteClosure, startMs: number, endMs: number): boolean {
  if (closure.validFrom !== null && closure.validFrom > endMs) return false;
  if (closure.validTo !== null && closure.validTo < startMs) return false;
  return true;
}

export interface ClosureMarksRequest {
  /** null: no feed. A feed that is not fresh or old yields no marks; the caller must tell the pilot closures were not checked. */
  report: ClosureReport | null;
  /** The network the closure chains are mapped on. */
  network: IsraelRouteSegmentLookup<IsraelRouteSegment>;
  /** The network the plan is flown on; only closures naming one of its route kinds count. */
  routeNetwork?: IsraelRouteNetwork;
  /** Planned departure, epoch ms. */
  departureMs: number;
  /** Seconds: closures overlapping [departure, departure + window] count. */
  windowSeconds: number;
  /** The chart label for a partial closure. */
  closureText: (closure: IsraelRouteClosure) => string;
}

/**
 * Segment closure states from the NOTAM feed for a departure window. Closures that cannot be placed on the network in
 * full are returned in `unresolved`, never dropped.
 */
export async function closureMarks(request: ClosureMarksRequest): Promise<IsraelClosureMarks> {
  const { report, network, routeNetwork = 'cvfr', departureMs, windowSeconds, closureText } = request;
  if (!report || !DRAWABLE_FRESHNESS.includes(report.freshnessLevel)) return emptyClosureMarks();
  const endMs = departureMs + windowSeconds * 1000;
  const active = report.closures.filter(
    (closure) =>
      NETWORK_CLOSURE_KINDS[routeNetwork].some((kind) => closureCovers(closure, kind)) &&
      closureOverlaps(closure, departureMs, endMs),
  );
  const mapping = await mapClosures(active, network);
  const result = emptyClosureMarks();
  for (const match of mapping.matches) {
    const { closure } = match;
    const severity = closureSeverity(closure);
    const state: IsraelSegmentClosure =
      severity === 'full'
        ? { kind: 'full', notamID: closure.notamId }
        : severity === 'check'
          ? { kind: 'check', notamID: closure.notamId }
          : { kind: 'partial', notamID: closure.notamId, text: closureText(closure) };
    for (const segment of match.segments) {
      const existing = result.segments.get(segment.id);
      if (existing && closureRank(existing) >= closureRank(state)) continue;
      result.segments.set(segment.id, state);
    }
    if (!isFullyMapped(match) && !result.unresolved.some((u) => u.notamID === closure.notamId)) {
      result.unresolved.push({
        notamID: closure.notamId,
        unknownCodes: match.unknownCodes,
        unmatchedLegs: match.unmatchedLegs,
      });
    }
  }
  return result;
}
