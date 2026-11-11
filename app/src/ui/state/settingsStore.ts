import { createStore } from 'zustand';
import type { AviationDataCycle } from '../../data/aviation/types';
import { fallbackDataAttribution, parseRegion, type Region } from '../../domain/core/region';
import { describeError } from '../../domain/describeError';
import { DISPLAY_MODE_DEFAULTS_KEY, DISPLAY_MODES, type DisplayMode } from '../../domain/displayMode';
import { readBool, writeBool, type Preferences } from '../../domain/ports/preferences';
import type { SecretStore } from '../../domain/ports/secretStore';
import {
  loadNotamCredentials,
  removeNotamCredentials,
  saveNotamCredentials,
} from '../../domain/settings/notamCredentials';
import type { IsraelChartStoreLike, IsraelDiagramStoreLike } from '../../domain/settings/packStores';
import { currencyToRenewCount } from '../../domain/settings/settingsFormat';
import type { UserData } from '../../domain/userData';

// View model of Settings (SettingsView.swift): the state its rows show and the actions behind them. The chart-pack rows,
// the about block and the sectional cycle are not here: they read their own stores and constants.

/** `Telemetry.enabledKey`; A5 owns telemetry and reads the same key. */
export const TELEMETRY_ENABLED_KEY = 'telemetryEnabled';

export interface SettingsDeps {
  userData: UserData;
  secrets: SecretStore;
  prefs: Preferences;
  /** AviationDatabase.dataCycle(). A rejection reads as an unknown cycle (Swift `try?`). */
  loadDataCycle(): Promise<AviationDataCycle | null>;
  /** Region.dataAttribution: Israel reads it from the bundled database's metadata. A rejection uses the fallback text. */
  dataAttribution(region: Region): Promise<string>;
  /** Region.dataUnavailableError: why the region's bundled data cannot be opened, or null. */
  regionDataUnavailable(region: Region): Promise<string | null>;
  /** Telemetry.setEnabled(enabled, region) (A5). */
  setTelemetryEnabled(enabled: boolean, region: Region): void;
  /** AppState.region and AppState.displayMode follow. Called at once, before the change is saved. Must not throw. */
  onRegionChange?(region: Region): void;
  onDisplayModeChange?(mode: DisplayMode): void;
  now(): number;
}

/** Settings > About: the running build. */
export interface AppInfo {
  version: string;
  build: string;
}

/** RemoteConfigStore as the About block reads it (S1). */
export interface RemoteConfigStatus {
  /** `sourceDescription` */
  sourceDescription: string;
  /** `updateRequest`: a required or recommended update, with its text. */
  updateRequest: { kind: 'required' | 'recommended'; text: string } | null;
  /** `active?.ignored`: values in the configuration file that were not accepted. */
  ignored: readonly string[];
  /** `lastError` */
  lastError: string | null;
}

/** Everything the Settings screen needs. The app shell builds the real one (I1); tests and screenshots use fakes. */
export interface SettingsServices extends SettingsDeps {
  appInfo: AppInfo;
  remoteConfig: RemoteConfigStatus;
  /** SectionalCycle.current().expires (offline maps, M3). */
  sectionalCycleExpires(now: number): number;
  /** OfflineSizeFormatter.string(bytes:) (offline maps, M3). */
  formatBytes(bytes: number): string;
  israelChart: IsraelChartStoreLike;
  israelDiagrams: IsraelDiagramStoreLike;
}

export interface NotamState {
  clientID: string;
  clientSecret: string;
  configured: boolean;
  message: string | null;
}

export interface SettingsState {
  /** True once the first load finished; the pickers wait for it. */
  loaded: boolean;
  region: Region;
  displayMode: DisplayMode;
  shareUsageData: boolean;
  dataAttribution: string;
  regionDataError: string | null;
  /** "Region changed, but it could not be saved: ..." */
  regionSaveError: string | null;
  /** A display-mode or privacy change that could not be saved (JS-only: Swift's AppStorage cannot fail). */
  preferenceError: string | null;
  /** Something that could not be read at load (JS-only; Swift reads with try? and shows defaults). */
  loadError: string | null;
  /** Medical, flight review and night currency of the active pilot that are not current. */
  currencyToRenew: number;
  dataCycle: AviationDataCycle | null;
  notam: NotamState;
  /** Reads everything again (also when the screen comes back into view). Runs after earlier actions finish. */
  load(): Promise<void>;
  setRegion(region: Region): Promise<void>;
  setDisplayMode(mode: DisplayMode): Promise<void>;
  setShareUsageData(enabled: boolean): Promise<void>;
  setNotamClientID(text: string): void;
  setNotamClientSecret(text: string): void;
  saveNotamKey(): Promise<void>;
  removeNotamKey(): Promise<void>;
}

/** Button("Save Key").disabled: both values must be non-blank after trimming. */
export const canSaveNotamKey = (n: Pick<NotamState, 'clientID' | 'clientSecret'>): boolean =>
  n.clientID.trim() !== '' && n.clientSecret.trim() !== '';

/** Runs an app-level notification; a throw is returned, not propagated, so it cannot undo the change that caused it. */
function notify(call: () => void): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return describeError(error);
  }
}

export function createSettingsStore(deps: SettingsDeps) {
  // Everything that reads or writes storage runs here, one job at a time in call order, so a slow earlier write can never
  // land after a later one and a load cannot overwrite a change made while it was reading.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.then(undefined, () => undefined);
    return run;
  };

  const attributionFor = (region: Region): Promise<string> =>
    deps.dataAttribution(region).catch(() => fallbackDataAttribution(region));
  const unavailableFor = (region: Region): Promise<string | null> =>
    deps.regionDataUnavailable(region).catch(describeError);

  return createStore<SettingsState>()((set, get) => {
    const setNotam = (patch: Partial<NotamState>) => set((s) => ({ notam: { ...s.notam, ...patch } }));

    /** Saves a preference and records the failure next to the setting that changed. */
    const persist = async (write: () => Promise<void>, applyFailure: string | null) => {
      try {
        await write();
        set({ preferenceError: applyFailure && `Changed, but the app could not apply it: ${applyFailure}` });
      } catch (error) {
        set({ preferenceError: `Changed, but it could not be saved: ${describeError(error)}` });
      }
    };

    return {
      loaded: false,
      region: parseRegion(undefined),
      displayMode: 'auto',
      shareUsageData: true,
      dataAttribution: fallbackDataAttribution(parseRegion(undefined)),
      regionDataError: null,
      regionSaveError: null,
      preferenceError: null,
      loadError: null,
      currencyToRenew: 0,
      dataCycle: null,
      notam: { clientID: '', clientSecret: '', configured: false, message: null },

      load: () =>
        enqueue(async () => {
          const problems: string[] = [];
          const read = async <T>(source: () => Promise<T>, fallback: T): Promise<T> => {
            try {
              return await source();
            } catch (error) {
              problems.push(describeError(error));
              return fallback;
            }
          };
          const row = await read(() => deps.userData.settings.get(), null);
          const region = parseRegion(row?.regionRaw);
          const rawMode = await read(() => deps.prefs.get(DISPLAY_MODE_DEFAULTS_KEY), null);
          // Unreadable reads as off: a privacy choice must not come back on because storage failed.
          const share = await read(() => readBool(deps.prefs, TELEMETRY_ENABLED_KEY, true), false);
          const credentials = await read(() => loadNotamCredentials(deps.secrets), null);
          const pilots = await read(() => deps.userData.pilots.list(), []);
          const cycle = await deps.loadDataCycle().catch(() => null);
          set({
            loaded: true,
            region,
            displayMode: DISPLAY_MODES.find((m) => m === rawMode) ?? 'auto',
            shareUsageData: share,
            dataAttribution: await attributionFor(region),
            regionDataError: await unavailableFor(region),
            currencyToRenew: currencyToRenewCount(pilots.find((p) => p.isActive) ?? null, deps.now()),
            dataCycle: cycle,
            loadError: problems.length > 0 ? problems.join('; ') : null,
            notam: {
              ...get().notam,
              clientID: credentials?.clientID ?? '',
              clientSecret: credentials?.clientSecret ?? '',
              configured: credentials !== null,
            },
          });
        }),

      setRegion: (region) => {
        if (region === get().region) return Promise.resolve(); // guard newRegion != appState.region
        set({ region });
        const applyFailure = notify(() => deps.onRegionChange?.(region));
        return enqueue(async () => {
          let message: string | null =
            applyFailure && `Region changed, but the app could not apply it: ${applyFailure}`;
          try {
            await deps.userData.settings.update({ regionRaw: region });
          } catch (error) {
            message = `Region changed, but it could not be saved: ${describeError(error)}`;
          }
          set({
            regionSaveError: message,
            dataAttribution: await attributionFor(region),
            regionDataError: await unavailableFor(region),
          });
        });
      },

      setDisplayMode: (mode) => {
        set({ displayMode: mode });
        const applyFailure = notify(() => deps.onDisplayModeChange?.(mode));
        return enqueue(() => persist(() => deps.prefs.set(DISPLAY_MODE_DEFAULTS_KEY, mode), applyFailure));
      },

      setShareUsageData: (enabled) => {
        set({ shareUsageData: enabled });
        const applyFailure = notify(() => deps.setTelemetryEnabled(enabled, get().region));
        return enqueue(() => persist(() => writeBool(deps.prefs, TELEMETRY_ENABLED_KEY, enabled), applyFailure));
      },

      setNotamClientID: (clientID) => setNotam({ clientID }),
      setNotamClientSecret: (clientSecret) => setNotam({ clientSecret }),

      saveNotamKey: () => {
        if (!canSaveNotamKey(get().notam)) return Promise.resolve();
        const credentials = { clientID: get().notam.clientID.trim(), clientSecret: get().notam.clientSecret.trim() };
        return enqueue(async () => {
          try {
            await saveNotamCredentials(deps.secrets, credentials);
            const configured = (await loadNotamCredentials(deps.secrets)) !== null;
            setNotam({ ...credentials, configured, message: 'Saved. NOTAMs appear in the airport sheet.' });
          } catch (error) {
            setNotam({ message: describeError(error) });
          }
        });
      },

      removeNotamKey: () =>
        enqueue(async () => {
          try {
            await removeNotamCredentials(deps.secrets);
            setNotam({ clientID: '', clientSecret: '', configured: false, message: 'Key removed.' });
          } catch (error) {
            // A half-removed pair is not usable, so say what the store now holds instead of keeping "Configured".
            const configured = await loadNotamCredentials(deps.secrets).then(
              (c) => c !== null,
              () => get().notam.configured,
            );
            setNotam({ configured, message: describeError(error) });
          }
        }),
    };
  });
}
