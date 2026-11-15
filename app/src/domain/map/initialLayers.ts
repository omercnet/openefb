// The layers on when the app opens in a region (AppState.visibleLayers default plus AppState.region's didSet, which
// runs when RegionStore.load sets the saved region at launch).
import { CVFR_CHART_LAYERS, metarStationIds, regionSupports, type MapLayer, type Region } from '../core';

const US_DEFAULTS: readonly MapLayer[] = ['sectional', 'airports', 'ownship', 'tfrs'];

export function initialVisibleLayers(region: Region): Set<MapLayer> {
  const layers = new Set<MapLayer>(US_DEFAULTS.filter((l) => regionSupports(region, l)));
  if (region !== 'us') {
    // The region's own METAR stations are the only live data there; the CVFR chart is its chart.
    if (metarStationIds(region).length > 0) layers.add('weatherDots');
    for (const l of CVFR_CHART_LAYERS) if (regionSupports(region, l)) layers.add(l);
  }
  return layers;
}
