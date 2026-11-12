// Port of the Pirep model and PirepParser (Services/PirepService.swift): pilot reports (PIREPs/AIREPs) from the NOAA
// Aviation Weather Center data API. Pure and platform-free. Times are epoch ms; coordinates are { lat, lon }.
import { AppFailure } from '../domain/errors';
import { doubleFromText } from './weather';

/** Cloud layer reported in the `/SK` group. */
export interface PirepCloudLayer {
  cover: string; // "BKN", "OVC", "SCT", "IMC", "CLR" ...
  base: number | null; // feet MSL, null when not reported
  top: number | null;
}

/** Turbulence or icing group (`/TB`, `/IC`). */
export interface PirepCondition {
  intensity: string; // "LGT", "MOD", "SEV", "NEG" ...
  type: string | null; // "CHOP", "CAT", "RIME", "MIXED" ...
  frequency: string | null; // "CONT", "INT", "OCNL" (turbulence only)
  base: number | null; // feet MSL
  top: number | null;
}

export interface Pirep {
  observationTime: number;
  reportType: string; // "PIREP", "Urgent PIREP", "AIREP"
  aircraftType: string | null;
  latitude: number; // degrees
  longitude: number; // degrees
  altitude: number | null; // feet MSL, null when unknown or reported only as DURC/DURD
  altitudeQualifier: string | null; // "DURC" (during climb), "DURD" (during descent), "UNKN"
  clouds: PirepCloudLayer[];
  weather: string | null; // present weather, e.g. "-RA", "FU"
  temperature: number | null; // degrees Celsius
  windDirection: number | null; // degrees true
  windSpeed: number | null; // knots
  turbulence: PirepCondition[];
  icing: PirepCondition[];
  rawText: string;
}

/** Swift prints the epoch seconds as a Double ("1793386320.0"). */
export function pirepId(p: Pirep): string {
  const seconds = p.observationTime / 1000;
  return `${Number.isInteger(seconds) ? `${seconds}.0` : seconds}-${p.rawText}`;
}

export const pirepIsUrgent = (p: Pirep): boolean =>
  p.reportType.toLowerCase().includes('urgent') || p.rawText.includes(' UUA ');

/** Swift `Int.formatted()` in an English locale: digit groups of three. */
export function formatInt(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// MARK: Display summaries

export function pirepAltitudeText(p: Pirep): string {
  const qualifier = p.altitudeQualifier === 'DURC' ? 'climbing' : p.altitudeQualifier === 'DURD' ? 'descending' : null;
  if (p.altitude !== null) {
    const feet = `${formatInt(p.altitude)} ft MSL`;
    return qualifier ? `${feet} (${qualifier})` : feet;
  }
  if (qualifier) return qualifier.charAt(0).toUpperCase() + qualifier.slice(1);
  return 'Alt unknown';
}

function conditionsSummary(conditions: readonly PirepCondition[]): string | null {
  if (conditions.length === 0) return null;
  return conditions
    .map((c) => {
      const parts = [c.intensity];
      if (c.frequency !== null) parts.push(c.frequency);
      if (c.type !== null) parts.push(c.type);
      let text = parts.join(' ');
      if (c.base !== null && c.top !== null) text += ` ${formatInt(c.base)}\u2013${formatInt(c.top)} ft`;
      else if (c.base !== null) text += ` from ${formatInt(c.base)} ft`;
      else if (c.top !== null) text += ` to ${formatInt(c.top)} ft`;
      return text;
    })
    .join(', ');
}

export const pirepTurbulenceSummary = (p: Pirep): string | null => conditionsSummary(p.turbulence);
export const pirepIcingSummary = (p: Pirep): string | null => conditionsSummary(p.icing);

export function pirepSkySummary(p: Pirep): string | null {
  if (p.clouds.length === 0) return null;
  return p.clouds
    .map((l) => {
      let text = l.cover;
      if (l.base !== null) text += ` ${formatInt(l.base)} ft`;
      if (l.top !== null) text += ` tops ${formatInt(l.top)} ft`;
      return text;
    })
    .join(', ');
}

export function pirepWindSummary(p: Pirep): string | null {
  if (p.windSpeed === null) return null;
  const direction = p.windDirection !== null ? `${String(p.windDirection).padStart(3, '0')}\u00b0` : 'VRB';
  return `${direction} ${p.windSpeed} kt`;
}

// MARK: Parsing and filtering

/** Earth radius in nautical miles. */
export const EARTH_RADIUS_NM = 3440.065;

type Entry = Record<string, unknown>;

/** Non-empty trimmed string, null for null/"" values. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/^[ \t]+|[ \t]+$/g, '');
  return trimmed === '' ? null : trimmed;
}

function dbl(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return doubleFromText(value);
  return null;
}

const roundHalfAway = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));
const int = (value: unknown): number | null => {
  const d = dbl(value);
  return d === null ? null : roundHalfAway(d);
};
const positive = (value: unknown): number | null => {
  const v = int(value);
  return v !== null && v > 0 ? v : null;
};

function condition(entry: Entry, prefix: string, index: number, hasFrequency: boolean): PirepCondition | null {
  const intensity = str(entry[`${prefix}Int${index}`]);
  if (intensity === null) return null;
  const base = int(entry[`${prefix}Bas${index}`]);
  const top = int(entry[`${prefix}Top${index}`]);
  return {
    intensity: intensity.toUpperCase(),
    type: str(entry[`${prefix}Type${index}`]),
    frequency: hasFrequency ? str(entry[`${prefix}Freq${index}`]) : null,
    // Bases/tops are hundreds of feet MSL.
    base: base === null ? null : base * 100,
    top: top === null ? null : top * 100,
  };
}

export function parsePirepEntry(entry: Entry): Pirep | null {
  const epoch = dbl(entry.obsTime);
  const lat = dbl(entry.lat);
  const lon = dbl(entry.lon);
  const raw = str(entry.rawOb);
  if (epoch === null || lat === null || lon === null || raw === null) return null;

  // fltLvl is hundreds of feet MSL. DURC/DURD reports often carry fltLvl 0 = not given.
  const levelType = str(entry.fltLvlType);
  const flightLevel = int(entry.fltLvl);
  let altitude: number | null;
  if (levelType === 'UNKN') altitude = null;
  else if (flightLevel !== null && (flightLevel > 0 || levelType === 'OTHER' || levelType === null))
    altitude = flightLevel * 100;
  else altitude = null;
  const altitudeQualifier = levelType === 'OTHER' ? null : levelType;

  const rawClouds =
    Array.isArray(entry.clouds) && entry.clouds.every((c) => typeof c === 'object' && c !== null && !Array.isArray(c))
      ? (entry.clouds as Entry[])
      : [];
  const clouds: PirepCloudLayer[] = [];
  for (const layer of rawClouds) {
    const cover = str(layer.cover);
    if (cover === null) continue;
    // AWC encodes "not reported" base/top as 0.
    clouds.push({ cover, base: positive(layer.base), top: positive(layer.top) });
  }

  const turbulence = [1, 2].flatMap((i) => condition(entry, 'tb', i, true) ?? []);
  const icing = [1, 2].flatMap((i) => condition(entry, 'icg', i, false) ?? []);

  return {
    observationTime: epoch * 1000, // epoch seconds UTC
    reportType: str(entry.pirepType) ?? 'PIREP',
    aircraftType: str(entry.acType),
    latitude: lat,
    longitude: lon,
    altitude,
    altitudeQualifier,
    clouds,
    weather: str(entry.wxString),
    temperature: int(entry.temp),
    windDirection: int(entry.wdir),
    windSpeed: int(entry.wspd),
    turbulence,
    icing,
    rawText: raw,
  };
}

/** Parse the AWC `pirep` JSON array. Entries without a position, observation time or raw text are dropped. An empty body
 * (HTTP 204) yields an empty array. */
export function parsePireps(body: string): Pirep[] {
  if (body.length === 0) return [];
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error('the response is not JSON') });
  }
  if (!Array.isArray(json) || !json.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e))) {
    throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error('the response is not a list of objects') });
  }
  return (json as Entry[]).flatMap((e) => parsePirepEntry(e) ?? []);
}

/** Haversine great-circle distance in nautical miles. */
export function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Keep reports within `radiusNM` (inclusive) and no older than `maxAgeSeconds` (inclusive), sorted newest first. Reports
 * time-stamped more than 5 minutes in the future are dropped. */
export function filterPireps(
  pireps: readonly Pirep[],
  near: { lat: number; lon: number },
  radiusNM: number,
  maxAgeSeconds: number,
  nowMs: number,
): Pirep[] {
  return pireps
    .filter((p) => {
      const age = (nowMs - p.observationTime) / 1000;
      return age <= maxAgeSeconds && age >= -300 && distanceNm(near, { lat: p.latitude, lon: p.longitude }) <= radiusNM;
    })
    .sort((a, b) => b.observationTime - a.observationTime);
}

/** Bounding box `minLat,minLon,maxLat,maxLon` (degrees) enclosing a `radiusNM` circle. */
export function pirepBoundingBox(around: { lat: number; lon: number }, radiusNM: number): string {
  const dLat = radiusNM / 60; // 1 degree latitude is about 60 NM
  const cosLat = Math.max(Math.cos((around.lat * Math.PI) / 180), 0.01);
  const dLon = Math.min(radiusNM / (60 * cosLat), 180);
  const minLat = Math.max(around.lat - dLat, -90);
  const maxLat = Math.min(around.lat + dLat, 90);
  const minLon = Math.max(around.lon - dLon, -180);
  const maxLon = Math.min(around.lon + dLon, 180);
  return [minLat, minLon, maxLat, maxLon].map((v) => v.toFixed(3)).join(',');
}

/** Bounding boxes `minLat,minLon,maxLat,maxLon` enclosing a `radiusNM` circle, split at the antimeridian: one box normally, two when
 * the circle crosses +-180 (a single clamped box would silently drop in-radius reports on the far side). A circle that reaches a
 * pole or spans more than the globe's width is one whole-longitude box. */
export function pirepBoundingBoxes(around: { lat: number; lon: number }, radiusNM: number): string[] {
  const dLat = radiusNM / 60;
  const cosLat = Math.max(Math.cos((around.lat * Math.PI) / 180), 0.01);
  const dLon = radiusNM / (60 * cosLat);
  const minLat = Math.max(around.lat - dLat, -90);
  const maxLat = Math.min(around.lat + dLat, 90);
  const fmt = (a: number, b: number, c: number, d: number) => [a, b, c, d].map((v) => v.toFixed(3)).join(',');
  if (dLon >= 180) return [fmt(minLat, -180, maxLat, 180)];
  const lon = ((((around.lon + 180) % 360) + 360) % 360) - 180; // 190 is -170
  const west = lon - dLon;
  const east = lon + dLon;
  if (west < -180) return [fmt(minLat, -180, maxLat, east), fmt(minLat, west + 360, maxLat, 180)];
  if (east > 180) return [fmt(minLat, west, maxLat, 180), fmt(minLat, -180, maxLat, east - 360)];
  return [fmt(minLat, west, maxLat, east)];
}
