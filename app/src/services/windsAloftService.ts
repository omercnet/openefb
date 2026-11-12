// Port of WindsAloftService (Services/WindsAloftService.swift): winds and temperatures aloft (FD/FB bulletin) from the NOAA
// Aviation Weather Center, one bulletin per region and forecast period, cached for 30 minutes.
import { AppFailure } from '../domain/errors';
import { fetchWithTimeout, isOfflineError } from './http';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';
import {
  forecastQueryValue,
  nearestStation,
  parseBulletin,
  WINDS_ALOFT_REGION_QUERY,
  type WindsAloftBulletin,
  type WindsAloftForecast,
  type WindsAloftRegion,
  type WindsAloftReport,
  type WindsAloftStation,
} from './windsAloft';
import { WINDS_ALOFT_STATIONS } from './windsAloftStations';

export const WINDS_ALOFT_URL = 'https://aviationweather.gov/api/data/windtemp';
export const WINDS_ALOFT_CACHE_EXPIRY_SECONDS = 1800; // 30 minutes
/** Swift: timeoutIntervalForRequest 15 s. */
export const WINDS_ALOFT_REQUEST_TIMEOUT_MS = 15_000;

export interface WindsAloftServiceLike {
  /** Winds aloft from the FD station nearest to `near` for the given forecast period. */
  fetchWindsAloft(near: { lat: number; lon: number }, forecast: WindsAloftForecast): Promise<WindsAloftReport>;
}

export interface WindsAloftServiceOptions {
  fetch: FetchLike;
  /** FD forecast points; defaults to the bundled NWS station table. */
  stations?: readonly WindsAloftStation[];
  now?: Clock;
  requestTimeoutMs?: number;
  log?: Logger;
}

const failed = (message: string) => new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(message) });

export class WindsAloftService implements WindsAloftServiceLike {
  private readonly cache = new Map<string, { bulletin: WindsAloftBulletin; fetchedAt: number }>();
  private readonly inFlight = new Map<string, Promise<WindsAloftBulletin>>();
  private readonly stations: readonly WindsAloftStation[];
  private readonly now: Clock;

  constructor(private readonly options: WindsAloftServiceOptions) {
    this.stations = options.stations ?? WINDS_ALOFT_STATIONS;
    this.now = options.now ?? systemClock;
  }

  async fetchWindsAloft(near: { lat: number; lon: number }, forecast: WindsAloftForecast): Promise<WindsAloftReport> {
    const nearest = nearestStation(near, this.stations);
    if (!nearest) throw failed('no winds aloft stations');
    const region = nearest.station.region;
    const bulletin = await this.bulletin(region, forecast);

    // The nearest table station may be missing from this issuance; fall back to the nearest station that the bulletin
    // actually contains.
    const available = this.stations.filter((s) => s.region === region && bulletin.rows.has(s.id));
    const pick = nearestStation(near, available);
    const levels = pick ? bulletin.rows.get(pick.station.id) : undefined;
    if (!pick || !levels) throw failed('the station is not in the bulletin');

    return {
      station: pick.station,
      distanceNM: pick.distanceNM,
      forecast,
      issued: bulletin.issued,
      basedOn: bulletin.basedOn,
      validTime: bulletin.validTime,
      forUseStart: bulletin.forUseStart,
      forUseEnd: bulletin.forUseEnd,
      levels,
    };
  }

  private bulletin(region: WindsAloftRegion, forecast: WindsAloftForecast): Promise<WindsAloftBulletin> {
    const key = `${WINDS_ALOFT_REGION_QUERY[region]}-${forecastQueryValue(forecast)}`;
    const now = this.now();
    const cached = this.cache.get(key);
    if (
      cached &&
      (now - cached.fetchedAt) / 1000 < WINDS_ALOFT_CACHE_EXPIRY_SECONDS &&
      (cached.bulletin.forUseEnd === null || now <= cached.bulletin.forUseEnd)
    ) {
      return Promise.resolve(cached.bulletin);
    }
    // JS-only: callers that arrive while the same bulletin downloads join it.
    const running = this.inFlight.get(key);
    if (running) return running;
    const task: Promise<WindsAloftBulletin> = this.download(region, forecast, key, now).finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async download(
    region: WindsAloftRegion,
    forecast: WindsAloftForecast,
    key: string,
    now: number,
  ): Promise<WindsAloftBulletin> {
    const url = `${WINDS_ALOFT_URL}?region=${WINDS_ALOFT_REGION_QUERY[region]}&level=low&fcst=${forecastQueryValue(forecast)}`;
    let response;
    try {
      response = await fetchWithTimeout(
        this.options.fetch,
        url,
        this.options.requestTimeoutMs ?? WINDS_ALOFT_REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      if (isOfflineError(error)) throw new AppFailure({ kind: 'networkUnavailable' });
      throw new AppFailure({ kind: 'weatherFetchFailed', cause: error });
    }
    if (response.status < 200 || response.status > 299) throw failed(`HTTP ${response.status}`);
    const bulletin = parseBulletin(await response.text(), now);
    this.cache.set(key, { bulletin, fetchedAt: now });
    this.options.log?.(`Winds aloft ${key}: ${bulletin.rows.size} stations`);
    return bulletin;
  }
}
