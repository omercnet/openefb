// Port of NotamService (Services/NotamService.swift): FAA NOTAM API client with a 10-minute per-airport in-memory
// cache. Needs a free FAA developer key (client_id + client_secret request headers), read through the SecretStore.
// Response schema: the FAA NOTAM API documentation (see notam.ts). Not verified against the live API.
import type { Airport } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY, type SecretStore } from '../domain/ports/secretStore';
import { fetchWithTimeout, isOfflineError } from './http';
import {
  activeSorted,
  locationQuery,
  NOTAM_ENDPOINT,
  parseNotamResponse,
  type Notam,
  type NotamPage,
  type NotamReport,
} from './notam';
import { systemClock, type Clock, type FetchLike, type Logger } from './ports';

// MARK: Errors

export type NotamErrorCode = 'notConfigured' | 'credentialsRejected';

const NOTAM_ERROR_TEXT: Record<NotamErrorCode, string> = {
  notConfigured: 'NOTAMs need a free FAA API key. Add it in Settings > NOTAM API.',
  credentialsRejected: 'The FAA rejected the NOTAM API key. Check the client ID and secret in Settings > NOTAM API.',
};

export class NotamError extends Error {
  constructor(readonly code: NotamErrorCode) {
    super(NOTAM_ERROR_TEXT[code]);
    this.name = 'NotamError';
  }
}

// MARK: Credentials

export interface NotamCredentials {
  clientID: string;
  clientSecret: string;
}

/** FAA developer portal where the free NOTAM API key is requested. */
export const FAA_REGISTRATION_URL = 'https://api.faa.gov/s/';

/** Stored credentials, or null when either value is missing or blank. A SecretStore failure reads as missing. */
export async function loadNotamCredentials(store: SecretStore): Promise<NotamCredentials | null> {
  try {
    const id = (await store.get(NOTAM_CLIENT_ID_KEY))?.trim();
    const secret = (await store.get(NOTAM_CLIENT_SECRET_KEY))?.trim();
    return id && secret ? { clientID: id, clientSecret: secret } : null;
  } catch {
    return null;
  }
}

export async function saveNotamCredentials(store: SecretStore, credentials: NotamCredentials): Promise<void> {
  await store.set(NOTAM_CLIENT_ID_KEY, credentials.clientID);
  await store.set(NOTAM_CLIENT_SECRET_KEY, credentials.clientSecret);
}

export async function removeNotamCredentials(store: SecretStore): Promise<void> {
  await store.remove(NOTAM_CLIENT_ID_KEY);
  await store.remove(NOTAM_CLIENT_SECRET_KEY);
}

// MARK: Service

export const NOTAM_CACHE_EXPIRY_SECONDS = 600; // 10 minutes
export const NOTAM_PAGE_SIZE = 100; // FAA allows up to 1000
export const NOTAM_MAX_PAGES = 5; // cap on sequential pages (500 NOTAMs)
export const NOTAM_FETCH_BUDGET_SECONDS = 30; // for all pages of one airport
/** Swift: timeoutIntervalForRequest 15 s. */
export const NOTAM_REQUEST_TIMEOUT_MS = 15_000;

export interface NotamServiceLike {
  /** Currently effective NOTAMs for an airport, closures first. Rejects with NotamError('notConfigured') (before any
   * network access) when no FAA key is stored. */
  fetchNotams(airport: Pick<Airport, 'icao' | 'faaID'>): Promise<NotamReport>;
}

export interface NotamServiceOptions {
  fetch: FetchLike;
  /** Read on every fetch, so a key saved in Settings applies at once. */
  credentials: () => Promise<NotamCredentials | null>;
  now?: Clock;
  requestTimeoutMs?: number;
  log?: Logger;
}

interface CacheEntry {
  notams: Notam[];
  fetchedAt: number;
  incomplete: boolean;
}

export class NotamService implements NotamServiceLike {
  /** All parsed NOTAMs per location query value; filtered for effectiveness on every read. */
  private cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<NotamReport>>();
  private readonly now: Clock;

  constructor(private readonly options: NotamServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  async fetchNotams(airport: Pick<Airport, 'icao' | 'faaID'>): Promise<NotamReport> {
    const credentials = await this.options.credentials();
    if (!credentials) throw new NotamError('notConfigured');

    const query = locationQuery(airport);
    const location = query.value || airport.icao;
    const now = this.now();
    const cached = this.cache.get(location);
    if (cached && (now - cached.fetchedAt) / 1000 < NOTAM_CACHE_EXPIRY_SECONDS) {
      return {
        location,
        notams: activeSorted(cached.notams, now),
        fetchedAt: cached.fetchedAt,
        refreshFailed: false,
        isIncomplete: cached.incomplete,
      };
    }

    // JS-only: a second call for the same airport while a download runs joins it instead of starting another.
    const running = this.inFlight.get(location);
    if (running) return running;
    const download = this.download(location, query, credentials, now).finally(() => {
      if (this.inFlight.get(location) === download) this.inFlight.delete(location);
    });
    this.inFlight.set(location, download);
    return download;
  }

  clearCache(): void {
    this.cache = new Map();
  }

  private async download(
    location: string,
    query: { name: string; value: string },
    credentials: NotamCredentials,
    now: number,
  ): Promise<NotamReport> {
    const all: Notam[] = [];
    let incomplete = false;
    try {
      let pageNum = 1;
      let lastPage = 1;
      do {
        const page = await this.fetchPage(query, pageNum, credentials);
        all.push(...page.notams);
        lastPage = page.totalPages;
        pageNum += 1;
        if (
          pageNum <= lastPage &&
          (pageNum > NOTAM_MAX_PAGES || (this.now() - now) / 1000 >= NOTAM_FETCH_BUDGET_SECONDS)
        ) {
          incomplete = true; // never present a cut-off list as complete
          break;
        }
      } while (pageNum <= lastPage);
    } catch (error) {
      // Fail honestly: serve the last good copy for this airport, flagged, with its true age.
      const previous = this.cache.get(location);
      if (previous) {
        this.options.log?.(
          `NOTAM refresh failed for ${location}, serving the copy from ${new Date(previous.fetchedAt).toISOString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return {
          location,
          notams: activeSorted(previous.notams, now),
          fetchedAt: previous.fetchedAt,
          refreshFailed: true,
          isIncomplete: previous.incomplete,
        };
      }
      throw error;
    }

    const fetchedAt = this.now();
    this.cache.set(location, { notams: all, fetchedAt, incomplete });
    this.options.log?.(`Fetched ${all.length} NOTAMs for ${location}${incomplete ? ' (incomplete)' : ''}`);
    return {
      location,
      notams: activeSorted(all, fetchedAt),
      fetchedAt,
      refreshFailed: false,
      isIncomplete: incomplete,
    };
  }

  private async fetchPage(
    query: { name: string; value: string },
    pageNum: number,
    credentials: NotamCredentials,
  ): Promise<NotamPage> {
    const params: [string, string][] = [
      [query.name, query.value],
      ['responseFormat', 'geoJson'],
      ['pageSize', String(NOTAM_PAGE_SIZE)],
      ['pageNum', String(pageNum)],
    ];
    const url = `${NOTAM_ENDPOINT}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;

    let response;
    try {
      response = await fetchWithTimeout(
        this.options.fetch,
        url,
        this.options.requestTimeoutMs ?? NOTAM_REQUEST_TIMEOUT_MS,
        {
          headers: {
            client_id: credentials.clientID,
            client_secret: credentials.clientSecret,
            Accept: 'application/json',
          },
        },
      );
    } catch (error) {
      if (isOfflineError(error)) throw new AppFailure({ kind: 'networkUnavailable' });
      throw new AppFailure({ kind: 'weatherFetchFailed', cause: error });
    }

    if (response.status >= 200 && response.status <= 299) {
      try {
        return parseNotamResponse(await response.text());
      } catch (error) {
        throw new AppFailure({ kind: 'weatherFetchFailed', cause: error });
      }
    }
    if (response.status === 401 || response.status === 403) throw new NotamError('credentialsRejected');
    this.options.log?.(`NOTAM API HTTP ${response.status}`);
    throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error(`HTTP ${response.status}`) });
  }
}
