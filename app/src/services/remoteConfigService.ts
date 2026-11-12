// Port of RemoteConfigService (Services/RemoteConfigService.swift): downloads the remote config file from the relay
// (web/notam-relay, GET /config.json). Transport only: RemoteConfigStore parses, validates, caches and applies it.
// HTTPS from the relay is the only trust there is (no signature), so the limits in RemoteConfig bound a file.
import { AppFailure } from '../domain/errors';
import { fetchWithTimeout, utf8ByteLength } from './http';
import type { FetchLike, Logger } from './ports';
import { MAXIMUM_BYTES } from './remoteConfig';

/** The deployed relay (web/notam-relay, Cloudflare Worker). Not a secret. */
export const DEFAULT_REMOTE_CONFIG_URL = 'https://openefb-notam-relay.omerc.workers.dev/config.json';
/** Swift: timeoutIntervalForRequest 10 s. */
export const REMOTE_CONFIG_TIMEOUT_MS = 10_000;

export interface RemoteConfigServiceLike {
  /** The raw body of the config file. Rejects on transport errors, non-200 answers and oversized bodies. */
  fetchConfigData(): Promise<string>;
}

export interface RemoteConfigServiceOptions {
  fetch: FetchLike;
  /** The user-set override (e.g. a local `wrangler dev` URL); null or empty falls back to the default. */
  urlOverride?: () => string | null | undefined;
  timeoutMs?: number;
  log?: Logger;
}

const rejected = (reason: string) => new AppFailure({ kind: 'remoteConfigRejected', reason });

export function createRemoteConfigService(options: RemoteConfigServiceOptions): RemoteConfigServiceLike {
  const { fetch, urlOverride, timeoutMs = REMOTE_CONFIG_TIMEOUT_MS, log } = options;
  return {
    async fetchConfigData() {
      const url = urlOverride?.() || DEFAULT_REMOTE_CONFIG_URL;
      const response = await fetchWithTimeout(fetch, url, timeoutMs);
      if (response.status !== 200) {
        log?.(`Remote config answered HTTP ${response.status}`);
        throw rejected(`the server answered ${response.status}`);
      }
      const body = await response.text();
      if (utf8ByteLength(body) > MAXIMUM_BYTES) throw rejected('the file is too large');
      return body;
    },
  };
}
