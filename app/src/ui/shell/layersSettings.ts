// The Layers column's persisted choices: the display mode and the airport diagrams switch, in small preferences (Swift:
// UserDefaults "displayMode", AppState.swift:75-77, and "showAirportDiagrams", AirportDiagramOverlay.swift:30). Orientation and sectional opacity stay in memory and reset to north up and 70% at every launch,
// as in Swift (UserSettings.defaultMapMode/sectionalOpacity are never read by the app).
import type { StoreApi } from 'zustand';
import type { Db } from '../../data/db';
import { DISPLAY_MODE_DEFAULTS_KEY, DISPLAY_MODES, type DisplayMode } from '../../domain/displayMode';
import type { TextStorage } from '../../services/ports';
import type { LayersData } from '../columns/layers/store';

export type LayerSettings = Pick<LayersData, 'displayMode' | 'mapMode' | 'sectionalOpacity' | 'airportDiagrams'>;

const STORAGE_KEY = `Preferences/${DISPLAY_MODE_DEFAULTS_KEY}`;
/** Swift AirportDiagramOverlay.enabledDefaultsKey: on unless the pilot switched it off. */
const DIAGRAMS_KEY = 'Preferences/showAirportDiagrams';

/** AppState's defaults: auto display mode, north up, 70% sectional. A value that cannot be read falls back to its default. */
export const DEFAULT_LAYER_SETTINGS: LayerSettings = {
  displayMode: 'auto',
  mapMode: 'northUp',
  sectionalOpacity: 0.7,
  airportDiagrams: true,
};

export async function loadLayerSettings(
  _db: Db,
  storage: TextStorage,
  log: (message: string) => void = () => undefined,
): Promise<LayerSettings> {
  const result = { ...DEFAULT_LAYER_SETTINGS };
  try {
    const raw = await storage.read(STORAGE_KEY);
    if (raw && (DISPLAY_MODES as readonly string[]).includes(raw)) result.displayMode = raw as DisplayMode;
  } catch (error) {
    log(`Could not read the display mode, using auto: ${String(error)}`); // an I/O failure, not a missing preference
  }
  try {
    const raw = await storage.read(DIAGRAMS_KEY);
    if (raw === 'true' || raw === 'false') result.airportDiagrams = raw === 'true';
  } catch (error) {
    log(`Could not read the diagrams switch, using on: ${String(error)}`);
  }
  return result;
}

/** Writes each change of the display mode and the diagrams switch back; failures are logged, never thrown into the UI. */
export function persistLayerSettings(
  store: StoreApi<LayersData>,
  _db: Db,
  storage: TextStorage,
  log: (message: string) => void = () => undefined,
): () => void {
  let last = store.getState();
  // Saves share one temp file in the storage: each starts after the previous one has settled.
  let chain: Promise<void> = Promise.resolve();
  return store.subscribe((state) => {
    const previous = last;
    last = state;
    if (state.displayMode !== previous.displayMode) {
      const mode = state.displayMode;
      chain = chain.then(() =>
        storage.write(STORAGE_KEY, mode).catch((e) => log(`Could not save the display mode: ${String(e)}`)),
      );
    }
    if (state.airportDiagrams !== previous.airportDiagrams) {
      const on = String(state.airportDiagrams);
      chain = chain.then(() =>
        storage.write(DIAGRAMS_KEY, on).catch((e) => log(`Could not save the diagrams switch: ${String(e)}`)),
      );
    }
  });
}
