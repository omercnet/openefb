import type { IsraelNotamReport } from '../../services/israelNotam';
import type { IsraelChartInput } from '../../domain/map/israel/layers';
import { closureLookupFrom, currentReport, israelChartSources } from './israelFeed';

const NOW = 1_793_524_800_000;
const pt = (id: number, code: string, lat: number) =>
  ({ id, code, kind: 'compulsory', latitude: lat, longitude: 34.8, name: code }) as never;
const seg = (id: number, from: string, to: string, lat: number) =>
  ({
    id,
    fromCode: from,
    toCode: to,
    fromPointID: id,
    toPointID: id + 1,
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: 6,
    isCivil: true,
    isMilitary: false,
    isByRequest: false,
    bearingTrue: 0,
    altitudeForward: null,
    altitudeReverse: null,
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat, lon: 34.8 },
      { lat: lat + 0.1, lon: 34.8 },
    ],
    network: 'cvfr',
    activity: 'civil',
    activitySource: null,
    smallOnly: false,
  }) as never;
const input: IsraelChartInput = {
  points: [pt(1, 'GALIM', 32), pt(2, 'DAROM', 32.1), pt(3, 'HOTRM', 32.2)],
  segments: [seg(10, 'GALIM', 'DAROM', 32), seg(11, 'DAROM', 'HOTRM', 32.1)],
  airspaces: [],
  runways: [],
  aerodromes: [],
};
const closure = (chain: string[]) => ({
  notamId: 'C1/26',
  routeKind: 'CVFR',
  routeName: null,
  chain,
  validFrom: NOW - 3_600_000,
  validTo: NOW + 7_200_000,
  schedule: null,
});
const report = (closures: unknown[], items: unknown[] = [], generatedAt = NOW - 300_000): IsraelNotamReport =>
  ({ feed: { generatedAt, items, closures }, fetchedAt: NOW, refreshFailed: false }) as never;

describe('israelChartSources', () => {
  it('without a feed the chart is drawn with no closures and says so', async () => {
    const { sources, status } = await israelChartSources(input, null, NOW);
    expect(status).toEqual({ kind: 'noFeed' });
    expect(sources['il-routes']?.features.length).toBe(2);
    expect(sources['il-closures']?.features ?? []).toHaveLength(0);
  });

  it('a fresh closure marks its segment, in either direction of the chain', async () => {
    const { sources, status } = await israelChartSources(input, report([closure(['DAROM', 'GALIM'])]), NOW);
    expect(status).toMatchObject({ kind: 'loaded', closedSegments: 1, level: 'fresh' });
    expect(sources['il-closures']?.features).toHaveLength(1);
    expect(sources['il-closure-labels']?.features).toHaveLength(1);
  });

  it('a feed too old to trust draws nothing but still reports its age', async () => {
    const old = report([closure(['GALIM', 'DAROM'])], [], NOW - 30 * 86_400_000);
    const { sources, status } = await israelChartSources(input, old, NOW);
    expect(status).toMatchObject({ kind: 'loaded', closedSegments: 0 });
    expect(sources['il-closures']?.features ?? []).toHaveLength(0);
  });
});

describe('feed access', () => {
  it('a failed fetch with nothing cached is no report, never an error', async () => {
    const failing = {
      fetchFeed: async () => {
        throw new Error('offline');
      },
    };
    expect(await currentReport(failing)).toBeNull();
    expect(await currentReport(null)).toBeNull();
  });

  it('the closure lookup names the NOTAMs that close a field, from a usable feed only', async () => {
    const item = {
      id: 'A1/26',
      cancelledBy: null,
      replacedBy: null,
      closures: [],
      validFrom: NOW - 1000,
      validTo: NOW + 1000,
      e: 'LLHZ AD CLSD',
    };
    const lookup = await closureLookupFrom({ fetchFeed: async () => report([], [item]) })!();
    expect(lookup('LLHZ', NOW)).toEqual(['A1/26']);
    expect(lookup('LLBG', NOW)).toEqual([]);
    const stale = await closureLookupFrom({ fetchFeed: async () => report([], [item], NOW - 30 * 86_400_000) })!();
    expect(stale('LLHZ', NOW)).toEqual([]);
    expect(closureLookupFrom(null)).toBeNull();
  });
});
