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

/** Runs fetch with a deadline that covers the headers AND the body: the returned response's `text()` and `arrayBuffer()`
 * race the same deadline, so a server that sends headers and then stalls cannot hang a caller. On timeout the request is
 * aborted and the call rejects with RequestTimeoutError. The timer is cleared when the body has been read, when the request
 * fails, and for a non-2xx answer (whose body callers do not read); it is unref'd where the platform supports it. */
export async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  timeoutMs: number,
  init: HttpRequestInit = {},
): Promise<HttpResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject the deadline first: an abort listener that rejects the body must not win the race with AbortError.
      reject(new RequestTimeoutError(url, timeoutMs));
      controller.abort();
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  deadline.catch(() => undefined); // the deadline may fire after everything settled
  const release = () => clearTimeout(timer);
  // The promise constructor turns a synchronous throw from fetchFn into a rejection; the no-op catch keeps a request that
  // fails after the deadline already won from surfacing as an unhandled rejection.
  const request = new Promise<HttpResponse>((resolve) => resolve(fetchFn(url, { ...init, signal: controller.signal })));
  request.catch(() => undefined);
  let response: HttpResponse;
  try {
    response = await Promise.race([request, deadline]);
  } catch (error) {
    release();
    throw error;
  }
  if (response.status < 200 || response.status > 299) release();
  const guard = <T>(body: Promise<T>): Promise<T> => {
    body.catch(() => undefined);
    return Promise.race([body, deadline]).finally(release);
  };
  return {
    status: response.status,
    text: () => guard(response.text()),
    arrayBuffer: () => guard(response.arrayBuffer()),
  };
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
