// Deterministic fakes for the fidelity captures (kanaf-dev://settings and friends) and the web preview. They describe a
// fresh install in Israel: no pilot, nothing downloaded, the chart and diagram editions offered. Real wiring is the shell's.
import Constants from 'expo-constants';
import { fallbackDataAttribution, type Region } from '../../domain/core/region';
import { FakePreferences } from '../../domain/ports/preferences';
import { FakeSecretStore } from '../../domain/ports/secretStore';
import { formatFileSize } from '../../domain/settings/settingsFormat';
import { createFakeChartStore, createFakeDiagramStore } from '../../domain/settings/packStores';
import { createMemoryUserData } from '../../domain/userData/memory';
import type { SettingsServices } from '../state/settingsStore';

const DAY_MS = 86_400_000;

/** The Israel line stored in the bundled database's metadata (Region.dataAttribution). */
const ISRAEL_ATTRIBUTION = 'Aeronautical data: Civil Aviation Authority of Israel (CAAI), data of 25 Oct 2026';

export function captureSettingsServices(): SettingsServices {
  const now = Date.now();
  return {
    userData: createMemoryUserData(),
    secrets: new FakeSecretStore(),
    prefs: new FakePreferences(),
    loadDataCycle: () =>
      Promise.resolve({ source: 'FAA NASR', effectiveMs: now - 10 * DAY_MS, expiresMs: now + 18 * DAY_MS }),
    dataAttribution: (region: Region) =>
      Promise.resolve(region === 'israel' ? ISRAEL_ATTRIBUTION : fallbackDataAttribution(region)),
    regionDataUnavailable: () => Promise.resolve(null),
    setTelemetryEnabled: () => undefined,
    now: () => now,
    appInfo: { version: Constants.expoConfig?.version ?? '1.0.0', build: '1' },
    remoteConfig: { sourceDescription: 'Built-in defaults', updateRequest: null, ignored: [], lastError: null },
    sectionalCycleExpires: () => now + 20 * DAY_MS,
    formatBytes: formatFileSize,
    israelChart: createFakeChartStore({
      status: { kind: 'notDownloaded' },
      latestLabel: 'Update 2/25 (October 2025)',
      offeredBytes: 15_300_000,
      installedBytes: null,
      isChecking: false,
      checkFailed: false,
      downloadProgress: null,
      pausedProgress: null,
      errorMessage: null,
    }),
    israelDiagrams: createFakeDiagramStore({
      pack: null,
      latestLabel: 'AIRAC AMDT 001/2026 (06 AUG 2026)',
      isChecking: false,
      downloadProgress: null,
      errorMessage: null,
      canDownload: true,
    }),
  };
}
