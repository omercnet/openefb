// The Now row's clock (LogStackView.swift nowRow: TimelineView(.periodic(from: .now, by: 1)) ages the last fix once a
// second so a stale ETE is never shown as current). Local to the row: nothing else re-renders on a tick.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** A fixed time (epoch ms) for tests and captures; null lets `useNow` tick by itself. */
const NowContext = createContext<number | null>(null);

/** Fixes the clock of every `useNow` below it. */
export function NowProvider({ value, children }: { value: number; children: ReactNode }) {
  return <NowContext.Provider value={value}>{children}</NowContext.Provider>;
}

/** In the background or inactive (app switcher, a call) nothing is on screen to age; 'unknown' at launch counts as active. */
const isForeground = (state: AppStateStatus | string | null | undefined) =>
  state !== 'background' && state !== 'inactive';

/**
 * The current time, epoch ms, updated every `intervalMs` while the app is in the foreground; the provided time under a
 * NowProvider (then no interval). The interval pauses in the background (background location keeps the JS running while
 * recording) and on return the time is taken at once, so an ETE from an old fix is not shown as current for up to a tick.
 */
export function useNow(intervalMs = 1000): number {
  const fixed = useContext(NowContext);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (fixed != null) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      id ??= setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (id != null) clearInterval(id);
      id = null;
    };
    if (isForeground(AppState.currentState)) start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (!isForeground(state)) return stop();
      setNow(Date.now());
      start();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [fixed, intervalMs]);
  return fixed ?? now;
}
