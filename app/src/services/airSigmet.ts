// Port of the advisory models and parser (Services/AirSigmetService.swift): SIGMETs, AIRMETs and CONUS G-AIRMETs from
// aviationweather.gov (keyless).
// - /api/data/airsigmet?format=json: [{airSigmetType "SIGMET"/"AIRMET", hazard "CONVECTIVE"/"TURB"/"ICE"/"IFR"/
//   "MTN OBSCN", validTimeFrom/validTimeTo epoch seconds, altitudeLow1/altitudeHi1 feet MSL (null = surface/unspecified),
//   coords [{lat, lon}], rawAirSigmet}]
// - /api/data/gairmet?format=json: the current G-AIRMET snapshot [{product SIERRA/TANGO/ZULU, tag, hazard "IFR"/
//   "MT_OBSC"/"TURB-HI"/"TURB-LO"/"ICE"/"FZLVL"/"M_FZLVL"/..., validTime ISO-8601, expireTime epoch seconds, base/top
//   hundreds of feet as strings ("SFC", "FZL", "080"), fzlbase/fzltop, geometryType AREA/LINE, coords [{lat, lon}] as
//   strings}]. A G-AIRMET snapshot represents conditions 90 minutes either side of its validTime.
// Validity filtering happens at display time so a cached snapshot never shows expired advisories.
import { AppFailure } from '../domain/errors';
import { parseIsoDateTime } from './isoDate';

export const ADVISORY_KINDS = ['SIGMET', 'AIRMET', 'G-AIRMET'] as const;
export type AdvisoryKind = (typeof ADVISORY_KINDS)[number];

export const ADVISORY_HAZARDS = ['convective', 'ifr', 'mountainObscuration', 'turbulence', 'icing', 'other'] as const;
export type AdvisoryHazard = (typeof ADVISORY_HAZARDS)[number];

/** Map aviationweather.gov hazard codes from both endpoints. */
export function hazardFromApiCode(apiCode: string): AdvisoryHazard {
  const code = apiCode.trim().toUpperCase();
  switch (code) {
    case 'CONVECTIVE':
    case 'TS':
      return 'convective';
    case 'IFR':
      return 'ifr';
    case 'MTN OBSCN':
    case 'MT_OBSC':
    case 'MTN OBSC':
    case 'MT OBSC':
      return 'mountainObscuration';
    case 'LLWS':
      return 'turbulence';
    default:
      if (code.startsWith('TURB')) return 'turbulence';
      if (code.startsWith('ICE') || code.startsWith('ICING')) return 'icing';
      return 'other';
  }
}

const HAZARD_NAMES: Record<AdvisoryHazard, string> = {
  convective: 'Convective',
  ifr: 'IFR',
  mountainObscuration: 'Mountain Obscuration',
  turbulence: 'Turbulence',
  icing: 'Icing',
  other: 'Other',
};
export const hazardDisplayName = (h: AdvisoryHazard): string => HAZARD_NAMES[h];

export interface AviationAdvisory {
  id: string;
  kind: AdvisoryKind;
  hazard: AdvisoryHazard;
  hazardCode: string; // API hazard code as published, e.g. "MTN OBSCN"
  validFrom: number; // epoch ms, UTC
  validTo: number; // epoch ms, UTC
  floorFeet: number | null; // feet MSL; null = surface or unspecified
  ceilingFeet: number | null; // feet MSL; null = unspecified
  boundaries: [number, number][]; // [lat, lon]
  text: string | null; // Raw SIGMET/AIRMET text, or G-AIRMET "due to" summary
}

/** Inclusive at both ends. */
export const isAdvisoryValid = (a: AviationAdvisory, atMs: number): boolean => a.validFrom <= atMs && atMs <= a.validTo;

export const ADVISORY_COLORS = {
  red: '#FF3B30', // SIGMETs and convective
  purple: '#AF52DE', // IFR
  orange: '#FF9500', // Turbulence / LLWS
  blue: '#007AFF', // Icing
  brown: '#A2845E', // Mountain obscuration
  gray: '#8E8E93', // Anything else
} as const;

/** Any SIGMET (convective or not) is red; AIRMETs/G-AIRMETs are colored by hazard. */
export function advisoryColorHex(kind: AdvisoryKind, hazard: AdvisoryHazard): string {
  if (kind === 'SIGMET') return ADVISORY_COLORS.red;
  switch (hazard) {
    case 'convective':
      return ADVISORY_COLORS.red;
    case 'ifr':
      return ADVISORY_COLORS.purple;
    case 'turbulence':
      return ADVISORY_COLORS.orange;
    case 'icing':
      return ADVISORY_COLORS.blue;
    case 'mountainObscuration':
      return ADVISORY_COLORS.brown;
    case 'other':
      return ADVISORY_COLORS.gray;
  }
}

/** Advisories plus the time they were fetched (epoch ms), for data-age display. */
export interface AdvisorySnapshot {
  advisories: AviationAdvisory[];
  fetchedAt: number;
}

/** Advisories in effect at `atMs`. */
export const validAdvisories = (s: AdvisorySnapshot, atMs: number): AviationAdvisory[] =>
  s.advisories.filter((a) => isAdvisoryValid(a, atMs));

// MARK: Parsing

/** Half-width of a G-AIRMET snapshot's valid window around its validTime (ms). */
export const G_AIRMET_HALF_WINDOW_MS = 90 * 60 * 1000;

/** G-AIRMET hazards that are informational contours, not hazard areas. */
export const EXCLUDED_G_AIRMET_HAZARDS: ReadonlySet<string> = new Set(['FZLVL', 'M_FZLVL']);

type Entry = Record<string, unknown>;

const fail = (message: string): never => {
  throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(message) });
};

function entriesFrom(body: string): Entry[] {
  if (body.length === 0) return []; // airsigmet answers HTTP 204 with an empty body when nothing matches
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fail('the response is not JSON');
  }
  if (!Array.isArray(json) || !json.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e))) {
    return fail('the response is not a list of objects');
  }
  return json as Entry[];
}

/** Numbers arrive as JSON numbers or numeric strings depending on endpoint. Non-finite values read as missing. */
export function advisoryNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.replace(/^[ \t]+|[ \t]+$/g, '');
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** [{lat, lon}] -> [[lat, lon]] */
export function ringFrom(value: unknown): [number, number][] {
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'object' && p !== null && !Array.isArray(p))) return [];
  const ring: [number, number][] = [];
  for (const point of value as Entry[]) {
    const lat = advisoryNumber(point.lat);
    const lon = advisoryNumber(point.lon);
    if (lat !== null && lon !== null) ring.push([lat, lon]);
  }
  return ring;
}

/** Parse /api/data/airsigmet JSON. Empty body (HTTP 204) means no advisories. */
export function parseAirSigmets(body: string): AviationAdvisory[] {
  const out: AviationAdvisory[] = [];
  entriesFrom(body).forEach((entry, index) => {
    const typeString = str(entry.airSigmetType)?.toUpperCase();
    const kind = ADVISORY_KINDS.find((k) => k === typeString);
    const from = advisoryNumber(entry.validTimeFrom);
    const to = advisoryNumber(entry.validTimeTo);
    if (!kind || from === null || to === null) return;
    const ring = ringFrom(entry.coords);
    if (ring.length < 3) return;

    const hazardCode = str(entry.hazard) ?? '';
    const series = str(entry.seriesId) ?? String(index);
    const issuer = str(entry.icaoId) ?? '';
    const low = advisoryNumber(entry.altitudeLow1);
    const high = advisoryNumber(entry.altitudeHi1);
    out.push({
      id: `${kind}-${issuer}-${series}-${Math.trunc(from)}`,
      kind,
      hazard: hazardFromApiCode(hazardCode),
      hazardCode,
      validFrom: from * 1000, // epoch seconds UTC
      validTo: to * 1000,
      floorFeet: low === null ? null : Math.trunc(low), // feet MSL
      ceilingFeet: high === null ? null : Math.trunc(high), // feet MSL
      boundaries: ring,
      text: str(entry.rawAirSigmet),
    });
  });
  return out;
}

/** G-AIRMET level in hundreds of feet ("080" = 8,000 ft MSL). "SFC" = 0. "FZL" uses the published freezing-level bound.
 * Returns feet MSL, or null when unspecified. */
export function gAirmetLevel(value: unknown, freezingLevel: unknown): number | null {
  const raw = str(value)
    ?.replace(/^[ \t]+|[ \t]+$/g, '')
    .toUpperCase();
  if (!raw) return null;
  if (raw === 'SFC') return 0;
  if (raw === 'FZL') {
    const fzl = advisoryNumber(freezingLevel);
    return fzl === null ? null : Math.trunc(fzl) * 100;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) * 100 : null;
}

/** Parse /api/data/gairmet JSON. Only AREA geometries of hazard types are kept. */
export function parseGAirmets(body: string): AviationAdvisory[] {
  const out: AviationAdvisory[] = [];
  entriesFrom(body).forEach((entry, index) => {
    const hazardCode = str(entry.hazard);
    if (hazardCode === null || EXCLUDED_G_AIRMET_HAZARDS.has(hazardCode.toUpperCase())) return;
    if ((str(entry.geometryType) ?? str(entry.geom))?.toUpperCase() !== 'AREA') return;
    const validTime = parseIsoDateTime(entry.validTime);
    if (validTime === null) return;
    const ring = ringFrom(entry.coords);
    if (ring.length < 3) return;

    let validTo = validTime + G_AIRMET_HALF_WINDOW_MS;
    const expire = advisoryNumber(entry.expireTime);
    if (expire !== null) validTo = Math.min(validTo, expire * 1000); // epoch seconds UTC

    const product = str(entry.product) ?? '';
    const tag = str(entry.tag) ?? String(index);
    out.push({
      // One tag can publish several polygons for the same hazard; the index keeps ids unique
      id: `G-AIRMET-${product}-${tag}-${hazardCode}-${Math.trunc(validTime / 1000)}-${index}`,
      kind: 'G-AIRMET',
      hazard: hazardFromApiCode(hazardCode),
      hazardCode,
      validFrom: validTime - G_AIRMET_HALF_WINDOW_MS,
      validTo,
      floorFeet: gAirmetLevel(entry.base, entry.fzlbase),
      ceilingFeet: gAirmetLevel(entry.top, entry.fzltop),
      boundaries: ring,
      text: str(entry.due_to),
    });
  });
  return out;
}
