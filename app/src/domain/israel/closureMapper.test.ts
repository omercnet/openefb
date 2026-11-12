// Port of efb-212Tests/ServiceTests/IsraelNotamClosureMapperTests.swift: closure chains -> route segments against a
// mock network. The three real-database cases from IsraelAviationDatabaseTests live in
// tests/domain/israel/closureMapperDb.test.ts.
import {
  closedSegments,
  isFullyMapped,
  mapClosures,
  mappingUnknownCodes,
  matchClosure,
  unresolvedMatches,
  type IsraelRouteSegmentLookup,
} from './closureMapper';
import type { IsraelRouteClosure } from './notamTypes';

/** A small network: GALIM -> DAROM -> HOTRM, stored in one direction only, plus ATLIT. */
function mockNetwork(points: string[], segments: Record<string, string>): IsraelRouteSegmentLookup<string> {
  return {
    knowsPoint: (code) => points.includes(code),
    segment: (from, to) => segments[`${from}>${to}`] ?? null,
  };
}

const network = mockNetwork(['GALIM', 'DAROM', 'HOTRM', 'ATLIT', 'FRDIS'], {
  'GALIM>DAROM': 'S1',
  'DAROM>HOTRM': 'S2',
  'HOTRM>FRDIS': 'S3',
});

function closure(
  chain: string[],
  id = 'C2267/26',
  from: number | null = null,
  to: number | null = null,
): IsraelRouteClosure {
  return {
    notamId: id,
    routeKind: 'CVFR',
    routeName: null,
    chain,
    validFrom: from === null ? null : from * 1000,
    validTo: to === null ? null : to * 1000,
    schedule: null,
  };
}

describe('Israel NOTAM Closure Mapper Tests', () => {
  test('mapsEveryLegOfAChainInOrder', async () => {
    const match = await matchClosure(closure(['GALIM', 'DAROM', 'HOTRM', 'FRDIS']), network);
    expect(match.segments).toEqual(['S1', 'S2', 'S3']);
    expect(isFullyMapped(match)).toBe(true);
    expect(match.unknownCodes).toEqual([]);
    expect(match.unmatchedLegs).toEqual([]);
  });

  test('aClosureShutsTheRouteBothWaysSoAReversedStoredSegmentStillMatches', async () => {
    // Chain written HOTRM-DAROM; the network stores DAROM>HOTRM.
    const match = await matchClosure(closure(['HOTRM', 'DAROM']), network);
    expect(match.segments).toEqual(['S2']);
    expect(isFullyMapped(match)).toBe(true);
  });

  test('unknownCodesAreReportedNotDropped', async () => {
    const match = await matchClosure(closure(['GALIM', 'DAROM', 'ZZZZZ', 'YYYYY', 'ZZZZZ']), network);
    expect(match.unknownCodes).toEqual(['ZZZZZ', 'YYYYY']); // once each, chain order
    expect(match.segments).toEqual(['S1']); // the leg that could be placed is still mapped
    expect(isFullyMapped(match)).toBe(false);
    expect(match.closure.chain).toHaveLength(5); // the closure itself is kept whole
  });

  test('knownPointsWithoutASegmentBetweenThemAreUnmatchedLegs', async () => {
    // ATLIT and DAROM exist but no published segment joins them.
    const match = await matchClosure(closure(['DAROM', 'ATLIT']), network);
    expect(match.segments).toEqual([]);
    expect(match.unmatchedLegs).toEqual([{ from: 'DAROM', to: 'ATLIT' }]);
    expect(match.unknownCodes).toEqual([]);
    expect(isFullyMapped(match)).toBe(false);
  });

  test('aLegWithAnUnknownEndIsReportedOnceAsUnknownNotAlsoAsUnmatched', async () => {
    const match = await matchClosure(closure(['GALIM', 'ZZZZZ']), network);
    expect(match.unknownCodes).toEqual(['ZZZZZ']);
    expect(match.unmatchedLegs).toEqual([]);
  });

  test('aSinglePointChainHasNoLegs', async () => {
    const match = await matchClosure(closure(['GALIM']), network);
    expect(match.segments).toEqual([]);
    expect(isFullyMapped(match)).toBe(true);
  });

  test('mappingAggregatesSegmentsAndUnresolvedClosuresAcrossNotams', async () => {
    const closures = [
      closure(['GALIM', 'DAROM'], 'C1111/26'),
      closure(['GALIM', 'DAROM', 'HOTRM'], 'C2222/26'), // S1 closed twice
      closure(['DAROM', 'QQQQQ'], 'C3333/26'),
    ];
    const mapping = await mapClosures(closures, network);
    expect(mapping.matches).toHaveLength(3);
    expect(new Set(closedSegments(mapping))).toEqual(new Set(['S1', 'S2']));
    expect(closedSegments(mapping)).toHaveLength(2);
    expect(new Set(mappingUnknownCodes(mapping))).toEqual(new Set(['QQQQQ']));
    expect(unresolvedMatches(mapping).map((m) => m.closure.notamId)).toEqual(['C3333/26']);
  });

  test('dateFilterKeepsOnlyClosuresValidAtThatTime', async () => {
    const closures = [
      closure(['GALIM', 'DAROM'], 'C0001/26', 100, 200), // over
      closure(['DAROM', 'HOTRM'], 'C0002/26', 100, 400), // active
      closure(['HOTRM', 'FRDIS'], 'C0003/26', 500, 600), // not yet
      closure(['GALIM', 'DAROM'], 'C0004/26', 100, null), // permanent
    ];
    const at = 300 * 1000;
    const mapping = await mapClosures(closures, network, at);
    expect(mapping.matches.map((m) => m.closure.notamId)).toEqual(['C0002/26', 'C0004/26']);
    expect(new Set(closedSegments(mapping))).toEqual(new Set(['S1', 'S2']));

    const all = await mapClosures(closures, network);
    expect(all.matches).toHaveLength(4);
  });

  test('mappingNothingGivesAnEmptyResult', async () => {
    const mapping = await mapClosures([], network);
    expect(mapping.matches).toEqual([]);
    expect(closedSegments(mapping)).toEqual([]);
    expect(unresolvedMatches(mapping)).toEqual([]);
  });
});

describe('JS-only guards', () => {
  test('object segments are deduplicated by id, not by reference (Swift IsraelRouteSegment hashes its id)', async () => {
    const lookup: IsraelRouteSegmentLookup<{ id: number }> = {
      knowsPoint: async () => true,
      segment: async (from, to) => ((from === 'A' && to === 'B') || (from === 'B' && to === 'A') ? { id: 7 } : null),
    };
    const match = await matchClosure(closure(['A', 'B', 'A']), lookup);
    expect(match.segments).toEqual([{ id: 7 }]);
    const mapping = await mapClosures([closure(['A', 'B']), closure(['B', 'A'])], lookup);
    expect(closedSegments(mapping)).toEqual([{ id: 7 }]);
  });
});
