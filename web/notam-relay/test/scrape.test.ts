import { describe, expect, it } from "vitest";
import { PARSER_VERSION, scrape, type DetailCache } from "../src/build.js";
import type { TextFetcher } from "../src/fetch.js";
import { LIST_URL, detailHtml, detailUrl, listPage, listRowHtml } from "./helpers.js";

const ICAO = (id: string, type: string, ref: string, e: string) =>
  `(${id} ${type}${ref ? ` ${ref}` : ""}\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2701010000\nE) ${e})`;

interface Row {
  rowId: string;
  id: string;
  type?: string;
  ref?: string;
  e: string;
  summary?: string;
}

interface FakeSite {
  fetchText: TextFetcher;
  /** every URL requested, in order */
  requests: string[];
}

function fakeSite(rows: Row[], failDetail: string[] = []): FakeSite {
  const requests: string[] = [];
  const fetchText: TextFetcher = async (url) => {
    requests.push(url);
    if (url === LIST_URL) return listPage(rows.map((r) => listRowHtml(r.rowId, r.id, "LLLL", r.summary ?? `E) ${r.e}`)));
    const row = rows.find((r) => detailUrl(r.rowId) === url);
    if (!row || failDetail.includes(row.rowId)) throw new Error("HTTP 500");
    return detailHtml(row.id, "LLLL", "01/11/2026 06:33", ICAO(row.id, row.type ?? "NOTAMN", row.ref ?? "", row.e));
  };
  return { fetchText, requests };
}

const NOW = new Date("2026-11-01T12:00:00Z");
const run = (site: FakeSite, cache: DetailCache = {}, extra: Partial<Parameters<typeof scrape>[0]> = {}) =>
  scrape({ fetchText: site.fetchText, delayMs: 0, cache, now: () => NOW, ...extra });

describe("scrape", () => {
  const rows: Row[] = [
    { rowId: "10", id: "C0010/26", e: "CVFR RTE CLSD GALIM-DAROM-HOTRM." },
    { rowId: "11", id: "C0011/26", e: "HEL RTE CLSD GALIM-SUVAS." },
    { rowId: "12", id: "C0012/26", e: "AIRSTRIP CLSD." },
  ];

  it("builds the feed: generatedAt, source, items in list order, closures flattened", async () => {
    const { feed, stats } = await run(fakeSite(rows));
    expect(feed.generatedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(feed.source.listUrl).toBe(LIST_URL);
    expect(feed.items.map((i) => i.id)).toEqual(["C0010/26", "C0011/26", "C0012/26"]);
    expect(feed.closures.map((c) => c.chain.join("-"))).toEqual(["GALIM-DAROM-HOTRM", "GALIM-SUVAS"]);
    expect(stats).toEqual({ rows: 3, fetched: 3, cached: 0, failed: 0, deferred: 0 });
  });

  it("drops closures of a NOTAM cancelled by a NOTAMC from the flat list but keeps both items", async () => {
    const withCancel: Row[] = [...rows, { rowId: "13", id: "C0013/26", type: "NOTAMC", ref: "C0010/26", e: "CVFR RTE CLSD GALIM-DAROM-HOTRM." }];
    const { feed } = await run(fakeSite(withCancel));
    expect(feed.items).toHaveLength(4);
    expect(feed.items.find((i) => i.id === "C0010/26")?.cancelledBy).toBe("C0013/26");
    expect(feed.closures.map((c) => c.notamId)).toEqual(["C0011/26"]);
  });

  it("drops closures of a replaced NOTAM", async () => {
    const withReplace: Row[] = [...rows, { rowId: "14", id: "C0014/26", type: "NOTAMR", ref: "C0011/26", e: "HEL RTE CLSD GALIM-KONFO." }];
    const { feed } = await run(fakeSite(withReplace));
    expect(feed.items.find((i) => i.id === "C0011/26")?.replacedBy).toBe("C0014/26");
    expect(feed.closures.map((c) => c.chain.join("-")).sort()).toEqual(["GALIM-DAROM-HOTRM", "GALIM-KONFO"]);
  });

  it("reuses cached details and requests only the list when nothing changed", async () => {
    const first = await run(fakeSite(rows));
    const site = fakeSite(rows);
    const second = await run(site, first.cache);
    expect(site.requests).toEqual([LIST_URL]);
    expect(second.stats).toMatchObject({ fetched: 0, cached: 3 });
    expect(second.feed.items).toEqual(first.feed.items);
  });

  it("reuses cached items without re-parsing while the parser version matches", async () => {
    const first = await run(fakeSite(rows));
    const tampered: DetailCache = structuredClone(first.cache);
    tampered["10"]!.item.closures = [];
    const site = fakeSite(rows);
    const { feed } = await run(site, tampered);
    expect(site.requests).toEqual([LIST_URL]);
    expect(feed.items[0]!.closures).toEqual([]); // taken from the cache verbatim
  });

  it("re-parses cached raw text once when the cache was written by an older parser version", async () => {
    const first = await run(fakeSite(rows));
    const stale: DetailCache = structuredClone(first.cache);
    stale["10"]!.item.closures = [];
    stale["10"]!.item.parsed = false;
    const site = fakeSite(rows);
    const { feed, cache } = await run(site, stale, { cacheParserVersion: PARSER_VERSION - 1 });
    expect(site.requests).toEqual([LIST_URL]);
    expect(feed.items[0]).toMatchObject({ parsed: true });
    expect(feed.items[0]!.closures).toHaveLength(1);
    expect(cache["10"]!.item.closures).toHaveLength(1);
  });

  it("stops fetching details at the request cap; the rest stay unparsed and uncached for the next run", async () => {
    const site = fakeSite(rows);
    const { feed, cache, stats } = await run(site, {}, { maxDetailRequests: 2 });
    expect(site.requests).toEqual([LIST_URL, detailUrl("10"), detailUrl("11")]);
    expect(feed.items.map((i) => i.parsed)).toEqual([true, true, false]);
    expect(stats).toMatchObject({ fetched: 2, failed: 0, deferred: 1 });
    expect(Object.keys(cache)).toEqual(["10", "11"]);
  });

  it("refetches a row whose list text changed, and a row that is new", async () => {
    const first = await run(fakeSite(rows));
    const edited: Row[] = [{ ...rows[0]!, summary: "E) CVFR RTE CLSD GALIM-DAROM." }, rows[1]!, rows[2]!, { rowId: "15", id: "C0015/26", e: "AIRSTRIP CLSD." }];
    const site = fakeSite(edited);
    await run(site, first.cache);
    expect(site.requests).toEqual([LIST_URL, detailUrl("10"), detailUrl("15")]);
  });

  it("forgets cache entries for rows that left the list", async () => {
    const first = await run(fakeSite(rows));
    const { cache } = await run(fakeSite(rows.slice(0, 1)), first.cache);
    expect(Object.keys(cache)).toEqual(["10"]);
  });

  it("keeps a NOTAM whose detail page failed, from the list text, flagged parsed: false", async () => {
    const { feed, cache, stats } = await run(fakeSite(rows, ["11"]));
    const kept = feed.items.find((i) => i.id === "C0011/26");
    expect(kept).toMatchObject({ parsed: false, rowId: "11", location: "LLLL", raw: "E) HEL RTE CLSD GALIM-SUVAS." });
    expect(stats).toMatchObject({ fetched: 2, failed: 1 });
    expect(cache["11"]).toBeUndefined(); // retried on the next run
  });

  it("sleeps between detail requests but not before the first", async () => {
    const started = Date.now();
    await scrape({ fetchText: fakeSite(rows.slice(0, 2)).fetchText, delayMs: 120, cache: {} });
    expect(Date.now() - started).toBeGreaterThanOrEqual(110); // one gap for two detail requests
    expect(Date.now() - started).toBeLessThan(230);
  });

  it("fails when the list has no rows (layout change or block page) rather than publishing an empty feed", async () => {
    const fetchText: TextFetcher = async () => "<html><body>Request blocked</body></html>";
    await expect(scrape({ fetchText, delayMs: 0, cache: {} })).rejects.toThrow(/no NOTAM rows/);
  });
});
