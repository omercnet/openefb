// Port of IsraelNotamService (Services/IsraelNotamService.swift): client for the OpenEFB Israel NOTAM relay
// (web/notam-relay, a Cloudflare Worker): a small server scrapes the IAA NOTAM page every 15 minutes and publishes
// `notams.json`. The app never contacts the IAA site. Wire format: web/notam-relay/src/types.ts (NotamsFeed).
// Freshness is judged on the feed's `generatedAt` (when the relay last scraped the IAA), not on when this device
// downloaded it, so a dead relay can't make old closures look current.
import { AppFailure } from '../domain/errors';
import { fetchWithTimeout, isOfflineError } from './http';
import { decodeIsraelNotamFeed, type IsraelNotamFeed, type IsraelNotamReport } from './israelNotam';
import { systemClock, type Clock, type FetchLike, type Logger, type TextStorage } from './ports';

/** The deployed relay (web/notam-relay, Cloudflare Worker). Not a secret. */
export const DEFAULT_ISRAEL_NOTAM_FEED_URL = 'https://openefb-notam-relay.omerc.workers.dev/notams.json';
export const ISRAEL_NOTAM_CACHE_EXPIRY_SECONDS = 300; // the relay's edge cache is 5 min
/** Swift: timeoutIntervalForRequest 15 s. */
export const ISRAEL_NOTAM_REQUEST_TIMEOUT_MS = 15_000;
/** Storage key of the last good feed (Swift: Application Support/IsraelNotam/last-feed.json). */
export const ISRAEL_NOTAM_STORAGE_KEY = 'IsraelNotam/last-feed.json';

export type IsraelNotamErrorCode = 'notConfigured' | 'badStatus' | 'undecodable';

/** Swift IsraelNotamError. `status` is set for badStatus. */
export class IsraelNotamError extends Error {
  constructor(
    readonly code: IsraelNotamErrorCode,
    readonly status?: number,
  ) {
    super(
      code === 'notConfigured'
        ? 'Israel NOTAMs need the relay address, which is not set in this build.'
        : code === 'badStatus'
          ? `The Israel NOTAM relay answered HTTP ${status}.`
          : "The Israel NOTAM relay sent data this version of Kanaf can't read.",
    );
    this.name = 'IsraelNotamError';
  }
}

export interface IsraelNotamServiceLike {
  /** The relay's current feed. Serves the in-memory copy while it is younger than the cache expiry; on a failed refresh
   * returns the last copy flagged `refreshFailed`, and rejects only when there is nothing cached. */
  fetchFeed(forceRefresh?: boolean): Promise<IsraelNotamReport>;
}

export interface IsraelNotamServiceOptions {
  fetch: FetchLike;
  /** The feed URL, read on every call; null = not configured. Omit to use the deployed relay. */
  feedUrl?: () => string | null;
  now?: Clock;
  /** Where the last good feed is kept so an offline relaunch still has it; omit for memory only (tests). */
  storage?: TextStorage;
  requestTimeoutMs?: number;
  log?: Logger;
}

interface SavedFeed {
  fetchedAtMs: number;
  body: string;
}

export class IsraelNotamService implements IsraelNotamServiceLike {
  private cached: IsraelNotamReport | null = null;
  private inFlight: Promise<IsraelNotamReport> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly now: Clock;

  constructor(private readonly options: IsraelNotamServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  async fetchFeed(forceRefresh = false): Promise<IsraelNotamReport> {
    const url = this.options.feedUrl ? this.options.feedUrl() : DEFAULT_ISRAEL_NOTAM_FEED_URL;
    if (!url) throw new IsraelNotamError('notConfigured');
    const cached = this.cached;
    if (
      !forceRefresh &&
      cached &&
      !cached.refreshFailed &&
      (this.now() - cached.fetchedAt) / 1000 < ISRAEL_NOTAM_CACHE_EXPIRY_SECONDS
    ) {
      return cached;
    }
    // JS-only: callers that arrive while a download runs join it instead of starting another.
    if (this.inFlight) return this.inFlight;
    const run: Promise<IsraelNotamReport> = this.refresh(url).finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** Resolves when every save started so far has finished (tests, app shutdown). */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private async refresh(url: string): Promise<IsraelNotamReport> {
    try {
      const { feed, body } = await this.download(url);
      const report: IsraelNotamReport = { feed, fetchedAt: this.now(), refreshFailed: false };
      this.cached = report;
      this.persist(report.fetchedAt, body);
      this.options.log?.(`Fetched ${feed.items.length} Israel NOTAMs, ${feed.closures.length} route closures`);
      return report;
    } catch (error) {
      const previous = this.cached ?? (await this.loadPersisted());
      if (previous) {
        this.options.log?.(
          `Israel NOTAM refresh failed, serving the saved copy: ${error instanceof Error ? error.message : String(error)}`,
        );
        const stale: IsraelNotamReport = { feed: previous.feed, fetchedAt: previous.fetchedAt, refreshFailed: true };
        this.cached = stale;
        return stale;
      }
      throw error;
    }
  }

  private async download(url: string): Promise<{ feed: IsraelNotamFeed; body: string }> {
    let response;
    try {
      response = await fetchWithTimeout(
        this.options.fetch,
        url,
        this.options.requestTimeoutMs ?? ISRAEL_NOTAM_REQUEST_TIMEOUT_MS,
        {
          headers: { Accept: 'application/json' },
        },
      );
    } catch (error) {
      if (isOfflineError(error)) throw new AppFailure({ kind: 'networkUnavailable' });
      throw error;
    }
    if (response.status !== 200) throw new IsraelNotamError('badStatus', response.status);
    try {
      const body = await response.text();
      return { feed: decodeIsraelNotamFeed(body), body };
    } catch {
      throw new IsraelNotamError('undecodable');
    }
  }

  // MARK: Persistence

  /** Saves the last good feed. Writes are chained so an older save never lands after a newer one; a failure to save
   * never blocks the feed. */
  private persist(fetchedAtMs: number, body: string): void {
    const storage = this.options.storage;
    if (!storage) return;
    const saved: SavedFeed = { fetchedAtMs, body };
    this.writeChain = this.writeChain.then(async () => {
      try {
        await storage.write(ISRAEL_NOTAM_STORAGE_KEY, JSON.stringify(saved));
      } catch (error) {
        this.options.log?.(
          `Could not save the Israel NOTAM feed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  /** The saved feed, or null when none exists or it cannot be read. Display age comes from the feed's own
   * `generatedAt`, so a copy that is too old is still gated by the existing freshness rules. */
  private async loadPersisted(): Promise<IsraelNotamReport | null> {
    const storage = this.options.storage;
    if (!storage) return null;
    try {
      const raw = await storage.read(ISRAEL_NOTAM_STORAGE_KEY);
      if (raw === null) return null;
      const saved = JSON.parse(raw) as Partial<SavedFeed> | null;
      if (!saved || typeof saved.fetchedAtMs !== 'number' || typeof saved.body !== 'string')
        throw new Error('bad shape');
      return { feed: decodeIsraelNotamFeed(saved.body), fetchedAt: saved.fetchedAtMs, refreshFailed: true };
    } catch {
      this.options.log?.('Saved Israel NOTAM feed is unreadable; ignoring it');
      return null;
    }
  }
}
