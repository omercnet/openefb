import type { LayerSpec } from '../layerSpec';
import { ISRAEL_OFFICIAL_CHART_LAYER } from './layers';
import { CVFR_CHART_LAYERS, type MapLayer } from '../../core';
import { withIsraelOfficialChart, withOfficialChartDefaults } from './officialChart';

const spec = (id: string): LayerSpec => ({ id, type: 'line', source: id, layer: null, paint: {} }) as LayerSpec;

describe('the official CAAI chart as the Israel base', () => {
  it('goes first, below every flight layer, when a pack is installed; nothing changes without one', () => {
    const specs = [spec('a'), spec('b')];
    expect(withIsraelOfficialChart(specs, true).map((s) => s.id)).toEqual([ISRAEL_OFFICIAL_CHART_LAYER.id, 'a', 'b']);
    expect(withIsraelOfficialChart(specs, false)).toBe(specs);
  });

  it('hides the vector CVFR layers it duplicates: with the chart only closures and the point tap targets stay on', () => {
    const before: MapLayer[] = ['sectional', 'airports', ...CVFR_CHART_LAYERS];
    const on = withOfficialChartDefaults(before, true);
    expect(on).toEqual(expect.arrayContaining(['sectional', 'airports', 'cvfrClosures', 'cvfrPoints']));
    for (const l of CVFR_CHART_LAYERS) if (l !== 'cvfrClosures' && l !== 'cvfrPoints') expect(on).not.toContain(l);
  });

  it('removing the pack brings the whole vector chart back as the fallback', () => {
    const on = withOfficialChartDefaults(['airports', 'cvfrClosures', 'cvfrPoints'], false);
    expect(on).toEqual(expect.arrayContaining(['airports', ...CVFR_CHART_LAYERS]));
  });

  it('keeps the layers that are not CVFR chart layers, in order, without duplicates', () => {
    const out = withOfficialChartDefaults(['ownship', 'cvfrPoints', 'tfrs'], true);
    expect(out.filter((l) => l === 'cvfrPoints')).toHaveLength(1);
    expect(out.slice(0, 2)).toEqual(['ownship', 'tfrs']);
  });
});
