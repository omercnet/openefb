import { PARSER_VERSION, scrape, type DetailCacheFile } from "./build.js";
import { HttpStatusError, httpFetcher, type TextFetcher } from "./fetch.js";
import { recordHistory } from "./history.js";
import { getJson, type Store } from "./storage.js";

export const FEED_FILE = "notams.json";
const CACHE_FILE = "detail-cache.json";
const META_FILE = "meta.json";

/** The IAA is scraped at most once per 15 minutes (a minute of slack for cron jitter). */
export const MIN_INTERVAL_MS = 14 * 60_000;
export const DETAIL_DELAY_MS = 400;
/** Workers free plan allows 50 subrequests per invocation (KV calls count): 1 list + 36 details leaves room for the 5 to 9 KV calls. */
export const MAX_DETAIL_REQUESTS = 36;
/** After a failed run the next attempt waits MIN_INTERVAL * 2^failures, capped. A 403/429 (block) starts at 2^2 so we back off hard. */
export const MAX_BACKOFF_MS = 6 * 3_600_000;

export function backoffMs(consecutiveFailures: number, blocked: boolean): number {
  if (consecutiveFailures <= 0) return MIN_INTERVAL_MS;
  const exponent = Math.min(consecutiveFailures + (blocked ? 1 : 0), 10);
  return Math.min(MIN_INTERVAL_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

export interface JobMeta {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastStats: { rows: number; fetched: number; cached: number; failed: number; deferred: number } | null;
  /** Runs failed in a row; 0 after a success. Drives the backoff. */
  consecutiveFailures?: number;
  /** Earliest time the next cron run may hit the IAA (set after a failure). */
  nextAttemptAt?: string | null;
}

export async function readMeta(store: Store): Promise<JobMeta> {
  return (await getJson<JobMeta>(store, META_FILE)) ?? { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastStats: null };
}

export type JobOutcome = { status: "skipped"; nextAllowedAt: string } | { status: "ok"; meta: JobMeta } | { status: "error"; error: string };

export interface JobOptions {
  force?: boolean;
  fetchText?: TextFetcher;
  delayMs?: number;
  maxDetailRequests?: number;
  now?: Date;
}

/** Scrape and publish. A failed run keeps the previous notams.json untouched and records the error. */
export async function runScrapeJob(store: Store, opts: JobOptions = {}): Promise<JobOutcome> {
  const now = opts.now ?? new Date();
  const meta = await readMeta(store);
  if (!opts.force) {
    const byInterval = meta.lastAttemptAt ? Date.parse(meta.lastAttemptAt) + MIN_INTERVAL_MS : 0;
    const byBackoff = meta.nextAttemptAt ? Date.parse(meta.nextAttemptAt) : 0;
    const next = Math.max(byInterval, Number.isFinite(byBackoff) ? byBackoff : 0);
    if (next > 0 && now.getTime() < next) return { status: "skipped", nextAllowedAt: new Date(next).toISOString() };
  }
  meta.lastAttemptAt = now.toISOString();
  try {
    const file = await getJson<DetailCacheFile>(store, CACHE_FILE);
    const result = await scrape({
      fetchText: opts.fetchText ?? httpFetcher,
      delayMs: opts.delayMs ?? DETAIL_DELAY_MS,
      maxDetailRequests: opts.maxDetailRequests ?? MAX_DETAIL_REQUESTS,
      cache: file?.entries ?? {},
      cacheParserVersion: file?.parserVersion ?? PARSER_VERSION,
      now: () => now,
      log: (m) => console.warn(m),
    });
    await store.put(FEED_FILE, JSON.stringify(result.feed));
    try {
      const added = await recordHistory(store, result.feed.items, now);
      if (added > 0) console.warn(`history: recorded ${added} new NOTAM(s)`);
    } catch (err) {
      // The corpus is a convenience: never fail (or delay) publishing the feed because of it.
      console.warn(`history write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // The cache only changes when a detail page was fetched, a row left the list, or the parser version moved.
    const cacheChanged =
      !file || file.parserVersion !== PARSER_VERSION || result.stats.fetched > 0 || Object.keys(result.cache).length !== Object.keys(file.entries).length;
    if (cacheChanged) {
      const body: DetailCacheFile = { parserVersion: PARSER_VERSION, entries: result.cache };
      await store.put(CACHE_FILE, JSON.stringify(body));
    }
    meta.lastSuccessAt = now.toISOString();
    meta.lastError = null;
    meta.lastStats = result.stats;
    meta.consecutiveFailures = 0;
    meta.nextAttemptAt = null;
    await store.put(META_FILE, JSON.stringify(meta));
    return { status: "ok", meta };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const blocked = err instanceof HttpStatusError && (err.status === 403 || err.status === 429);
    meta.consecutiveFailures = (meta.consecutiveFailures ?? 0) + 1;
    meta.nextAttemptAt = new Date(now.getTime() + backoffMs(meta.consecutiveFailures, blocked)).toISOString();
    meta.lastError = error;
    await store.put(META_FILE, JSON.stringify(meta));
    return { status: "error", error };
  }
}
