// Port of AirSigmetService (Services/AirSigmetService.swift): last good fetch cached in memory and refetched at most
// every 10 minutes. Both feeds must succeed; a partial picture (SIGMETs without AIRMETs) is not published.
import { AppFailure } from '../domain/errors';
import { parseAirSigmets, parseGAirmets, type AdvisorySnapshot } from './airSigmet';
import { fetchWithTimeout } from './http';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';

export const AIR_SIGMET_URL = 'https://aviationweather.gov/api/data/airsigmet?format=json';
export const G_AIRMET_URL = 'https://aviationweather.gov/api/data/gairmet?format=json';
export const ADVISORY_REFRESH_INTERVAL_SECONDS = 600; // 10 minutes
/** Swift: timeoutIntervalForRequest 15 s. */
export const ADVISORY_REQUEST_TIMEOUT_MS = 15_000;

export interface AirSigmetServiceLike {
  /** All advisories from the last fetch (including not-yet-valid ones) and the fetch time. Cached for 10 minutes; a
   * failed refresh returns the last good snapshot. Rejects only when nothing was ever fetched. Filter with
   * `validAdvisories` before display. */
  currentAdvisories(): Promise<AdvisorySnapshot>;
}

export interface AirSigmetServiceOptions {
  fetch: FetchLike;
  now?: Clock;
  requestTimeoutMs?: number;
  log?: Logger;
}

export class AirSigmetService implements AirSigmetServiceLike {
  private snapshot: AdvisorySnapshot | null = null;
  private inFlight: Promise<AdvisorySnapshot> | null = null;
  private readonly now: Clock;

  constructor(private readonly options: AirSigmetServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  currentAdvisories(): Promise<AdvisorySnapshot> {
    const cached = this.snapshot;
    if (cached && (this.now() - cached.fetchedAt) / 1000 < ADVISORY_REFRESH_INTERVAL_SECONDS) {
      return Promise.resolve(cached);
    }
    if (this.inFlight) return this.inFlight;

    const run: Promise<AdvisorySnapshot> = this.refresh()
      .then((fresh) => {
        this.snapshot = fresh;
        return fresh;
      })
      .catch((error: unknown) => {
        const previous = this.snapshot;
        if (previous) {
          this.options.log?.(
            `Advisory refresh failed, serving cache from ${new Date(previous.fetchedAt).toISOString()}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return previous;
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /** Both feeds must succeed. */
  private async refresh(): Promise<AdvisorySnapshot> {
    const [sigmetBody, gAirmetBody] = await Promise.all([this.fetchBody(AIR_SIGMET_URL), this.fetchBody(G_AIRMET_URL)]);
    const advisories = [...parseAirSigmets(sigmetBody), ...parseGAirmets(gAirmetBody)];
    return { advisories, fetchedAt: this.now() };
  }

  private async fetchBody(url: string): Promise<string> {
    let response;
    try {
      response = await fetchWithTimeout(
        this.options.fetch,
        url,
        this.options.requestTimeoutMs ?? ADVISORY_REQUEST_TIMEOUT_MS,
      );
    } catch (cause) {
      throw new AppFailure({ kind: 'weatherFetchFailed', cause });
    }
    if (response.status < 200 || response.status > 299) {
      throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(`HTTP ${response.status}`) });
    }
    try {
      return await response.text(); // empty for HTTP 204 (no advisories)
    } catch (cause) {
      throw new AppFailure({ kind: 'weatherFetchFailed', cause });
    }
  }
}
