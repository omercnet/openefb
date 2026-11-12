// Port of TFRParser and the TFR source records (Services/TFRService.swift): live TFRs from the FAA (tfr.faa.gov), no API
// key required.
// - Geometry: FAA TFR GeoServer WFS (GeoJSON, one Polygon per TFR area, [lon, lat] order). Properties: NOTAM_KEY
//   "6/4240-1-FDC-F", TITLE, LEGAL (category), STATE, CNS_LOCATION_ID, LAST_MODIFICATION_DATETIME "yyyyMMddHHmm" (UTC).
// - Schedule and altitudes: per-NOTAM XNOTAM detail at /download/detail_<yr>_<seq>.xml. NOTAM-level
//   <dateEffective>/<dateExpire> are UTC regardless of <codeTimeZone>; missing dateEffective = "effective immediately",
//   missing dateExpire = "until further notice". Each <aseTFRArea> carries its own floor/ceiling and is linked by codeId
//   to an <abdMergedArea> boundary, which is matched to WFS polygons.
import type { Tfr, TfrAltitude } from '../domain/core/models';
import { ringCentroid } from '../domain/core/polygon';
import { tfrTypeFromFaa, type TfrType } from '../domain/core/types';
import { AppFailure } from '../domain/errors';
import { parseXml, XmlError, type XmlHandler } from './terminal/xml';
import { doubleFromText } from './weather';

/** One polygon from the FAA WFS layer TFR:V_TFR_LOC. */
export interface TfrFeature {
  notamID: string; // "6/4240" (from NOTAM_KEY "6/4240-1-FDC-F")
  title: string;
  type: TfrType;
  state: string | null;
  facility: string | null; // CNS_LOCATION_ID, the ARTCC
  lastModifiedRaw: string | null; // "yyyyMMddHHmm" UTC, used as the detail cache key
  lastModified: number | null;
  ring: number[][]; // [lat, lon] (converted from GeoJSON [lon, lat])
}

/** Schedule and per-area altitudes from the FAA XNOTAM detail XML. */
export interface TfrDetailArea {
  id: string; // aseTFRArea codeId
  name: string | null;
  floor: TfrAltitude | null;
  ceiling: TfrAltitude | null;
  ring: number[][]; // [lat, lon] from abdMergedArea, empty if unpublished
}

export interface TfrDetail {
  notamID: string | null;
  effectiveDate: number | null; // UTC; null = effective immediately
  expirationDate: number | null; // UTC; null = until further notice
  areas: TfrDetailArea[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const fetchFailed = (message: string): AppFailure =>
  new AppFailure({ kind: 'tfrFetchFailed', cause: new Error(message) });

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result === '' ? null : result;
}

/** "yyyyMMddHHmm" UTC. */
function parseModified(raw: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  return m ? checkedUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), 0) : null;
}

/** "yyyy-MM-dd'T'HH:mm:ss" UTC (no zone: the FAA's detail dates are UTC regardless of <codeTimeZone>). */
function parseDetailDate(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  return m ? checkedUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : null;
}

function checkedUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const c = new Date(ms);
  return c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d ? ms : null;
}

const isPosition = (p: unknown): p is number[] => Array.isArray(p) && p.every((n) => typeof n === 'number');
const isRing = (r: unknown): r is number[][] => Array.isArray(r) && r.every(isPosition);

/** Outer rings of a Polygon or MultiPolygon, as [lon, lat] positions. A shape that does not match yields none. */
function outerRings(geometry: Json): number[][][] {
  switch (geometry.type) {
    case 'Polygon': {
      const rings = geometry.coordinates;
      if (!Array.isArray(rings) || !rings.every(isRing)) return [];
      return rings.length > 0 ? [rings[0]] : [];
    }
    case 'MultiPolygon': {
      const polygons = geometry.coordinates;
      if (!Array.isArray(polygons) || !polygons.every((p) => Array.isArray(p) && p.every(isRing))) return [];
      return (polygons as number[][][][]).filter((p) => p.length > 0).map((p) => p[0]);
    }
    default:
      return [];
  }
}

/** Parse the WFS GeoJSON FeatureCollection. Features without a NOTAM key or polygon are skipped. */
export function parseTfrFeatures(body: string): TfrFeature[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw fetchFailed('the response is not JSON');
  }
  if (!isObject(json) || !Array.isArray(json.features) || !json.features.every(isObject)) {
    throw fetchFailed('the response is not a FeatureCollection');
  }
  const result: TfrFeature[] = [];
  for (const feature of json.features as Json[]) {
    const properties = feature.properties;
    if (!isObject(properties) || typeof properties.NOTAM_KEY !== 'string' || !isObject(feature.geometry)) continue;
    const notamID = properties.NOTAM_KEY.split('-').find((s) => s !== '') ?? '';
    if (notamID === '') continue;

    const lastModifiedRaw = trimmed(properties.LAST_MODIFICATION_DATETIME);
    const lastModified = lastModifiedRaw === null ? null : parseModified(lastModifiedRaw);
    for (const lonLatRing of outerRings(feature.geometry)) {
      const ring = lonLatRing.filter((p) => p.length >= 2).map((p) => [p[1], p[0]]); // [lon, lat] -> [lat, lon]
      if (ring.length < 3) continue;
      result.push({
        notamID,
        title: trimmed(properties.TITLE) ?? `TFR ${notamID}`,
        type: tfrTypeFromFaa(trimmed(properties.LEGAL) ?? ''),
        state: trimmed(properties.STATE),
        facility: trimmed(properties.CNS_LOCATION_ID),
        lastModifiedRaw,
        lastModified,
        ring,
      });
    }
  }
  return result;
}

/** XNOTAM vertical limit: code ALT = MSL, HEI = AGL, STD or unit FL = flight level. */
export function tfrAltitudeFromCode(
  code: string | null,
  value: string | null,
  unit: string | null,
): TfrAltitude | null {
  const number = value === null ? null : doubleFromText(value);
  if (number === null) return null;
  const rounded = Math.sign(number) * Math.round(Math.abs(number)); // Swift .rounded(): half away from zero
  if (unit?.toUpperCase() === 'FL' || code?.toUpperCase() === 'STD')
    return { value: rounded, reference: 'flightLevel' };
  switch (code?.toUpperCase()) {
    case 'ALT':
      return { value: rounded, reference: 'msl' }; // feet MSL
    case 'HEI':
      return { value: rounded, reference: 'agl' }; // feet AGL
    default:
      return null;
  }
}

interface AreaBuilder {
  id: string;
  name: string | null;
  upperCode: string | null;
  upperValue: string | null;
  upperUnit: string | null;
  lowerCode: string | null;
  lowerValue: string | null;
  lowerUnit: string | null;
}

/** "40.71669911N" / "105.55833333W" -> signed decimal degrees. */
export function parseXnotamCoordinate(value: string): number | null {
  const hemisphere = value.slice(-1).toUpperCase();
  const magnitude = doubleFromText(value.slice(0, -1));
  if (value === '' || magnitude === null) return null;
  if (hemisphere === 'N' || hemisphere === 'E') return magnitude;
  if (hemisphere === 'S' || hemisphere === 'W') return -magnitude;
  return null;
}

/** Parse an FAA XNOTAM detail document. Returns null if the XML is malformed. Boundary vertices are only read inside
 * <abdMergedArea>; <aseShapes> repeats them as unmerged construction geometry. */
export function parseTfrDetail(xml: string): TfrDetail | null {
  let localName: string | null = null;
  let effective: string | null = null;
  let expire: string | null = null;
  const areas: AreaBuilder[] = [];
  const mergedRings = new Map<string, number[][]>();
  const path: string[] = [];
  let text = '';
  let currentArea: AreaBuilder | null = null;
  let mergedID: string | null = null;
  let mergedRing: number[][] = [];
  let vertexLat: number | null = null;
  let vertexLon: number | null = null;
  const pathEndsWith = (suffix: string[]) =>
    path.length >= suffix.length && suffix.every((s, i) => path[path.length - suffix.length + i] === s);

  const handler: XmlHandler = {
    start(name) {
      path.push(name);
      text = '';
      if (name === 'aseTFRArea') {
        currentArea = {
          id: '',
          name: null,
          upperCode: null,
          upperValue: null,
          upperUnit: null,
          lowerCode: null,
          lowerValue: null,
          lowerUnit: null,
        };
      } else if (name === 'abdMergedArea') {
        mergedID = null;
        mergedRing = [];
      } else if (name === 'Avx') {
        vertexLat = null;
        vertexLon = null;
      }
    },
    text(chunk) {
      text += chunk;
    },
    end(name) {
      const value = text.trim();
      const parent = path.length >= 2 ? path[path.length - 2] : '';
      const area = currentArea;
      const inMerged = path.includes('abdMergedArea');
      if (name === 'txtLocalName' && parent === 'NotUid') localName = value;
      else if (name === 'dateEffective' && parent === 'Not') effective = value;
      else if (name === 'dateExpire' && parent === 'Not') expire = value;
      else if (name === 'aseTFRArea') {
        if (area) areas.push(area);
        currentArea = null;
      } else if (name === 'codeId' && parent === 'AseUid' && pathEndsWith(['aseTFRArea', 'AseUid', 'codeId'])) {
        if (area) area.id = value;
      } else if (parent === 'aseTFRArea' && area) {
        if (name === 'txtName') area.name = value;
        else if (name === 'codeDistVerUpper') area.upperCode = value;
        else if (name === 'valDistVerUpper') area.upperValue = value;
        else if (name === 'uomDistVerUpper') area.upperUnit = value;
        else if (name === 'codeDistVerLower') area.lowerCode = value;
        else if (name === 'valDistVerLower') area.lowerValue = value;
        else if (name === 'uomDistVerLower') area.lowerUnit = value;
      } else if (
        name === 'codeId' &&
        parent === 'AseUid' &&
        pathEndsWith(['abdMergedArea', 'AbdUid', 'AseUid', 'codeId'])
      ) {
        mergedID = value;
      } else if (name === 'geoLat' && parent === 'Avx' && inMerged) vertexLat = parseXnotamCoordinate(value);
      else if (name === 'geoLong' && parent === 'Avx' && inMerged) vertexLon = parseXnotamCoordinate(value);
      else if (name === 'Avx' && inMerged) {
        if (vertexLat !== null && vertexLon !== null) mergedRing.push([vertexLat, vertexLon]);
      } else if (name === 'abdMergedArea') {
        if (mergedID !== null) mergedRings.set(mergedID, mergedRing);
        mergedID = null;
        mergedRing = [];
      }
      path.pop();
      text = '';
    },
  };
  try {
    parseXml(xml, handler);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  return {
    notamID: localName,
    effectiveDate: effective === null ? null : parseDetailDate(effective),
    expirationDate: expire === null ? null : parseDetailDate(expire),
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      floor: tfrAltitudeFromCode(a.lowerCode, a.lowerValue, a.lowerUnit),
      ceiling: tfrAltitudeFromCode(a.upperCode, a.upperValue, a.upperUnit),
      ring: mergedRings.get(a.id) ?? [],
    })),
  };
}

/** Largest centroid offset accepted when matching a WFS polygon to a detail area (degrees, ~12 NM). */
export const MAX_MATCH_OFFSET_DEGREES = 0.2;
/** Detail areas whose centroids are this close to the best match are indistinguishable (degrees, ~0.3 NM). */
export const AMBIGUOUS_OFFSET_DEGREES = 0.005;

const sameAltitude = (a: TfrAltitude | null, b: TfrAltitude | null): boolean =>
  a === b || (a !== null && b !== null && a.value === b.value && a.reference === b.reference);

/** Find the detail area for a WFS polygon. Prefers areas with the same vertex count (the FAA publishes both from the same
 * boundary), then the nearest centroid. Returns null when two indistinguishable areas publish different altitudes (e.g.
 * FDC 6/3002 Areas C and E share one footprint), so the UI says "See NOTAM" rather than guessing. */
export function matchTfrArea(ring: number[][], areas: readonly TfrDetailArea[]): TfrDetailArea | null {
  if (areas.length === 1) return areas[0];
  const center = ringCentroid(ring);
  if (!center) return null;

  const sameShape = areas.filter((a) => a.ring.length === ring.length);
  const candidates = sameShape.length === 0 ? areas : sameShape;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const scored = candidates
    .flatMap((area) => {
      const c = ringCentroid(area.ring);
      return c ? [{ area, offset: Math.hypot(c.lat - center.lat, (c.lon - center.lon) * cosLat) }] : [];
    })
    .sort((a, b) => a.offset - b.offset);

  const best = scored[0];
  if (!best || best.offset > MAX_MATCH_OFFSET_DEGREES) return null;
  const indistinguishable = scored.filter((s) => s.offset - best.offset <= AMBIGUOUS_OFFSET_DEGREES);
  const conflicting = indistinguishable.some(
    (s) => !sameAltitude(s.area.floor, best.area.floor) || !sameAltitude(s.area.ceiling, best.area.ceiling),
  );
  return conflicting ? null : best.area;
}

/** Join WFS polygons with NOTAM details. Every polygon becomes one `Tfr`; fields the detail does not provide (or could not
 * be matched) stay null. */
export function joinTfrs(features: readonly TfrFeature[], details: ReadonlyMap<string, TfrDetail>): Tfr[] {
  const areaIndex = new Map<string, number>();
  return features.map((feature) => {
    const index = areaIndex.get(feature.notamID) ?? 0;
    areaIndex.set(feature.notamID, index + 1);
    const detail = details.get(feature.notamID);
    const area = detail ? matchTfrArea(feature.ring, detail.areas) : null;
    return {
      id: `${feature.notamID}#${index}`,
      notamID: feature.notamID,
      type: feature.type,
      title: feature.title,
      state: feature.state,
      facility: feature.facility,
      effectiveDate: detail?.effectiveDate ?? null,
      expirationDate: detail?.expirationDate ?? null,
      boundaries: feature.ring,
      floor: area?.floor ?? null,
      ceiling: area?.ceiling ?? null,
      lastModified: feature.lastModified,
    };
  });
}
