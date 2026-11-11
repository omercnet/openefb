import { isLayerVisible, validateRegistry, visibleLayerIds } from './layerSpec';
import { CORE_LAYER_SPECS, SOURCE_IDS } from './layers';
import { ownshipFeatures, routeLinePath } from './ownshipRoute';
import { trackRuler, rulerLabelAnchor } from './trackRuler';

describe('core layer registry', () => {
  it('has unique layer ids and only known sources', () => {
    expect(validateRegistry(CORE_LAYER_SPECS, SOURCE_IDS)).toEqual([]);
  });

  it('keeps Swift z-order: advisories and the ruler under ownship, ownship under the airport dots, TFRs and route on top', () => {
    const ids = CORE_LAYER_SPECS.map((s) => s.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('advisory-fill')).toBeLessThan(at('ownship-symbol'));
    expect(at('track-ruler-ticks')).toBeLessThan(at('ownship-symbol'));
    expect(at('ownship-symbol')).toBeLessThan(at('airport-circles'));
    expect(at('airport-circles')).toBeLessThan(at('tfr-fill'));
    expect(at('tfr-fill')).toBeLessThan(at('route-line-layer'));
  });

  it('toggle visibility follows the layer set and the region', () => {
    const spec = CORE_LAYER_SPECS.find((s) => s.id === 'airport-circles')!;
    expect(isLayerVisible(spec, new Set(['airports']), 'us')).toBe(true);
    expect(isLayerVisible(spec, new Set(['sectional']), 'us')).toBe(false);
    expect(isLayerVisible(spec, new Set(['airports']), 'israel')).toBe(false); // Israel has no US airport source
    const ruler = CORE_LAYER_SPECS.find((s) => s.id === 'track-ruler-line')!;
    expect(isLayerVisible(ruler, new Set(), 'us')).toBe(true);
    expect(visibleLayerIds(CORE_LAYER_SPECS, new Set(['ownship']), 'us')).toEqual([
      'track-ruler-line',
      'track-ruler-ticks',
      'ownship-symbol',
    ]);
  });

  it('validateRegistry reports duplicates and unknown sources', () => {
    const s = { id: 'a', type: 'line' as const, source: 'nope', layer: null };
    expect(validateRegistry([s, s], ['x'])).toEqual([
      'layer a references unknown source nope',
      'duplicate layer id a',
      'layer a references unknown source nope',
    ]);
    const mk = (id: string, source: string) => ({ id, type: 'line' as const, source, layer: null });
    expect(validateRegistry([mk('1', 'x'), mk('2', 'y'), mk('3', 'x')], ['x', 'y'])).toEqual([
      'layers of source x are not contiguous (at 3)',
    ]);
  });
});

describe('ownshipFeatures', () => {
  it('is empty before the first fix, grey when stale, blue when live', () => {
    expect(ownshipFeatures(null, 90, false).features).toEqual([]);
    expect(ownshipFeatures({ lat: 1, lon: 2 }, 90, true).features[0]!.properties).toEqual({
      heading: 90,
      icon: 'ownship-chevron-stale',
    });
    expect(ownshipFeatures({ lat: 1, lon: 2 }, 90, false).features[0]!.properties.icon).toBe('ownship-chevron');
  });
  it('a NaN heading draws north', () => {
    expect(ownshipFeatures({ lat: 1, lon: 2 }, Number.NaN, false).features[0]!.properties.heading).toBe(0);
  });
});

describe('routeLinePath', () => {
  it('needs two points', () => {
    expect(routeLinePath([{ lat: 1, lon: 1 }]).features).toEqual([]);
    expect(
      routeLinePath([
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 },
      ]).features[0]!.geometry,
    ).toEqual({
      type: 'LineString',
      coordinates: [
        [1, 1],
        [2, 2],
      ],
    });
  });
});

describe('trackRuler', () => {
  const origin = { lat: 37.4876, lon: -122.2289 };
  it('ticks at 1, 2, 3, 5 and 10 minutes with the Swift labels; the line ends at the last tick', () => {
    const r = trackRuler(origin, 296, 96);
    expect(r.ticks.features.map((f) => f.properties.label)).toEqual(['1 min', '2', '3', '5', '10 min']);
    const last = r.ticks.features.at(-1)!.geometry;
    const lineGeom = r.line.features[0]!.geometry;
    if (last.type !== 'Point' || lineGeom.type !== 'LineString') throw new Error('shape');
    expect(lineGeom.coordinates[1]).toEqual(last.coordinates);
    expect(lineGeom.coordinates[0]).toEqual([origin.lon, origin.lat]);
  });
  it('is cleared with no fix, below 30 kt, or with a NaN track', () => {
    expect(trackRuler(null, 90, 100).ticks.features).toEqual([]);
    expect(trackRuler(origin, 90, 29.9).line.features).toEqual([]);
    expect(trackRuler(origin, 90, 30).ticks.features).toHaveLength(5);
    expect(trackRuler(origin, Number.NaN, 100).line.features).toEqual([]);
    expect(trackRuler(origin, 90, Number.NaN).line.features).toEqual([]);
  });
  it('label anchor: top for a line running across the screen, left for up/down; follows the map bearing', () => {
    expect(rulerLabelAnchor(90)).toBe('top');
    expect(rulerLabelAnchor(0)).toBe('left');
    expect(rulerLabelAnchor(90, 90)).toBe('left');
  });
});
