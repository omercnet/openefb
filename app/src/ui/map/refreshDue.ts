// MapViewModel.refreshDueData: refresh the weather, TFR and AIRMET/SIGMET layers that are on and due, per
// DataRefreshScheduler (interval per product, doubled in Low Power Mode, none offline, backoff after a failure). The
// hook runs it about once a minute while the map is mounted (OverlayStalenessBadges.swift:62 does the same).
import { useEffect, useRef } from 'react';
import { isLayerAvailable, type MapLayer, type Region } from '../../domain/core';
import { DataRefreshScheduler, type RefreshProduct } from '../../services/dataRefreshScheduler';

/** What the refresh needs from the map data controller. */
export interface RefreshableMap {
  region: Region;
  visibleLayers: ReadonlySet<MapLayer>;
  weatherFetchedAt: number | null;
  tfrFetchedAt: number | null;
  advisoriesFetchedAt: number | null;
  loadWeatherDots(): Promise<boolean>;
  loadTFRs(): Promise<void>;
  loadAdvisories(): Promise<void>;
}

export interface RefreshInput {
  nowMs: number;
  lowPower: boolean;
  networkAvailable: boolean;
}

export async function refreshDueData(map: RefreshableMap, scheduler: DataRefreshScheduler, input: RefreshInput) {
  const wanted = new Set<RefreshProduct>();
  if (map.visibleLayers.has('weatherDots')) wanted.add('weather');
  if (map.visibleLayers.has('tfrs') && isLayerAvailable(map.region, 'tfrs')) wanted.add('tfr');
  if (map.visibleLayers.has('advisories') && isLayerAvailable(map.region, 'advisories')) wanted.add('advisories');
  const lastData: Partial<Record<RefreshProduct, number>> = {};
  if (map.weatherFetchedAt !== null) lastData.weather = map.weatherFetchedAt;
  if (map.tfrFetchedAt !== null) lastData.tfr = map.tfrFetchedAt;
  if (map.advisoriesFetchedAt !== null) lastData.advisories = map.advisoriesFetchedAt;

  const due = scheduler.due({ wanted, lastData, nowMs: input.nowMs, lowPower: input.lowPower, networkAvailable: input.networkAvailable });
  for (const product of due) {
    let success: boolean;
    if (product === 'weather') {
      success = await map.loadWeatherDots();
    } else if (product === 'tfr') {
      const before = map.tfrFetchedAt;
      await map.loadTFRs();
      success = map.tfrFetchedAt !== before; // a failed refresh serves the cache, with the old time
    } else {
      const before = map.advisoriesFetchedAt;
      await map.loadAdvisories();
      success = map.advisoriesFetchedAt !== before;
    }
    scheduler.recordAttempt(product, input.nowMs, success);
  }
}

export const REFRESH_TICK_MS = 60_000;

/** Runs `refreshDueData` now and every minute while mounted. `read` returns the live map state and inputs each time. */
export function useDataRefresh(read: () => { map: RefreshableMap } & Omit<RefreshInput, 'nowMs'>, now: () => number = Date.now): void {
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  useEffect(() => {
    const scheduler = new DataRefreshScheduler();
    const run = () => {
      const { map, ...rest } = readRef.current();
      refreshDueData(map, scheduler, { ...rest, nowMs: now() }).catch(() => undefined);
    };
    run();
    const id = setInterval(run, REFRESH_TICK_MS);
    return () => clearInterval(id);
  }, [now]);
}
