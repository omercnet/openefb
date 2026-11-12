// FileDownloader (services/charts/ports) over expo-file-system's File.downloadFileAsync. Native only; the device checks
// (I3) own it.
//
// KNOWN LIMIT: downloadFileAsync cannot append, so `rangeStart` is ignored and every attempt restarts the file from byte
// 0 (the service treats the 200 answer as "server ignored the range", which is exactly this). Resume-from-partial needs a
// ranged download written through a FileHandle; do that when the device check shows a real pack is too big to restart.
//
// Deadlines: an idle window (connect, then every progress report restarts it) aborts a stalled transfer, and `maxBytes`
// aborts a body that grows past the expected size (the partial file is removed).
import { File } from 'expo-file-system';
import { idleDeadline } from '../services/charts/idleDeadline';
import {
  CancelledError,
  ResponseTooLargeError,
  type DownloadRequest,
  type FileDownloader,
} from '../services/charts/ports';

/** No bytes for this long (including before the first byte) fails the attempt as a transport error, which callers retry. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

/** `UnableToDownload` rejects with the HTTP status in the message ("... status code 404 ..."). */
function statusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: string }).code ?? '';
  if (!/UnableToDownload/i.test(code) && !/UnableToDownload/i.test(error.message)) return null;
  const m = /\b([1-5]\d\d)\b/.exec(error.message);
  return m ? Number(m[1]) : null;
}

export const fileDownloader: FileDownloader = {
  async download(request: DownloadRequest) {
    if (request.signal?.aborted) throw new CancelledError();
    const deadline = idleDeadline(DOWNLOAD_IDLE_TIMEOUT_MS, request.signal);
    const guard = new AbortController();
    deadline.signal.addEventListener('abort', () => guard.abort(), { once: true });
    let tooLarge = false;
    try {
      await File.downloadFileAsync(request.url, new File(request.destination), {
        idempotent: true,
        signal: guard.signal,
        onProgress: ({ bytesWritten }) => {
          deadline.touch();
          if (request.maxBytes !== undefined && bytesWritten > request.maxBytes && !tooLarge) {
            tooLarge = true;
            guard.abort();
            return;
          }
          request.onBytes?.(bytesWritten);
        },
      });
      return { status: 200 };
    } catch (error) {
      if (tooLarge) {
        const partial = new File(request.destination);
        if (partial.exists) partial.delete();
        throw new ResponseTooLargeError(request.maxBytes ?? 0);
      }
      if (request.signal?.aborted) throw new CancelledError();
      if (deadline.timedOut) throw deadline.timedOut; // a stalled transfer: a transport failure, retried by the service
      if (error instanceof Error && error.name === 'AbortError') throw new CancelledError();
      const status = statusFromError(error);
      if (status !== null) return { status };
      throw error; // transport failure: the caller retries
    } finally {
      deadline.dispose();
    }
  },
};
