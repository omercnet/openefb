// Sends usage counts to the Worker in web/telemetry (owner decision Q7). One POST per batch: a JSON body, a content type, and
// nothing else: no cookie, no token, no custom header, no id. The Worker is not deployed by this repo; until the owner builds the
// app with EXPO_PUBLIC_TELEMETRY_URL set, `telemetryEndpoint` gives null and nothing is sent.
import { isRecord } from '../domain/typeGuards';
import type { SendOutcome, TelemetryTransport } from '../domain/ports/telemetry';
import type { CounterRow } from '../domain/telemetry/schema';
import { TELEMETRY_SCHEMA } from '../domain/telemetry/schema';

export const TELEMETRY_PATH = '/v1/counters';
export const TELEMETRY_TIMEOUT_MS = 10_000;

// scheme://host[:port][/]: no credentials, path, query or fragment. Parsed by hand because React Native's URL does not implement
// the parts of it a check like this needs.
const ORIGIN =
  /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::([0-9]{1,5}))?\/?$/i;

/** The machine the app runs on, as a development build reaches it (10.0.2.2 is the Android emulator's name for the host machine). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2']);

/**
 * The URL counts are posted to, from the endpoint setting (the Worker's origin, EXPO_PUBLIC_TELEMETRY_URL); null when the setting
 * is empty or not usable. A release build sends over HTTPS only. A development build sends to the machine it runs on only, so the
 * counts of someone running the app from source never reach the deployed Worker.
 */
export function telemetryEndpoint(setting: string | undefined, development: boolean): string | null {
  const match = ORIGIN.exec(setting?.trim() ?? '');
  if (!match) return null;
  const scheme = (match[1] as string).toLowerCase();
  const host = (match[2] as string).toLowerCase();
  const port = match[3] === undefined ? null : Number(match[3]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  if (development ? !LOOPBACK_HOSTS.has(host) : scheme !== 'https') return null;
  return `${scheme}://${host}${port === null ? '' : `:${port}`}${TELEMETRY_PATH}`;
}

export interface HttpTransportOptions {
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * What the Worker's answer means. Only its own answer (202 with the counts it took) is "sent"; a 200 or a redirect comes from
 * something in between (a captive portal, a proxy), so it is tried again. 4xx other than "later" statuses is a refusal of the
 * batch itself, which would be refused again.
 */
async function outcomeOf(response: Response): Promise<SendOutcome> {
  const { status } = response;
  if (status === 202) {
    const body: unknown = await response.json(); // not JSON: rejects, which the caller turns into a retry
    return isRecord(body) && typeof body.accepted === 'number' ? 'sent' : 'retry';
  }
  if (status === 408 || status === 425 || status === 429) return 'retry';
  return status >= 400 && status < 500 ? 'drop' : 'retry';
}

export function createHttpTransport(endpoint: string, options: HttpTransportOptions = {}): TelemetryTransport {
  const timeoutMs = options.timeoutMs ?? TELEMETRY_TIMEOUT_MS;
  return {
    async send(rows: readonly CounterRow[]): Promise<SendOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await (options.fetch ?? fetch)(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ v: TELEMETRY_SCHEMA.version, counters: rows }),
          credentials: 'omit',
          signal: controller.signal,
        });
        return await outcomeOf(response);
      } catch {
        return 'retry'; // No network, a timeout, an answer that was not read: the counts stay for the next flush.
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
