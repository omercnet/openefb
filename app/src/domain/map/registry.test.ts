import { validateRegistry } from './layerSpec';
import { ALL_SOURCE_IDS, layerSpecsFor } from './registry';

describe('layer registry', () => {
  it('is valid for both regions: unique ids, known sources, contiguous per source', () => {
    expect(validateRegistry(layerSpecsFor('us'), ALL_SOURCE_IDS)).toEqual([]);
    expect(validateRegistry(layerSpecsFor('israel'), ALL_SOURCE_IDS)).toEqual([]);
  });
  it('only Israel carries the CVFR overlays, below the track ruler and ownship; arrays are stable', () => {
    const us = layerSpecsFor('us');
    expect(us.some((s) => s.source.startsWith('il-'))).toBe(false);
    const il = layerSpecsFor('israel');
    const ids = il.map((s) => s.id);
    expect(il.length).toBeGreaterThan(us.length);
    // The core layers keep their relative order.
    expect(il.filter((s) => !s.source.startsWith('il-'))).toEqual(us);
    const lastIsrael = Math.max(...il.map((s, i) => (s.source.startsWith('il-') ? i : -1)));
    expect(lastIsrael).toBeLessThan(ids.indexOf('track-ruler-line'));
    expect(lastIsrael).toBeLessThan(ids.indexOf('ownship-symbol'));
    expect(lastIsrael).toBeLessThan(ids.indexOf('route-line-layer'));
    expect(il.findIndex((s) => s.source.startsWith('il-'))).toBeGreaterThan(ids.indexOf('advisory-fill'));
    expect(layerSpecsFor('israel')).toBe(il);
  });
});
