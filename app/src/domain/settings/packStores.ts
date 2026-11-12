// The chart-pack stores as Settings > Region (Israel) sees them. S1 ports IsraelChartStore and IsraelDiagramStore; these
// are the slices the rows use, named after the Swift members so the S1 ports can satisfy them directly. The fakes drive
// tests, the screenshot fixtures and the web preview.
import type { IsraelChartPackState, IsraelDiagramPackState } from './israelPacks';

export interface PackStore<S> {
  /** The current state. The same object until something changes (React reads it through useSyncExternalStore). */
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
  /** Asks the server for the latest edition (`refresh()` in Swift). */
  refresh(): Promise<void>;
}

export interface IsraelChartStoreLike extends PackStore<IsraelChartPackState> {
  startDownload(): void;
  pauseDownload(): void;
  remove(): void;
}

export interface IsraelDiagramStoreLike extends PackStore<IsraelDiagramPackState> {
  startDownload(): void;
}

function fakeStore<S extends object>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  return {
    calls,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Test control: change part of the state and notify. */
    set(patch: Partial<S>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    record: (call: string) => void calls.push(call),
  };
}

export function createFakeChartStore(initial: IsraelChartPackState) {
  const s = fakeStore(initial);
  return {
    calls: s.calls,
    getSnapshot: s.getSnapshot,
    subscribe: s.subscribe,
    set: s.set,
    refresh() {
      s.record('refresh');
      return Promise.resolve();
    },
    startDownload: () => s.record('startDownload'),
    pauseDownload: () => s.record('pauseDownload'),
    remove: () => s.record('remove'),
  } satisfies IsraelChartStoreLike & { calls: string[]; set: (patch: Partial<IsraelChartPackState>) => void };
}

export function createFakeDiagramStore(initial: IsraelDiagramPackState) {
  const s = fakeStore(initial);
  return {
    calls: s.calls,
    getSnapshot: s.getSnapshot,
    subscribe: s.subscribe,
    set: s.set,
    refresh() {
      s.record('refresh');
      return Promise.resolve();
    },
    startDownload: () => s.record('startDownload'),
  } satisfies IsraelDiagramStoreLike & { calls: string[]; set: (patch: Partial<IsraelDiagramPackState>) => void };
}
