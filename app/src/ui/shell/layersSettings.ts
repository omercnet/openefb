// The Layers column's persisted choices: orientation and sectional opacity live in the user settings row (UserSettings
// defaultMapMode, sectionalOpacity); the display mode in a small preference (Swift: UserDefaults "displayMode").
import type { StoreApi } from 'zustand';
import type { Db } from '../../data/db';
import { settingsRepository } from '../../data/repositories';
import { MAP_MODES, type MapMode } from '../../domain/core';
import { DISPLAY_MODE_DEFAULTS_KEY, DISPLAY_MODES, type DisplayMode } from '../../domain/displayMode';
import type { TextStorage } from '../../services/ports';
import type { LayersData } from '../columns/layers/store';

export type LayerSettings = Pick<LayersData, 'displayMode' | 'mapMode' | 'sectionalOpacity'>;

const STORAGE_KEY = `Preferences/${DISPLAY_MODE_DEFAULTS_KEY}`;

/** AppState's defaults: auto display mode, north up, 70% sectional. A value that cannot be read falls back to its default. */
export const DEFAULT_LAYER_SETTINGS: LayerSettings = { displayMode: 'auto', mapMode: 'northUp', sectionalOpacity: 0.7 };

export async function loadLayerSettings(db: Db, storage: TextStorage): Promise<LayerSettings> {
  const result = { ...DEFAULT_LAYER_SETTINGS };
  try {
    const row = await settingsRepository(db).get();
    if (row) {
      if ((MAP_MODES as readonly string[]).includes(row.defaultMapMode)) result.mapMode = row.defaultMapMode as MapMode;
      if (Number.isFinite(row.sectionalOpacity) && row.sectionalOpacity >= 0 && row.sectionalOpacity <= 1) {
        result.sectionalOpacity = row.sectionalOpacity;
      }
    }
  } catch {
    // keep the defaults
  }
  try {
    const raw = await storage.read(STORAGE_KEY);
    if (raw && (DISPLAY_MODES as readonly string[]).includes(raw)) result.displayMode = raw as DisplayMode;
  } catch {
    // keep the default
  }
  return result;
}

/** Writes each change of the three values back; failures are logged, never thrown into the UI. */
export function persistLayerSettings(
  store: StoreApi<LayersData>,
  db: Db,
  storage: TextStorage,
  log: (message: string) => void = () => undefined,
): () => void {
  let last = store.getState();
  return store.subscribe((state) => {
    const previous = last;
    last = state;
    if (state.displayMode !== previous.displayMode) {
      storage.write(STORAGE_KEY, state.displayMode).catch((e) => log(`Could not save the display mode: ${String(e)}`));
    }
    if (state.mapMode !== previous.mapMode || state.sectionalOpacity !== previous.sectionalOpacity) {
      settingsRepository(db)
        .update({ defaultMapMode: state.mapMode, sectionalOpacity: state.sectionalOpacity })
        .catch((e) => log(`Could not save the map settings: ${String(e)}`));
    }
  });
}
