// Value types of the Israel NOTAM relay feed and their pure helpers. Port of the model part of
// Services/IsraelNotamService.swift (the service itself, decoding and freshness belong to the S1 port; that ticket
// should import these types rather than redefine them). Times are epoch ms; positions are { lat, lon } degrees.
import type { Coordinate } from '../core/geometry';

/** Swift IsraelLatLon: same shape as Coordinate. */
export type IsraelLatLon = Coordinate;

export interface IsraelNotamQLine {
  fir: string;
  code: string;
  traffic: string;
  purpose: string;
  scope: string;
  /** flight level, 0 = surface */
  lower: number;
  /** flight level, 999 = unlimited */
  upper: number;
  centre: IsraelLatLon | null;
  /** nautical miles */
  radiusNM: number | null;
}

export interface IsraelNotamCircle {
  centre: IsraelLatLon;
  /** nautical miles */
  radiusNM: number;
}

export interface IsraelNotamGeometry {
  /** Ring of positions from E); at least three points, not closed. */
  polygon: IsraelLatLon[] | null;
  circle: IsraelNotamCircle | null;
}

/** One altitude limit in feet from a NOTAM closure clause ("AT 2,500FT AMSL", "BLW 1,500FT"). */
export interface IsraelAltitudeLimit {
  /** AT, BLW, ABV or BTN */
  op: string;
  lowerFt: number | null;
  upperFt: number | null;
  /** AMSL, AGL, or FL */
  ref: string | null;
}

export interface IsraelAvailableAltitude extends IsraelAltitudeLimit {
  /** BIDIRECTIONAL when written, otherwise null. */
  direction: string | null;
}

/** red = closed, amber = partial, amber "check NOTAM" = not read in full. */
export type IsraelClosureSeverity = 'full' | 'partial' | 'check';

/** One ordered chain of published point codes closed by a NOTAM ("CVFR RTE CLSD GALIM-DAROM-HOTRM"). */
export interface IsraelRouteClosure {
  notamId: string;
  /** CVFR, HEL, ULTRALIGHT, ATS, ... as written before "RTE CLSD". */
  routeKind: string;
  routeName: string | null;
  /** Ordered point codes (5-letter reporting points; 4-letter ICAO codes for airfields). */
  chain: string[];
  /** epoch ms, UTC */
  validFrom: number | null;
  /** epoch ms; null when permanent or unreadable */
  validTo: number | null;
  /** D) text: the closure applies only at these times within the validity window. */
  schedule: string | null;
  routeKinds?: string[] | null;
  closedAltitudes?: IsraelAltitudeLimit[] | null;
  availableAltitudes?: IsraelAvailableAltitude[] | null;
  exceptions?: string[] | null;
  partial?: boolean | null;
  parsed?: boolean | null;
  raw?: string | null;
}

/** Inside the validity window (ignores `schedule`; check `closureHasSchedule`). Bounds inclusive. */
export function closureIsValidAt(closure: IsraelRouteClosure, date: number): boolean {
  if (closure.validFrom !== null && date < closure.validFrom) return false;
  if (closure.validTo !== null && date > closure.validTo) return false;
  return true;
}

export const closureHasSchedule = (closure: IsraelRouteClosure): boolean => closure.schedule !== null;

/** Consecutive point pairs along the chain. */
export function closureLegs(closure: IsraelRouteClosure): { from: string; to: string }[] {
  const legs: { from: string; to: string }[] = [];
  for (let i = 0; i + 1 < closure.chain.length; i += 1) legs.push({ from: closure.chain[i], to: closure.chain[i + 1] });
  return legs;
}

/** Kinds this closure applies to, upper-cased; falls back to `routeKind` for feeds without `routeKinds`. */
export function closureKinds(closure: IsraelRouteClosure): string[] {
  const listed = (closure.routeKinds ?? []).map((k) => k.toUpperCase());
  return listed.length === 0 ? [closure.routeKind.toUpperCase()] : listed;
}

export const closureCovers = (closure: IsraelRouteClosure, kind: string): boolean =>
  closureKinds(closure).includes(kind.toUpperCase());

export function closureSeverity(closure: IsraelRouteClosure): IsraelClosureSeverity {
  if (closure.parsed === false) return 'check';
  return closure.partial === true ? 'partial' : 'full';
}

export interface IsraelNotam {
  rowId: string;
  /** e.g. "C2269/26" */
  id: string;
  /** NOTAMN / NOTAMR / NOTAMC */
  type: string | null;
  references: string | null;
  /** ICAO location indicator */
  location: string;
  locationDescription: string | null;
  created: number | null;
  q: IsraelNotamQLine | null;
  a: string | null;
  validFrom: number | null;
  validTo: number | null;
  permanent: boolean;
  estimated: boolean;
  d: string | null;
  e: string | null;
  f: string | null;
  g: string | null;
  geometry: IsraelNotamGeometry;
  closures: IsraelRouteClosure[];
  /** false: the relay could not read the ICAO fields; show `raw`. */
  parsed: boolean;
  cancelledBy: string | null;
  replacedBy: string | null;
  raw: string;
}

export const notamIsSuperseded = (notam: IsraelNotam): boolean =>
  notam.cancelledBy !== null || notam.replacedBy !== null;
