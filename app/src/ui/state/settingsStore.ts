import { createStore } from 'zustand';
import type { AviationDataCycle } from '../../data/aviation/types';
import { fallbackDataAttribution, parseRegion, type Region } from '../../domain/core/region';
import { describeError } from '../../domain/describeError';
import { DISPLAY_MODE_DEFAULTS_KEY, DISPLAY_MODES, type DisplayMode } from '../../domain/displayMode';
import { readBool, writeBool, type Preferences } from '../../domain/ports/preferences';
import { NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY, type SecretStore } from '../../domain/ports/secretStore';
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
  /** A complete, usable pair is stored. */
  configured: boolean;
  /** Part of a key is still stored (a removal failed half way): Remove Key stays available so it can be finished. */
  partiallyStored: boolean;
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
  /** The preference that error is about, so the screen shows it next to that setting. */
  preferenceErrorFor: 'displayMode' | 'shareUsageData' | null;
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
  /** Repeats the failed write of the preference named in `preferenceError`, with its current value and without telling the app again. */
  retryPreferenceSave(): Promise<void>;
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

  /** Region writes queued but not finished: a load that reads storage meanwhile must not put the old region back. */
  let pendingRegionWrites = 0;
  /** Same for the two preferences: a load must not put back a value changed while it was reading. */
  const pendingPrefWrites = { displayMode: 0, shareUsageData: 0 };
  /** What went wrong with the last region change, so Retry repeats exactly that (the save, the notification, or both). */
  /** True once the user has typed in a NOTAM field since the last load, save or removal (empty is a valid edit). */
  let notamEdited = false;
  let regionFailed: { region: Region | null; apply: boolean; save: boolean } = {
    region: null,
    apply: false,
    save: false,
  };
  /** Which preference the shown preferenceError belongs to: a later success of another one must not clear it. */
  let errorOwner: 'displayMode' | 'shareUsageData' | null = null;

  return createStore<SettingsState>()((set, get) => {
    const setNotam = (patch: Partial<NotamState>) => set((s) => ({ notam: { ...s.notam, ...patch } }));

    /** Saves a preference and records the failure next to the setting that changed. */
    const persist = async (
      owner: 'displayMode' | 'shareUsageData',
      write: () => Promise<void>,
      applyFailure: string | null,
    ) => {
      const show = (message: string | null) => {
        if (message === null && errorOwner !== owner) return; // another setting's failure stays
        errorOwner = message === null ? null : owner;
        set({ preferenceError: message, preferenceErrorFor: message === null ? null : owner });
      };
      try {
        await write();
        show(applyFailure && `Changed, but the app could not apply it: ${applyFailure}`);
      } catch (error) {
        show(`Changed, but it could not be saved: ${describeError(error)}`);
      }
    };

    /** Saves the region (when `write`) and records what failed. `applyFailure` is what notifying the app threw, if anything. */
    const saveRegion = async (region: Region, applyFailure: string | null, write: boolean) => {
      let saveFailure: string | null = null;
      if (write) {
        try {
          await deps.userData.settings.update({ regionRaw: region });
        } catch (error) {
          saveFailure = describeError(error);
        }
      }
      // A newer choice owns the shared state; this older save must not overwrite its error, attribution or availability.
      if (get().region !== region) return;
      regionFailed = { region, apply: applyFailure !== null, save: saveFailure !== null };
      set({
        regionSaveError:
          saveFailure !== null
            ? `Region changed, but it could not be saved: ${saveFailure}`
            : applyFailure && `Region changed, but the app could not apply it: ${applyFailure}`,
        dataAttribution: await attributionFor(region),
        regionDataError: await unavailableFor(region),
      });
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
      preferenceErrorFor: null,
      loadError: null,
      currencyToRenew: 0,
      dataCycle: null,
      notam: { clientID: '', clientSecret: '', configured: false, partiallyStored: false, message: null },

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
          // Everything that awaits comes first; what the user did meanwhile is read at the moment of the final set(), not before.
          const regionNow = () =>
            // A region whose save failed is still the one the user chose: a reload must not drop it before Retry.
            pendingRegionWrites > 0 || regionFailed.save ? get().region : region;
          let attributedFor = regionNow();
          let attribution = await attributionFor(attributedFor);
          let unavailable = await unavailableFor(attributedFor);
          while (attributedFor !== regionNow()) {
            attributedFor = regionNow();
            attribution = await attributionFor(attributedFor);
            unavailable = await unavailableFor(attributedFor);
          }
          const typing = get().notam;
          set({
            loaded: true,
            region: attributedFor,
            displayMode:
              pendingPrefWrites.displayMode > 0
                ? get().displayMode
                : (DISPLAY_MODES.find((m) => m === rawMode) ?? 'auto'),
            shareUsageData: pendingPrefWrites.shareUsageData > 0 ? get().shareUsageData : share,
            dataAttribution: attribution,
            regionDataError: unavailable,
            currencyToRenew: currencyToRenewCount(pilots.find((p) => p.isActive) ?? null, deps.now()),
            dataCycle: cycle,
            loadError: problems.length > 0 ? problems.join('; ') : null,
            notam: {
              ...typing,
              // What the user typed or cleared is not replaced by a slow read.
              clientID: notamEdited ? typing.clientID : (credentials?.clientID ?? ''),
              clientSecret: notamEdited ? typing.clientSecret : (credentials?.clientSecret ?? ''),
              configured: credentials !== null,
              partiallyStored: false,
            },
          });
        }),

      setRegion: (region) => {
        // Guard newRegion != appState.region; but a region whose save failed may be saved again (the picker offers Retry).
        // The failure flags belong to the operation that set them: they are taken, and cleared, when a change or retry is queued,
        // so a later operation never reads (or leaves) another region's state.
        const failed = regionFailed.region === region ? regionFailed : { region, apply: false, save: false };
        regionFailed = { region, apply: false, save: false };
        const retry = region === get().region && (failed.apply || failed.save);
        if (region === get().region && !retry) return Promise.resolve();
        set({ region });
        // A retry repeats only what failed: the notification, the save, or both.
        const applyFailure = !retry || failed.apply ? notify(() => deps.onRegionChange?.(region)) : null;
        const write = !retry || failed.save;
        pendingRegionWrites += 1;
        return enqueue(async () => {
          try {
            await saveRegion(region, applyFailure, write);
          } finally {
            pendingRegionWrites -= 1;
          }
        });
      },

      setDisplayMode: (mode) => {
        set({ displayMode: mode });
        const applyFailure = notify(() => deps.onDisplayModeChange?.(mode));
        pendingPrefWrites.displayMode += 1;
        return enqueue(() =>
          persist('displayMode', () => deps.prefs.set(DISPLAY_MODE_DEFAULTS_KEY, mode), applyFailure).finally(() => {
            pendingPrefWrites.displayMode -= 1;
          }),
        );
      },

      retryPreferenceSave: () => {
        const owner = get().preferenceErrorFor;
        if (owner === null) return Promise.resolve();
        // The value on screen is what the user chose; saving it again changes nothing the app has applied.
        if (owner === 'displayMode') {
          const mode = get().displayMode;
          pendingPrefWrites.displayMode += 1;
          return enqueue(() =>
            persist('displayMode', () => deps.prefs.set(DISPLAY_MODE_DEFAULTS_KEY, mode), null).finally(() => {
              pendingPrefWrites.displayMode -= 1;
            }),
          );
        }
        const enabled = get().shareUsageData;
        pendingPrefWrites.shareUsageData += 1;
        return enqueue(() =>
          persist('shareUsageData', () => writeBool(deps.prefs, TELEMETRY_ENABLED_KEY, enabled), null).finally(() => {
            pendingPrefWrites.shareUsageData -= 1;
          }),
        );
      },

      setShareUsageData: (enabled) => {
        set({ shareUsageData: enabled });
        const applyFailure = notify(() => deps.setTelemetryEnabled(enabled, get().region));
        pendingPrefWrites.shareUsageData += 1;
        return enqueue(() =>
          persist('shareUsageData', () => writeBool(deps.prefs, TELEMETRY_ENABLED_KEY, enabled), applyFailure).finally(
            () => {
              pendingPrefWrites.shareUsageData -= 1;
            },
          ),
        );
      },

      setNotamClientID: (clientID) => {
        notamEdited = true;
        setNotam({ clientID });
      },
      setNotamClientSecret: (clientSecret) => {
        notamEdited = true;
        setNotam({ clientSecret });
      },

      saveNotamKey: () => {
        if (!canSaveNotamKey(get().notam)) return Promise.resolve();
        const credentials = { clientID: get().notam.clientID.trim(), clientSecret: get().notam.clientSecret.trim() };
        return enqueue(async () => {
          try {
            await saveNotamCredentials(deps.secrets, credentials);
            const readBack = await loadNotamCredentials(deps.secrets);
            // Both writes succeeded; a read that comes back empty means the store cannot be read, not that no key is saved.
            // The fields the user kept editing while this waited are left alone; the status still updates.
            const now = get().notam;
            const unchanged =
              now.clientID.trim() === credentials.clientID && now.clientSecret.trim() === credentials.clientSecret;
            if (unchanged) notamEdited = false;
            setNotam({
              ...(unchanged ? credentials : {}),
              configured: true,
              message:
                readBack === null
                  ? 'Saved, but the key could not be read back to check it.'
                  : 'Saved. NOTAMs appear in the airport sheet.',
            });
          } catch (error) {
            setNotam({ message: describeError(error) });
          }
        });
      },

      removeNotamKey: () => {
        // What was typed after Remove was pressed is not removed with the saved key.
        const pressed = { ...get().notam };
        return enqueue(async () => {
          try {
            await removeNotamCredentials(deps.secrets);
            const now = get().notam;
            const unchanged = now.clientID === pressed.clientID && now.clientSecret === pressed.clientSecret;
            if (unchanged) notamEdited = false;
            setNotam({
              ...(unchanged ? { clientID: '', clientSecret: '' } : {}),
              configured: false,
              partiallyStored: false,
              message: 'Key removed.',
            });
          } catch (error) {
            // A half-removed pair is not usable, but what is left must stay removable.
            const configured = await loadNotamCredentials(deps.secrets).then(
              (c) => c !== null,
              () => get().notam.configured,
            );
            const stored = await Promise.all(
              [NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY].map((key) =>
                deps.secrets.get(key).then(
                  (v) => v !== null,
                  () => true,
                ),
              ),
            );
            setNotam({ configured, partiallyStored: stored.some(Boolean), message: describeError(error) });
          }
        });
      },
    };
  });
}
