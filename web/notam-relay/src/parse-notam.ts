import type { Geometry, LatLon, NotamItem, QLine, RouteClosure } from "./types.js";

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

/** 3-letter navaid codes (BGN) appear next to 5-letter reporting points; only used inside a closure sentence. */
const CHAIN = /^([A-Z]{3,5}(?:\s*-\s*[A-Z]{3,5})+)/;
/** `CVFR RTE CLSD`, and the ATS form `ATS RTE L53 CLSD BTN`. Groups: kind, optional route name. */
const CLOSURE_HEAD = /\b([A-Z]+)\s+RTES?\s+(?:([A-Z]\d{1,3})\s+)?CLSD(?:\s+BTN)?\b/g;

/**
 * `CVFR RTE CLSD A-B-C. D-E.`, `ATS RTE CLSD P68 BTN A-B. Q17 BTN C-D.`, several kinds per NOTAM.
 * Returns chains only; tokens that don't look like point codes are ignored, never guessed.
 */
export function parseClosures(
  notamId: string,
  eText: string,
  validFrom: string | null,
  validTo: string | null,
  schedule: string | null,
): RouteClosure[] {
  const text = collapse(eText);
  const heads = [...text.matchAll(CLOSURE_HEAD)];
  const out: RouteClosure[] = [];
  heads.forEach((h, i) => {
    const bodyStart = (h.index ?? 0) + h[0].length;
    const bodyEnd = heads[i + 1]?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd);
    for (const piece of body.split(/\.(?:\s|$|\))|[;,]|\bAND\b|\)/)) {
      let s = piece.trim();
      if (!s) continue;
      let routeName: string | null = h[2] ?? null;
      const named = /^([A-Z]\d{1,3})\s+BTN\s+(.*)$/.exec(s);
      if (named) {
        routeName = named[1]!;
        s = named[2]!;
      }
      const c = CHAIN.exec(s);
      if (!c) continue;
      out.push({
        notamId,
        routeKind: h[1]!,
        routeName,
        chain: c[1]!.split(/\s*-\s*/),
        validFrom,
        validTo,
        schedule,
      });
    }
  });
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
    const mentionsRoute = base.type !== "NOTAMC" && new RegExp(CLOSURE_HEAD.source).test(f.e ?? "");
    // Structured enough to trust: header, validity start, and E) present. A route-closure
    // sentence we extracted no chain from is flagged so nobody trusts an empty closure list.
    base.parsed = Boolean(head && base.validFrom && f.e !== undefined) && (!mentionsRoute || base.closures.length > 0);
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
