import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { PackStore } from '../../domain/settings/packStores';
import { createSettingsStore, type SettingsDeps, type SettingsState } from './settingsStore';

/**
 * The Settings view model for one mounted screen. `deps` must keep its identity while the screen is mounted. Loads on
 * mount; call `load()` again when the screen comes back into view.
 */
export function useSettings(deps: SettingsDeps): SettingsState {
  const [store] = useState(() => createSettingsStore(deps));
  useEffect(() => {
    void store.getState().load();
  }, [store]);
  return useStore(store);
}

/** A pack store's current state, asking the server for the latest edition once on mount (`.task { await store.refresh() }`). */
export function usePackState<S>(store: PackStore<S>): S {
  useEffect(() => {
    // refresh() reports failures through the state (checkFailed, errorMessage); a rejection must not become an unhandled one.
    store.refresh().catch(() => undefined);
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
