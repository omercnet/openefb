import { act } from 'react';
import { render } from '../../../tests/support/ui';
import type { MapLayer } from '../../domain/core';
import { DataRefreshScheduler } from '../../services/dataRefreshScheduler';
import { REFRESH_TICK_MS, refreshDueData, refreshableMapFor, useDataRefresh, type RefreshableMap } from './refreshDue';

const NOW = 10_000_000_000;
const MIN = 60_000;

function fakeMap(over: Partial<RefreshableMap> = {}) {
  const calls: string[] = [];
  const map: RefreshableMap = {
    region: 'us',
    visibleLayers: new Set<MapLayer>(['weatherDots', 'tfrs', 'advisories']),
    weatherFetchedAt: null,
    tfrFetchedAt: null,
    advisoriesFetchedAt: null,
    loadWeatherDots: async () => (calls.push('weather'), true),
    loadTFRs: async () => (calls.push('tfr'), void (map.tfrFetchedAt = NOW)),
    loadAdvisories: async () => (calls.push('advisories'), void (map.advisoriesFetchedAt = NOW)),
    ...over,
  };
  return { map, calls };
}

const input = { nowMs: NOW, lowPower: false, networkAvailable: true };

describe('refreshDueData (MapViewModel.refreshDueData)', () => {
  it('fetches every layer that is on and never fetched', async () => {
    const { map, calls } = fakeMap();
    await refreshDueData(map, new DataRefreshScheduler(), input);
    expect(calls).toEqual(['weather', 'tfr', 'advisories']);
  });

  it('fetches nothing offline', async () => {
    const { map, calls } = fakeMap();
    await refreshDueData(map, new DataRefreshScheduler(), { ...input, networkAvailable: false });
    expect(calls).toEqual([]);
  });

  it('skips a layer that is off and data younger than its interval', async () => {
    const { map, calls } = fakeMap({
      visibleLayers: new Set<MapLayer>(['weatherDots', 'tfrs']),
      weatherFetchedAt: NOW - 5 * MIN,
      tfrFetchedAt: NOW - 11 * MIN,
    });
    await refreshDueData(map, new DataRefreshScheduler(), input);
    expect(calls).toEqual(['tfr']);
  });

  it('Low Power Mode doubles the intervals', async () => {
    const { map, calls } = fakeMap({ visibleLayers: new Set<MapLayer>(['tfrs']), tfrFetchedAt: NOW - 11 * MIN });
    await refreshDueData(map, new DataRefreshScheduler(), { ...input, lowPower: true });
    expect(calls).toEqual([]);
  });

  it('a TFR layer is not wanted in a region without it (Israel)', async () => {
    const { map, calls } = fakeMap({ region: 'israel', visibleLayers: new Set<MapLayer>(['tfrs']) });
    await refreshDueData(map, new DataRefreshScheduler(), input);
    expect(calls).toEqual([]);
  });

  it('a failed refresh (time unchanged) backs the next attempt off', async () => {
    const scheduler = new DataRefreshScheduler();
    const { map, calls } = fakeMap({
      visibleLayers: new Set<MapLayer>(['tfrs']),
      loadTFRs: async () => void calls.push('tfr'),
    });
    await refreshDueData(map, scheduler, input);
    await refreshDueData(map, scheduler, { ...input, nowMs: NOW + 11 * MIN });
    expect(calls).toEqual(['tfr']); // 2x backoff: 20 minutes after the failed attempt
  });
});

describe('refreshableMapFor', () => {
  it('reads the controller live, so a refresh that moved the time counts as a success (no backoff)', async () => {
    const snapshot = {
      region: 'us' as const,
      visibleLayers: new Set<MapLayer>(['tfrs']),
      weatherFetchedAt: null,
      tfrFetchedAt: null as number | null,
      advisoriesFetchedAt: null,
    };
    const controller = {
      getSnapshot: () => snapshot,
      loadWeatherDots: async () => true,
      loadTFRs: async () => void (snapshot.tfrFetchedAt = NOW),
      loadAdvisories: async () => undefined,
    };
    const scheduler = new DataRefreshScheduler();
    await refreshDueData(refreshableMapFor(controller), scheduler, input);
    // Success: the next refresh is due after the base 10 minutes, not the doubled 20.
    expect(scheduler.interval('tfr', false)).toBe(600);
  });
});

describe('useDataRefresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not start a second run while the previous one is still pending', async () => {
    const gate = Promise.withResolvers<boolean>();
    const loadWeatherDots = jest.fn(() => gate.promise);
    const map: RefreshableMap = {
      ...fakeMap().map,
      visibleLayers: new Set<MapLayer>(['weatherDots']),
      loadWeatherDots,
    };
    function Probe() {
      useDataRefresh(
        () => ({ map, lowPower: false, networkAvailable: true }),
        () => NOW,
      );
      return null;
    }
    await render(<Probe />);
    await act(async () => {
      jest.advanceTimersByTime(REFRESH_TICK_MS * 3);
    });
    expect(loadWeatherDots).toHaveBeenCalledTimes(1);
    gate.resolve(true);
    await act(async () => undefined);
  });
});
