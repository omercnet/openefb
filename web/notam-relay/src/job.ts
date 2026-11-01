import { PARSER_VERSION, scrape, type DetailCacheFile } from "./build.js";
import { httpFetcher, type TextFetcher } from "./fetch.js";
import { getJson, type Store } from "./storage.js";

export const FEED_FILE = "notams.json";
const CACHE_FILE = "detail-cache.json";
const META_FILE = "meta.json";

/** The IAA is scraped at most once per 15 minutes (a minute of slack for cron jitter). */
export const MIN_INTERVAL_MS = 14 * 60_000;
export const DETAIL_DELAY_MS = 400;
/** Workers free plan allows 50 subrequests per invocation: 1 list + 40 details leaves room for the KV calls. */
export const MAX_DETAIL_REQUESTS = 40;

export interface JobMeta {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastStats: { rows: number; fetched: number; cached: number; failed: number; deferred: number } | null;
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
  if (!opts.force && meta.lastAttemptAt) {
    const next = Date.parse(meta.lastAttemptAt) + MIN_INTERVAL_MS;
    if (now.getTime() < next) return { status: "skipped", nextAllowedAt: new Date(next).toISOString() };
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
    await store.put(META_FILE, JSON.stringify(meta));
    return { status: "ok", meta };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    meta.lastError = error;
    await store.put(META_FILE, JSON.stringify(meta));
    return { status: "error", error };
  }
}
