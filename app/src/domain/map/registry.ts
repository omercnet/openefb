// The full layer registry for a region: the core layers plus, in Israel, the CVFR chart and LSA overlays.
// Israel overlays are drawn after (above) the core flight layers, as IsraelChartOverlay.attach ran after MapService.
import type { Region } from '../core';
import { ISRAEL_LAYER_SPECS, ISRAEL_SOURCE_IDS } from './israel/layers';
import type { LayerSpec } from './layerSpec';
import { CORE_LAYER_SPECS, SOURCE_IDS } from './layers';

export const ALL_SOURCE_IDS: readonly string[] = [...SOURCE_IDS, ...ISRAEL_SOURCE_IDS];

const US_LAYERS: readonly LayerSpec[] = CORE_LAYER_SPECS;
const ISRAEL_LAYERS: readonly LayerSpec[] = [...CORE_LAYER_SPECS, ...ISRAEL_LAYER_SPECS];

/** Stable arrays (same identity per region) so the surface can memoise on them. */
export const layerSpecsFor = (region: Region): readonly LayerSpec[] =>
  region === 'israel' ? ISRAEL_LAYERS : US_LAYERS;
