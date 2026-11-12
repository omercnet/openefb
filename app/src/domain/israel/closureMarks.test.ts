// Port of the "Closures from the NOTAM feed" and "Unresolved closures" cases of IsraelRoutePlannerTests.swift and the
// closure-kind cases of IsraelLSAPlannerTests.swift. The staleness case is split: Swift builds a report with an old
// `generatedAt`; here the report carries its freshness level (S1 computes it), so stale == a non-drawable level.
import type { IsraelReportingPoint, IsraelRouteNetwork, IsraelRouteSegment } from '../../data/aviation/israelTypes';
import { IsraelNetworkLookup, closureMarks, closureOverlaps, type ClosureReport } from './closureMarks';
import type { IsraelRouteClosure } from './notamTypes';
import { emptyClosureMarks } from './routePlanner';

const codes = ['A', 'B', 'C', 'D', 'E', 'F', 'Z'];

function points(network: IsraelRouteNetwork = 'cvfr'): IsraelReportingPoint[] {
  return codes.map((code, index) => ({
    id: index + 1,
    code,
    nameEnglish: code,
    nameHebrew: null,
    kind: 'compulsory',
    latitude: 32.0 + index * 0.01,
    longitude: 34.8,
    network,
  }));
}

function segment(id: number, from: string, to: string, nm: number): IsraelRouteSegment {
  const index = (c: string): number => Math.max(codes.indexOf(c), 0) + 1;
  return {
    id,
    fromCode: from,
    toCode: to,
    fromPointID: index(from),
    toPointID: index(to),
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: nm,
    isCivil: true,
    isMilitary: false,
    isByRequest: false,
    bearingTrue: 90,
    altitudeForward: { published: '1500', feet: 1500 },
    altitudeReverse: { published: '2000', feet: 2000 },
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: 32, lon: 34.8 },
      { lat: 32, lon: 34.9 },
    ],
    network: 'cvfr',
    activity: 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

const diamond = [
  segment(1, 'A', 'B', 10),
  segment(2, 'B', 'C', 10),
  segment(3, 'A', 'D', 15),
  segment(4, 'D', 'C', 15),
];
const network = () => new IsraelNetworkLookup(points(), diamond);
const now = 1_800_000_000_000;
const HOUR = 3600_000;

function closure(o: Partial<IsraelRouteClosure> = {}): IsraelRouteClosure {
  return {
    notamId: 'C9/26',
    routeKind: 'CVFR',
    routeName: null,
    chain: ['B', 'C'],
    validFrom: null,
    validTo: null,
    schedule: null,
    partial: null,
    ...o,
  };
}

const report = (
  closures: IsraelRouteClosure[],
  freshnessLevel: ClosureReport['freshnessLevel'] = 'fresh',
): ClosureReport => ({ freshnessLevel, closures });

const marks = (
  r: ClosureReport | null,
  o: { routeNetwork?: IsraelRouteNetwork; departureMs?: number; windowSeconds?: number } = {},
) =>
  closureMarks({
    report: r,
    network: network(),
    routeNetwork: o.routeNetwork,
    departureMs: o.departureMs ?? now,
    windowSeconds: o.windowSeconds ?? 7200,
    closureText: (c) => `TEXT ${c.notamId}`,
  });

describe('Closures from the NOTAM feed', () => {
  test('closureOverlappingTheDepartureWindowMarksTheSegment', async () => {
    const result = await marks(report([closure({ validFrom: now + HOUR })]));
    expect(result.segments.get(2)).toEqual({ kind: 'full', notamID: 'C9/26' });
    expect(result.unresolved).toEqual([]);
  });

  test('closureThatStartsAfterTheWindowOrEndedBeforeIsIgnored', async () => {
    expect(await marks(report([closure({ validFrom: now + 4 * HOUR })]))).toEqual(emptyClosureMarks());
    expect(await marks(report([closure({ validTo: now - 60_000 })]))).toEqual(emptyClosureMarks());
  });

  test('window bounds are inclusive', () => {
    expect(closureOverlaps(closure({ validFrom: now + 2 * HOUR }), now, now + 2 * HOUR)).toBe(true);
    expect(closureOverlaps(closure({ validTo: now }), now, now + 2 * HOUR)).toBe(true);
  });

  test('staleOrMissingFeedYieldsNoClosureMarks', async () => {
    const closures = [closure()];
    expect(await marks(report(closures, 'expired'))).toEqual(emptyClosureMarks());
    expect(await marks(report(closures, 'unsafe'))).toEqual(emptyClosureMarks());
    expect(await marks(report(closures, 'unknown'))).toEqual(emptyClosureMarks());
    expect(await marks(null)).toEqual(emptyClosureMarks());
    expect((await marks(report(closures, 'old'))).segments.get(2)).toEqual({ kind: 'full', notamID: 'C9/26' });
  });

  test('severity maps to full, check and partial (with the supplied label)', async () => {
    const result = await marks(
      report([
        closure({ notamId: 'F', chain: ['A', 'B'] }),
        closure({ notamId: 'K', chain: ['B', 'C'], parsed: false }),
        closure({ notamId: 'P', chain: ['A', 'D'], partial: true }),
      ]),
    );
    expect(result.segments.get(1)).toEqual({ kind: 'full', notamID: 'F' });
    expect(result.segments.get(2)).toEqual({ kind: 'check', notamID: 'K' });
    expect(result.segments.get(3)).toEqual({ kind: 'partial', notamID: 'P', text: 'TEXT P' });
  });

  test('the stronger closure wins on a shared segment, whatever the order', async () => {
    const partial = closure({ notamId: 'P', partial: true });
    const full = closure({ notamId: 'F' });
    expect((await marks(report([partial, full]))).segments.get(2)).toEqual({ kind: 'full', notamID: 'F' });
    expect((await marks(report([full, partial]))).segments.get(2)).toEqual({ kind: 'full', notamID: 'F' });
    const check = closure({ notamId: 'K', parsed: false });
    expect((await marks(report([partial, check]))).segments.get(2)).toEqual({ kind: 'check', notamID: 'K' });
    // Equal rank keeps the first.
    const second = closure({ notamId: 'F2' });
    expect((await marks(report([full, second]))).segments.get(2)).toEqual({ kind: 'full', notamID: 'F' });
  });
});

describe('Unresolved closures never fail open (efb-qpk)', () => {
  const chainClosure = (id: string, chain: string[]) => closure({ notamId: id, chain });

  test('closureWithAnUnknownCodeIsReportedAsUnresolved', async () => {
    const result = await marks(report([chainClosure('C7/26', ['B', 'NOWHERE'])]));
    expect(result.segments.size).toBe(0);
    expect(result.unresolved).toEqual([{ notamID: 'C7/26', unknownCodes: ['NOWHERE'], unmatchedLegs: [] }]);
  });

  test('closureLegWithNoPublishedSegmentIsReportedAsUnresolved', async () => {
    // B and D are both on the network but no segment joins them.
    const result = await marks(report([chainClosure('C8/26', ['B', 'D'])]));
    expect(result.unresolved).toEqual([
      { notamID: 'C8/26', unknownCodes: [], unmatchedLegs: [{ from: 'B', to: 'D' }] },
    ]);
  });

  test('partlyPlacedClosureStillClosesWhatItCanAndStaysUnresolved', async () => {
    const result = await marks(report([chainClosure('C6/26', ['A', 'B', 'NOWHERE'])]));
    expect(result.segments.get(1)).toEqual({ kind: 'full', notamID: 'C6/26' });
    expect(result.unresolved.map((u) => u.notamID)).toEqual(['C6/26']);
  });

  test('a NOTAM appears once in unresolved even when it has several bad legs', async () => {
    const result = await marks(report([chainClosure('C5/26', ['B', 'D', 'NOWHERE', 'ELSEWHERE'])]));
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].unknownCodes).toEqual(['NOWHERE', 'ELSEWHERE']);
  });
});

describe('Closure kinds per network', () => {
  const lsaMarks = (kind: string, routeNetwork: IsraelRouteNetwork) =>
    marks(report([closure({ notamId: 'C5/26', routeKind: kind })]), { routeNetwork, windowSeconds: 3600 });

  test('anUltralightClosureCountsOnTheLSANetworkOnly', async () => {
    expect((await lsaMarks('ULTRALIGHT', 'lsa')).segments.get(2)).toEqual({ kind: 'full', notamID: 'C5/26' });
    expect((await lsaMarks('ULTRALIGHT', 'cvfr')).segments.size).toBe(0);
  });

  test('aCVFRClosureDoesNotCloseTheLSANetwork', async () => {
    expect((await lsaMarks('CVFR', 'lsa')).segments.size).toBe(0);
    expect((await lsaMarks('CVFR', 'cvfr')).segments.get(2)).toEqual({ kind: 'full', notamID: 'C5/26' });
  });

  test('anLSAClosureThatNamesAnUnknownPointStillBlocksFiling', async () => {
    const result = await marks(report([closure({ notamId: 'C6/26', routeKind: 'LSA', chain: ['B', 'NOWHERE'] })]), {
      routeNetwork: 'lsa',
      windowSeconds: 3600,
    });
    expect(result.unresolved.map((u) => u.notamID)).toEqual(['C6/26']);
  });

  test('the lookup matches codes case-insensitively and by direction', () => {
    const lookup = network();
    expect(lookup.knowsPoint('a')).toBe(true);
    expect(lookup.knowsPoint('NOWHERE')).toBe(false);
    expect(lookup.segment('a', 'b')?.id).toBe(1);
    expect(lookup.segment('B', 'A')).toBeNull();
  });
});
