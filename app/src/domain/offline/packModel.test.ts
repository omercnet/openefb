// Ports efb-212Tests/ServiceTests/OfflineMapTests.swift (20) and CharacterizationTests/OfflinePackStatusCharacterizationTests.swift
// (20), same names. The Swift cases that need MapLibre types (`mlnBounds`) are folded into toLngLatBounds.
import { AppFailure } from '../errors';
import {
  boundsAround,
  bounds,
  boundsContain,
  boundsIntersect,
  toLngLatBounds,
  CONTIGUOUS_US_SECTIONAL_AREAS,
  type OfflineRegionBounds,
} from './bounds';
import {
  currentSectionalCycle,
  estimatedBytes,
  estimatedBytesForLayers,
  formatOfflineSize,
  isSectionalCurrent,
  layerAverageTileBytes,
  layerZoomRange,
  OFFLINE_LAYERS,
  sectionalDaysRemaining,
  tileCount,
  type OfflineLayer,
} from './layers';
import {
  decodeContext,
  encodeContext,
  layerStatus,
  packFraction,
  packIsExpired,
  packStyle,
  styleStatus,
  type OfflinePackState,
  type OfflinePackSummary,
} from './packModel';

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const paloAlto = bounds(37.3, -122.3, 37.6, -121.9);
const view = bounds(37.4, -122.2, 37.5, -122.0);
let seq = 0;
function pack(
  layer: OfflineLayer,
  o: {
    bounds?: OfflineRegionBounds;
    state?: OfflinePackState;
    cycle?: number | null;
    completed?: number;
    expected?: number;
  } = {},
): OfflinePackSummary {
  return {
    context: {
      id: `p${seq++}`,
      name: 'Test',
      layer,
      bounds: o.bounds ?? paloAlto,
      cycleEffective: o.cycle ?? null,
      createdAt: 1_793_000_000_000,
    },
    state: o.state ?? { kind: 'complete' },
    completedResources: o.completed ?? 10,
    expectedResources: o.expected ?? 10,
    completedBytes: 1000,
  };
}
const now = utc(2026, 11, 1);
const cycleNow = utc(2026, 10, 29, 9, 1);
const cyclePrev = utc(2026, 9, 3, 9, 1);

describe('Offline Maps', () => {
  describe('cycle', () => {
    it('cycleAnchorIsTheFAAEditionDate', () => {
      const c = currentSectionalCycle(utc(2026, 11, 15));
      expect(c.effective).toBe(utc(2026, 10, 29, 9, 1));
      expect(c.expires).toBe(utc(2026, 12, 24, 9, 1));
    });
    it('cycleRollsOverExactlyAtTheBoundary', () => {
      const boundary = utc(2026, 12, 24, 9, 1);
      expect(currentSectionalCycle(boundary - 1000).effective).toBe(utc(2026, 10, 29, 9, 1));
      const at = currentSectionalCycle(boundary);
      expect(at.effective).toBe(boundary);
      expect(at.expires).toBe(boundary + 56 * 86_400_000);
    });
    it('cycleComputesEarlierCyclesBeforeTheAnchor', () => {
      const c = currentSectionalCycle(utc(2026, 10, 1));
      expect(c.effective).toBe(utc(2026, 9, 3, 9, 1));
      expect(c.expires).toBe(utc(2026, 10, 29, 9, 1));
    });
    it('chartFromThePreviousCycleIsNotCurrent', () => {
      expect(isSectionalCurrent(cyclePrev, now)).toBe(false);
      expect(isSectionalCurrent(cycleNow, now)).toBe(true);
    });
    it('daysRemainingCountsWholeDaysToTheNextEdition', () => {
      expect(sectionalDaysRemaining(utc(2026, 12, 20, 9, 1))).toBe(4);
      expect(sectionalDaysRemaining(utc(2026, 12, 24, 9, 0))).toBe(0);
    });
  });

  describe('size estimate', () => {
    it('tileCountMatchesHandComputedWorldBox', () => {
      expect(tileCount(bounds(-80, -170, 80, 170), 1, 1)).toBe(4);
    });
    it('sectionalEstimateForASingleTileColumnIsOneTilePerZoom', () => {
      const point = bounds(37.461, -122.1151, 37.4611, -122.115);
      const { min, max } = layerZoomRange('sectional');
      expect(tileCount(point, min, max)).toBe(5);
      expect(estimatedBytes(point, 'sectional')).toBe(5 * layerAverageTileBytes('sectional'));
    });
    it('estimateGrowsWithAreaAndSumsLayers', () => {
      const small = estimatedBytesForLayers(view, ['sectional']);
      const big = estimatedBytesForLayers(paloAlto, ['sectional']);
      expect(big).toBeGreaterThan(small);
      expect(estimatedBytesForLayers(paloAlto, ['sectional', 'street'])).toBe(big + estimatedBytes(paloAlto, 'street'));
    });
    it('onlyRedistributableLayersAreDownloadable', () => {
      expect([...OFFLINE_LAYERS]).toEqual(['sectional', 'street']);
    });
  });

  describe('status', () => {
    it('completeCurrentPackCoveringTheViewIsReady', () => {
      expect(styleStatus(view, 'vfrSectional', [pack('sectional', { cycle: cycleNow }), pack('street')], now)).toBe(
        'ready',
      );
    });
    it('noPacksIsNotDownloaded', () => {
      expect(styleStatus(view, 'street', [], now)).toBe('notDownloaded');
    });
    it('vfrNeedsBothSectionalAndStreet', () => {
      const packs = [pack('sectional', { cycle: cycleNow })];
      expect(styleStatus(view, 'vfrSectional', packs, now)).toBe('notDownloaded');
      expect(layerStatus(view, 'sectional', packs, now)).toBe('ready');
    });
    it('viewPartlyOutsideThePackIsPartial', () => {
      expect(layerStatus(bounds(37.2, -122.5, 37.5, -122.0), 'street', [pack('street')], now)).toBe('partial');
    });
    it('packStillDownloadingIsPartial', () => {
      expect(layerStatus(view, 'street', [pack('street', { state: { kind: 'downloading' } })], now)).toBe('partial');
    });
    it('packElsewhereDoesNotCount', () => {
      expect(layerStatus(view, 'street', [pack('street', { bounds: bounds(39, -105.5, 40, -104) })], now)).toBe(
        'notDownloaded',
      );
    });
    it('sectionalFromAnEarlierCycleIsExpiredNeverReady', () => {
      const old = pack('sectional', { cycle: cyclePrev });
      expect(packIsExpired(old, now)).toBe(true);
      expect(layerStatus(view, 'sectional', [old], now)).toBe('expired');
      expect(styleStatus(view, 'vfrSectional', [old, pack('street')], now)).toBe('expired');
    });
    it('aCurrentPackWinsOverAnExpiredOne', () => {
      const packs = [pack('sectional', { cycle: cyclePrev }), pack('sectional', { cycle: cycleNow })];
      expect(layerStatus(view, 'sectional', packs, now)).toBe('ready');
    });
    it('streetPacksNeverExpireWithTheChartCycle', () => {
      expect(packIsExpired(pack('street'), utc(2030, 1, 1))).toBe(false);
    });
  });

  describe('pack style', () => {
    const base = {
      version: 8,
      glyphs: 'https://example.com/{fontstack}/{range}.pbf',
      sources: {
        'vfr-sectional': { type: 'raster', tiles: ['https://a/{z}/{y}/{x}'] },
        openmaptiles: { type: 'vector', url: 'https://b' },
      },
      layers: [
        { id: 'bg', type: 'background' },
        { id: 'base-vfr-sectional', type: 'raster', source: 'vfr-sectional' },
        { id: 'street-water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      ],
    };
    it('packStyleKeepsOnlyTheLayersSources', () => {
      const s = packStyle('sectional', base) as { sources: object; layers: { id: string }[]; glyphs?: unknown };
      expect(Object.keys(s.sources)).toEqual(['vfr-sectional']);
      expect(s.layers.map((l) => l.id)).toEqual(['base-vfr-sectional']);
      expect(s.glyphs).toBeUndefined();
    });
    it('packStyleRejectsMalformedBaseStyle', () => {
      expect(() => packStyle('street', {})).toThrow(AppFailure);
      expect(() => packStyle('street', null)).toThrow(AppFailure);
    });
    it('street keeps glyphs and does not mutate the base', () => {
      const s = packStyle('street', base) as { glyphs?: unknown; name: string };
      expect(s.glyphs).toBeDefined();
      expect(s.name).toBe('Kanaf offline street');
      expect(Object.keys(base.sources)).toHaveLength(2);
    });
  });
});

describe('Offline Pack Status Characterization', () => {
  describe('resource counts vs state', () => {
    it('completeStateWithMissingResourcesReadsPartialNotReady', () => {
      const half = pack('street', { bounds: view, completed: 5, expected: 10 });
      expect(packFraction(half)).toBe(0.5);
      expect(layerStatus(view, 'street', [half], now)).toBe('partial');
    });
    it('completePackWithZeroExpectedResourcesIsFullyDoneAndReady', () => {
      const empty = pack('street', { bounds: view, completed: 0, expected: 0 });
      expect(packFraction(empty)).toBe(1);
      expect(layerStatus(view, 'street', [empty], now)).toBe('ready');
      expect(
        packFraction(pack('street', { bounds: view, state: { kind: 'downloading' }, completed: 0, expected: 0 })),
      ).toBe(0);
    });
    it('fractionIsCappedAtOneWhenCompletedExceedsExpected', () => {
      expect(packFraction(pack('street', { bounds: view, completed: 15, expected: 10 }))).toBe(1);
    });
    it('failedPackCoveringTheViewReadsNotDownloaded', () => {
      expect(
        layerStatus(
          view,
          'street',
          [pack('street', { bounds: view, state: { kind: 'failed', reason: 'Removed' } })],
          now,
        ),
      ).toBe('notDownloaded');
    });
    it('failedPackDoesNotHideAHealthyPackOnTheSameLayer', () => {
      const failed = pack('street', { bounds: view, state: { kind: 'failed', reason: 'Removed' } });
      expect(layerStatus(view, 'street', [failed, pack('street', { bounds: view })], now)).toBe('ready');
    });
    it('pausedPackCoveringTheViewReadsPartial', () => {
      expect(
        layerStatus(view, 'street', [pack('street', { bounds: view, state: { kind: 'paused' }, completed: 3 })], now),
      ).toBe('partial');
    });
  });

  describe('isExpired boundary', () => {
    it('packFromTheCurrentCycleEffectiveIsNotExpired', () => {
      const n = utc(2026, 11, 15);
      const effective = currentSectionalCycle(n).effective;
      expect(effective).toBe(utc(2026, 10, 29, 9, 1));
      expect(packIsExpired(pack('sectional', { bounds: view, cycle: effective }), n)).toBe(false);
      expect(packIsExpired(pack('sectional', { bounds: view, cycle: effective - 1000 }), n)).toBe(true);
      expect(packIsExpired(pack('sectional', { bounds: view, cycle: effective - 86_400_000 }), n)).toBe(true);
    });
    it('packIsExpiredFromTheExactNextCycleBoundary', () => {
      const next = utc(2026, 12, 24, 9, 1);
      const current = pack('sectional', { bounds: view, cycle: utc(2026, 10, 29, 9, 1) });
      expect(packIsExpired(current, next - 1000)).toBe(false);
      expect(packIsExpired(current, next)).toBe(true);
    });
    it('sectionalPackWithoutCycleNeverExpires', () => {
      const noCycle = pack('sectional', { bounds: view, cycle: null });
      const far = utc(2030, 1, 1);
      // BUG preserved (efb-epd): a sectional context without cycleEffective reads current forever.
      expect(packIsExpired(noCycle, far)).toBe(false);
      expect(layerStatus(view, 'sectional', [noCycle], far)).toBe('ready');
    });
    it('packCycleInTheFutureIsNotExpired', () => {
      expect(packIsExpired(pack('sectional', { bounds: view, cycle: utc(2027, 6, 1) }), utc(2026, 11, 15))).toBe(false);
    });
  });

  describe('coverage', () => {
    it('twoAdjacentPacksThatTogetherCoverTheViewArePartial', () => {
      const west = bounds(37.3, -122.3, 37.6, -122.1);
      const east = bounds(37.3, -122.1, 37.6, -121.9);
      expect(
        layerStatus(view, 'street', [pack('street', { bounds: west }), pack('street', { bounds: east })], now),
      ).toBe('partial');
    });
    it('packThatOnlyTouchesTheViewEdgeCountsAsIntersecting', () => {
      const touching = bounds(37.4, -122.5, 37.5, -122.2);
      expect(boundsIntersect(touching, view)).toBe(true);
      expect(layerStatus(view, 'street', [pack('street', { bounds: touching })], now)).toBe('partial');
    });
    it('viewExactlyEqualToPackBoundsIsReady', () => {
      expect(layerStatus(view, 'street', [pack('street', { bounds: view })], now)).toBe('ready');
      expect(boundsContain(view, view)).toBe(true);
    });
    it('expiredFullCoverPlusCurrentPartialCoverIsPartialNotExpired', () => {
      const n = utc(2026, 11, 15);
      const packs = [
        pack('sectional', { bounds: bounds(37, -123, 38, -121), cycle: cyclePrev }),
        pack('sectional', { bounds: bounds(37.45, -122.15, 37.55, -122.05), cycle: cycleNow }),
      ];
      expect(layerStatus(view, 'sectional', packs, n)).toBe('partial');
    });
    it('styleStatusWorstLayerWinsExpiredOverPartial', () => {
      const packs = [
        pack('sectional', { bounds: view, cycle: cyclePrev }),
        pack('street', { bounds: view, state: { kind: 'downloading' } }),
      ];
      expect(styleStatus(view, 'vfrSectional', packs, utc(2026, 11, 15))).toBe('expired');
    });
  });

  describe('bounds', () => {
    it('boundsNormaliseSwappedMinMax', () => {
      expect(bounds(40, -100, 30, -110)).toEqual(bounds(30, -110, 40, -100));
    });
    it('boundsAcrossTheAntimeridianBecomeTheWrongWayAroundBox', () => {
      const b = bounds(50, 170, 55, -170);
      expect(b.west).toBe(-170);
      expect(b.east).toBe(170);
    });
    it('boundsAroundAPointAtTheEquator', () => {
      const b = boundsAround({ lat: 0, lon: 10 }, 30);
      expect(b.south).toBeCloseTo(-0.5, 9);
      expect(b.north).toBeCloseTo(0.5, 9);
      expect(b.west).toBeCloseTo(9.5, 9);
      expect(b.east).toBeCloseTo(10.5, 9);
    });
    it('boundsAroundAHighLatitudePointClampTheLongitudeScale', () => {
      const b = boundsAround({ lat: 89, lon: 0 }, 60);
      expect(b.west).toBeCloseTo(-20, 9);
      expect(b.east).toBeCloseTo(20, 9);
      expect(b.south).toBeCloseTo(88, 9);
      expect(b.north).toBeCloseTo(90, 9);
    });
    it('boundsAroundAPointNearThePoleExceedNinetyDegrees', () => {
      const b = boundsAround({ lat: 89.5, lon: 0 }, 60);
      expect(b.north).toBeCloseTo(90.5, 9);
      const [w, s, e, n] = toLngLatBounds(b);
      expect([w, s, e, n].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-20, 88.5, 20, 90.5]);
    });
  });
});

describe('offline JS-only guards', () => {
  it('context codec round-trips and rejects malformed input', () => {
    const c = { id: 'a', name: 'n', layer: 'street' as const, bounds: view, cycleEffective: null, createdAt: 5 };
    expect(decodeContext(encodeContext(c))).toEqual(c);
    expect(decodeContext('not json')).toBeNull();
    expect(decodeContext('{}')).toBeNull();
    expect(decodeContext(JSON.stringify({ ...c, layer: 'satellite' }))).toBeNull();
    expect(decodeContext(JSON.stringify({ ...c, bounds: { ...view, south: 'x' } }))).toBeNull();
    expect(decodeContext(null)).toBeNull();
  });
  it('the sectional area table has the 36 Swift areas with valid boxes', () => {
    expect(CONTIGUOUS_US_SECTIONAL_AREAS).toHaveLength(36);
    expect(
      CONTIGUOUS_US_SECTIONAL_AREAS.every((a) => a.bounds.south < a.bounds.north && a.bounds.west < a.bounds.east),
    ).toBe(true);
  });
  it('formats sizes like ByteCountFormatter(.file)', () => {
    expect(formatOfflineSize(0)).toBe('Zero KB');
    expect(formatOfflineSize(999)).toBe('999 bytes');
    expect(formatOfflineSize(45_000)).toBe('45 KB');
    expect(formatOfflineSize(1_234_567)).toBe('1.2 MB');
    expect(formatOfflineSize(2_000_000_000)).toBe('2 GB');
    expect(formatOfflineSize(Number.NaN)).toBe('Zero KB');
  });
});
