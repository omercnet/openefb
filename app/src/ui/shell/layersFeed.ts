// Keeps the Layers column and the map data controller in step (Swift: both read AppState.visibleLayers and the map view
// model's fetch times). The column writes the pilot's choices into the slice; the controller owns the layer set and the
// data ages. Each side only follows the other when the layer sets differ, so the two never loop.
import type { StoreApi } from 'zustand';
import type { MapLayer } from '../../domain/core';
import type { MapDataSnapshot } from '../../domain/map/mapDataController';
import { currentSectionalCycle } from '../../domain/offline/layers';
import type { LayersData } from '../columns/layers/store';

export interface LayersController {
  getSnapshot(): MapDataSnapshot;
  subscribe(listener: () => void): () => void;
  toggleLayer(layer: MapLayer): Promise<void>;
  loadTFRs(): Promise<void>;
  loadAdvisories(): Promise<void>;
}

/** The clock for the data ages: a minute tick is enough (the slice's contract). */
export const LAYERS_NOW_TICK_MS = 60_000;

const sameSet = (a: ReadonlySet<MapLayer>, b: readonly MapLayer[]): boolean =>
  a.size === b.length && b.every((l) => a.has(l));

export function bindLayers(controller: LayersController, store: StoreApi<LayersData>, clock: () => number): () => void {
  // MapViewModel.chartExpirationDate is SectionalCycle.current(at: now).expires: it follows the clock across a cycle change.
  const clockState = (): Partial<LayersData> => {
    const now = clock();
    const expires = currentSectionalCycle(now).expires;
    return { now, sectionalCycleExpires: expires, chartExpiration: expires };
  };
  const fromController = () => {
    const s = controller.getSnapshot();
    store.setState({
      visibleLayers: [...s.visibleLayers],
      tfrFetchedAt: s.tfrFetchedAt,
      tfrLoadFailed: s.tfrLoadFailed,
      advisoriesFetchedAt: s.advisoriesFetchedAt,
      advisoriesLoadFailed: s.advisoriesLoadFailed,
      oldestWeatherObservation: s.oldestWeatherObservationTime,
    });
  };
  fromController();
  store.setState({
    ...clockState(), // not only on the first tick: at a cycle boundary the column must not start a minute behind
    retryTfrs: () => void controller.loadTFRs(),
    retryAdvisories: () => void controller.loadAdvisories(),
  });

  const stopController = controller.subscribe(fromController);
  const stopStore = store.subscribe((state) => {
    const current = controller.getSnapshot().visibleLayers;
    if (sameSet(current, state.visibleLayers)) return;
    const wanted = new Set(state.visibleLayers);
    for (const layer of new Set([...current, ...wanted])) {
      if (current.has(layer) !== wanted.has(layer)) void controller.toggleLayer(layer);
    }
  });
  const tick = setInterval(() => store.setState(clockState()), LAYERS_NOW_TICK_MS);
  return () => {
    stopController();
    stopStore();
    clearInterval(tick);
  };
}
