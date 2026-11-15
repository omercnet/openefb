import type { MapLayer } from '../../domain/core';
import type { MapDataSnapshot } from '../../domain/map/mapDataController';
import { currentSectionalCycle } from '../../domain/offline/layers';
import { layers } from '../columns/layers/store';
import { bindLayers, LAYERS_NOW_TICK_MS, type LayersController } from './layersFeed';

function fakeController(initial: MapLayer[]) {
  let snapshot = {
    visibleLayers: new Set<MapLayer>(initial),
    tfrFetchedAt: null,
    tfrLoadFailed: false,
    advisoriesFetchedAt: null,
    advisoriesLoadFailed: false,
    oldestWeatherObservationTime: null,
  } as unknown as MapDataSnapshot;
  const listeners = new Set<() => void>();
  const toggled: MapLayer[] = [];
  const controller: LayersController = {
    getSnapshot: () => snapshot,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    toggleLayer: async (layer) => {
      toggled.push(layer);
      const next = new Set(snapshot.visibleLayers);
      if (!next.delete(layer)) next.add(layer);
      change({ visibleLayers: next });
    },
    loadTFRs: jest.fn(async () => undefined),
    loadAdvisories: jest.fn(async () => undefined),
  };
  const change = (patch: Partial<MapDataSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of [...listeners]) l();
  };
  return { controller, toggled, change };
}

describe('bindLayers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts the column on the controller layers and fetch times', () => {
    const store = layers.make();
    const { controller } = fakeController(['sectional', 'ownship']);
    const stop = bindLayers(controller, store, () => 777);
    expect(store.getState().visibleLayers.toSorted()).toEqual(['ownship', 'sectional']);
    expect(store.getState().now).toBe(777);
    stop();
  });

  it('a switch in the column toggles exactly the changed layer on the controller', () => {
    const store = layers.make();
    const { controller, toggled } = fakeController(['sectional', 'ownship']);
    const stop = bindLayers(controller, store, Date.now);
    store.setState({ visibleLayers: ['sectional', 'ownship', 'tfrs'] });
    store.setState({ visibleLayers: ['ownship', 'tfrs'] });
    expect(toggled).toEqual(['tfrs', 'sectional']);
    expect(store.getState().visibleLayers.toSorted()).toEqual(['ownship', 'tfrs']);
    stop();
  });

  it('the data ages and failures follow the controller', () => {
    const store = layers.make();
    const { controller, change } = fakeController(['tfrs']);
    const stop = bindLayers(controller, store, Date.now);
    change({ tfrFetchedAt: 42, tfrLoadFailed: true, oldestWeatherObservationTime: 7 });
    expect(store.getState()).toMatchObject({ tfrFetchedAt: 42, tfrLoadFailed: true, oldestWeatherObservation: 7 });
    stop();
  });

  it('Retry reloads the product; the clock ticks each minute; stop detaches', () => {
    const store = layers.make();
    let now = 1;
    const { controller, toggled } = fakeController(['tfrs']);
    const stop = bindLayers(controller, store, () => now);
    store.getState().retryTfrs();
    store.getState().retryAdvisories();
    expect(controller.loadTFRs).toHaveBeenCalledTimes(1);
    expect(controller.loadAdvisories).toHaveBeenCalledTimes(1);
    now = Date.UTC(2027, 5, 1);
    jest.advanceTimersByTime(LAYERS_NOW_TICK_MS);
    expect(store.getState().now).toBe(now);
    // The chart cycle follows the clock (MapViewModel.chartExpirationDate), not the launch time.
    expect(store.getState().chartExpiration).toBe(currentSectionalCycle(now).expires);
    stop();
    store.setState({ visibleLayers: ['sectional'] });
    expect(toggled).toEqual([]);
  });

  it('starts with the chart cycle of the clock, not the launch default', () => {
    const store = layers.make();
    const { controller } = fakeController(['tfrs']);
    const at = Date.UTC(2027, 5, 1);
    const stop = bindLayers(controller, store, () => at);
    expect(store.getState().chartExpiration).toBe(currentSectionalCycle(at).expires);
    expect(store.getState().sectionalCycleExpires).toBe(currentSectionalCycle(at).expires);
    stop();
  });
});
