// The Layers column's slice: the AppState / MapViewModel / OfflineMapService fields LayersColumnView.swift reads. The
// column writes the user choices (display mode, orientation, visible layers, opacity, diagrams) into it; I1 subscribes
// and drives the map, and feeds the data ages and statuses. The fixture reproduces app/reference/ipad-layers.png.
// I1 feeds it with `layers.store.setState(partial)` (merge), never `replace`: the slice carries its callbacks. `now`
// must tick (a minute tick is enough) or the data ages never advance.
import type { FreshnessLevel } from '../../../domain/core/freshness';
import type { MapLayer, MapMode } from '../../../domain/core/types';
import type { DisplayMode } from '../../../domain/displayMode';
import { createStoreContext } from '../../state/storeContext';
import type { OfflineStatus } from './logic';

/** The NOTAM feed behind the Israel CVFR route closures (IsraelChartOverlay.closureStatus). */
export type ClosureStatus =
  { kind: 'noFeed' } | { kind: 'loaded'; generatedAt: number; level: FreshnessLevel; closed: number };

export interface LayersData {
  displayMode: DisplayMode;
  mapMode: MapMode;
  visibleLayers: readonly MapLayer[];
  /** AirportDiagramOverlay.isEnabled (FAA or CAAI diagrams at zoom 14 and closer). */
  airportDiagrams: boolean;
  /** 0...1. */
  sectionalOpacity: number;
  offlineStatus: OfflineStatus;
  /** End of the current FAA sectional cycle, epoch ms. */
  sectionalCycleExpires: number;
  /** MapViewModel.chartExpirationDate, epoch ms. */
  chartExpiration: number | null;
  /** Epoch ms of the last TFR / AIRMET-SIGMET fetch, null until one succeeds. */
  tfrFetchedAt: number | null;
  tfrLoadFailed: boolean;
  advisoriesFetchedAt: number | null;
  advisoriesLoadFailed: boolean;
  /** Oldest METAR observation on the map, epoch ms. */
  oldestWeatherObservation: number | null;
  closureStatus: ClosureStatus;
  /** Clock for the data ages, epoch ms (the domain never reads the clock). */
  now: number;
  retryTfrs: () => void;
  retryAdvisories: () => void;
}

const NOW = Date.UTC(2026, 10, 12, 0, 35); // 4:35 PM PST, 11 Nov 2026

export const layers = createStoreContext<LayersData>({
  displayMode: 'day',
  mapMode: 'northUp',
  visibleLayers: ['sectional', 'tfrs', 'weatherDots', 'route', 'ownship'],
  airportDiagrams: true,
  sectionalOpacity: 0.7,
  offlineStatus: 'notDownloaded',
  sectionalCycleExpires: Date.UTC(2026, 11, 24, 9, 1),
  chartExpiration: Date.UTC(2026, 11, 24, 9, 1),
  tfrFetchedAt: NOW - 20_000,
  tfrLoadFailed: false,
  advisoriesFetchedAt: null,
  advisoriesLoadFailed: false,
  oldestWeatherObservation: NOW - 48 * 60_000,
  closureStatus: { kind: 'noFeed' },
  now: NOW,
  retryTfrs: () => {},
  retryAdvisories: () => {},
});
