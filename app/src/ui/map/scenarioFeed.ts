// Fixture feed for the fidelity captures and the performance harness (kanaf-dev://map?animate=1 on Android, the
// `-KanafAnimate 1` launch argument on iOS): the KPAO-KOAK scenario ownship, optionally moved along its track at 10 Hz
// for 60 s while JS frame pacing is recorded to the animation result file. Real GPS wiring is I1.
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Settings } from 'react-native';
import { ANIMATION_FILE, writeResult } from '../../adapters/resultFile';
import { makeWeatherCache, type Coordinate, type WeatherCache } from '../../domain/core';
import { scenario } from '../../fixtures/scenario';
import { destination, pacing } from './geo';
import { getCurrentMapStatus } from './mapStatus';
import type { OwnshipInput } from './useMapData';

const { ownship } = scenario;
const ORIGIN: [number, number] = [ownship.lon, ownship.lat];
const UPDATE_MS = 100; // 10 Hz, the SwiftUI app's location update rate
const ANIMATION_MS = 60_000;

export function useAnimateFlag(): boolean {
  const url = Linking.useURL();
  return Platform.OS === 'ios' ? String(Settings.get('KanafAnimate') ?? '') === '1' : /[?&]animate=1\b/.test(url ?? '');
}

/** Scenario ownship; with `animate` it flies the track and writes the pacing result when the minute is up. */
export function useScenarioOwnship(animate: boolean): OwnshipInput {
  const [pos, setPos] = useState<[number, number]>(ORIGIN);
  const [timestamp, setTimestamp] = useState(1);

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    const frames: number[] = []; // requestAnimationFrame deltas, ms
    const updates: number[] = []; // 10 Hz timer deltas, ms
    let lastFrame = start;
    let lastUpdate = start;
    let raf = 0;
    const onFrame = () => {
      const now = performance.now();
      frames.push(now - lastFrame);
      lastFrame = now;
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    const timer = setInterval(() => {
      const now = performance.now();
      updates.push(now - lastUpdate);
      lastUpdate = now;
      // NM flown = knots * hours
      setPos(destination(ORIGIN, (ownship.gsKt * (now - start)) / 3_600_000, ownship.trkDeg));
      setTimestamp((t) => t + 1);
      if (now - start < ANIMATION_MS) return;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      const result = {
        platform: Platform.OS,
        durationMs: Math.round(now - start),
        targetUpdateMs: UPDATE_MS,
        rafDeltaMs: pacing(frames),
        updateDeltaMs: pacing(updates),
        map: getCurrentMapStatus(),
      };
      console.log('SPIKE_ANIM ' + JSON.stringify(result));
      writeResult(ANIMATION_FILE, result).catch((e) => console.warn('animation result write failed', e));
    }, UPDATE_MS);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, [animate]);

  return useMemo<OwnshipInput>(
    () => ({
      position: { lat: pos[1], lon: pos[0] } satisfies Coordinate,
      trackDeg: ownship.trkDeg,
      groundSpeedKt: ownship.gsKt,
      timestamp,
      stale: false,
    }),
    [pos, timestamp],
  );
}

/** Fixture weather: every requested station reads VFR, as the SwiftUI reference screenshots show (green dots). */
export const scenarioWeather = {
  fetchWeatherForStations: async (ids: string[]): Promise<WeatherCache[]> =>
    ids.map((id) => makeWeatherCache({ id, stationID: id, flightCategory: 'vfr', fetchedAt: 0 })),
};
