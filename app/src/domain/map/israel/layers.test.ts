// IsraelBriefingFilterTests.aRouteClosureDrawsItsChainNotTheScopeCircleButAnAreaNotamKeepsItsCircle (the
// IsraelBriefingGeometry case, moved here from L3), plus JS-only checks of the registry and source builders (no Swift
// equivalent: Swift built these imperatively against MLNStyle).
import type { IsraelAerodrome } from '../../../data/aviation/israelTypes';
import { CVFR_CHART_LAYERS, type Coordinate } from '../../core';
import { validateRegistry } from '../layerSpec';
import {
  briefingShapes,
  israelBriefingBounds,
  israelBriefingHighlightSource,
  type IsraelBriefingNotamInput,
} from './briefing';
import { israelSelectionFromFeature } from './chartDetails';
import {
  ISRAEL_LAYER_SPECS,
  ISRAEL_SOURCE_IDS,
  buildIsraelSources,
  israelOfficialChartOverrides,
  israelOfficialChartUrl,
} from './layers';

const notam = (
  circle: { centre: Coordinate; radiusNM: number } | null,
  closures: { chain: string[] }[] = [],
): IsraelBriefingNotamInput => ({ geometry: { polygon: null, circle }, q: null, closures });

describe('Israel briefing geometry', () => {
  test('aRouteClosureDrawsItsChainNotTheScopeCircleButAnAreaNotamKeepsItsCircle', () => {
    const lookup = (code: string): Coordinate =>
      code === 'GALIM' ? { lat: 32.7, lon: 34.9 } : { lat: 32.8, lon: 35.0 };
    const route = notam({ centre: { lat: 32.7, lon: 34.9 }, radiusNM: 60 }, [{ chain: ['GALIM', 'DAROM'] }]);
    const shapes = briefingShapes(route, lookup);
    expect(shapes.rings).toHaveLength(0); // a 60 NM filled disc read as "this whole area is closed"
    expect(shapes.lines).toHaveLength(1);

    const area = notam({ centre: { lat: 32.7, lon: 34.9 }, radiusNM: 5 });
    expect(briefingShapes(area, lookup).rings).toHaveLength(1);
  });

  test('highlight source closes rings, carries the colour and frames the shapes (JS-only)', () => {
    const area = notam({ centre: { lat: 32, lon: 35 }, radiusNM: 6 });
    const source = israelBriefingHighlightSource(area, () => null, '#FF0000');
    const geometry = source?.features[0]?.geometry;
    expect(geometry?.type).toBe('Polygon');
    const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0]! : [];
    expect(ring).toHaveLength(73);
    expect(ring[0]).toEqual(ring[72]);
    expect(source?.features[0]?.properties.color).toBe('#FF0000');
    const box = israelBriefingBounds(area, () => null)!;
    expect(box.north - box.south).toBeCloseTo(0.2, 6);
    expect(israelBriefingHighlightSource(notam(null), () => null, '#FF0000')).toBeNull();
  });
});

describe('Israel layer registry (JS-only)', () => {
  test('is valid, il- prefixed, and gated only by Israel toggles or always shown', () => {
    expect(validateRegistry(ISRAEL_LAYER_SPECS, ISRAEL_SOURCE_IDS)).toEqual([]);
    const allowed = new Set<string>([...CVFR_CHART_LAYERS, 'lsaRoutes']);
    for (const spec of ISRAEL_LAYER_SPECS) {
      // Swift sprites became text: no layer needs an image registered.
      expect(Object.keys(spec.layout ?? {}).filter((k) => k.startsWith('icon-'))).toEqual([]);
      if (spec.layer !== null) expect(allowed.has(spec.layer)).toBe(true);
      else expect(spec.source).toBe('il-brief-highlight');
      for (const v of Object.values(spec.layout ?? {})) expect(JSON.stringify(v)).not.toContain('icon-image');
      if (spec.type === 'symbol') expect(spec.layout?.['text-font']).toEqual(['Noto Sans Regular']);
    }
  });

  test('every chart colour has a night paint', () => {
    for (const spec of ISRAEL_LAYER_SPECS) {
      if (spec.layer === null || spec.layer === 'lsaRoutes') continue;
      expect(Object.keys(spec.nightPaint ?? {})).not.toHaveLength(0);
    }
  });

  test('official chart hides point labels and keeps airspace fills as tap targets', () => {
    expect(israelOfficialChartOverrides(false, new Set(), false)).toEqual({ visibility: {}, paint: {} });
    const o = israelOfficialChartOverrides(true, new Set(['cvfrPoints']), false);
    expect(o.visibility['il-as-fill-civil']).toBe(true);
    expect(o.paint['il-as-fill-civil']).toEqual({ 'fill-opacity': 0.01 });
    expect(o.visibility['il-point-labels-arp']).toBe(false);
    expect(o.paint['il-point-icons']).toEqual({ 'circle-opacity': 0.02, 'circle-stroke-opacity': 0.02 });
    expect(israelOfficialChartUrl('/var/App Support/il.mbtiles')).toBe('mbtiles:///var/App%20Support/il.mbtiles');
  });
});

describe('buildIsraelSources (JS-only)', () => {
  const pointRow = (id: number, code: string, kind: 'arp' | 'compulsory') => ({
    id,
    code,
    nameEnglish: null,
    nameHebrew: null,
    kind,
    latitude: 32,
    longitude: 34.8,
    network: 'cvfr' as const,
  });
  const input = {
    points: [pointRow(1, 'GALIM', 'compulsory'), pointRow(2, 'LLHZ', 'arp')],
    segments: [],
    airspaces: [
      {
        id: 7,
        kind: 'CTR' as const,
        code: 'LLHA',
        nameEnglish: null,
        nameHebrew: null,
        label: null,
        authority: null,
        floor: { feet: 0, reference: 'SFC' as const, publishedText: null },
        ceiling: { feet: 3000, reference: 'MSL' as const, publishedText: null },
        polygons: [
          [
            [
              { lat: 32, lon: 34 },
              { lat: 32, lon: 35 },
              { lat: 33, lon: 35 },
            ],
          ],
        ],
      },
    ],
    runways: [],
    aerodromes: [],
  };

  test('keys every source id and builds airspace polygons, labels and points', () => {
    const sources = buildIsraelSources(input);
    expect(Object.keys(sources).sort()).toEqual([...ISRAEL_SOURCE_IDS].sort());
    const area = sources['il-airspace']!.features[0]!;
    expect(area.properties).toEqual({ id: 7, kind: 'CTR', restricted: false });
    expect(area.geometry.type === 'Polygon' && area.geometry.coordinates[0]).toHaveLength(4);
    expect(sources['il-airspace-labels']!.features[0]!.properties.label).toBe('LLHA CTR\nSFC\u20133000');
    expect(sources['il-points']!.features.map((f) => f.properties.symbol)).toEqual(['compulsory', 'aerodrome']);
  });

  test('a tapped ARP with an aerodrome record opens the airport sheet', () => {
    const llhz = { code: 'LLHZ', use: 'civil' } as IsraelAerodrome;
    const foreign = { code: 'LLHZ', use: 'foreign' } as IsraelAerodrome;
    expect(israelSelectionFromFeature({ id: 2, code: 'LLHZ' }, { ...input, aerodromes: [llhz] }, new Map())).toEqual({
      kind: 'aerodrome',
      code: 'LLHZ',
    });
    // No record (or only a foreign one, which IsraelChartData.load drops): the CVFR point sheet.
    const sheet = israelSelectionFromFeature({ id: 2, code: 'LLHZ' }, { ...input, aerodromes: [foreign] }, new Map());
    expect(sheet?.kind).toBe('point');
    expect(israelSelectionFromFeature({ code: 'LLXX' }, input, new Map())).toEqual({ kind: 'aerodrome', code: 'LLXX' });
    expect(israelSelectionFromFeature({}, input, new Map())).toBeNull();
  });
});
