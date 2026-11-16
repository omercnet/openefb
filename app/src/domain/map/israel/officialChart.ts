// The official CAAI CVFR chart as the Israel base (MapService.swift: the base chart in Israel; IsraelChartOverlay.applyOfficial;
// IsraelChartDefaults). The raster prints routes, points and airspace itself, so the vector layers it duplicates are hidden:
// closures and the point tap targets stay, the rest is off by default and can still be switched on.
import { CVFR_CHART_LAYERS, type MapLayer } from '../../core';
import type { LayerSpec } from '../layerSpec';
import { israelChartDefaultVisibleLayers } from './chartFeatures';
import { ISRAEL_OFFICIAL_CHART_LAYER } from './layers';

/** The chart raster above the street base and below every flight layer; the specs unchanged without a pack. */
export const withIsraelOfficialChart = (specs: readonly LayerSpec[], present: boolean): readonly LayerSpec[] =>
  present ? [ISRAEL_OFFICIAL_CHART_LAYER, ...specs] : specs;

/** The visible layers with the CVFR chart layers set to their defaults for `present` (IsraelChartDefaults.visibleLayers). */
export function withOfficialChartDefaults(layers: readonly MapLayer[], present: boolean): MapLayer[] {
  const chart = new Set<MapLayer>(CVFR_CHART_LAYERS);
  return [...layers.filter((l) => !chart.has(l)), ...israelChartDefaultVisibleLayers(present)];
}
