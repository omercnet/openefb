// The full layer registry for a region: the core layers plus, in Israel, the CVFR chart and LSA overlays.
// Israel overlays are drawn after (above) the core flight layers, as IsraelChartOverlay.attach ran after MapService.
import type { Region } from '../core';
import { ISRAEL_LAYER_SPECS, ISRAEL_SOURCE_IDS } from './israel/layers';
import type { LayerSpec } from './layerSpec';
import { DIAGRAM_LAYER_SPECS, DIAGRAM_SOURCE_IDS } from '../diagram/layers';
import { CORE_LAYER_SPECS, SOURCE_IDS } from './layers';

export const ALL_SOURCE_IDS: readonly string[] = [...SOURCE_IDS, ...DIAGRAM_SOURCE_IDS, ...ISRAEL_SOURCE_IDS];

/** Airport diagrams sit below the airport dots, above the sectional (AirportDiagramOverlay.add). */
const dots = CORE_LAYER_SPECS.findIndex((s) => s.id === 'airport-circles');
const CORE_WITH_DIAGRAMS: readonly LayerSpec[] = [
  ...CORE_LAYER_SPECS.slice(0, dots),
  ...DIAGRAM_LAYER_SPECS,
  ...CORE_LAYER_SPECS.slice(dots),
];

const US_LAYERS: readonly LayerSpec[] = CORE_WITH_DIAGRAMS;
// IsraelChartOverlay.place inserts each layer below ownship-symbol, and the track ruler and route are raised back above
// them (MapService.raiseRouteLayer). So the Israel layers go right before the ruler: below ownship, and therefore below
// the diagram slots too (what AirportDiagramOverlay.raiseAboveIsraelFills enforced in Swift).
const rulerAt = CORE_WITH_DIAGRAMS.findIndex((s) => s.id === 'track-ruler-line');
const ISRAEL_LAYERS: readonly LayerSpec[] = [
  ...CORE_WITH_DIAGRAMS.slice(0, rulerAt),
  ...ISRAEL_LAYER_SPECS,
  ...CORE_WITH_DIAGRAMS.slice(rulerAt),
];

/** Stable arrays (same identity per region) so the surface can memoise on them. */
export const layerSpecsFor = (region: Region): readonly LayerSpec[] =>
  region === 'israel' ? ISRAEL_LAYERS : US_LAYERS;
