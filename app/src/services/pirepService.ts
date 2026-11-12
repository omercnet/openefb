// Port of PirepService (Services/PirepService.swift): pilot reports from the NOAA Aviation Weather Center data API.
// Keyless endpoint: https://aviationweather.gov/api/data/pirep?bbox=...&age=2&format=json (HTTP 204 with an empty body
// when nothing matches).
import { AppFailure } from '../domain/errors';
import { fetchWithTimeout, isOfflineError } from './http';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';
import { filterPireps, parsePireps, pirepBoundingBoxes, pirepId, type Pirep } from './pirep';

export const PIREP_URL = 'https://aviationweather.gov/api/data/pirep';
/** Swift: timeoutIntervalForRequest 15 s. */
export const PIREP_REQUEST_TIMEOUT_MS = 15_000;

export interface PirepServiceLike {
  /** PIREPs within `radiusNM` nautical miles of `coordinate` observed no more than `maxAgeSeconds` ago, newest first. */
  fetchPireps(near: { lat: number; lon: number }, radiusNM: number, maxAgeSeconds: number): Promise<Pirep[]>;
}

export interface PirepServiceOptions {
  fetch: FetchLike;
  now?: Clock;
  requestTimeoutMs?: number;
  log?: Logger;
}

export class PirepService implements PirepServiceLike {
  private readonly now: Clock;
  constructor(private readonly options: PirepServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  async fetchPireps(near: { lat: number; lon: number }, radiusNM: number, maxAgeSeconds: number): Promise<Pirep[]> {
    if (
      !Number.isFinite(near.lat) ||
      !Number.isFinite(near.lon) ||
      !Number.isFinite(radiusNM) ||
      !Number.isFinite(maxAgeSeconds)
    ) {
      throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error('invalid PIREP query') });
    }
    // Query a bounding box around the circle (two when it crosses the antimeridian), then filter precisely by great-circle
    // distance. The API's own `id`+`distance` radius is loosely enforced and needs a reporting station id, which private strips
    // lack.
    const ageHours = (Math.max(maxAgeSeconds, 60) / 3600).toFixed(2);
    const parsed: Pirep[] = [];
    const seen = new Set<string>();
    for (const bbox of pirepBoundingBoxes(near, radiusNM)) {
      const url = `${PIREP_URL}?bbox=${encodeURIComponent(bbox)}&age=${ageHours}&format=json`;
      let response;
      try {
        response = await fetchWithTimeout(
          this.options.fetch,
          url,
          this.options.requestTimeoutMs ?? PIREP_REQUEST_TIMEOUT_MS,
        );
      } catch (error) {
        if (isOfflineError(error)) throw new AppFailure({ kind: 'networkUnavailable' });
        throw new AppFailure({ kind: 'weatherFetchFailed', cause: error });
      }
      if (response.status < 200 || response.status > 299) {
        throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(`HTTP ${response.status}`) });
      }
      // A report on a box edge can come back from both requests: keep one.
      for (const p of parsePireps(await response.text())) {
        const id = pirepId(p);
        if (!seen.has(id)) {
          seen.add(id);
          parsed.push(p);
        }
      }
    }
    const result = filterPireps(parsed, near, radiusNM, maxAgeSeconds, this.now());
    this.options.log?.(`PIREPs: ${parsed.length} in bbox, ${result.length} within ${radiusNM} NM`);
    return result;
  }
}
