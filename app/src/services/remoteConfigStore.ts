// Port of RemoteConfigStore (Services/RemoteConfigStore.swift): the remote config in effect. Fetch policy,
// validation, the last good copy on disk, and the answers the rest of the app asks (is a feature switched off, what
// is a parameter, is an update wanted).
// Rules (docs/handoff/REMOTE-CONFIG.md):
//  - a file with a lower serial than the cached one is a stale copy and is rejected;
//  - an expired file (cached or new) never applies: the built-in values are used;
//  - offline: the last good copy, else the built-in values; the map never waits for this;
//  - never fetches while a flight is being recorded; at most once an hour (5 minutes after a failure).
import { errorDescription } from '../domain/core/errorInfo';
import type { Region } from '../domain/core/region';
import { AppFailure } from '../domain/errors';
import { failureText } from './http';
import { systemClock, type Clock, type Logger, type TextStorage } from './ports';
import {
  isExpired,
  noticeApplies,
  PARAMETER_INFO,
  parseRemoteConfig,
  resolveText,
  type RemoteConfig,
  type RemoteFeature,
  type RemoteNotice,
  type RemoteParameter,
} from './remoteConfig';
import type { RemoteConfigServiceLike } from './remoteConfigService';

/** Minimum time between checks after the file was read or rejected -- seconds. */
export const CHECK_INTERVAL_SECONDS = 3600;
/** Minimum time between checks after the network failed -- seconds. */
export const RETRY_INTERVAL_SECONDS = 300;
/** The map-wide banner id for a required update. */
export const UPDATE_BANNER_ID = 'update-required';
/** Storage key of the last good file (Swift: Application Support/RemoteConfig/last-config.json). */
export const LAST_CONFIG_KEY = 'RemoteConfig/last-config.json';

export type UpdateRequest = { kind: 'required'; message: string } | { kind: 'recommended'; message: string };

export interface RemoteConfigStoreOptions {
  service: RemoteConfigServiceLike;
  /** Where the last good file is kept; omit for memory only (tests). */
  storage?: TextStorage;
  /** The running build number (CFBundleVersion / versionCode). */
  buildNumber: number;
  now?: Clock;
  /** The device's first preferred language tag, read each time a text is resolved. */
  preferredLanguage?: () => string;
  log?: Logger;
}

interface SavedConfig {
  fetchedAtMs: number;
  body: string;
}

export class RemoteConfigStore {
  /** The last good config, even if it has expired. Use `active` for what applies. */
  config: RemoteConfig | null = null;
  /** When the cached config was downloaded (epoch ms). */
  fetchedAtMs: number | null = null;
  /** Why the last check did not produce a new file; null after a successful check. */
  lastError: string | null = null;
  isChecking = false;
  /** Banner and notice ids the pilot dismissed this session. */
  private dismissed = new Set<string>();

  private readonly service: RemoteConfigServiceLike;
  private readonly storage: TextStorage | undefined;
  private readonly buildNumber: number;
  private readonly now: Clock;
  private readonly preferredLanguage: () => string;
  private readonly log: Logger | undefined;
  private nextCheckAtMs: number | null = null;
  private inFlight: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  private constructor(options: RemoteConfigStoreOptions) {
    this.service = options.service;
    this.storage = options.storage;
    this.buildNumber = options.buildNumber;
    this.now = options.now ?? systemClock;
    this.preferredLanguage = options.preferredLanguage ?? (() => 'en');
    this.log = options.log;
  }

  /** Creates the store and loads the saved copy (Swift does this in init; reading a file is async here). */
  static async open(options: RemoteConfigStoreOptions): Promise<RemoteConfigStore> {
    const store = new RemoteConfigStore(options);
    await store.loadSaved();
    return store;
  }

  // MARK: Change notification (for useSyncExternalStore)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever observable state changes. */
  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.log?.(`Remote config listener failed: ${String(error)}`);
      }
    }
  }

  // MARK: What applies

  /** The config in effect now: the cached one unless it has expired. */
  get active(): RemoteConfig | null {
    return this.config && !isExpired(this.config, this.now()) ? this.config : null;
  }

  /** The pilot-facing message when `feature` is switched off, else null. */
  disabledMessage(feature: RemoteFeature): string | null {
    const text = this.active?.disabledFeatures[feature];
    return text ? resolveText(text, this.preferredLanguage()) : null;
  }

  isDisabled(feature: RemoteFeature): boolean {
    return this.disabledMessage(feature) !== null;
  }

  /** The value for `parameter`: the file's when it applies, else the built-in one. */
  value(parameter: RemoteParameter): number {
    return this.active?.parameters[parameter] ?? PARAMETER_INFO[parameter].builtIn;
  }

  /** Whether the config asks the pilot to update. Wording falls back to a fixed text when the file has none. */
  get updateRequest(): UpdateRequest | null {
    const active = this.active;
    if (!active) return null;
    const message = active.updateMessage
      ? resolveText(active.updateMessage, this.preferredLanguage())
      : 'A newer version of Kanaf is available.';
    if (active.minSupportedBuild !== null && this.buildNumber < active.minSupportedBuild) {
      return { kind: 'required', message };
    }
    if (active.recommendedBuild !== null && this.buildNumber < active.recommendedBuild) {
      return { kind: 'recommended', message };
    }
    return null;
  }

  /** Notices that apply to `region` now and were not dismissed. */
  notices(region: Region): RemoteNotice[] {
    const current = this.now();
    return (this.active?.notices ?? []).filter((n) => noticeApplies(n, region, current) && !this.dismissed.has(n.id));
  }

  dismissBanner(id: string): void {
    this.dismissed.add(id);
    this.changed();
  }

  isBannerDismissed(id: string): boolean {
    return this.dismissed.has(id);
  }

  /** Settings > About line: where the values in effect come from. */
  get sourceDescription(): string {
    const active = this.active;
    if (!active || this.fetchedAtMs === null) return 'Built-in';
    return `Serial ${active.serial}, checked ${relativeShort(this.fetchedAtMs, this.now())}`;
  }

  // MARK: Fetching

  /** Checks the relay when one is due. Called at launch and when the app becomes active.
   * Does nothing while a flight is being recorded, while a check runs, or before the next due time. */
  async refreshIfDue(recordingActive: boolean): Promise<void> {
    if (recordingActive || this.isChecking) return;
    if (this.nextCheckAtMs !== null && this.now() < this.nextCheckAtMs) return;
    await this.refresh();
  }

  /** Fetches and applies a new file now. A call while a check runs joins that check instead of starting another. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async runRefresh(): Promise<void> {
    this.isChecking = true;
    this.changed();
    try {
      let body: string;
      try {
        body = await this.service.fetchConfigData();
      } catch (error) {
        this.lastError = failureText(error, errorDescription);
        this.nextCheckAtMs = this.now() + RETRY_INTERVAL_SECONDS * 1000;
        return;
      }
      this.nextCheckAtMs = this.now() + CHECK_INTERVAL_SECONDS * 1000;
      this.apply(body);
    } finally {
      this.isChecking = false;
      this.changed();
    }
  }

  /** Validates `body` against the cached copy and adopts it. A rejected file leaves the cache untouched. */
  apply(body: string): void {
    const current = this.now();
    try {
      const incoming = parseRemoteConfig(body, current);
      if (this.config && incoming.serial < this.config.serial) {
        throw new AppFailure({
          kind: 'remoteConfigRejected',
          reason: `serial ${incoming.serial} is older than the saved ${this.config.serial}`,
        });
      }
      this.config = incoming;
      this.fetchedAtMs = current;
      this.lastError = null;
      this.persist(body, current);
    } catch (error) {
      this.lastError = failureText(error, errorDescription);
    }
    this.changed();
  }

  // MARK: Disk

  /** Resolves when every write started so far has finished (tests, app shutdown). */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private async loadSaved(): Promise<void> {
    if (!this.storage) return;
    try {
      const raw = await this.storage.read(LAST_CONFIG_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw) as Partial<SavedConfig> | null;
      if (!saved || typeof saved.fetchedAtMs !== 'number' || typeof saved.body !== 'string') return;
      // Re-validated on every launch; an expired copy is kept (for its serial) but never applies.
      this.config = parseRemoteConfig(saved.body, saved.fetchedAtMs);
      this.fetchedAtMs = saved.fetchedAtMs;
    } catch {
      // A damaged or unreadable saved file is ignored: the built-in values apply.
    }
  }

  /** Writes are chained so an older write can never land after a newer one. */
  private persist(body: string, fetchedAtMs: number): void {
    const storage = this.storage;
    if (!storage) return;
    const saved: SavedConfig = { fetchedAtMs, body };
    this.writeChain = this.writeChain.then(async () => {
      try {
        await storage.write(LAST_CONFIG_KEY, JSON.stringify(saved));
      } catch (error) {
        this.log?.(`Could not save the remote config: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}

/** Short relative time ("now", "5 min. ago", "2 hr. ago", "3 days ago"); Swift uses RelativeDateTimeFormatter. */
export function relativeShort(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min. ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr. ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
