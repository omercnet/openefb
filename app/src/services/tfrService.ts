// Port of TFRService (Services/TFRService.swift): live TFRs from the FAA (tfr.faa.gov). Last good fetch is cached in memory
// and refetched at most every 10 minutes. NOTAM details are cached per NOTAM and refetched only when
// LAST_MODIFICATION_DATETIME changes.
import type { Tfr } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { fetchWithTimeout } from './http';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';
import { joinTfrs, parseTfrDetail, parseTfrFeatures, type TfrDetail } from './tfr';

export const TFR_WFS_URL =
  'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json';
export const TFR_REFRESH_INTERVAL_SECONDS = 600; // 10 minutes
export const TFR_MAX_CONCURRENT_DETAIL_FETCHES = 6;
/** Swift: timeoutIntervalForRequest 15 s. */
export const TFR_REQUEST_TIMEOUT_MS = 15_000;

/** XNOTAM detail URL, e.g. "6/4348" -> https://tfr.faa.gov/download/detail_6_4348.xml. A NOTAM id that is not made of
 * letters, digits, "/", "_" and "-" (the FAA's own shape) gets no URL: it comes from a remote document and becomes a path
 * segment, so it must not be able to add path or query parts. */
export function tfrDetailUrl(notamID: string): string | null {
  return /^[A-Za-z0-9/_-]+$/.test(notamID)
    ? `https://tfr.faa.gov/download/detail_${notamID.replaceAll('/', '_')}.xml`
    : null;
}

/** TFRs plus the time they were fetched from the FAA (epoch ms), for data-age display. */
export interface TfrSnapshot {
  tfrs: Tfr[];
  fetchedAt: number;
}

export interface TfrServiceLike {
  /** All published TFRs and when they were fetched. Served from cache when the last fetch is under 10 minutes old; if a
   * refresh fails, the last good snapshot is returned (its `fetchedAt` exposes the age). Rejects only when nothing was
   * ever fetched. */
  currentTFRs(): Promise<TfrSnapshot>;
}

export interface TfrServiceOptions {
  fetch: FetchLike;
  now?: Clock;
  requestTimeoutMs?: number;
  log?: Logger;
}

interface CachedDetail {
  lastModifiedRaw: string | null;
  detail: TfrDetail;
}

export class TfrService implements TfrServiceLike {
  private snapshot: TfrSnapshot | null = null;
  private details = new Map<string, CachedDetail>();
  private inFlight: Promise<TfrSnapshot> | null = null;
  private readonly now: Clock;

  constructor(private readonly options: TfrServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  currentTFRs(): Promise<TfrSnapshot> {
    const cached = this.snapshot;
    if (cached && (this.now() - cached.fetchedAt) / 1000 < TFR_REFRESH_INTERVAL_SECONDS) return Promise.resolve(cached);
    if (this.inFlight) return this.inFlight;

    const run: Promise<TfrSnapshot> = this.refresh()
      .then((fresh) => {
        this.snapshot = fresh;
        return fresh;
      })
      .catch((error: unknown) => {
        const previous = this.snapshot;
        if (previous) {
          this.options.log?.(
            `TFR refresh failed, serving cache from ${new Date(previous.fetchedAt).toISOString()}: ${error instanceof Error ? error.message : String(error)}`,
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

  private request(url: string) {
    return fetchWithTimeout(this.options.fetch, url, this.options.requestTimeoutMs ?? TFR_REQUEST_TIMEOUT_MS);
  }

  private async refresh(): Promise<TfrSnapshot> {
    let response;
    try {
      response = await this.request(TFR_WFS_URL);
    } catch (cause) {
      throw new AppFailure({ kind: 'tfrFetchFailed', cause });
    }
    if (response.status < 200 || response.status > 299) {
      throw new AppFailure({ kind: 'tfrFetchFailed', cause: new Error(`HTTP ${response.status}`) });
    }
    let body: string;
    try {
      body = await response.text();
    } catch (cause) {
      throw new AppFailure({ kind: 'tfrFetchFailed', cause });
    }
    const features = parseTfrFeatures(body);

    // NOTAM id -> last-modified stamp; refetch details that are new or changed.
    const modified = new Map<string, string | null>();
    for (const feature of features)
      if (!modified.has(feature.notamID)) modified.set(feature.notamID, feature.lastModifiedRaw);
    const stale = [...modified.keys()].sort().filter((id) => {
      const cached = this.details.get(id);
      const stamp = modified.get(id) ?? null;
      return !cached || cached.lastModifiedRaw !== stamp;
    });

    const fetched = await this.fetchDetails(stale);
    // Build the next cache aside, then swap: a failure above leaves the previous cache untouched.
    const next = new Map<string, CachedDetail>();
    // Keep a detail only while its NOTAM is unchanged (Q10, owner-approved deviation from Swift): a changed NOTAM whose refetch
    // failed shows "See NOTAM" until a refresh succeeds, never the superseded limits. Cancelled NOTAMs are dropped too.
    for (const [id, cached] of this.details) {
      if (modified.has(id) && cached.lastModifiedRaw === (modified.get(id) ?? null)) next.set(id, cached);
    }
    for (const [id, detail] of fetched) next.set(id, { lastModifiedRaw: modified.get(id) ?? null, detail });
    this.details = next;

    const missing = stale.length - fetched.size;
    if (missing > 0)
      this.options.log?.(
        `${missing} TFR NOTAM details unavailable; altitudes/times shown as See NOTAM until a refresh succeeds`,
      );

    const tfrs = joinTfrs(features, new Map([...next].map(([id, c]) => [id, c.detail])));
    return { tfrs, fetchedAt: this.now() };
  }

  /** Fetch XNOTAM details with bounded concurrency. Failed fetches are omitted (retried next refresh). */
  private async fetchDetails(notamIDs: string[]): Promise<Map<string, TfrDetail>> {
    const results = new Map<string, TfrDetail>();
    let next = 0;
    const worker = async () => {
      while (next < notamIDs.length) {
        const id = notamIDs[next++];
        const detail = await this.fetchDetail(id);
        if (detail) results.set(id, detail);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TFR_MAX_CONCURRENT_DETAIL_FETCHES, notamIDs.length) }, worker));
    return results;
  }

  private async fetchDetail(notamID: string): Promise<TfrDetail | null> {
    const url = tfrDetailUrl(notamID);
    if (url === null) return null;
    try {
      const response = await this.request(url);
      if (response.status < 200 || response.status > 299) return null;
      return parseTfrDetail(await response.text());
    } catch {
      return null;
    }
  }
}
