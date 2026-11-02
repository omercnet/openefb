import type { AltitudeLimit, AvailableAltitude, Geometry, LatLon, NotamItem, QLine, RouteClosure } from "./types.js";

const NOTAM_ID = /^[A-Z]\d{4}\/\d{2}$/;

/** "YYMMDDHHMM" (UTC) → ISO 8601, or null when malformed. */
export function parseIcaoDate(s: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [yy, mo, dd, hh, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 24 || mi > 59) return null;
  const d = new Date(Date.UTC(2000 + yy, mo - 1, dd, hh, mi));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** DMS or DM to decimal degrees. */
function dms(deg: string, min: string, sec: string | undefined, neg: boolean): number | null {
  const d = Number(deg);
  const m = Number(min);
  const s = sec === undefined ? 0 : Number(sec);
  if (m >= 60 || s >= 60) return null;
  const v = d + m / 60 + s / 3600;
  return neg ? -v : v;
}

function mkPoint(lat: number | null, lon: number | null): LatLon | null {
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round(lat), lon: round(lon) };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Every coordinate in free text, in order of appearance. Handles both IAA spellings:
 * `N323122E0345511` (hemisphere first) and `323334N0345409E` (hemisphere last), with or
 * without seconds.
 */
export function extractCoordinates(text: string): LatLon[] {
  const found: { index: number; point: LatLon }[] = [];
  const prefix = /(?<![A-Z0-9])([NS])(\d{2})(\d{2})(\d{2})?\s?([EW])(\d{3})(\d{2})(\d{2})?(?![0-9])/g;
  const suffix = /(?<![A-Z0-9])(\d{2})(\d{2})(\d{2})?([NS])\s?(\d{3})(\d{2})(\d{2})?([EW])(?![A-Z0-9])/g;
  for (const m of text.matchAll(prefix)) {
    const p = mkPoint(dms(m[2]!, m[3]!, m[4], m[1] === "S"), dms(m[6]!, m[7]!, m[8], m[5] === "W"));
    if (p) found.push({ index: m.index ?? 0, point: p });
  }
  for (const m of text.matchAll(suffix)) {
    const p = mkPoint(dms(m[1]!, m[2]!, m[3], m[4] === "S"), dms(m[5]!, m[6]!, m[7], m[8] === "W"));
    if (p) found.push({ index: m.index ?? 0, point: p });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.point);
}

/** `LLLL/QARLC/IV/NBO/E /010/025/3243N03458E008` */
export function parseQLine(q: string): QLine | null {
  const parts = q.split("/").map((p) => p.trim());
  if (parts.length < 8) return null;
  const [fir, code, traffic, purpose, scope, lower, upper, geo] = parts as [string, string, string, string, string, string, string, string];
  if (!/^[A-Z]{4}$/.test(fir) || !/^Q[A-Z]{4}$/.test(code)) return null;
  if (!/^\d{3}$/.test(lower) || !/^\d{3}$/.test(upper)) return null;
  let centre: LatLon | null = null;
  let radiusNM: number | null = null;
  const g = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?$/.exec(geo);
  if (g) {
    centre = mkPoint(dms(g[1]!, g[2]!, undefined, g[3] === "S"), dms(g[4]!, g[5]!, undefined, g[6] === "W"));
    radiusNM = g[7] === undefined ? null : Number(g[7]);
  }
  return { fir, code, traffic, purpose, scope, lower: Number(lower), upper: Number(upper), centre, radiusNM };
}

interface Fields {
  header: string;
  q?: string;
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  e?: string;
  f?: string;
  g?: string;
}

const LETTERS = ["Q", "A", "B", "C", "D", "E", "F", "G"] as const;

/** Split an ICAO NOTAM into its lettered fields. Letters are searched in order, so a "D)" inside E) text is safe. */
function splitFields(raw: string): Fields {
  const marks: { letter: (typeof LETTERS)[number]; start: number; end: number }[] = [];
  let pos = 0;
  for (const letter of LETTERS) {
    const re = new RegExp(`(^|\\s)${letter}\\)\\s?`, "g");
    re.lastIndex = pos;
    const m = re.exec(raw);
    if (!m) continue;
    const start = m.index + (m[1]?.length ?? 0);
    const end = re.lastIndex;
    marks.push({ letter, start, end });
    pos = end;
  }
  const out: Fields = { header: raw.slice(0, marks[0]?.start ?? raw.length).trim() };
  marks.forEach((mk, i) => {
    const next = marks[i + 1]?.start ?? raw.length;
    let body = raw.slice(mk.end, next).trim();
    if (i === marks.length - 1) body = body.replace(/\)\s*$/, "").trim();
    out[mk.letter.toLowerCase() as "q"] = body;
  });
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Route-closure parsing. IAA wording seen in real NOTAMs (structure only, see test/parse.test.ts):
 *   CVFR RTE CLSD A-B-C.                              HEL RTE LIAAD-MARIB CLSD.
 *   CVFR AND HEL RTE CLSD AT 1,200FT AMSL, AVBL BIDIRECTIONAL AT 800FT AMSL A-B-C.
 *   CVFR RTE CLSD, EXC PPR FLT FM IAF A-SHORELINE-B.  ATS RTE CLSD P68 BTN A-B. Q17 C-D.
 *   ULTRALIGHT AND HEL RTE CLSD BTN A-B. CVFR RTE CLSD AT 2,500FT AMSL, AVBL ... C-D.
 * One sentence (or "RTE ... CLSD" segment of a sentence) is one clause; every chain in it shares the clause's
 * conditions. A clause that looks like a closure is NEVER dropped: when it cannot be read in full it is
 * emitted with `parsed: false` and its raw text.
 */

/** Words that are part of a published chain although they are not 5-letter point codes. */
const NON_CODE_TOKENS = ["SHORELINE"];
const TOK = `(?:${NON_CODE_TOKENS.join("|")}|[A-Z]{3,5})(?![A-Z0-9])`;
/** A hyphen-joined run of tokens; 3-letter navaids (BGN, NAT) and ICAO aerodromes (LLLV) are valid members. */
const CHAIN_RUN = new RegExp(`(?<![A-Z0-9-])${TOK}(?:\\s*-\\s*${TOK})+`, "g");
/** Kind list right before RTE: "CVFR", "ULTRALIGHT AND HEL", "CVFR, HEL". */
const KIND_LIST = /(?<![A-Z0-9-])((?:[A-Z]+)(?:(?:\s*,\s*|\s+AND\s+|\s*\/\s*)[A-Z]+)*)\s*$/;
const RTE = /\bRTES?\b/g;
const CLSD = /\b(?:CLSD|CLOSED)\b/;
/** Wording that describes where traffic goes instead: its chains are detours, not closures. */
const DETOUR = /(?:\bTFC\s+(?:WILL\s+BE\s+)?)?\b(?:VIA|DIVERT\w*|RE-?ROUT\w*|RADAR VECT\w*|DCT|PROCEED)\b/;

// Altitudes: "1,200FT AMSL", "800FT", "FL100". The first limit of a BTN pair may omit FT ("11,000-16,000FT").
const ALT_FULL = String.raw`(?:FL\s*\d{2,3}|\d[\d,]*\s*FT)(?:\s*(?:AMSL|AGL))?`;
const ALT_LEAD = String.raw`(?:FL\s*\d{2,3}|\d[\d,]*)(?:\s*FT)?(?:\s*(?:AMSL|AGL))?`;
const LIMIT = String.raw`(?:(AT|BLW|ABV)\s+(${ALT_FULL})|BTN\s+(${ALT_LEAD})\s+(?:AND|TO|-)\s+(${ALT_FULL}))`;
const CLOSED_ALT = new RegExp(String.raw`\b(?:CLSD|CLOSED)\s+${LIMIT}`, "g");
const AVBL_ALT = new RegExp(String.raw`\bAVBL\s+(BIDIRECTIONAL\s+)?${LIMIT}`, "g");

function parseAltitude(text: string): { feet: number; ref: AltitudeLimit["ref"] } | null {
  const fl = /FL\s*(\d{2,3})/.exec(text);
  const ref = /AMSL/.test(text) ? "AMSL" : /AGL/.test(text) ? "AGL" : null;
  if (fl) return { feet: Number(fl[1]) * 100, ref: "FL" }; // flight level, standard pressure
  const n = /(\d[\d,]*)/.exec(text);
  const feet = n ? Number(n[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(feet) ? { feet, ref } : null;
}

function toLimit(op: string | undefined, single: string | undefined, lead: string | undefined, upper: string | undefined): AltitudeLimit | null {
  if (op && single) {
    const a = parseAltitude(single);
    if (!a) return null;
    const o = op as "AT" | "BLW" | "ABV";
    return { op: o, lowerFt: o === "BLW" ? null : a.feet, upperFt: o === "ABV" ? null : a.feet, ref: a.ref };
  }
  if (lead && upper) {
    const lo = parseAltitude(lead), hi = parseAltitude(upper);
    if (!lo || !hi) return null;
    return { op: "BTN", lowerFt: Math.min(lo.feet, hi.feet), upperFt: Math.max(lo.feet, hi.feet), ref: hi.ref ?? lo.ref };
  }
  return null;
}

function validRuns(text: string): { index: number; chain: string[] }[] {
  const out: { index: number; chain: string[] }[] = [];
  for (const m of text.matchAll(CHAIN_RUN)) {
    const chain = m[0].split(/\s*-\s*/);
    // 3- and 4-letter-only runs (FLY-PAST, MON-FRI, AMSL-AGL) are prose; a point code is 5 letters, an aerodrome LLxx.
    if (chain.some((t) => t.length === 5 || NON_CODE_TOKENS.includes(t) || /^LL[A-Z]{2}$/.test(t))) out.push({ index: m.index ?? 0, chain });
  }
  return out;
}

interface Head {
  kinds: string[];
  /** start of the kind list in the sentence */
  start: number;
  rteAt: number;
}

/** Every "<kinds> RTE" in a sentence, in order. */
function findHeads(sentence: string): Head[] {
  const heads: Head[] = [];
  for (const m of sentence.matchAll(RTE)) {
    const rteAt = m.index ?? 0;
    const k = KIND_LIST.exec(sentence.slice(0, rteAt));
    const kinds = k ? k[1]!.split(/\s*,\s*|\s+AND\s+|\s*\/\s*/).filter((w) => w && w !== "AND") : [];
    heads.push({ kinds: [...new Set(kinds)], start: k ? (k.index ?? rteAt) : rteAt, rteAt });
  }
  return heads;
}

/** Sentence split that keeps "1,200FT" and "0.5NM" whole. */
const sentences = (text: string): string[] =>
  text
    .split(/\.(?=\s|$|\))/)
    .map((s) => s.replace(/^\s*E\)\s*/, "").replace(/\)\s*$/, "").trim())
    .filter(Boolean);

/** True when E) contains wording that closes a route. Used by the corpus harness and the item's `parsed` flag. */
export function looksLikeRouteClosure(eText: string): boolean {
  return sentences(collapse(eText)).some((s) => findHeads(s).some((h) => CLSD.test(s.slice(h.rteAt))));
}

/** What a clause says about the closure, apart from which chains it names. */
interface Conditions {
  closedAltitudes: AltitudeLimit[];
  availableAltitudes: AvailableAltitude[];
  exceptions: string[];
  partial: boolean;
  /** wording about altitudes (AVBL, AT n FT) that the model could not read */
  unread: boolean;
}

function buildClauses(
  notamId: string,
  clause: string,
  kinds: string[],
  fallbackName: string | null,
  validFrom: string | null,
  validTo: string | null,
  schedule: string | null,
  inherited: Conditions | null = null,
): { clauses: RouteClosure[]; conditions: Conditions } {
  // Detour wording ("TFC WILL BE DIVERTED VIA GALIM-DAROM") describes other traffic: cut each piece at it.
  const text = clause
    .split(/\s*(?:(?<!\d),|,(?!\d)|;)\s*/) // a comma inside "2,500FT" is not a separator
    .map((p) => p.slice(0, DETOUR.exec(p)?.index ?? p.length))
    .filter(Boolean)
    .join(", ");
  const runs = validRuns(text);
  const closedAltitudes: AltitudeLimit[] = [];
  for (const m of text.matchAll(CLOSED_ALT)) {
    const l = toLimit(m[1], m[2], m[3], m[4]);
    if (l) closedAltitudes.push(l);
  }
  const availableAltitudes: AvailableAltitude[] = [];
  for (const m of text.matchAll(AVBL_ALT)) {
    const l = toLimit(m[2], m[3], m[4], m[5]);
    if (l) availableAltitudes.push({ ...l, direction: m[1] ? "BIDIRECTIONAL" : null });
  }
  const exceptions: string[] = [];
  const exc = /\bEXC(?:EPT)?\b\s*/.exec(text);
  if (exc) {
    const start = (exc.index ?? 0) + exc[0].length;
    const next = runs.find((r) => r.index >= start);
    const body = text
      .slice(start, next ? next.index : text.length)
      .replace(/\s+(?:[A-Z]\d{1,3}\s+)?(?:BTN\s*)?$/, "") // a route name or BTN that introduces the chain
      .replace(/[\s,;]+$/, "")
      .trim();
    if (body) exceptions.push(body);
  }
  const will = /\bWILL BE CLSD(?:\s+(?:BY-ATC|BY ATC|IN REAL TIME))?/.exec(text);
  if (will) exceptions.push(will[0]);

  const own: Conditions = {
    closedAltitudes,
    availableAltitudes,
    exceptions,
    partial: closedAltitudes.length > 0 || availableAltitudes.length > 0 || exceptions.length > 0,
    unread:
      (/\bAVBL\b/.test(text) && availableAltitudes.length === 0) ||
      (/\b(?:AT|BLW|ABV)\s+(?:FL\s*)?\d/.test(text) && closedAltitudes.length + availableAltitudes.length === 0),
  };
  const conditions: Conditions = inherited
    ? {
        closedAltitudes: [...inherited.closedAltitudes, ...own.closedAltitudes],
        availableAltitudes: [...inherited.availableAltitudes, ...own.availableAltitudes],
        exceptions: [...inherited.exceptions, ...own.exceptions],
        partial: inherited.partial || own.partial,
        unread: inherited.unread || own.unread,
      }
    : own;
  // Old shipped builds read only `routeKind`: put CVFR first when the clause covers it.
  const routeKind = kinds.includes("CVFR") ? "CVFR" : (kinds[0] ?? "");
  const { unread, ...fields } = conditions;
  const base = { notamId, routeKind, routeKinds: kinds, validFrom, validTo, schedule, ...fields, raw: clause };

  if (runs.length === 0) {
    return { clauses: [{ ...base, routeName: fallbackName, chain: [], parsed: false }], conditions };
  }
  const clauses = runs.map((r) => {
    const named = /([A-Z]\d{1,3})\s+(?:CLSD\s+)?(?:BTN\s+)?$/.exec(text.slice(0, r.index));
    return { ...base, routeName: named?.[1] ?? fallbackName, chain: r.chain, parsed: !unread };
  });
  return { clauses, conditions };
}

/**
 * Every closure clause of E): all sentences, every route kind, every chain. Altitude conditions, exceptions and
 * "available at" altitudes are modelled; a clause that cannot be read in full comes back `parsed: false`.
 */
export function parseClosures(
  notamId: string,
  eText: string,
  validFrom: string | null,
  validTo: string | null,
  schedule: string | null,
): RouteClosure[] {
  const out: RouteClosure[] = [];
  // The previous closure sentence. When it named no chain itself ("CVFR RTE CLSD, EXC PPR FLT. A-B. C-D."), the
  // chains on the sentences that follow are its chains and take its conditions; otherwise they stand alone.
  let last: { kinds: string[]; inherit: Conditions | null; placeholder: number | null } | null = null;
  for (const sentence of sentences(collapse(eText))) {
    const heads = findHeads(sentence).filter((h) => CLSD.test(sentence.slice(h.rteAt)));
    if (heads.length > 0) {
      for (const [i, h] of heads.entries()) {
        const segment = sentence.slice(h.start, heads[i + 1]?.start ?? sentence.length).trim();
        const name = /\bRTES?\s+(?:CLSD\s+)?([A-Z]\d{1,3})\b/.exec(segment)?.[1] ?? null;
        const built = buildClauses(notamId, segment, h.kinds, name, validFrom, validTo, schedule);
        const chainless = built.clauses.every((c) => c.chain.length === 0);
        last = { kinds: h.kinds, inherit: chainless ? built.conditions : null, placeholder: chainless ? out.length : null };
        out.push(...built.clauses);
      }
      continue;
    }
    // "ATLIT-FRDIS." / "J14 NAT-ZACCI." / "Q17 BTN C-D.": another chain of the previous closure.
    const lead = /^(?:[A-Z]\d{1,3}\s+)?(?:BTN\s+)?/.exec(sentence)?.[0].length ?? 0;
    const first = validRuns(sentence)[0];
    if (last && first && first.index === lead) {
      const built = buildClauses(notamId, sentence, last.kinds, null, validFrom, validTo, schedule, last.inherit);
      if (last.placeholder !== null) {
        out.splice(last.placeholder, 1); // the chain-less head is accounted for by the chains that follow it
        last.placeholder = null;
      }
      out.push(...built.clauses);
    }
  }
  return out;
}

function parseGeometry(e: string, q: QLine | null): Geometry {
  const text = collapse(e);
  const coords = extractCoordinates(text);
  // "WI 0.54NM RADIUS CENTERED ON PSN 330651N0353618E"
  const rad = /(\d+(?:\.\d+)?)\s*(NM|KM)\s+RADIUS/.exec(text);
  if (rad && coords.length >= 1) {
    const value = Number(rad[1]);
    const nm = rad[2] === "KM" ? value / 1.852 : value;
    return { polygon: null, circle: { centre: coords[0]!, radiusNM: round(nm) } };
  }
  if (coords.length >= 3) {
    const ring = [...coords];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first.lat === last.lat && first.lon === last.lon) ring.pop();
    if (ring.length >= 3) return { polygon: ring, circle: null };
  }
  if (q?.centre && q.radiusNM !== null) return { polygon: null, circle: { centre: q.centre, radiusNM: q.radiusNM } };
  return { polygon: null, circle: null };
}

export interface DetailMeta {
  rowId: string;
  location: string;
  locationDescription: string | null;
  created: string | null;
}

/**
 * Parse the ICAO text of one NOTAM. Never throws and never drops: when the structure isn't
 * recognised the item is returned with `parsed: false` and the raw text.
 */
export function parseNotamText(raw: string, meta: DetailMeta, listId: string | null): NotamItem {
  const base: NotamItem = {
    rowId: meta.rowId,
    id: listId ?? "",
    type: null,
    references: null,
    location: meta.location,
    locationDescription: meta.locationDescription,
    created: meta.created,
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
    raw,
  };
  try {
    const f = splitFields(raw);
    const head = /^\(?\s*([A-Z]\d{4}\/\d{2})\s+(NOTAM[NRC])(?:\s+([A-Z]\d{4}\/\d{2}))?/.exec(f.header);
    if (head) {
      base.id = head[1]!;
      base.type = head[2] as NotamItem["type"];
      base.references = head[3] ?? null;
    }
    if (!NOTAM_ID.test(base.id)) return base;

    base.q = f.q ? parseQLine(f.q) : null;
    base.a = f.a ? collapse(f.a) : null;
    base.validFrom = f.b ? parseIcaoDate(f.b) : null;
    if (f.c !== undefined) {
      const c = collapse(f.c);
      base.permanent = /^PERM/.test(c);
      base.estimated = /\bEST\b/.test(c);
      base.validTo = base.permanent ? null : parseIcaoDate(c.replace(/\s*EST$/, ""));
    }
    base.d = f.d ? collapse(f.d) : null;
    base.e = f.e ? collapse(f.e) : null;
    base.f = f.f ? collapse(f.f) : null;
    base.g = f.g ? collapse(f.g) : null;

    if (f.e) {
      base.geometry = parseGeometry(f.e, base.q);
      // A NOTAMC only withdraws an earlier NOTAM; any closure wording it repeats is not a new closure.
      if (base.type !== "NOTAMC") base.closures = parseClosures(base.id, f.e, base.validFrom, base.validTo, base.d);
    }
    // A route-closure sentence we could not read in full is flagged, so nobody trusts a clean closure list.
    const mentionsRoute = base.type !== "NOTAMC" && looksLikeRouteClosure(f.e ?? "");
    base.parsed = Boolean(head && base.validFrom && f.e !== undefined) && (!mentionsRoute || (base.closures.length > 0 && base.closures.every((c) => c.parsed)));
    return base;
  } catch {
    base.parsed = false;
    return base;
  }
}

/** Mark NOTAMs cancelled (NOTAMC) or replaced (NOTAMR) by a later item in the same feed. */
export function applyCancellations(items: NotamItem[]): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    if (!item.references) continue;
    const target = byId.get(item.references);
    if (!target || target === item) continue;
    if (item.type === "NOTAMC") target.cancelledBy = item.id;
    else if (item.type === "NOTAMR") target.replacedBy = item.id;
  }
}
