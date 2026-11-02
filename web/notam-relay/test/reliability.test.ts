import { describe, expect, it } from "vitest";
import { handleFetch, MAX_AGE_SECONDS, type Env } from "../src/handler.js";
import { HttpStatusError, type TextFetcher } from "../src/fetch.js";
import { MAX_HISTORY_IDS, recordHistory } from "../src/history.js";
import { MAX_BACKOFF_MS, MIN_INTERVAL_MS, backoffMs, readMeta, runScrapeJob } from "../src/job.js";
import { htmlText, parseDetailHtml, parseListHtml } from "../src/parse-html.js";
import type { KVLike, Store } from "../src/storage.js";
import type { NotamItem } from "../src/types.js";
import { LIST_URL, detailHtml, listPage, listRowHtml } from "./helpers.js";

class MemoryKV implements KVLike {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
}
const asStore = (kv: MemoryKV): Store => kv;
const T0 = new Date("2026-11-01T12:00:00Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
const req = (path: string, init?: RequestInit) => new Request(`https://relay.test${path}`, init);

const ok: TextFetcher = async (url) =>
  url === LIST_URL
    ? listPage([listRowHtml("1", "C0001/26", "LLLL", "E) CVFR RTE CLSD GALIM-SUVAS.")])
    : detailHtml("C0001/26", "LLLL", "01/11/2026 06:33", "(C0001/26 NOTAMN\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2701010000\nE) CVFR RTE CLSD GALIM-SUVAS.)");
const blocked: TextFetcher = async (url) => {
  throw new HttpStatusError(403, url);
};

describe("backoff after IAA errors", () => {
  it("grows exponentially, starts higher for a block, and is capped", () => {
    expect(backoffMs(0, false)).toBe(MIN_INTERVAL_MS);
    expect(backoffMs(1, false)).toBe(MIN_INTERVAL_MS * 2);
    expect(backoffMs(2, false)).toBe(MIN_INTERVAL_MS * 4);
    expect(backoffMs(1, true)).toBe(MIN_INTERVAL_MS * 4);
    expect(backoffMs(50, true)).toBe(MAX_BACKOFF_MS);
  });

  it("a 403 stops the cron hitting the IAA until the backoff expires, and success resets it", async () => {
    const kv = new MemoryKV();
    const calls: string[] = [];
    const counting = (inner: TextFetcher): TextFetcher => async (u) => (calls.push(u), inner(u));

    expect((await runScrapeJob(asStore(kv), { fetchText: counting(blocked), delayMs: 0, now: T0 })).status).toBe("error");
    const meta = await readMeta(asStore(kv));
    expect(meta.consecutiveFailures).toBe(1);
    expect(Date.parse(meta.nextAttemptAt ?? "")).toBe(T0.getTime() + MIN_INTERVAL_MS * 4); // blocked: 2^(1+1) x 14 min = 56 min

    calls.length = 0;
    const early = await runScrapeJob(asStore(kv), { fetchText: counting(ok), delayMs: 0, now: after(30 * 60_000) });
    expect(early.status).toBe("skipped");
    expect(calls).toEqual([]); // not a single request to the IAA while backing off

    const later = await runScrapeJob(asStore(kv), { fetchText: counting(ok), delayMs: 0, now: after(57 * 60_000) });
    expect(later.status).toBe("ok");
    const healed = await readMeta(asStore(kv));
    expect(healed.consecutiveFailures).toBe(0);
    expect(healed.nextAttemptAt).toBeNull();
  });

  it("a non-block failure backs off less than a block", async () => {
    const kv = new MemoryKV();
    await runScrapeJob(asStore(kv), {
      fetchText: async () => {
        throw new Error("timeout");
      },
      delayMs: 0,
      now: T0,
    });
    expect(Date.parse((await readMeta(asStore(kv))).nextAttemptAt ?? "")).toBe(T0.getTime() + MIN_INTERVAL_MS * 2);
  });
});

describe("feed freshness as the app sees it", () => {
  it("serves a fresh feed with its age and a normal cache lifetime", async () => {
    const kv = new MemoryKV();
    await runScrapeJob(asStore(kv), { fetchText: ok, delayMs: 0, now: T0 });
    const res = await handleFetch(req("/notams.json"), { NOTAM_KV: kv }, after(5 * 60_000));
    expect(res.headers.get("X-Feed-Age-Seconds")).toBe("300");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
    expect(res.headers.get("Warning")).toBeNull();
  });

  it("marks a stale feed with Warning 110, a short cache lifetime and the age", async () => {
    const kv = new MemoryKV();
    await runScrapeJob(asStore(kv), { fetchText: ok, delayMs: 0, now: T0 });
    const res = await handleFetch(req("/notams.json"), { NOTAM_KV: kv }, after((MAX_AGE_SECONDS + 60) * 1000));
    expect(res.status).toBe(200); // the last good data is still served, but flagged
    expect(res.headers.get("Warning")).toContain("110");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(Number(res.headers.get("X-Feed-Age-Seconds"))).toBeGreaterThan(MAX_AGE_SECONDS);
  });

  it("/health exposes the backoff state", async () => {
    const kv = new MemoryKV();
    await runScrapeJob(asStore(kv), { fetchText: ok, delayMs: 0, now: T0 });
    await runScrapeJob(asStore(kv), { fetchText: blocked, delayMs: 0, now: after(20 * 60_000) });
    const body = await (await handleFetch(req("/health"), { NOTAM_KV: kv }, after(21 * 60_000))).json();
    expect(body).toMatchObject({ ok: true, consecutiveFailures: 1 });
    expect(body.nextAttemptAt).toBeTruthy();
  });
});

describe("POST /run auth", () => {
  const env = (kv: MemoryKV): Env => ({ NOTAM_KV: kv, RUN_SECRET: "s3cret" });
  const post = (headers: Record<string, string>) => req("/run", { method: "POST", headers });

  it("rejects a wrong token, a prefix of the token, a longer token and a bare secret", async () => {
    const kv = new MemoryKV();
    for (const auth of ["Bearer s3cre", "Bearer s3cret!", "s3cret", "bearer s3cret", "Bearer "]) {
      expect((await handleFetch(post({ authorization: auth }), env(kv), T0)).status).toBe(401);
    }
    expect((await handleFetch(req("/run", { method: "POST" }), env(kv), T0)).status).toBe(401);
  });

  it("does not run the job for a GET", async () => {
    const kv = new MemoryKV();
    expect((await handleFetch(req("/run", { headers: { authorization: "Bearer s3cret" } }), env(kv), T0)).status).toBe(404);
  });
});

describe("hostile or garbled markup", () => {
  it("out-of-range and surrogate numeric entities do not throw", () => {
    expect(htmlText("a&#99999999;b&#xD800;c&#0;d&#x110000;e")).toBe("a&#99999999;b&#xD800;c&#0;d&#x110000;e");
    expect(htmlText("&#65;&#x42;")).toBe("AB");
  });

  it("a list page of 10k unterminated rows parses in bounded time and yields nothing", () => {
    const started = Date.now();
    const rows = parseListHtml(`<div id="divMainInfo_1"><td class="NotamID">`.repeat(10_000));
    expect(rows).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("an unterminated detail page returns null instead of hanging", () => {
    const started = Date.now();
    expect(parseDetailHtml(`<td class="DetailsBlueLine"><b>`.repeat(5000), "1")).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("script tags and attributes in a NOTAM line are reduced to text, never kept as markup", () => {
    expect(htmlText(`<script>alert(1)</script>E) RWY CLSD <img src=x onerror=alert(1)>`)).toBe("alert(1)E) RWY CLSD ");
  });
});

describe("history store growth", () => {
  const item = (id: string): NotamItem => ({ id, raw: `(${id} NOTAMN\nE) X)` }) as NotamItem;

  it("stops recording at the id cap and refuses to overwrite a corrupt index", async () => {
    const kv = new MemoryKV();
    kv.data.set("history-index.json", JSON.stringify(Array.from({ length: MAX_HISTORY_IDS }, (_, i) => `X${i}`)));
    await expect(recordHistory(kv, [item("C0001/26")], T0)).rejects.toThrow(/stopped/);

    const bad = new MemoryKV();
    bad.data.set("history-index.json", "{not json");
    await expect(recordHistory(bad, [item("C0001/26")], T0)).rejects.toThrow(/not valid JSON/);
    expect(bad.data.get("history-index.json")).toBe("{not json"); // untouched
  });
});
