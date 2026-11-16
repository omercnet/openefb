// What Settings reads and changes on the real device (SettingsView.swift's environment): the user database, the keychain,
// the aviation databases, the chart packs, the remote configuration and the telemetry choice. The screen and its store are
// ui/screens/SettingsScreen and ui/state/settingsStore; this builds their services from the runtime.
import Constants from 'expo-constants';
import { createSecretStore } from '../../adapters/secretStore';
import { fallbackDataAttribution, type Region } from '../../domain/core/region';
import { errorDescription } from '../../domain/core/errorInfo';
import { DISPLAY_MODE_DEFAULTS_KEY, type DisplayMode } from '../../domain/displayMode';
import type { Preferences } from '../../domain/ports/preferences';
import { currentSectionalCycle } from '../../domain/offline/layers';
import { formatFileSize } from '../../domain/settings/settingsFormat';
import { userDataFromDb } from '../../domain/userData';
import type { TextStorage } from '../../services/ports';
import type { SettingsServices } from '../state/settingsStore';
import { israelChartStoreLike, israelDiagramStoreLike } from './chartPacks';
import type { AppRuntime } from './runtime';

/** Where the display mode lives for the map (layersSettings.ts): Settings must read and write the same place. */
const DISPLAY_MODE_FILE_KEY = `Preferences/${DISPLAY_MODE_DEFAULTS_KEY}`;

/**
 * The preferences Settings uses. Everything is the key-value store (the onboarding flag, the telemetry choice) except the
 * display mode, which the Layers column and the map read from the text storage: one value, one place.
 */
export function settingsPreferences(kv: Preferences, files: TextStorage): Preferences {
  const routed = (key: string) => key === DISPLAY_MODE_DEFAULTS_KEY;
  return {
    get: (key) => (routed(key) ? files.read(DISPLAY_MODE_FILE_KEY) : kv.get(key)),
    set: (key, value) => (routed(key) ? files.write(DISPLAY_MODE_FILE_KEY, value) : kv.set(key, value)),
    remove: (key) => (routed(key) ? files.remove(DISPLAY_MODE_FILE_KEY) : kv.remove(key)),
  };
}

export interface SettingsServicesDeps {
  runtime: AppRuntime;
  files: TextStorage;
  /** AppState.region follows (the shell reloads the map for it). */
  /** The region was saved: the shell restarts the live app on it. */
  onRegionSaved: (region: Region) => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  now?: () => number;
}

export function createSettingsServices(deps: SettingsServicesDeps): SettingsServices {
  const { runtime } = deps;
  const { started } = runtime;
  const now = deps.now ?? Date.now;
  const remote = started.remoteConfig;
  return {
    userData: userDataFromDb(started.userDb),
    secrets: createSecretStore(),
    prefs: settingsPreferences(runtime.preferences, deps.files),
    loadDataCycle: () => (started.aviation ? started.aviation.dataCycle() : Promise.resolve(null)),
    dataAttribution: async (region) => {
      if (region === 'israel' && started.israel) {
        const { attribution } = await started.israel.metadata();
        if (attribution) return attribution;
      }
      return fallbackDataAttribution(region);
    },
    regionDataUnavailable: async (region) => {
      const open = region === 'israel' ? started.israel !== null : started.aviation !== null;
      return open ? null : errorDescription({ kind: 'regionDataUnavailable', region });
    },
    // The rejection reaches Settings: an opt-out whose backlog could not be cleared must not read as saved.
    setTelemetryEnabled: (enabled) => runtime.telemetry.setEnabled(enabled),
    onRegionSaved: deps.onRegionSaved,
    onDisplayModeChange: deps.onDisplayModeChange,
    now,
    appInfo: { version: Constants.expoConfig?.version ?? '1.0.0', build: Constants.nativeBuildVersion ?? '1' },
    // Read live: the store changes after a check, and the screen keeps this object for as long as it is open.
    remoteConfig: {
      get sourceDescription() {
        return remote ? remote.sourceDescription : 'Built-in';
      },
      get updateRequest() {
        const request = remote?.updateRequest ?? null;
        return request ? { kind: request.kind, text: request.message } : null;
      },
      get ignored() {
        return remote?.active?.ignored ?? [];
      },
      get lastError() {
        return remote?.lastError ?? null;
      },
    },
    sectionalCycleExpires: (at) => currentSectionalCycle(at).expires,
    formatBytes: formatFileSize,
    israelChart: israelChartStoreLike(runtime.chartPacks.israelChart),
    israelDiagrams: israelDiagramStoreLike(runtime.chartPacks.israelDiagrams),
  };
}
