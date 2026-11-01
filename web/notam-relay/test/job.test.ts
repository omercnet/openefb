import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetch, MAX_AGE_SECONDS, type Env } from "../src/handler.js";
import worker from "../src/index.js";
import type { TextFetcher } from "../src/fetch.js";
import * as job from "../src/job.js";
import type { KVLike, Store } from "../src/storage.js";
import { LIST_URL, detailHtml, listPage, listRowHtml } from "./helpers.js";

class MemoryKV implements KVLike {
  data = new Map<string, string>();
  writes: string[] = [];
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.writes.push(key);
    this.data.set(key, value);
  }
}
const asStore = (kv: MemoryKV): Store => kv;

const okSite: TextFetcher = async (url) =>
  url === LIST_URL
    ? listPage([listRowHtml("1", "C0001/26", "LLLL", "E) CVFR RTE CLSD GALIM-SUVAS.")])
    : detailHtml("C0001/26", "LLLL", "01/11/2026 06:33", "(C0001/26 NOTAMN\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2701010000\nE) CVFR RTE CLSD GALIM-SUVAS.)");

const T0 = new Date("2026-11-01T12:00:00Z");
const minutesLater = (m: number) => new Date(T0.getTime() + m * 60_000);
const req = (path: string, init?: RequestInit) => new Request(`https://relay.test${path}`, init);

describe("scrape job + routes", () => {
  const kv = new MemoryKV();
  const env: Env = { NOTAM_KV: kv };

  it("serves 503 before the first scrape", async () => {
    expect((await handleFetch(req("/notams.json"), env, T0)).status).toBe(503);
    expect((await handleFetch(req("/health"), env, T0)).status).toBe(503);
  });

  it("publishes notams.json with cache and CORS headers on the first run", async () => {
    expect((await job.runScrapeJob(asStore(kv), { fetchText: okSite, delayMs: 0, now: T0 })).status).toBe("ok");
    const res = await handleFetch(req("/notams.json"), env, T0);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const feed = await res.json();
    expect(feed.generatedAt).toBe(T0.toISOString());
    expect(feed.closures).toHaveLength(1);
  });

  it("refuses to hit the IAA again within 15 minutes, and allows it after", async () => {
    const calls: string[] = [];
    const counting: TextFetcher = async (u) => (calls.push(u), okSite(u));
    const early = await job.runScrapeJob(asStore(kv), { fetchText: counting, delayMs: 0, now: minutesLater(10) });
    expect(early).toMatchObject({ status: "skipped" });
    expect(calls).toEqual([]);
    const later = await job.runScrapeJob(asStore(kv), { fetchText: counting, delayMs: 0, now: minutesLater(15) });
    expect(later.status).toBe("ok");
    expect(calls).toEqual([LIST_URL]); // detail came from the cache
  });

  it("does not rewrite the detail cache when nothing changed", async () => {
    kv.writes.length = 0;
    await job.runScrapeJob(asStore(kv), { fetchText: okSite, delayMs: 0, now: minutesLater(30) });
    expect(kv.writes.sort()).toEqual(["meta.json", "notams.json"]);
  });

  it("keeps the last good feed when a scrape fails, and records the error", async () => {
    const down: TextFetcher = async () => {
      throw new Error("HTTP 403 from IAA");
    };
    const out = await job.runScrapeJob(asStore(kv), { fetchText: down, delayMs: 0, now: minutesLater(50) });
    expect(out).toEqual({ status: "error", error: "HTTP 403 from IAA" });
    const feed = await (await handleFetch(req("/notams.json"), env, minutesLater(50))).json();
    expect(feed.generatedAt).toBe(minutesLater(30).toISOString());
    const meta = await job.readMeta(asStore(kv));
    expect(meta.lastError).toBe("HTTP 403 from IAA");
    expect(meta.lastSuccessAt).toBe(minutesLater(30).toISOString());
  });

  it("/health reports the age of the last success and turns unhealthy past 45 minutes", async () => {
    const ok = await handleFetch(req("/health"), env, minutesLater(40)); // 10 min after the last success
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, ageSeconds: 600, lastError: "HTTP 403 from IAA" });
    const stale = await handleFetch(req("/health"), env, minutesLater(30 + MAX_AGE_SECONDS / 60 + 1));
    expect(stale.status).toBe(503);
    expect((await stale.json()).ok).toBe(false);
  });

  it("unknown paths are 404", async () => {
    expect((await handleFetch(req("/nope"), env, T0)).status).toBe(404);
  });
});

describe("POST /run", () => {
  it("is closed without RUN_SECRET and without the bearer token", async () => {
    const kv = new MemoryKV();
    expect((await handleFetch(req("/run", { method: "POST" }), { NOTAM_KV: kv }, T0)).status).toBe(503);
    const env: Env = { NOTAM_KV: kv, RUN_SECRET: "s3cret" };
    expect((await handleFetch(req("/run", { method: "POST" }), env, T0)).status).toBe(401);
    expect((await handleFetch(req("/run", { method: "POST", headers: { authorization: "Bearer nope" } }), env, T0)).status).toBe(401);
  });
});

describe("scheduled handler", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("runs a scrape into KV", async () => {
    const kv = new MemoryKV();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => new Response(await okSite(String(url))));
    await worker.scheduled(undefined, { NOTAM_KV: kv });
    vi.unstubAllGlobals();
    expect(JSON.parse(kv.data.get("meta.json") ?? "{}").lastError).toBeNull();
    expect(kv.data.has("notams.json")).toBe(true);
  });
});
