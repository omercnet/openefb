// FileDownloader (services/charts/ports) over expo-file-system's File.downloadFileAsync. Native only; the device checks
// (I3) own it.
//
// KNOWN LIMIT: downloadFileAsync cannot append, so `rangeStart` is ignored and every attempt restarts the file from byte
// 0 (the service treats the 200 answer as "server ignored the range", which is exactly this). Resume-from-partial needs a
// ranged download written through a FileHandle; do that when the device check shows a real pack is too big to restart.
import { File } from 'expo-file-system';
import { CancelledError, type DownloadRequest, type FileDownloader } from '../services/charts/ports';

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
    try {
      await File.downloadFileAsync(request.url, new File(request.destination), {
        idempotent: true,
        signal: request.signal,
        onProgress: ({ bytesWritten }) => request.onBytes?.(bytesWritten),
      });
      return { status: 200 };
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
        throw new CancelledError();
      const status = statusFromError(error);
      if (status !== null) return { status };
      throw error; // transport failure: the caller retries
    }
  },
};
