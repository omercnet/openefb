import { createContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { Coordinate } from '../../domain/core';
import { layers } from '../columns/layers/store';
import { Day, Night, type Theme } from '../tokens';
import { ownship } from './ownship';
import { DisplayModeResolver, type DisplayMode } from '../../domain/displayMode';

/** The live app's resolved display mode (AppState.displayMode with the sun at ownship). Null: the screen decides (capture routes). */
export const NightContext = createContext<boolean | null>(null);

/** AppState.displayMode resolved now: day and night are fixed, auto follows the sun at ownship (re-evaluated every minute). */
export function useIsNight(mode: DisplayMode, ownship: Coordinate | null, tickMs = 60_000): boolean {
  const systemIsDark = useColorScheme() === 'dark';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (mode !== 'auto') return;
    // The stored time is as old as the last Auto period: re-read it as Auto becomes active, then every tick.
    const refresh = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => {
      clearTimeout(refresh);
      clearInterval(id);
    };
  }, [mode, tickMs]);
  return DisplayModeResolver.isNight({ mode, systemIsDark, coordinate: ownship, date: now });
}

/** The live app's palette: the resolved display mode at ownship. Screens over the map (Log, briefing, chart viewer) use it. */
export function useLiveTheme(): Theme {
  const displayMode = layers.useData((s) => s.displayMode);
  const position = ownship.useData((s) => s.input.position);
  return useIsNight(displayMode, position) ? Night : Day;
}
