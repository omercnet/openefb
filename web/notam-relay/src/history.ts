import type { Store } from "./storage.js";
import type { NotamItem } from "./types.js";

/**
 * Our own regression corpus: every NOTAM the relay has seen, id plus verbatim ICAO text, kept so parser changes
 * can be checked against real wording without relying on anyone else's archive.
 *
 * Layout in the store (KV in production):
 *   history-index.json         JSON array of every id recorded so far (a few KB per thousand NOTAMs)
 *   history-YYYY-MM-DD.json    JSON array of { id, raw, seenAt } first seen that UTC day
 * A run that sees nothing new writes nothing; a run with new NOTAMs writes two keys, however many are new.
 * That keeps the worst case at 2 x 96 = 192 writes a day, inside the free plan's 1000 together with the feed.
 */
export const HISTORY_INDEX = "history-index.json";
export const historyShard = (now: Date): string => `history-${now.toISOString().slice(0, 10)}.json`;

export interface HistoryEntry {
  id: string;
  raw: string;
  /** ISO 8601 UTC */
  seenAt: string;
}

/** Text from a detail page starts "(C2269/26 NOTAMN"; a list-page fallback (truncated summary) does not and is not recorded. */
const DETAIL_TEXT = /^\(\s*[A-Z]\d{4}\/\d{2}\s+NOTAM[NRC]/;

/** Append the NOTAMs not recorded before. Returns how many were added. Never throws into the scrape. */
export async function recordHistory(store: Store, items: NotamItem[], now: Date): Promise<number> {
  const indexText = await store.get(HISTORY_INDEX);
  const known = new Set<string>(indexText ? (JSON.parse(indexText) as string[]) : []);
  const fresh: HistoryEntry[] = [];
  for (const item of items) {
    if (!item.id || known.has(item.id) || !DETAIL_TEXT.test(item.raw)) continue;
    known.add(item.id);
    fresh.push({ id: item.id, raw: item.raw, seenAt: now.toISOString() });
  }
  if (fresh.length === 0) return 0;
  const shardName = historyShard(now);
  const shardText = await store.get(shardName);
  const shard = shardText ? (JSON.parse(shardText) as HistoryEntry[]) : [];
  // Shard first: if the second write fails the ids are simply recorded again next run, never lost.
  await store.put(shardName, JSON.stringify([...shard, ...fresh]));
  await store.put(HISTORY_INDEX, JSON.stringify([...known]));
  return fresh.length;
}
