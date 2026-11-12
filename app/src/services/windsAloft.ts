// Port of the winds-aloft models and WindsAloftDecoder (Services/WindsAloftService.swift): winds and temperatures aloft
// (FD/FB bulletin) from the NOAA Aviation Weather Center. Keyless endpoint:
// https://aviationweather.gov/api/data/windtemp?region=all&level=low&fcst=06 returns the plain-text bulletin:
//
//   FBUS31 KWNO 301400
//   FD1US1
//   DATA BASED ON 301200Z
//   VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000
//
//   FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
//   ABI      1330+09 1533+05 1918+03 2022-09 2232-19 223735 223747 226160
//
// Each level is a fixed-width field whose header label is right-aligned to the field end; groups start at the field
// start (a 4-character "DDSS" sits left in a 7-character field). Blank fields are levels within 1,500 ft of the station
// elevation (not forecast). Times are epoch ms (UTC).
import { AppFailure } from '../domain/errors';
import { EARTH_RADIUS_NM } from './pirep';

/** AWC `region` query values; each bulletin covers a disjoint station set. */
export type WindsAloftRegion = 'conus' | 'alaska' | 'hawaii' | 'pacific';
export const WINDS_ALOFT_REGION_QUERY: Record<WindsAloftRegion, string> = {
  conus: 'all',
  alaska: 'alaska',
  hawaii: 'hawaii',
  pacific: 'other_pac',
};

export const WINDS_ALOFT_FORECASTS = [6, 12, 24] as const;
export type WindsAloftForecast = (typeof WINDS_ALOFT_FORECASTS)[number];
export const forecastQueryValue = (f: WindsAloftForecast): string => String(f).padStart(2, '0');
export const forecastLabel = (f: WindsAloftForecast): string => `${f} h`;

export interface WindsAloftStation {
  id: string; // FD station identifier, e.g. "SFO"
  name: string;
  latitude: number; // degrees
  longitude: number; // degrees
  elevation: number; // feet MSL
  region: WindsAloftRegion;
}

export interface WindsAloftLevel {
  altitude: number; // feet MSL
  direction: number | null; // degrees true; null when light and variable or not forecast
  speed: number | null; // knots; null when not forecast
  temperature: number | null; // degrees Celsius; null when not forecast at this level
  isLightAndVariable: boolean; // "9900" group: less than 5 knots
}

/** False for blank columns (level within 1,500 ft of the station elevation). */
export const levelIsForecast = (l: WindsAloftLevel): boolean => l.isLightAndVariable || l.speed !== null;

export const blankLevel = (altitude: number): WindsAloftLevel => ({
  altitude,
  direction: null,
  speed: null,
  temperature: null,
  isLightAndVariable: false,
});

export interface WindsAloftBulletin {
  issued: number | null; // bulletin issue time (WMO header)
  basedOn: number | null; // model data time ("DATA BASED ON")
  validTime: number | null;
  forUseStart: number | null;
  forUseEnd: number | null;
  levels: number[]; // feet MSL, header order
  rows: Map<string, WindsAloftLevel[]>; // station id -> one entry per header level
}

export interface WindsAloftReport {
  station: WindsAloftStation;
  distanceNM: number; // nautical miles from the requested coordinate
  forecast: WindsAloftForecast;
  issued: number | null;
  basedOn: number | null;
  validTime: number | null;
  forUseStart: number | null;
  forUseEnd: number | null;
  levels: WindsAloftLevel[];
}

/** True when `atMs` falls inside the bulletin's FOR USE window (both ends inclusive). */
export function isInForUsePeriod(r: Pick<WindsAloftReport, 'forUseStart' | 'forUseEnd'>, atMs: number): boolean {
  if (r.forUseStart === null || r.forUseEnd === null) return false;
  return atMs >= r.forUseStart && atMs <= r.forUseEnd;
}

// MARK: Decoding

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const allDigits = (s: string): boolean => s.length > 0 && [...s].every(isDigit);

/** Decode one FD group at `altitude` (feet MSL).
 * - `DDSS`: direction (tens of degrees true) + speed (knots), no temperature.
 * - `DDSS+-TT`: with signed temperature (degrees C).
 * - `DDSSTT`: sign omitted: negative ("TEMPS NEG ABV 24000").
 * - `9900`: light and variable. Direction 51-86 encodes speed + 100 knots (7315 = 230 degrees 115 kt). */
export function decodeGroup(group: string, altitude: number): WindsAloftLevel | null {
  const chars = [...group];
  if (![4, 6, 7].includes(chars.length) || !allDigits(chars.slice(0, 4).join(''))) return null;
  const dd = Number(chars.slice(0, 2).join(''));
  const ss = Number(chars.slice(2, 4).join(''));

  let temperature: number | null = null;
  if (chars.length === 6) {
    if (!allDigits(chars.slice(4, 6).join(''))) return null;
    temperature = -Number(chars.slice(4, 6).join('')); // degrees Celsius, implied negative
  } else if (chars.length === 7) {
    if ((chars[4] !== '+' && chars[4] !== '-') || !allDigits(chars.slice(5, 7).join(''))) return null;
    temperature = Number(chars.slice(4, 7).join('')); // degrees Celsius
  }

  if (dd === 99 && ss === 0) return { altitude, direction: null, speed: 0, temperature, isLightAndVariable: true };

  let tens = dd;
  let speed = ss; // knots
  if (tens >= 51 && tens <= 86) {
    tens -= 50;
    speed += 100;
  }
  if (tens < 0 || tens > 36) return null;
  return { altitude, direction: tens === 0 ? 360 : tens * 10, speed, temperature, isLightAndVariable: false };
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(chars: string): Token[] {
  const tokens: Token[] = [];
  let start: number | null = null;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) {
      if (start !== null) tokens.push({ text: chars.slice(start, i), start, end: i });
      start = null;
    } else if (start === null) start = i;
  }
  if (start !== null) tokens.push({ text: chars.slice(start), start, end: chars.length });
  return tokens;
}

/** Three-character uppercase alphanumeric identifier followed by whitespace or end of line. */
function isStationRow(line: string): boolean {
  if (line.length < 3 || !/^[A-Z0-9]{3}/.test(line)) return false;
  return line.length === 3 || /\s/.test(line[3]);
}

/** Time from the WMO header, e.g. `FBUS31 KWNO 301400`. */
function issueTime(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].startsWith('FB') || i + 2 >= tokens.length) continue;
    const time = tokens[i + 2].replace(/^\)+|\)+$/g, '');
    if (time.length === 6 && allDigits(time)) return time;
  }
  return null;
}

/** `DDHHMM` or `DDHHMMZ` resolved to the calendar month nearest `referenceMs`. */
export function resolveDdhhmm(ddhhmm: string, referenceMs: number): number | null {
  const digits = ddhhmm.endsWith('Z') ? ddhhmm.slice(0, -1) : ddhhmm;
  if (digits.length !== 6 || !allDigits(digits)) return null;
  const day = Number(digits.slice(0, 2));
  const hour = Number(digits.slice(2, 4));
  const minute = Number(digits.slice(4, 6));
  if (day < 1 || day > 31 || hour >= 24 || minute >= 60) return null;

  const ref = new Date(referenceMs);
  let best: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const ms = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + offset, day, hour, minute);
    if (new Date(ms).getUTCDate() !== day) continue; // e.g. 31st in a 30-day month
    if (best === null || Math.abs(ms - referenceMs) < Math.abs(best - referenceMs)) best = ms;
  }
  return best;
}

/** `1400-2100Z.` relative to the valid time: start is the latest HHMM at or before valid, end the earliest HHMM at or
 * after valid (handles windows spanning midnight). */
export function forUsePeriod(text: string, validMs: number): [number | null, number | null] {
  const cleaned = text.replace(/^[.Z]+|[.Z]+$/g, '');
  const parts = cleaned.split('-').filter((p) => p !== '');
  if (parts.length !== 2) return [null, null];

  const dayStart = Date.UTC(
    new Date(validMs).getUTCFullYear(),
    new Date(validMs).getUTCMonth(),
    new Date(validMs).getUTCDate(),
  );
  const time = (hhmm: string): number | null => {
    if (hhmm.length !== 4 || !allDigits(hhmm)) return null;
    const hour = Number(hhmm.slice(0, 2));
    const minute = Number(hhmm.slice(2));
    return hour <= 24 && minute < 60 ? dayStart + hour * 3_600_000 + minute * 60_000 : null;
  };
  let start = time(parts[0]);
  if (start !== null && start > validMs) start -= 86_400_000;
  let end = time(parts[1].replaceAll('Z', ''));
  if (end !== null && end < validMs) end += 86_400_000;
  return [start, end];
}

/** Parse a full FD bulletin. Day-of-month timestamps are resolved to the month nearest `referenceMs`. Throws
 * AppFailure(weatherFetchFailed) when there is no `FT` header row. */
export function parseBulletin(text: string, referenceMs: number): WindsAloftBulletin {
  let issued: number | null = null;
  let basedOn: number | null = null;
  let validTime: number | null = null;
  let forUseStart: number | null = null;
  let forUseEnd: number | null = null;
  let columns: { altitude: number; start: number; end: number }[] = [];
  const rows = new Map<string, WindsAloftLevel[]>();

  for (const line of text.split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/)) {
    const tokens = tokenize(line);
    const first = tokens[0];
    if (!first) continue;

    if (first.text === 'FT') {
      columns = [];
      // Field i spans from one past field i-1's end to its own label end; the first field starts where its label starts
      // (right after the 3-character station id).
      for (const token of tokens.slice(1)) {
        if (!/^[+-]?\d+$/.test(token.text)) continue; // feet MSL
        const start = columns.length > 0 ? columns[columns.length - 1].end + 1 : token.start;
        columns.push({ altitude: Number(token.text), start, end: token.end });
      }
      continue;
    }

    if (issued === null) {
      const time = issueTime(tokens.map((t) => t.text));
      if (time !== null) issued = resolveDdhhmm(time, referenceMs);
    }

    if (line.startsWith('DATA BASED ON') && tokens.length >= 4) {
      basedOn = resolveDdhhmm(tokens[3].text, referenceMs);
      continue;
    }

    if (first.text === 'VALID' && tokens.length >= 2) {
      validTime = resolveDdhhmm(tokens[1].text, referenceMs);
      const useIndex = tokens.findIndex((t) => t.text === 'USE');
      if (validTime !== null && useIndex >= 0 && useIndex + 1 < tokens.length) {
        [forUseStart, forUseEnd] = forUsePeriod(tokens[useIndex + 1].text, validTime);
      }
      continue;
    }

    if (columns.length === 0 || !isStationRow(line)) continue;

    const levels = columns.map((c) => blankLevel(c.altitude));
    for (const token of tokens.slice(1)) {
      const index = columns.findIndex((c) => token.start >= c.start && token.start < c.end);
      if (index < 0) continue;
      const level = decodeGroup(token.text, columns[index].altitude);
      if (level) levels[index] = level;
    }
    rows.set(first.text, levels);
  }

  if (columns.length === 0) throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error('no FT header row') });
  return { issued, basedOn, validTime, forUseStart, forUseEnd, levels: columns.map((c) => c.altitude), rows };
}

/** Haversine great-circle distance in nautical miles. */
export function windsDistanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearest station to `near` (great-circle) with its distance in nautical miles; the first of equals wins. */
export function nearestStation(
  near: { lat: number; lon: number },
  among: readonly WindsAloftStation[],
): { station: WindsAloftStation; distanceNM: number } | null {
  let best: { station: WindsAloftStation; distanceNM: number } | null = null;
  for (const station of among) {
    const distanceNM = windsDistanceNm(near, { lat: station.latitude, lon: station.longitude });
    if (best === null || distanceNM < best.distanceNM) best = { station, distanceNM };
  }
  return best;
}
