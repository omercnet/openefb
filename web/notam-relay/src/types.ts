/** Wire format of notams.json, consumed by the Kanaf iPad app (IsraelNotamService.swift). */

export interface LatLon {
  /** degrees, WGS-84, north positive */
  lat: number;
  /** degrees, east positive */
  lon: number;
}

export interface QLine {
  fir: string;
  /** five-letter Q code, e.g. QARLC */
  code: string;
  /** I, V or IV */
  traffic: string;
  /** N, B, O, M, K combinations */
  purpose: string;
  /** A, E, W, K combinations */
  scope: string;
  /** flight level, lower limit (000 = surface) */
  lower: number;
  /** flight level, upper limit (999 = unlimited) */
  upper: number;
  centre: LatLon | null;
  /** nautical miles */
  radiusNM: number | null;
}

export interface Geometry {
  /** closed ring of positions found in E) (at least 3) */
  polygon: LatLon[] | null;
  /** fallback: Q-line centre + radius */
  circle: { centre: LatLon; radiusNM: number } | null;
}

/** One altitude limit in feet. AT x: lower = upper = x. BLW x: upper only. ABV x: lower only. BTN x y: both. */
export interface AltitudeLimit {
  op: "AT" | "BLW" | "ABV" | "BTN";
  /** feet; null when unbounded below */
  lowerFt: number | null;
  /** feet; null when unbounded above */
  upperFt: number | null;
  /** AMSL / AGL as written, FL when given as a flight level (converted to feet), null when not written */
  ref: "AMSL" | "AGL" | "FL" | null;
}

/** "AVBL BIDIRECTIONAL AT 800FT AMSL": an altitude at which the chain stays usable. */
export interface AvailableAltitude extends AltitudeLimit {
  /** BIDIRECTIONAL when written, otherwise null */
  direction: string | null;
}

export interface RouteClosure {
  /** CVFR when the clause covers CVFR, else the first kind. Kept for builds that read only this field. */
  routeKind: string;
  /** every kind of the clause: "CVFR AND HEL RTE CLSD" -> ["CVFR", "HEL"] */
  routeKinds: string[];
  /** altitudes at which the chain is closed ("CLSD AT 2,500FT AMSL"); empty = closed at all altitudes */
  closedAltitudes: AltitudeLimit[];
  /** altitudes at which the chain stays open ("AVBL BIDIRECTIONAL AT 3,000FT AMSL") */
  availableAltitudes: AvailableAltitude[];
  /** raw exception text, e.g. "PPR FLT FM IAF"; the closure does not apply to these flights */
  exceptions: string[];
  /** closed only at some altitudes, or with exceptions: not a full closure */
  partial: boolean;
  /** false: this looks like a closure but could not be read in full (no chain, or an altitude condition left unread) */
  parsed: boolean;
  /** the clause text this closure came from, verbatim */
  raw: string;
  /** NOTAM number this chain came from, e.g. C2267/26 */
  notamId: string;
  /** optional ATS route designator, e.g. P68 ("P68 BTN GALIM-MERVA") */
  routeName: string | null;
  /** ordered chain of 5-letter point codes */
  chain: string[];
  /** ISO 8601 UTC, from B) */
  validFrom: string | null;
  /** ISO 8601 UTC, from C); null when PERM or unknown */
  validTo: string | null;
  /** D) schedule text if any */
  schedule: string | null;
}

export interface NotamItem {
  /** row id on the IAA site, used as the detail cache key */
  rowId: string;
  /** NOTAM number, e.g. C2269/26 */
  id: string;
  /** NOTAMN / NOTAMR / NOTAMC */
  type: "NOTAMN" | "NOTAMR" | "NOTAMC" | null;
  /** NOTAM replaced or cancelled by this one (NOTAMR / NOTAMC) */
  references: string | null;
  /** ICAO location indicator from the list page, e.g. LLLL, LLBO */
  location: string;
  locationDescription: string | null;
  /** "Created" stamp from the detail page, ISO 8601 UTC */
  created: string | null;
  q: QLine | null;
  a: string | null;
  /** ISO 8601 UTC */
  validFrom: string | null;
  /** ISO 8601 UTC; null when PERM */
  validTo: string | null;
  /** C) was PERM */
  permanent: boolean;
  /** C) carried EST */
  estimated: boolean;
  d: string | null;
  e: string | null;
  f: string | null;
  g: string | null;
  geometry: Geometry;
  closures: RouteClosure[];
  /** id of the later NOTAMC in this feed that cancelled this NOTAM */
  cancelledBy: string | null;
  /** id of the later NOTAMR in this feed that replaced this NOTAM */
  replacedBy: string | null;
  /** false when the ICAO fields could not be parsed; raw text is still present */
  parsed: boolean;
  /** the full ICAO text from the detail page, verbatim */
  raw: string;
}

export interface NotamsFeed {
  /** ISO 8601 UTC */
  generatedAt: string;
  source: { name: string; listUrl: string; detailUrlTemplate: string };
  items: NotamItem[];
  /** all closures from non-cancelled items, flattened */
  closures: RouteClosure[];
}
