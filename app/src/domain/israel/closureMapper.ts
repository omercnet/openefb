// Port of Services/IsraelNotamClosureMapper.swift: maps NOTAM route-closure chains ("CVFR RTE CLSD GALIM-DAROM-HOTRM")
// onto route segments of the published Israeli network. Depends only on the lookup interface below; the D5
// IsraelAviationDatabase (knowsPoint/segment, async) conforms as is. No drawing and no alerts.
import { closureIsValidAt, closureLegs, type IsraelRouteClosure } from './notamTypes';

/** Segment lookup by point codes (Swift IsraelRouteSegmentLookup). Sync or async answers are both accepted. */
export interface IsraelRouteSegmentLookup<S> {
  /** Whether `code` is a published point or airfield in the network. */
  knowsPoint(code: string): boolean | Promise<boolean>;
  /** The segment joining two points in that direction, or null when none is published. */
  segment(from: string, to: string): S | null | Promise<S | null>;
}

export interface IsraelClosureLeg {
  from: string;
  to: string;
}

/** One closure mapped onto the network. */
export interface IsraelClosureMatch<S> {
  closure: IsraelRouteClosure;
  /** Segments found for the chain's legs, in chain order, without duplicates. */
  segments: S[];
  /** Point codes the network doesn't know. Reported, never dropped: the pilot must see a closure we could not place. */
  unknownCodes: string[];
  /** Legs whose points are both known but have no published segment between them. */
  unmatchedLegs: IsraelClosureLeg[];
}

export interface IsraelClosureMapping<S> {
  matches: IsraelClosureMatch<S>[];
}

/**
 * Identity of a segment for de-duplication (Swift Hashable). Segments with an `id` (IsraelRouteSegment hashes its id
 * only) compare by it; anything else by value.
 */
export type SegmentKey<S> = (segment: S) => unknown;

export const defaultSegmentKey = <S>(segment: S): unknown =>
  typeof segment === 'object' && segment !== null && 'id' in segment ? segment.id : segment;

/** Every leg of the chain landed on a segment. */
export const isFullyMapped = <S>(match: IsraelClosureMatch<S>): boolean =>
  match.unknownCodes.length === 0 && match.unmatchedLegs.length === 0;

/** Every segment closed by any of the mapped closures, once each, in first-seen order (Swift: a Set). */
export function closedSegments<S>(mapping: IsraelClosureMapping<S>, key: SegmentKey<S> = defaultSegmentKey): S[] {
  const seen = new Set<unknown>();
  const result: S[] = [];
  for (const segment of mapping.matches.flatMap((m) => m.segments)) {
    const k = key(segment);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(segment);
  }
  return result;
}

/** Every code that could not be placed, once each, in first-seen order (Swift: a Set). */
export const mappingUnknownCodes = <S>(mapping: IsraelClosureMapping<S>): string[] => [
  ...new Set(mapping.matches.flatMap((m) => m.unknownCodes)),
];

/** Closures that could not be fully placed: surface these to the pilot, don't hide them. */
export const unresolvedMatches = <S>(mapping: IsraelClosureMapping<S>): IsraelClosureMatch<S>[] =>
  mapping.matches.filter((m) => !isFullyMapped(m));

/**
 * @param closures from the feed.
 * @param at epoch ms: keep only closures whose validity window contains it; null keeps all of them. A D) schedule is
 *   not evaluated: such a closure is kept.
 */
export async function mapClosures<S>(
  closures: readonly IsraelRouteClosure[],
  lookup: IsraelRouteSegmentLookup<S>,
  at: number | null = null,
  key: SegmentKey<S> = defaultSegmentKey,
): Promise<IsraelClosureMapping<S>> {
  const selected = at === null ? closures : closures.filter((c) => closureIsValidAt(c, at));
  const matches: IsraelClosureMatch<S>[] = [];
  // Sequential, like Swift: the database lookup is a single connection anyway.
  for (const closure of selected) matches.push(await matchClosure(closure, lookup, key));
  return { matches };
}

export async function matchClosure<S>(
  closure: IsraelRouteClosure,
  lookup: IsraelRouteSegmentLookup<S>,
  key: SegmentKey<S> = defaultSegmentKey,
): Promise<IsraelClosureMatch<S>> {
  // Swift asks knowsPoint again for every leg end; the answers are cached here (same results, fewer queries).
  const known = new Map<string, boolean>();
  const knows = async (code: string): Promise<boolean> => {
    const cached = known.get(code);
    if (cached !== undefined) return cached;
    const answer = await lookup.knowsPoint(code);
    known.set(code, answer);
    return answer;
  };

  const unknownCodes: string[] = [];
  for (const code of closure.chain) {
    if (!(await knows(code)) && !unknownCodes.includes(code)) unknownCodes.push(code);
  }

  const segments: S[] = [];
  const segmentKeys = new Set<unknown>();
  const unmatchedLegs: IsraelClosureLeg[] = [];
  for (const leg of closureLegs(closure)) {
    if (!(await knows(leg.from)) || !(await knows(leg.to))) continue;
    // A closure shuts the route both ways; the network may store one direction only.
    const segment = (await lookup.segment(leg.from, leg.to)) ?? (await lookup.segment(leg.to, leg.from));
    if (segment === null) {
      unmatchedLegs.push({ from: leg.from, to: leg.to });
      continue;
    }
    const k = key(segment);
    if (!segmentKeys.has(k)) {
      segmentKeys.add(k);
      segments.push(segment);
    }
  }
  return { closure, segments, unknownCodes, unmatchedLegs };
}
