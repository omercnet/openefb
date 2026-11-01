import { describe, expect, it } from "vitest";
import { parseDetailHtml, parseListHtml, parseSiteDate } from "../src/parse-html.js";
import { applyCancellations, extractCoordinates, parseClosures, parseIcaoDate, parseNotamText, parseQLine } from "../src/parse-notam.js";
import { fixtureText, rawNotam } from "./helpers.js";

const META = { rowId: "1", location: "LLLL", locationDescription: null, created: null };
const parse = (raw: string) => parseNotamText(raw, META, null);

// Saved by the research pass: docs/research/israel-cvfr-samples/iaa-notam-detail.txt (C0005/26)
const C0005 = `(C0005/26 NOTAMR C0731/25
Q) LLLL/QWULW/IV/BO /W /000/005/3231N03455E001
A) LLLL B) 2601010630 C) PERM
E) UAS/UAV ACT WILL TAKE PLACE AT OR-AKIVA INDUSTRY AREA.
   AN AREA BTN THE FLW PSN CLSD FM GND UP TO 500FT AMSL
   N323122E0345511 N323119E0345512 N323119E0345515
   N323123E0345514.
   CTN ADZ.
   DOM AIP, PART A-17, PAGE 10, PARA 3. NISPACH 2 REF.
F) GND G) 500FT AMSL)`;

const dm = (d: number, m: number, s = 0) => d + m / 60 + s / 3600;

describe("list page", () => {
  const rows = parseListHtml(fixtureText("iaa-notam-list-trimmed.html"));

  it("returns one row per NOTAM with row id, number, location and the truncated text", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ rowId: "2074111", id: "C2269/26", location: "LLLL" });
    expect(rows[0]!.summary).toMatch(/^E\) HEL RTE CLSD GALIM-DAROM-ATLIT-HASID\./);
    expect(new Set(rows.map((r) => r.rowId)).size).toBe(10);
  });

  it("ignores page chrome and returns nothing for a block page", () => {
    expect(parseListHtml("<html><body>Request blocked</body></html>")).toEqual([]);
  });
});

describe("detail page", () => {
  const page = parseDetailHtml(fixtureText("iaa-notam-detail-C2269-26.html"), "2074111");

  it("reads title, location and the created stamp (UTC)", () => {
    expect(page?.id).toBe("C2269/26");
    expect(page?.meta).toMatchObject({ rowId: "2074111", location: "LLLL", locationDescription: "Tel-Aviv FIR", created: "2026-10-25T14:31:00.000Z" });
  });

  it("keeps the ICAO text verbatim, line by line", () => {
    expect(page?.raw.split("\n")[0]).toBe("(C2269/26 NOTAMN");
    expect(page?.raw).toContain("D) 0745-1030 1230-1330");
    expect(page?.raw).toContain("   SDTYM-LLLV.)");
  });

  it("returns null when the page holds no NOTAM", () => {
    expect(parseDetailHtml("<html>blocked</html>", "1")).toBeNull();
  });

  it("reads site dates as DD/MM/YYYY", () => {
    expect(parseSiteDate("Created: 01/11/2026 06:33")).toBe("2026-11-01T06:33:00.000Z");
    expect(parseSiteDate("n/a")).toBeNull();
  });

  it("parses the whole item: header, validity, schedule", () => {
    const item = parseNotamText(page!.raw, page!.meta, "C2269/26");
    expect(item).toMatchObject({
      id: "C2269/26",
      type: "NOTAMN",
      references: null,
      validFrom: "2026-10-28T07:45:00.000Z",
      validTo: "2026-10-28T13:30:00.000Z",
      permanent: false,
      d: "0745-1030 1230-1330",
      parsed: true,
      created: "2026-10-25T14:31:00.000Z",
    });
    expect(item.raw).toBe(page!.raw);
  });
});

describe("Q-line", () => {
  it("decodes FIR, code, traffic, purpose, scope, limits, centre and radius", () => {
    const q = parseQLine("LLLL/QWULW/IV/BO /W /000/005/3231N03455E001");
    expect(q).toMatchObject({ fir: "LLLL", code: "QWULW", traffic: "IV", purpose: "BO", scope: "W", lower: 0, upper: 5, radiusNM: 1 });
    expect(q?.centre?.lat).toBeCloseTo(dm(32, 31), 5);
    expect(q?.centre?.lon).toBeCloseTo(dm(34, 55), 5);
  });

  it("handles a single-letter traffic field and southern/western hemispheres", () => {
    const q = parseQLine("LLLL/QANLC/I /NBO/E /050/370/3056S03502W053");
    expect(q?.traffic).toBe("I");
    expect(q?.upper).toBe(370);
    expect(q?.centre?.lat).toBeLessThan(0);
    expect(q?.centre?.lon).toBeLessThan(0);
  });

  it("rejects text that is not a Q-line", () => {
    expect(parseQLine("LLLL/XXXX")).toBeNull();
    expect(parseQLine("LLLL/QWULW/IV/BO/W/ABC/005/3231N03455E001")).toBeNull();
  });
});

describe("coordinates", () => {
  it("reads the hemisphere-first spelling from E)", () => {
    const pts = extractCoordinates("N323122E0345511 N323119E0345512 N323119E0345515 N323123E0345514.");
    expect(pts).toHaveLength(4);
    expect(pts[0]!.lat).toBeCloseTo(dm(32, 31, 22), 5);
    expect(pts[0]!.lon).toBeCloseTo(dm(34, 55, 11), 5);
  });

  it("reads the hemisphere-last spelling and keeps order", () => {
    const pts = extractCoordinates("PSN 323334N0345409E 324716N0345650E");
    expect(pts.map((p) => p.lat.toFixed(4))).toEqual([dm(32, 33, 34).toFixed(4), dm(32, 47, 16).toFixed(4)]);
  });

  it("drops impossible values instead of guessing", () => {
    expect(extractCoordinates("326100N0345409E")).toEqual([]); // 61 minutes
    expect(extractCoordinates("913000N0345409E")).toEqual([]); // 91 degrees
  });

  it("does not mistake flight levels, times or point codes for coordinates", () => {
    expect(extractCoordinates("FM GND UP TO 12,000FT AMSL 0745-1030 GALIM-DAROM FL330")).toEqual([]);
  });
});

describe("dates", () => {
  it("parses YYMMDDHHMM as UTC and rejects junk", () => {
    expect(parseIcaoDate("2610281330")).toBe("2026-10-28T13:30:00.000Z");
    expect(parseIcaoDate("PERM")).toBeNull();
    expect(parseIcaoDate("2613281330")).toBeNull();
  });
});

describe("geometry", () => {
  it("builds a polygon from the E) coordinates (hemisphere-first, C0005/26)", () => {
    const item = parse(C0005);
    expect(item.type).toBe("NOTAMR");
    expect(item.references).toBe("C0731/25");
    expect(item.permanent).toBe(true);
    expect(item.validTo).toBeNull();
    expect(item.geometry.polygon).toHaveLength(4);
    expect(item.geometry.circle).toBeNull();
    expect(item.f).toBe("GND");
    expect(item.g).toBe("500FT AMSL");
  });

  it("builds a polygon from the hemisphere-last list in a live NOTAM (C2261/26)", () => {
    const item = parse(rawNotam("C2261/26"));
    expect(item.geometry.polygon).toHaveLength(9);
    expect(item.geometry.polygon![0]!.lat).toBeCloseTo(dm(32, 33, 34), 5);
  });

  it("uses the radius written in E) around its centre (C2259/26)", () => {
    const item = parse(rawNotam("C2259/26"));
    expect(item.geometry.polygon).toBeNull();
    expect(item.geometry.circle?.radiusNM).toBe(0.54);
    expect(item.geometry.circle?.centre.lat).toBeCloseTo(dm(33, 6, 51), 5);
  });

  it("falls back to the Q-line centre and radius when E) has no position", () => {
    const item = parse(rawNotam("C2269/26"));
    expect(item.geometry.polygon).toBeNull();
    expect(item.geometry.circle?.radiusNM).toBe(8);
    expect(item.geometry.circle?.centre.lat).toBeCloseTo(dm(32, 43), 5);
  });

  it("converts a kilometre radius to nautical miles", () => {
    const item = parse("(X0001/26 NOTAMN\nQ) LLLL/QRTCA/IV/BO /W /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2601020000\nE) AREA WI 1.852KM RADIUS CENTERED ON PSN 320000N0350000E CLSD.)");
    expect(item.geometry.circle?.radiusNM).toBe(1);
  });
});

describe("route closures", () => {
  it("returns every chain of a NOTAM that lists several, with its validity and schedule (C2269/26)", () => {
    const item = parse(rawNotam("C2269/26"));
    expect(item.closures.map((c) => c.chain)).toEqual([
      ["GALIM", "DAROM", "ATLIT", "HASID"],
      ["ATLIT", "FRDIS"],
      ["HOTRM", "LLLV"],
      ["FRDIS", "LLLV"],
      ["SDTYM", "LLLV"],
    ]);
    expect(item.closures.every((c) => c.routeKind === "HEL" && c.routeName === null && c.notamId === "C2269/26")).toBe(true);
    expect(item.closures[0]).toMatchObject({ validFrom: "2026-10-28T07:45:00.000Z", validTo: "2026-10-28T13:30:00.000Z", schedule: "0745-1030 1230-1330" });
  });

  it("reads the CVFR chain and ignores the closing parenthesis (C2267/26)", () => {
    const item = parse(rawNotam("C2267/26"));
    expect(item.closures).toHaveLength(1);
    expect(item.closures[0]).toMatchObject({ routeKind: "CVFR", chain: ["GALIM", "DAROM", "HOTRM", "BOREN", "FRDIS"] });
  });

  it("reads ATS routes with the designator before BTN, several per NOTAM (A0849/26)", () => {
    const item = parse(rawNotam("A0849/26"));
    expect(item.closures.map((c) => [c.routeKind, c.routeName, c.chain.join("-")])).toEqual([
      ["ATS", "P68", "GALIM-MERVA"],
      ["ATS", "Q17", "ATLIT-ZAHAV"],
    ]);
  });

  it("reads the form with the designator before CLSD, including a 3-letter navaid (A0689/26, A0764/26)", () => {
    const q30 = parse(rawNotam("A0689/26"));
    expect(q30.closures).toMatchObject([{ routeKind: "ATS", routeName: "Q30", chain: ["BEXOM", "NURIT"] }]);
    const l53 = parse(rawNotam("A0764/26"));
    expect(l53.closures).toMatchObject([{ routeKind: "ATS", routeName: "L53", chain: ["ABIMI", "BGN"] }]);
  });

  it("reads one-line variants and leaves non-closure routes alone", () => {
    expect(parseClosures("C0001/26", "HEL RTE CLSD  GALIM-SUVAS.)", null, null, null)[0]?.chain).toEqual(["GALIM", "SUVAS"]);
    expect(parseClosures("C0001/26", "CVFR RTE CLSD  TAVOR-DESHE.)", null, null, null)[0]?.chain).toEqual(["TAVOR", "DESHE"]);
    expect(parse(rawNotam("A0622/26")).closures).toEqual([]); // "ATS RTE W13 AVBL ...": availability, not a closure
  });

  it("splits chains on commas and AND, and handles two route kinds in one NOTAM", () => {
    const out = parseClosures("C0002/26", "CVFR RTE CLSD ALFAB-BRAVO, CHARL-DELTA AND ECHOO-FOXTR. HEL RTE CLSD GALIM-SUVAS.", null, null, null);
    expect(out.map((c) => `${c.routeKind}:${c.chain.join("-")}`)).toEqual(["CVFR:ALFAB-BRAVO", "CVFR:CHARL-DELTA", "CVFR:ECHOO-FOXTR", "HEL:GALIM-SUVAS"]);
  });

  it("does not turn prose after the chain into points", () => {
    const out = parseClosures("C0003/26", "ATS RTE L53 CLSD BTN ABIMI-BGN. TFC WITH DEP FM AD SHALL FILE H24 TALMI DCT TAPUZ BTN 11,000-16,000FT.", null, null, null);
    expect(out).toHaveLength(1);
  });

  it("flags a closure sentence it could not read as parsed: false, keeping the raw text", () => {
    const raw = "(C0009/26 NOTAMN\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2601020000\nE) CVFR RTE CLSD BETWEEN THE TWO LAKES.)";
    const item = parse(raw);
    expect(item.closures).toEqual([]);
    expect(item.parsed).toBe(false);
    expect(item.raw).toBe(raw);
  });
});

describe("never drops what it cannot parse", () => {
  it("returns parsed: false with the raw text for free-form garbage", () => {
    const item = parseNotamText("שלום\nnot a notam", META, "C0077/26");
    expect(item.parsed).toBe(false);
    expect(item.raw).toBe("שלום\nnot a notam");
    expect(item.id).toBe("C0077/26");
  });

  it("keeps a NOTAM with a broken Q-line and reads the rest", () => {
    const item = parse("(C0008/26 NOTAMN\nQ) garbage\nA) LLBO B) 2601010000 C) 2601020000\nE) AIRSTRIP CLSD TO ALL FLT.)");
    expect(item.q).toBeNull();
    expect(item.e).toBe("AIRSTRIP CLSD TO ALL FLT.");
    expect(item.parsed).toBe(true);
  });
});

describe("cancellation", () => {
  const mk = (id: string, type: "NOTAMN" | "NOTAMR" | "NOTAMC", ref?: string) =>
    parse(`(${id} ${type}${ref ? ` ${ref}` : ""}\nQ) LLLL/QARLC/IV/NBO/E /000/050/3200N03500E005\nA) LLLL B) 2601010000 C) 2701010000\nE) ${type === "NOTAMC" ? "CVFR RTE CLSD" : "CVFR RTE CLSD GALIM-SUVAS."}.)`);

  it("marks the referenced NOTAM cancelled by a NOTAMC and replaced by a NOTAMR", () => {
    const items = [mk("C0001/26", "NOTAMN"), mk("C0002/26", "NOTAMC", "C0001/26"), mk("C0003/26", "NOTAMN"), mk("C0004/26", "NOTAMR", "C0003/26"), mk("C0005/26", "NOTAMR", "C0000/25")];
    applyCancellations(items);
    expect(items[0]).toMatchObject({ cancelledBy: "C0002/26", replacedBy: null });
    expect(items[2]).toMatchObject({ cancelledBy: null, replacedBy: "C0004/26" });
    expect(items[1]!.closures).toEqual([]); // the NOTAMC itself closes nothing
    expect(items[4]!.replacedBy).toBeNull(); // references a NOTAM not in the feed: nothing to mark, nothing dropped
    expect(items).toHaveLength(5);
  });
});
