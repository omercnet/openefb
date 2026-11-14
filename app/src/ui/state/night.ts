import { createContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { Coordinate } from '../../domain/core';
import { DisplayModeResolver, type DisplayMode } from '../../domain/displayMode';

/** The live app's resolved display mode (AppState.displayMode with the sun at ownship). Null: the screen decides (capture routes). */
export const NightContext = createContext<boolean | null>(null);

/** AppState.displayMode resolved now: day and night are fixed, auto follows the sun at ownship (re-evaluated every minute). */
export function useIsNight(mode: DisplayMode, ownship: Coordinate | null, tickMs = 60_000): boolean {
  const systemIsDark = useColorScheme() === 'dark';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (mode !== 'auto') return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [mode, tickMs]);
  return DisplayModeResolver.isNight({ mode, systemIsDark, coordinate: ownship, date: now });
}
