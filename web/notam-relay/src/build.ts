import { DETAIL_URL_TEMPLATE, LIST_URL, detailUrl, sleep, type TextFetcher } from "./fetch.js";
import { parseDetailHtml, parseListHtml, type ListRow } from "./parse-html.js";
import { applyCancellations, parseNotamText } from "./parse-notam.js";
import type { NotamItem, NotamsFeed } from "./types.js";

/** Bump when the parser's output changes: cached items are then re-parsed from their stored raw text (once, not every run). */
export const PARSER_VERSION = 2;

/**
 * Detail cache entry. Keyed by IAA row id; reused only while the list page still shows the same NOTAM
 * number and message text for that row and the cached item carries the same "Created" stamp it had
 * when fetched. A row that was edited on the site changes its list text and is fetched again.
 */
export interface CacheEntry {
  listId: string;
  listSummary: string;
  created: string | null;
  item: NotamItem;
}
export interface DetailCacheFile {
  parserVersion: number;
  entries: Record<string, CacheEntry>;
}
export type DetailCache = Record<string, CacheEntry>;

export interface ScrapeOptions {
  fetchText: TextFetcher;
  /** pause between detail requests (milliseconds) */
  delayMs: number;
  cache: DetailCache;
  /** Parser version the cache was written with; a mismatch re-parses cached raw text. Defaults to current. */
  cacheParserVersion?: number;
  /** Detail requests allowed in one run (Workers free plan: 50 subrequests). Rows beyond it stay unparsed until the next run. */
  maxDetailRequests?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface ScrapeResult {
  feed: NotamsFeed;
  cache: DetailCache;
  stats: { rows: number; fetched: number; cached: number; failed: number; deferred: number };
}

function fallbackItem(row: ListRow): NotamItem {
  // Never drop a NOTAM: when the detail page is unavailable, keep the list text, flagged unparsed.
  return {
    rowId: row.rowId,
    id: row.id,
    type: null,
    references: null,
    location: row.location,
    locationDescription: null,
    created: null,
    q: null,
    a: null,
    validFrom: null,
    validTo: null,
    permanent: false,
    estimated: false,
    d: null,
    e: null,
    f: null,
    g: null,
    geometry: { polygon: null, circle: null },
    closures: [],
    cancelledBy: null,
    replacedBy: null,
    parsed: false,
    raw: row.summary,
  };
}

/** List page → one detail request per new or changed row, sequential, with a delay. Throws only if the list fails. */
export async function scrape(opts: ScrapeOptions): Promise<ScrapeResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const rows = parseListHtml(await opts.fetchText(LIST_URL));
  if (rows.length === 0) throw new Error("IAA list page held no NOTAM rows (layout change, or a block page)");

  const cache: DetailCache = {};
  const items: NotamItem[] = [];
  const stats = { rows: rows.length, fetched: 0, cached: 0, failed: 0, deferred: 0 };
  let requested = false;
  let requests = 0;
  const maxRequests = opts.maxDetailRequests ?? Infinity;
  const reparse = (opts.cacheParserVersion ?? PARSER_VERSION) !== PARSER_VERSION;

  for (const row of rows) {
    const hit = opts.cache[row.rowId];
    if (hit && hit.listId === row.id && hit.listSummary === row.summary && hit.created === hit.item.created) {
      // Reuse the parsed item as is; only a parser version bump re-parses the stored raw text.
      let item = hit.item;
      if (reparse) {
        const { raw, location, locationDescription, created } = hit.item;
        item = parseNotamText(raw, { rowId: row.rowId, location, locationDescription, created }, row.id);
      }
      cache[row.rowId] = reparse ? { ...hit, item } : hit;
      items.push(item);
      stats.cached++;
      continue;
    }
    if (requests >= maxRequests) {
      items.push(fallbackItem(row)); // not cached, so the next run fetches it
      stats.deferred++;
      continue;
    }
    if (requested) await sleep(opts.delayMs);
    requested = true;
    requests++;
    try {
      const page = parseDetailHtml(await opts.fetchText(detailUrl(row.rowId)), row.rowId);
      if (!page) throw new Error("detail page held no NOTAM text");
      const item = parseNotamText(page.raw, page.meta, row.id);
      if (!item.location) item.location = row.location;
      cache[row.rowId] = { listId: row.id, listSummary: row.summary, created: item.created, item };
      items.push(item);
      stats.fetched++;
    } catch (err) {
      log(`detail ${row.rowId} (${row.id}) failed: ${err instanceof Error ? err.message : String(err)}`);
      items.push(fallbackItem(row));
      stats.failed++;
    }
  }

  applyCancellations(items);
  const closures = items.filter((i) => !i.cancelledBy && !i.replacedBy).flatMap((i) => i.closures);
  const feed: NotamsFeed = {
    generatedAt: now().toISOString(),
    source: { name: "IAA AeroInfo", listUrl: LIST_URL, detailUrlTemplate: DETAIL_URL_TEMPLATE },
    items,
    closures,
  };
  return { feed, cache, stats };
}
