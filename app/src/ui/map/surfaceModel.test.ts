import { CORE_LAYER_SPECS } from '../../domain/map/layers';
import { groupBySource, styleFor } from './surfaceModel';

const sectionalOf = (night: boolean, sectional: boolean) => {
  const l = styleFor(night, sectional).layers.find((x) => x.id === 'base-vfr-sectional');
  if (!l || l.type !== 'raster') throw new Error('sectional layer missing');
  return l;
};

describe('styleFor', () => {
  it('shows the sectional at runtime (the style ships it hidden) and hides it when the toggle is off', () => {
    expect(sectionalOf(false, true).layout?.visibility).toBe('visible');
    expect(sectionalOf(false, false).layout?.visibility).toBe('none');
  });
  it('dims and desaturates the sectional at night only', () => {
    expect(sectionalOf(true, true).paint).toMatchObject({ 'raster-brightness-max': 0.55, 'raster-saturation': -0.35 });
    expect(sectionalOf(false, true).paint).not.toHaveProperty('raster-brightness-max');
  });
  it('leaves every other layer untouched', () => {
    const a = styleFor(false, true).layers.filter((l) => l.id !== 'base-vfr-sectional');
    const b = styleFor(true, false).layers.filter((l) => l.id !== 'base-vfr-sectional');
    expect(a).toEqual(b);
  });
});

describe('groupBySource', () => {
  it('keeps draw order and one group per source for the core registry (fixed React child count)', () => {
    const groups = groupBySource(CORE_LAYER_SPECS);
    expect(groups.map((g) => g.source)).toEqual([
      'advisories', 'track-ruler-line', 'track-ruler-ticks', 'ownship', 'airports', 'navaids', 'airspaces', 'weather-dots', 'tfrs', 'route-line',
    ]);
    expect(groups.flatMap((g) => g.specs.map((s) => s.id))).toEqual(CORE_LAYER_SPECS.map((s) => s.id));
  });
  it('is empty for an empty registry', () => {
    expect(groupBySource([])).toEqual([]);
  });
});
