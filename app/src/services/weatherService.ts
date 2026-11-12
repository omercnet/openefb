// Port of WeatherService (Services/WeatherService.swift): NOAA Aviation Weather API client with a 15-minute in-memory
// cache. Fetches METAR and TAF data from aviationweather.gov.
import type { WeatherCache } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { uuidv4 } from '../data/ids';
import { fetchWithTimeout } from './http';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';
import { parseMetarResponse } from './weather';

export const METAR_URL = 'https://aviationweather.gov/api/data/metar';
export const TAF_URL = 'https://aviationweather.gov/api/data/taf';
export const WEATHER_CACHE_EXPIRY_SECONDS = 900; // 15 minutes
export const WEATHER_BATCH_SIZE = 40; // URL length safety
/** Swift: timeoutIntervalForRequest 15 s. */
export const WEATHER_REQUEST_TIMEOUT_MS = 15_000;

export interface WeatherServiceLike {
  fetchMETAR(stationID: string): Promise<WeatherCache>;
  fetchTAF(stationID: string): Promise<string>;
  /** Fresh stations from the cache, the rest from the network in batches of 40; a station the network did not answer for
   * is served from the last cached report, however old. */
  fetchWeatherForStations(stationIDs: readonly string[]): Promise<WeatherCache[]>;
  /** The last fetched weather for a station, including entries older than the fresh-cache window, so callers can show
   * stale data (with an age badge) when offline. */
  cachedWeather(stationID: string): WeatherCache | null;
}

export interface WeatherServiceOptions {
  fetch: FetchLike;
  now?: Clock;
  newId?: () => string;
  requestTimeoutMs?: number;
  log?: Logger;
}

const failed = (cause: unknown) => new AppFailure({ kind: 'weatherFetchFailed', cause });

/** Station ids go into the query string: percent-encode each one so an id can never add a parameter. */
const idsParam = (ids: readonly string[]): string => ids.map(encodeURIComponent).join(',');

export class WeatherService implements WeatherServiceLike {
  private readonly cache = new Map<string, WeatherCache>();
  private readonly now: Clock;
  private readonly newId: () => string;

  constructor(private readonly options: WeatherServiceOptions) {
    this.now = options.now ?? systemClock;
    this.newId = options.newId ?? uuidv4;
  }

  private isFresh(cached: WeatherCache): boolean {
    return (this.now() - cached.fetchedAt) / 1000 < WEATHER_CACHE_EXPIRY_SECONDS;
  }

  private request(url: string) {
    return fetchWithTimeout(this.options.fetch, url, this.options.requestTimeoutMs ?? WEATHER_REQUEST_TIMEOUT_MS);
  }

  // MARK: METAR

  async fetchMETAR(stationID: string): Promise<WeatherCache> {
    const cached = this.cache.get(stationID);
    if (cached && this.isFresh(cached)) return cached;

    const response = await this.request(`${METAR_URL}?ids=${idsParam([stationID])}&format=json`);
    if (response.status < 200 || response.status > 299) throw failed(new Error(`HTTP ${response.status}`));
    const [entry] = parseMetarResponse(await response.text(), this.now(), this.newId);
    if (!entry) throw failed(new Error('no report for the station'));
    this.cache.set(entry.stationID, entry);
    return entry;
  }

  // MARK: TAF

  async fetchTAF(stationID: string): Promise<string> {
    const response = await this.request(`${TAF_URL}?ids=${idsParam([stationID])}&format=json`);
    if (response.status < 200 || response.status > 299) throw failed(new Error(`HTTP ${response.status}`));
    // NOAA TAF endpoint returns a JSON array with a rawTAF field.
    let json: unknown;
    try {
      json = JSON.parse(await response.text());
    } catch {
      throw failed(new Error('the response is not JSON'));
    }
    const first: unknown = Array.isArray(json) ? json[0] : undefined;
    const raw = typeof first === 'object' && first !== null ? (first as Record<string, unknown>).rawTAF : undefined;
    if (
      !Array.isArray(json) ||
      json.some((e) => typeof e !== 'object' || e === null || Array.isArray(e)) ||
      typeof raw !== 'string'
    ) {
      throw failed(new Error('the response has no rawTAF'));
    }
    return raw;
  }

  // MARK: Batch fetch

  async fetchWeatherForStations(stationIDs: readonly string[]): Promise<WeatherCache[]> {
    if (stationIDs.length === 0) return [];

    // Separate recently cached from needing fetch.
    const results: WeatherCache[] = [];
    const needsFetch: string[] = [];
    for (const id of stationIDs) {
      const cached = this.cache.get(id);
      if (cached && this.isFresh(cached)) results.push(cached);
      else needsFetch.push(id);
    }

    // Batch the rest into groups of 40 (URL length safety).
    for (let start = 0; start < needsFetch.length; start += WEATHER_BATCH_SIZE) {
      const batch = needsFetch.slice(start, start + WEATHER_BATCH_SIZE);
      try {
        const response = await this.request(`${METAR_URL}?ids=${idsParam(batch)}&format=json`);
        if (response.status < 200 || response.status > 299) continue;
        for (const entry of parseMetarResponse(await response.text(), this.now(), this.newId)) {
          this.cache.set(entry.stationID, entry);
          results.push(entry);
        }
      } catch (error) {
        this.options.log?.(
          `Batch weather fetch failed for ${batch.length} stations: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Continue with other batches.
      }
    }

    // A station the network did not answer for (offline, failed batch, no report) is served from the last cached report,
    // however old, so the map keeps its dots and the age badge says how old they are.
    const answered = new Set(results.map((r) => r.stationID));
    for (const id of needsFetch) {
      const stale = this.cache.get(id);
      if (!answered.has(id) && stale) results.push(stale);
    }
    return results;
  }

  // MARK: Cache access

  cachedWeather(stationID: string): WeatherCache | null {
    return this.cache.get(stationID) ?? null;
  }

  /** Force-clear cache for a station (used by manual refresh). */
  clearCache(stationID: string): void {
    this.cache.delete(stationID);
  }

  /** Clear all cached weather data. */
  clearAllCache(): void {
    this.cache.clear();
  }
}
