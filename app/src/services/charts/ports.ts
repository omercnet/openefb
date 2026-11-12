// Platform-free collaborators for chart packs and terminal procedures. Native implementations live in src/adapters
// (chartFileSystem.ts, fileDownloader.ts); tests use the in-memory fakes in testSupport.ts.
import type { Sha256 } from './sha256';

/** Files and folders under the app's storage. Paths are opaque strings made with `join`; metadata reads are
 * synchronous (cheap), data reads and writes are async. A missing path reads as null / false and is never an error. */
export interface ChartFileSystem {
  join(...parts: string[]): string;
  exists(path: string): boolean;
  /** Size in bytes of a file, or null when it does not exist (or is a folder). */
  size(path: string): number | null;
  readText(path: string): Promise<string | null>;
  /** Writes a file, creating parent folders and replacing any existing file. Atomic where the platform allows. */
  writeText(path: string, text: string): Promise<void>;
  /** The first `count` bytes of a file, or null when it does not exist. */
  readHead(path: string, count: number): Promise<Uint8Array | null>;
  /** Streams a file through the hasher in chunks, never holding it all in memory. Rejects when the file is missing. */
  hashFile(path: string, hasher: Sha256): Promise<void>;
  ensureDir(path: string): Promise<void>;
  /** Moves a file or folder. The destination must not exist (callers remove it first). */
  move(from: string, to: string): Promise<void>;
  /** Deletes a file or a folder with everything in it. A missing path is not an error. */
  remove(path: string): Promise<void>;
  /** Names (not paths) of a folder's entries; empty for a missing folder. */
  list(path: string): Promise<string[]>;
  /** Removes `path` from device backups (re-downloadable data). Best effort; may be a no-op. */
  excludeFromBackup?(path: string): Promise<void>;
}

/** Thrown by a FileDownloader (and the services) when the caller aborted the transfer. The partial file is kept. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** A download body went past `maxBytes`. */
export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`response larger than ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

export interface DownloadRequest {
  url: string;
  /** File to write. */
  destination: string;
  /** > 0: ask for `bytes=<rangeStart>-`. A 206 answer is appended to the destination; a 200 answer (server ignored
   * the range) replaces it from the start. */
  rangeStart: number;
  signal?: AbortSignal;
  /** The most bytes the destination may hold. A body that would exceed it is cut off, the destination is removed, and the
   * download rejects with ResponseTooLargeError (not a transport failure: callers do not retry it). */
  maxBytes?: number;
  /** Total bytes now in `destination`, reported as they arrive. */
  onBytes?: (totalBytes: number) => void;
}

/** Streams a URL into a file. Resolves with the HTTP status once the body is fully written; writes nothing for a status
 * other than 200 or 206. Rejects with CancelledError when aborted, and with any other error for a transport failure
 * (lost signal, stalled connection, timeout), which the caller treats as retryable. */
export interface FileDownloader {
  download(request: DownloadRequest): Promise<{ status: number }>;
}
