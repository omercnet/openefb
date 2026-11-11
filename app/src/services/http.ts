// Shared request plumbing: a hard timeout that also aborts the request, and a byte cap on text bodies.
import { AppFailure } from '../domain/errors';
import type { FetchLike, HttpRequestInit, HttpResponse } from './ports';

export class RequestTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`request timed out after ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

/** Runs fetch with a timeout. On timeout the request is aborted and the promise rejects with RequestTimeoutError.
 * The timer is always cleared, so a fast answer leaves nothing pending. */
export async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  timeoutMs: number,
  init: HttpRequestInit = {},
): Promise<HttpResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(url, timeoutMs));
    }, timeoutMs);
  });
  // The promise constructor turns a synchronous throw from fetchFn into a rejection; the no-op catch keeps a
  // request that fails after the timeout already won from surfacing as an unhandled rejection.
  const request = new Promise<HttpResponse>((resolve) => resolve(fetchFn(url, { ...init, signal: controller.signal })));
  request.catch(() => undefined);
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The message a person should see for a thrown value: the localized wording for an AppFailure. */
export function failureText(error: unknown, describe: (e: AppFailure['error']) => string): string {
  if (error instanceof AppFailure) return describe(error.error);
  return error instanceof Error ? error.message : String(error);
}

/** True for the rejection a fetch gives when the device has no network path (RN: TypeError "Network request failed";
 * browsers and Node: "Failed to fetch" / "fetch failed"). Timeouts and other failures are not offline. */
export function isOfflineError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return /network request failed|failed to fetch|fetch failed|network error|appears to be offline/i.test(error.message);
}
