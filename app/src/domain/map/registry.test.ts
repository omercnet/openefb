import { validateRegistry } from './layerSpec';
import { ALL_SOURCE_IDS, layerSpecsFor } from './registry';

describe('layer registry', () => {
  it('is valid for both regions: unique ids, known sources, contiguous per source', () => {
    expect(validateRegistry(layerSpecsFor('us'), ALL_SOURCE_IDS)).toEqual([]);
    expect(validateRegistry(layerSpecsFor('israel'), ALL_SOURCE_IDS)).toEqual([]);
  });
  it('only Israel carries the CVFR overlays, drawn after the core layers; arrays are stable', () => {
    expect(layerSpecsFor('us').some((s) => s.source.startsWith('il-'))).toBe(false);
    const il = layerSpecsFor('israel');
    expect(il.length).toBeGreaterThan(layerSpecsFor('us').length);
    expect(il.slice(0, layerSpecsFor('us').length)).toEqual(layerSpecsFor('us'));
    expect(layerSpecsFor('israel')).toBe(il);
  });
});
