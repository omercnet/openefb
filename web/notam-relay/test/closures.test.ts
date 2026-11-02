import { describe, expect, it } from "vitest";
import { looksLikeRouteClosure, parseClosures } from "../src/parse-notam.js";

// Fixtures are written for these tests from the structure of IAA closure wording, with made-up point codes.
const parse = (e: string) => parseClosures("C0001/26", e, null, null, null);
const sig = (e: string) => parse(e).map((c) => `${c.routeKinds.join("+")}:${c.chain.join("-")}:${c.parsed ? "ok" : "raw"}`);

describe("every sentence is read", () => {
  it("finds the CVFR closure in the second sentence after a HEL/ultralight one", () => {
    const out = parse("ULTRALIGHT AND HEL RTE CLSD BTN ALFAB-BRAVO. CVFR RTE CLSD AT 2,500FT AMSL, AVBL BIDIRECTIONAL AT 3,000FT AMSL CHARL-DELTA.)");
    expect(out.map((c) => [c.routeKinds, c.chain])).toEqual([
      [["ULTRALIGHT", "HEL"], ["ALFAB", "BRAVO"]],
      [["CVFR"], ["CHARL", "DELTA"]],
    ]);
    expect(out[0]).toMatchObject({ routeKind: "ULTRALIGHT", partial: false, parsed: true });
  });

  it("splits one sentence holding two RTE CLSD heads", () => {
    expect(sig("CVFR RTE CLSD ALFAB-BRAVO AND HEL RTE CLSD CHARL-DELTA.")).toEqual(["CVFR:ALFAB-BRAVO:ok", "HEL:CHARL-DELTA:ok"]);
  });

  it("takes chains written before CLSD and after RTE BTN", () => {
    expect(sig("HEL RTE ALFAB-BRAVO-CHARL CLSD.")).toEqual(["HEL:ALFAB-BRAVO-CHARL:ok"]);
    expect(sig("CVFR RTE BTN ALFAB-BRAVO CLSD AT 2,500FT AMSL, AVBL BIDIRECTIONAL AT 3,000FT AMSL.")).toEqual(["CVFR:ALFAB-BRAVO:ok"]);
  });

  it("keeps continuation chains of the first closure, including route designators without BTN", () => {
    const out = parse("ATS RTE CLSD J11 CLSD BTN ALFAB-NAT. J14 NAT-CHARL. Q17 BTN DELTA-ECHOO.");
    expect(out.map((c) => [c.routeName, c.chain.join("-")])).toEqual([["J11", "ALFAB-NAT"], ["J14", "NAT-CHARL"], ["Q17", "DELTA-ECHOO"]]);
  });

  it("a head that names no chain hands its conditions to the chains on the sentences after it", () => {
    const out = parse("CVFR RTE CLSD, EXC PPR FLT FM IAF, TFC WILL BE DIVERTED VIA ALFAB-BRAVO CHARL-DELTA. ECHOO-FOXTR. GOLFO-HOTEL.");
    expect(out.map((c) => [c.chain.join("-"), c.exceptions, c.partial])).toEqual([
      ["ECHOO-FOXTR", ["PPR FLT FM IAF"], true],
      ["GOLFO-HOTEL", ["PPR FLT FM IAF"], true],
    ]);
  });

  it("keeps the closed chain when a detour sentence follows it with no punctuation", () => {
    expect(sig("ULTRALIGHT AND HEL RTE CLSD ALFAB-BRAVO-CHARL TFC WILL BE DIVERTED VIA DELTA-ECHOO")).toEqual(["ULTRALIGHT+HEL:ALFAB-BRAVO-CHARL:ok"]);
  });

  it("does not read detours or prose as closed chains", () => {
    expect(sig("CVFR RTE CLSD, DUE IFR ACT WI LLHS ALFAB-BRAVO-CHARL. TFC WILL BE DIVERTED VIA DELTA-ECHOO-FOXTR.")).toEqual(["CVFR:ALFAB-BRAVO-CHARL:ok"]);
    expect(sig("CVFR RTE CLSD ALFAB-BRAVO, TFC VIA CHARL-DELTA.")).toEqual(["CVFR:ALFAB-BRAVO:ok"]);
    // FLY-PAST is two words, not a chain; the real chain follows it
    expect(sig("ULTRALIGHT RTE CLSD, EXC PARTICIPATING ACFT IN FLY-PAST ALFAB-BRAVO.")).toEqual(["ULTRALIGHT:ALFAB-BRAVO:ok"]);
  });

  it("accepts a non-code token (SHORELINE) and ICAO aerodromes in a chain", () => {
    expect(sig("CVFR RTE CLSD, EXC PPR FLT FM IAF ALFAB-SHORELINE-BRAVO.")).toEqual(["CVFR:ALFAB-SHORELINE-BRAVO:ok"]);
    expect(sig("HEL RTE CLSD ALFAB-LLLV.")).toEqual(["HEL:ALFAB-LLLV:ok"]);
  });

  it("does not take day or unit ranges as chains", () => {
    expect(sig("CVFR RTE CLSD MON-FRI ALFAB-BRAVO.")).toEqual(["CVFR:ALFAB-BRAVO:ok"]);
  });
});

describe("conditions", () => {
  it("models closed and available altitudes (CVFR AND HEL, one sentence)", () => {
    const [c] = parse("CVFR AND HEL RTE CLSD AT 1,200FT AMSL, AVBL BIDIRECTIONAL AT 800FT AMSL ALFAB-BRAVO-CHARL.");
    expect(c).toMatchObject({
      routeKind: "CVFR",
      routeKinds: ["CVFR", "HEL"],
      chain: ["ALFAB", "BRAVO", "CHARL"],
      closedAltitudes: [{ op: "AT", lowerFt: 1200, upperFt: 1200, ref: "AMSL" }],
      availableAltitudes: [{ op: "AT", lowerFt: 800, upperFt: 800, ref: "AMSL", direction: "BIDIRECTIONAL" }],
      exceptions: [],
      partial: true,
      parsed: true,
    });
  });

  it("routeKind keeps CVFR even when it is listed second, so shipped builds still see it", () => {
    expect(parse("HEL AND CVFR RTE CLSD ALFAB-BRAVO.")[0]?.routeKind).toBe("CVFR");
  });

  it("reads available altitude without a direction, with ONLY, and AGL", () => {
    const [c] = parse("CVFR RTE CLSD AT 1,200FT, AVBL AT 800FT AGL ONLY ALFAB-BRAVO.");
    expect(c).toMatchObject({ closedAltitudes: [{ ref: null }], availableAltitudes: [{ upperFt: 800, ref: "AGL", direction: null }], parsed: true });
  });

  it("reads BLW, ABV, BTN limits and flight levels", () => {
    expect(parse("CVFR RTE CLSD BLW 1,500FT AMSL ALFAB-BRAVO.")[0]?.closedAltitudes).toEqual([{ op: "BLW", lowerFt: null, upperFt: 1500, ref: "AMSL" }]);
    expect(parse("HEL RTE CLSD ABV FL100 ALFAB-BRAVO.")[0]?.closedAltitudes).toEqual([{ op: "ABV", lowerFt: 10000, upperFt: null, ref: "FL" }]);
    expect(parse("CVFR RTE CLSD BTN 1,000 AND 2,000FT AMSL ALFAB-BRAVO.")[0]?.closedAltitudes).toEqual([{ op: "BTN", lowerFt: 1000, upperFt: 2000, ref: "AMSL" }]);
  });

  it("keeps exception text raw, whether before or after the chain", () => {
    expect(parse("CVFR RTE CLSD, EXC PPR FLT FM IAF ALFAB-BRAVO-CHARL.")[0]).toMatchObject({ exceptions: ["PPR FLT FM IAF"], partial: true, parsed: true });
    expect(parse("ATS RTE CLSD P68 ALFAB-BRAVO EXC ACFT C/S HFA. Q17 CHARL-DELTA.")[0]).toMatchObject({ routeName: "P68", exceptions: ["ACFT C/S HFA"] });
    expect(parse("ATS RTE CLSD EXC BY ATC P68 BTN ALFAB-BRAVO.")[0]).toMatchObject({ routeName: "P68", exceptions: ["BY ATC"] });
  });

  it("marks 'WILL BE CLSD ...' as a conditional (partial) closure", () => {
    expect(parse("ATS RTE J14 WILL BE CLSD BY-ATC BTN ALFAB-BRAVO.")[0]).toMatchObject({ chain: ["ALFAB", "BRAVO"], exceptions: ["WILL BE CLSD BY-ATC"], partial: true });
  });

  it("a plain closure is not partial", () => {
    expect(parse("CVFR RTE CLSD ALFAB-BRAVO.")[0]).toMatchObject({ partial: false, closedAltitudes: [], availableAltitudes: [], exceptions: [], parsed: true, raw: "CVFR RTE CLSD ALFAB-BRAVO" });
  });
});

describe("never drops a closure-looking clause", () => {
  it("emits no-chain clauses as parsed: false with the raw clause", () => {
    expect(parse("ATS RTE J14 CLSD.")).toMatchObject([{ parsed: false, chain: [], routeName: "J14", raw: "ATS RTE J14 CLSD" }]);
  });

  it("flags an altitude condition it cannot read, keeping the chain so the map can mark it", () => {
    const [c] = parse("CVFR RTE CLSD AT 2,500 METRES, AVBL BIDIRECTIONAL AT HIGHER LEVELS ALFAB-BRAVO.");
    expect(c).toMatchObject({ chain: ["ALFAB", "BRAVO"], parsed: false });
    expect(c?.raw).toContain("AVBL BIDIRECTIONAL");
  });

  it("looksLikeRouteClosure agrees with parseClosures: closure wording always yields at least one entry", () => {
    for (const e of ["CVFR RTE CLSD.", "HEL RTE CLSD ALFAB-BRAVO.", "RTE CLSD DUE FIRING.", "ATS RTES CLSD BTN ALFAB-BRAVO."]) {
      expect(looksLikeRouteClosure(e)).toBe(true);
      expect(parse(e).length).toBeGreaterThan(0);
    }
    for (const e of ["ATS RTE W13 AVBL H24 BTN ALFAB-BRAVO.", "RWY 12 CLSD.", "TWY A CLSD."]) {
      expect(looksLikeRouteClosure(e)).toBe(false);
      expect(parse(e)).toEqual([]);
    }
  });
});
