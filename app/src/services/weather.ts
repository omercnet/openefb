// Port of the NOAA METAR parsing in WeatherService.swift: aviationweather.gov JSON -> WeatherCache. Pure and
// platform-free. Times are epoch ms.
//   [{icaoId, rawOb, temp, dewp, wdir, wspd, wgst, visib, clouds, obsTime, fltCat, altim, reportTime}, ...]
import { FLIGHT_CATEGORIES, type FlightCategory } from '../domain/core/types';
import { HPA_PER_INHG } from '../domain/core/units';
import type { WeatherCache } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { parseIsoDateTime } from './isoDate';

type Entry = Record<string, unknown>;

const weatherFailure = (message: string): AppFailure =>
  new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(message) });

/** Swift `Double(String)` accepts decimal text; "" and non-numbers are nil. */
export function doubleFromText(s: string): number | null {
  const t = s.trim();
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseDouble(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return doubleFromText(value);
  return null;
}

/** Swift: an integral number is an Int; any other number truncates; text must be a whole number. */
export function parseInt10(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : Math.trunc(value);
  }
  if (typeof value === 'string') return /^[+-]?\d+$/.test(value) ? Number(value) : null;
  return null;
}

/** Lowest cloud base with BKN or OVC cover; `clouds` is [{cover, base}]. A non-integral base is skipped. */
export function parseCeiling(clouds: unknown): number | null {
  if (!Array.isArray(clouds) || !clouds.every((c) => typeof c === 'object' && c !== null && !Array.isArray(c)))
    return null;
  let lowest: number | null = null;
  for (const cloud of clouds as Entry[]) {
    if (cloud.cover !== 'BKN' && cloud.cover !== 'OVC') continue;
    const base = cloud.base;
    if (typeof base === 'number' && Number.isInteger(base) && (lowest === null || base < lowest)) lowest = base;
  }
  return lowest;
}

/** "10+" -> 10, "3" -> 3, anything else null. */
export function parseVisibilityFloat(visibility: string | null): number | null {
  return visibility === null ? null : doubleFromText(visibility.replaceAll('+', ''));
}

/** Flight category from ceiling and visibility per FAA standards, worst wins. VFR: ceiling >3000 AND vis >5; MVFR:
 * ceiling 1000-3000 OR vis 3-5; IFR: ceiling 500-999 OR vis 1-3 (exclusive); LIFR: ceiling <500 OR vis <1. */
export function computeFlightCategory(ceiling: number | null, visibility: string | null): FlightCategory {
  const vis = parseVisibilityFloat(visibility);
  let ceilingCat: FlightCategory = 'vfr'; // no ceiling = clear sky
  if (ceiling !== null) {
    if (ceiling < 500) ceilingCat = 'lifr';
    else if (ceiling < 1000) ceilingCat = 'ifr';
    else if (ceiling <= 3000) ceilingCat = 'mvfr';
  }
  let visCat: FlightCategory = 'vfr'; // no visibility data = assume VFR
  if (vis !== null) {
    if (vis < 1) visCat = 'lifr';
    else if (vis < 3) visCat = 'ifr';
    else if (vis <= 5) visCat = 'mvfr';
  }
  for (const cat of ['lifr', 'ifr', 'mvfr', 'vfr'] as const) if (ceilingCat === cat || visCat === cat) return cat;
  return 'vfr';
}

/** Parse the NOAA METAR JSON response into WeatherCache entries. Throws AppFailure(weatherFetchFailed) when the body is
 * not a JSON array of objects. Entries without `icaoId` are dropped. */
export function parseMetarResponse(body: string, fetchedAtMs: number, newId: () => string): WeatherCache[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw weatherFailure('the response is not JSON');
  }
  if (!Array.isArray(json) || !json.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e))) {
    throw weatherFailure('the response is not a list of objects');
  }
  const out: WeatherCache[] = [];
  for (const entry of json as Entry[]) {
    if (typeof entry.icaoId !== 'string') continue;

    // Visibility can be numeric or string.
    let visibility: string | null = null;
    if (typeof entry.visib === 'number' && Number.isFinite(entry.visib)) {
      visibility = entry.visib >= 10 ? '10+' : entry.visib.toFixed(1);
    } else if (typeof entry.visib === 'string') {
      visibility = entry.visib;
    }

    const ceiling = parseCeiling(entry.clouds);
    const catText = typeof entry.fltCat === 'string' ? entry.fltCat.toLowerCase() : null;
    const flightCategory =
      (FLIGHT_CATEGORIES as readonly string[]).includes(catText ?? '') && catText !== null
        ? (catText as FlightCategory)
        : computeFlightCategory(ceiling, visibility);

    // aviationweather.gov sends `altim` in hPa (e.g. 1017 for Q1017). A value under 100 can only be inHg, so convert
    // rather than show 30 hPa.
    const altim = parseDouble(entry.altim);
    const altimeterHPa = altim === null ? null : altim < 100 ? altim * HPA_PER_INHG : altim;

    // NOAA `obsTime` is epoch seconds (number); `reportTime` is an ISO-8601 string with fractional seconds.
    let observationTime: number | null = null;
    const epoch = parseDouble(entry.obsTime);
    if (epoch !== null) observationTime = epoch * 1000;
    else if (typeof entry.reportTime === 'string') observationTime = parseIsoDateTime(entry.reportTime);

    out.push({
      id: newId(),
      stationID: entry.icaoId,
      rawMETAR: typeof entry.rawOb === 'string' ? entry.rawOb : null,
      temperature: parseDouble(entry.temp),
      dewpoint: parseDouble(entry.dewp),
      windDirection: parseInt10(entry.wdir),
      windSpeed: parseInt10(entry.wspd),
      windGust: parseInt10(entry.wgst),
      visibility,
      ceiling,
      flightCategory,
      observationTime,
      altimeterHPa,
      fetchedAt: fetchedAtMs,
    });
  }
  return out;
}
