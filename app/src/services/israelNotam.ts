// Port of the Israel NOTAM feed models (Services/IsraelNotamService.swift), mirroring web/notam-relay/src/types.ts
// (NotamsFeed). Times are epoch ms (UTC). Decoding follows Swift Codable: required fields and wrong types reject the
// whole feed, except the closure conditions, which are decoded leniently so a malformed optional field never costs the
// pilot the whole feed.
import { evaluateFreshness, type DataFreshness } from '../domain/core/freshness';
import { parseIsoDateTime } from './isoDate';
import {
  asObject,
  DecodeError,
  lenient,
  optArray,
  optBool,
  optDouble,
  optInt,
  optObject,
  optString,
  reqArray,
  reqBool,
  reqDouble,
  reqInt,
  reqString,
  stringArray,
  type JsonObject,
} from './jsonDecode';

import type {
  IsraelAltitudeLimit,
  IsraelAvailableAltitude,
  IsraelLatLon,
  IsraelNotam,
  IsraelNotamGeometry,
  IsraelNotamQLine,
  IsraelRouteClosure,
} from '../domain/israel/notamTypes';

// The value types, the closure helpers and the severity rule are L3's (domain/israel/notamTypes.ts); this module keeps the
// relay decoder, the report and its freshness. Swift names are kept as aliases.
export type {
  IsraelAltitudeLimit,
  IsraelAvailableAltitude,
  IsraelClosureSeverity,
  IsraelLatLon,
  IsraelNotam,
  IsraelNotamCircle,
  IsraelNotamGeometry,
  IsraelNotamQLine,
  IsraelRouteClosure,
} from '../domain/israel/notamTypes';
export {
  closureCovers,
  closureHasSchedule,
  closureIsValidAt as closureIsValid,
  closureKinds,
  closureLegs,
  closureSeverity,
  notamIsSuperseded as isSuperseded,
} from '../domain/israel/notamTypes';

export const availableAltitudeLimit = (a: IsraelAvailableAltitude): IsraelAltitudeLimit => ({
  op: a.op,
  lowerFt: a.lowerFt,
  upperFt: a.upperFt,
  ref: a.ref,
});

/** Chart text: "2500", "BLW 1500", "ABV FL100", "1000-2000", "800 AGL". */
export function altitudeChartText(limit: IsraelAltitudeLimit): string {
  const { op, lowerFt: lo, upperFt: hi, ref } = limit;
  const value = (feet: number) => (ref === 'FL' ? `FL${Math.trunc(feet / 100)}` : String(feet));
  const suffix = ref === 'AGL' ? ' AGL' : '';
  if (op === 'BTN' && lo !== null && hi !== null) return `${value(lo)}-${value(hi)}${suffix}`;
  if (op === 'BLW' && hi !== null) return `BLW ${value(hi)}${suffix}`;
  if (op === 'ABV' && lo !== null) return `ABV ${value(lo)}${suffix}`;
  if (lo !== null) return value(lo) + suffix;
  if (hi !== null) return value(hi) + suffix;
  return op;
}

/** Swift's memberwise initialiser: the optional condition fields default to null. */
export function makeRouteClosure(
  fields: Pick<
    IsraelRouteClosure,
    'notamId' | 'routeKind' | 'routeName' | 'chain' | 'validFrom' | 'validTo' | 'schedule'
  > &
    Partial<IsraelRouteClosure>,
): IsraelRouteClosure {
  return {
    routeKinds: null,
    closedAltitudes: null,
    availableAltitudes: null,
    exceptions: null,
    partial: null,
    parsed: null,
    raw: null,
    ...fields,
  };
}

export interface IsraelNotamFeed {
  /** When the relay scraped the IAA (epoch ms). */
  generatedAt: number;
  items: IsraelNotam[];
  /** Closures from non-cancelled items, flattened. */
  closures: IsraelRouteClosure[];
}

/** The feed plus how old it is. */
export interface IsraelNotamReport {
  feed: IsraelNotamFeed;
  /** When this device downloaded it (epoch ms). */
  fetchedAt: number;
  /** The last refresh failed; `feed` is the previous copy. */
  refreshFailed: boolean;
}

/** Badge for the NOTAM page and route alerts, on the relay's scrape time (not the download time). */
export function reportFreshness(report: IsraelNotamReport, nowMs: number): DataFreshness {
  return evaluateFreshness('notam', { observed: report.feed.generatedAt, now: nowMs });
}

// MARK: Decoding

/** ISO 8601 with or without fractional seconds (JavaScript's `toISOString()` writes milliseconds). */
function optDate(o: JsonObject, key: string): number | null {
  const text = optString(o, key);
  if (text === null) return null;
  const ms = parseIsoDateTime(text);
  if (ms === null) throw new DecodeError(`${key}: bad date ${text}`);
  return ms;
}

function reqDate(o: JsonObject, key: string): number {
  const ms = optDate(o, key);
  if (ms === null) throw new DecodeError(`${key}: missing`);
  return ms;
}

function decodeLatLon(value: unknown, path: string): IsraelLatLon {
  const o = asObject(value, path);
  return { lat: reqDouble(o, 'lat'), lon: reqDouble(o, 'lon') };
}

function optLatLon(o: JsonObject, key: string): IsraelLatLon | null {
  const v = optObject(o, key);
  return v ? decodeLatLon(v, key) : null;
}

function decodeQLine(o: JsonObject): IsraelNotamQLine {
  return {
    fir: reqString(o, 'fir'),
    code: reqString(o, 'code'),
    traffic: reqString(o, 'traffic'),
    purpose: reqString(o, 'purpose'),
    scope: reqString(o, 'scope'),
    lower: reqInt(o, 'lower'),
    upper: reqInt(o, 'upper'),
    centre: optLatLon(o, 'centre'),
    radiusNM: optDouble(o, 'radiusNM'),
  };
}

function decodeGeometry(o: JsonObject): IsraelNotamGeometry {
  const polygon = optArray(o, 'polygon');
  const circle = optObject(o, 'circle');
  return {
    polygon: polygon ? polygon.map((p) => decodeLatLon(p, 'polygon[]')) : null,
    circle: circle
      ? { centre: decodeLatLon(circle.centre, 'circle.centre'), radiusNM: reqDouble(circle, 'radiusNM') }
      : null,
  };
}

function decodeAltitudeLimit(value: unknown): IsraelAltitudeLimit {
  const o = asObject(value, 'altitude');
  return {
    op: reqString(o, 'op'),
    lowerFt: optInt(o, 'lowerFt'),
    upperFt: optInt(o, 'upperFt'),
    ref: optString(o, 'ref'),
  };
}

function decodeAvailableAltitude(value: unknown): IsraelAvailableAltitude {
  return { ...decodeAltitudeLimit(value), direction: optString(asObject(value, 'altitude'), 'direction') };
}

/** The conditions are decoded leniently: a malformed optional field never costs the pilot the whole feed. */
export function decodeRouteClosure(value: unknown): IsraelRouteClosure {
  const c = asObject(value, 'closure');
  const routeKinds = lenient(() => {
    const a = optArray(c, 'routeKinds');
    return a ? stringArray(a, 'routeKinds') : null;
  });
  const closedAltitudes = lenient(() => optArray(c, 'closedAltitudes')?.map(decodeAltitudeLimit) ?? null);
  const availableAltitudes = lenient(() => optArray(c, 'availableAltitudes')?.map(decodeAvailableAltitude) ?? null);
  const exceptions = lenient(() => {
    const a = optArray(c, 'exceptions');
    return a ? stringArray(a, 'exceptions') : null;
  });
  // A `parsed` we cannot read must not turn into "fully read": treat it as unread.
  const parsed = 'parsed' in c ? (lenient(() => reqBool(c, 'parsed')) ?? false) : null;
  return {
    notamId: reqString(c, 'notamId'),
    routeKind: reqString(c, 'routeKind'),
    routeName: optString(c, 'routeName'),
    chain: stringArray(reqArray(c, 'chain'), 'chain'),
    validFrom: optDate(c, 'validFrom'),
    validTo: optDate(c, 'validTo'),
    schedule: optString(c, 'schedule'),
    routeKinds,
    closedAltitudes,
    availableAltitudes,
    exceptions,
    partial: lenient(() => optBool(c, 'partial')),
    parsed,
    raw: lenient(() => optString(c, 'raw')),
  };
}

function decodeNotam(value: unknown): IsraelNotam {
  const o = asObject(value, 'items[]');
  const q = optObject(o, 'q');
  const geometry = optObject(o, 'geometry');
  if (!geometry) throw new DecodeError('geometry: missing');
  return {
    rowId: reqString(o, 'rowId'),
    id: reqString(o, 'id'),
    type: optString(o, 'type'),
    references: optString(o, 'references'),
    location: reqString(o, 'location'),
    locationDescription: optString(o, 'locationDescription'),
    created: optDate(o, 'created'),
    q: q ? decodeQLine(q) : null,
    a: optString(o, 'a'),
    validFrom: optDate(o, 'validFrom'),
    validTo: optDate(o, 'validTo'),
    permanent: reqBool(o, 'permanent'),
    estimated: reqBool(o, 'estimated'),
    d: optString(o, 'd'),
    e: optString(o, 'e'),
    f: optString(o, 'f'),
    g: optString(o, 'g'),
    geometry: decodeGeometry(geometry),
    closures: reqArray(o, 'closures').map(decodeRouteClosure),
    parsed: reqBool(o, 'parsed'),
    cancelledBy: optString(o, 'cancelledBy'),
    replacedBy: optString(o, 'replacedBy'),
    raw: reqString(o, 'raw'),
  };
}

/** Decodes a notams.json body. Throws DecodeError when it is not a valid feed. */
export function decodeIsraelNotamFeed(body: string): IsraelNotamFeed {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new DecodeError('the body is not JSON');
  }
  const root = asObject(json, 'feed');
  return {
    generatedAt: reqDate(root, 'generatedAt'),
    items: reqArray(root, 'items').map(decodeNotam),
    closures: reqArray(root, 'closures').map(decodeRouteClosure),
  };
}
