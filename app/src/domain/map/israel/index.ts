// Israel overlays for the map (M1): pure feature builders, tap-sheet details, palette and the layer registry.
export {
  ISRAEL_LAYER_SPECS,
  ISRAEL_OFFICIAL_CHART_LAYER,
  ISRAEL_OFFICIAL_CHART_SOURCE_ID,
  ISRAEL_SOURCE_IDS,
  buildIsraelSources,
  israelClosureSources,
  israelLSASources,
  israelOfficialChartOverrides,
  israelOfficialChartUrl,
  loadIsraelChartInput,
  type IsraelChartInput,
  type IsraelLayerOverrides,
} from './layers';
export {
  israelClosureSet,
  israelClosureStatus,
  closureFeatures,
  closureText,
  NO_CLOSURES,
  type IsraelAltitudeLimitInput,
  type IsraelAvailableAltitudeInput,
  type IsraelChartClosureFeature,
  type IsraelChartClosureMark,
  type IsraelChartClosureSet,
  type IsraelClosureMatchInput,
  type IsraelClosureSeverity,
  type IsraelClosureStatus,
  type IsraelRouteClosureInput,
} from './closures';
export {
  airspaceFeatures,
  israelChartDefaultVisibleLayers,
  limitText,
  limitsText,
  segmentFeatures,
  type IsraelChartAirspaceFeature,
  type IsraelChartSegmentFeature,
  type IsraelRouteStyle,
} from './chartFeatures';
export {
  airspaceDetails,
  israelAirspaceSelection,
  israelSelectionFromFeature,
  pointDetail,
  selectionId,
  type IsraelAirspaceDetail,
  type IsraelChartSelection,
  type IsraelPointDetail,
  type IsraelRouteAltitudeRow,
  type IsraelSelectionData,
} from './chartDetails';
export { ISRAEL_DAY_PALETTE, ISRAEL_NIGHT_PALETTE, israelPalette, type IsraelChartPalette } from './style';
export {
  briefingShapes,
  israelBriefingBounds,
  israelBriefingHighlightSource,
  type IsraelBriefingNotamInput,
} from './briefing';
