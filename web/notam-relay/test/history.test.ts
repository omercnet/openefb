import { describe, expect, it } from "vitest";
import { HISTORY_INDEX, historyShard, recordHistory, type HistoryEntry } from "../src/history.js";
import { parseNotamText } from "../src/parse-notam.js";
import type { Store } from "../src/storage.js";

class CountingStore implements Store {
  data = new Map<string, string>();
  writes: string[] = [];
  async get(name: string) {
    return this.data.get(name) ?? null;
  }
  async put(name: string, body: string) {
    this.writes.push(name);
    this.data.set(name, body);
  }
}

const META = { rowId: "1", location: "LLLL", locationDescription: null, created: null };
const notam = (id: string) => parseNotamText(`(${id} NOTAMN\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2701010000\nE) CVFR RTE CLSD ALFAB-BRAVO.)`, META, id);
const DAY1 = new Date("2026-11-01T06:00:00Z");
const DAY2 = new Date("2026-11-02T06:00:00Z");

describe("NOTAM history", () => {
  it("records new NOTAMs with their raw text in one shard plus the index: two writes however many are new", async () => {
    const store = new CountingStore();
    expect(await recordHistory(store, [notam("C0001/26"), notam("C0002/26"), notam("C0003/26")], DAY1)).toBe(3);
    expect(store.writes).toEqual([historyShard(DAY1), HISTORY_INDEX]);
    const shard = JSON.parse(store.data.get(historyShard(DAY1))!) as HistoryEntry[];
    expect(shard.map((e) => e.id)).toEqual(["C0001/26", "C0002/26", "C0003/26"]);
    expect(shard[0]?.raw).toContain("CVFR RTE CLSD ALFAB-BRAVO");
    expect(shard[0]?.seenAt).toBe(DAY1.toISOString());
  });

  it("writes nothing when nothing is new, and appends only the new ones the next day", async () => {
    const store = new CountingStore();
    await recordHistory(store, [notam("C0001/26")], DAY1);
    store.writes = [];
    expect(await recordHistory(store, [notam("C0001/26")], DAY1)).toBe(0);
    expect(store.writes).toEqual([]);
    expect(await recordHistory(store, [notam("C0001/26"), notam("C0004/26")], DAY2)).toBe(1);
    expect(store.writes).toEqual([historyShard(DAY2), HISTORY_INDEX]);
    expect(JSON.parse(store.data.get(HISTORY_INDEX)!)).toEqual(["C0001/26", "C0004/26"]);
  });

  it("appends to the same day's shard across runs", async () => {
    const store = new CountingStore();
    await recordHistory(store, [notam("C0001/26")], DAY1);
    await recordHistory(store, [notam("C0002/26")], new Date("2026-11-01T18:00:00Z"));
    expect((JSON.parse(store.data.get(historyShard(DAY1))!) as HistoryEntry[]).map((e) => e.id)).toEqual(["C0001/26", "C0002/26"]);
  });

  it("does not record a list-page fallback (truncated summary), so the full text is stored when it arrives", async () => {
    const store = new CountingStore();
    const fallback = { ...notam("C0005/26"), raw: "E) CVFR RTE CLSD ALFAB-BRA" };
    expect(await recordHistory(store, [fallback], DAY1)).toBe(0);
    expect(await recordHistory(store, [notam("C0005/26")], DAY2)).toBe(1);
  });
});
