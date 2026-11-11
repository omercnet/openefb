// Port of ChartPackService (Services/IsraelChartService.swift): downloads, verifies and stores a hosted chart pack (IL-9).
// Used for the official CAAI CVFR chart (product "israel-cvfr") and any other product on the same R2 layout, e.g. airport
// diagrams ("il-diagrams").
//
// Host layout:  <base>/<product>/manifest.json           index with the latest published edition
//               <base>/<product>/<edition>/manifest.json  edition manifest with files[] and sha256
// On disk:      <root>/<product>/<edition>/<file> and <root>/<product>/installed.json
//
// The app only ever installs a published edition whose validation gate passed (`isServable`); a DEBUG-only developer
// setting allows trying an unpublished build.
import { AppFailure } from '../../domain/errors';
import { fetchWithTimeout } from '../http';
import { systemClock, type Clock, type FetchLike, type Logger } from '../ports';
import {
  compareNumeric,
  decodeChartIndex,
  decodeChartManifest,
  decodeInstalled,
  isServable,
  manifestLabel,
  manifestTotalBytes,
  type ChartIndex,
  type ChartManifest,
  type ChartManifestFile,
  type ChartPackInstalled,
} from './manifest';
import { CancelledError, type ChartFileSystem, type FileDownloader } from './ports';
import { Sha256 } from './sha256';

export const ISRAEL_CVFR_PRODUCT = 'israel-cvfr';
/** Public base of the Cloudflare R2 bucket `openefb-charts` (dev URL; a custom domain may replace it). Not a secret. */
export const DEFAULT_CHART_BASE_URL = 'https://pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev';
/** Request timeout for the small JSON documents (Swift: URLSession 30 s). */
export const CHART_REQUEST_TIMEOUT_MS = 30_000;

/** Bounded retry for pack downloads. A transport error (stalled connection, lost signal) is retried after
 * `delayMs(retry)`; the partial file is kept, so each retry resumes with a Range request. HTTP errors, checksum failures
 * and cancellation are never retried. */
export interface RetryPolicy {
  /** Total attempts per file, including the first. */
  maxAttempts: number;
  /** Base delay; retry n (1-based) waits base * 2^(n-1), with up to 25% jitter. */
  baseDelayMs: number;
}
export const STANDARD_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 2000 };
export const NO_RETRY: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0 };

export function retryDelayMs(policy: RetryPolicy, retry: number, random: () => number = Math.random): number {
  if (retry <= 0 || policy.baseDelayMs <= 0) return 0;
  const scaled = policy.baseDelayMs * 2 ** Math.min(retry - 1, 6);
  return scaled + scaled * 0.25 * random();
}

export interface ChartPackServiceLike {
  readonly product: string;
  fetchIndex(): Promise<ChartIndex>;
  fetchManifest(edition: string): Promise<ChartManifest>;
  /** The edition the pilot should have: the index's latest published edition, if it is servable. */
  latestServable(allowUnpublished: boolean): Promise<ChartManifest | null>;
  /** Downloads (resuming a partial download), verifies every file's SHA-256 and installs the edition. Aborting the
   * signal rejects with CancelledError and keeps the partial file. */
  download(
    manifest: ChartManifest,
    options?: { progress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<ChartPackInstalled>;
  installed(): Promise<ChartPackInstalled | null>;
  /** Re-hashes every installed file against its recorded SHA-256. A pack that fails is removed. True when the pack is
   * intact, or when nothing is installed. */
  verifyInstalled(): Promise<boolean>;
  /** Location of a file of the given installed record; null when it is not part of the record or is missing. */
  fileLocation(record: ChartPackInstalled, name: string): string | null;
  /** Location of an installed file; null when nothing is installed or the file is missing. */
  filePath(name: string): Promise<string | null>;
  /** Stops a running download, waits for it to stop, then deletes everything for the product. */
  remove(): Promise<void>;
}

export interface ChartPackServiceOptions {
  product: string;
  baseUrl: string;
  /** Storage root; the product folder is <root>/<product>. */
  root: string;
  fs: ChartFileSystem;
  fetch: FetchLike;
  downloader: FileDownloader;
  retry?: RetryPolicy;
  now?: Clock;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  requestTimeoutMs?: number;
  log?: Logger;
}

/** Manifest-supplied names become path components: no separators, no dot segments, no control characters. */
export const isSafeName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name) && !name.includes('..');

export function regionName(product: string): string {
  return product === ISRAEL_CVFR_PRODUCT ? 'Israel CVFR' : `Israel ${product}`;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

export class ChartPackService implements ChartPackServiceLike {
  readonly product: string;
  private readonly baseUrl: string;
  private readonly productDir: string;
  private readonly fs: ChartFileSystem;
  private readonly retry: RetryPolicy;
  private readonly now: Clock;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  /** The download in progress, if any: one at a time per product (they share a staging folder). */
  private removing = 0;
  private running: { edition: string; controller: AbortController; done: Promise<ChartPackInstalled> } | null = null;

  constructor(private readonly options: ChartPackServiceOptions) {
    this.product = options.product;
    this.baseUrl = trimSlash(options.baseUrl);
    this.fs = options.fs;
    this.productDir = options.fs.join(options.root, options.product);
    this.retry = options.retry ?? STANDARD_RETRY;
    this.now = options.now ?? systemClock;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  // MARK: Network

  private productUrl(...parts: string[]): string {
    return [this.baseUrl, this.product, ...parts].map(encodeURI).join('/');
  }

  private async getText(url: string): Promise<string> {
    const region = regionName(this.product);
    let response;
    try {
      response = await fetchWithTimeout(
        this.options.fetch,
        url,
        this.options.requestTimeoutMs ?? CHART_REQUEST_TIMEOUT_MS,
      );
    } catch {
      throw new AppFailure({ kind: 'networkUnavailable' });
    }
    if (response.status !== 200) throw new AppFailure({ kind: 'chartDownloadFailed', region });
    try {
      return await response.text();
    } catch {
      throw new AppFailure({ kind: 'networkUnavailable' });
    }
  }

  private async getDecoded<T>(url: string, decode: (body: string) => T): Promise<T> {
    const body = await this.getText(url);
    try {
      return decode(body);
    } catch {
      throw new AppFailure({ kind: 'chartDownloadFailed', region: regionName(this.product) });
    }
  }

  fetchIndex(): Promise<ChartIndex> {
    return this.getDecoded(this.productUrl('manifest.json'), decodeChartIndex);
  }

  fetchManifest(edition: string): Promise<ChartManifest> {
    if (!isSafeName(edition))
      return Promise.reject(new AppFailure({ kind: 'chartDownloadFailed', region: regionName(this.product) }));
    return this.getDecoded(this.productUrl(edition, 'manifest.json'), decodeChartManifest);
  }

  async latestServable(allowUnpublished: boolean): Promise<ChartManifest | null> {
    const index = await this.fetchIndex();
    let edition: string | null;
    if (allowUnpublished) {
      const all = index.editions.map((e) => e.edition);
      edition = all.length === 0 ? index.latest : all.reduce((best, e) => (compareNumeric(best, e) < 0 ? e : best));
    } else {
      edition = index.latest;
    }
    if (edition === null) return null;
    const manifest = await this.fetchManifest(edition);
    return isServable(manifest, allowUnpublished) ? manifest : null;
  }

  // MARK: Install state (disk)

  private editionDir(edition: string): string {
    return this.fs.join(this.productDir, edition);
  }

  async installed(): Promise<ChartPackInstalled | null> {
    let text: string | null;
    try {
      text = await this.fs.readText(this.fs.join(this.productDir, 'installed.json'));
    } catch {
      return null;
    }
    if (text === null) return null;
    const record = decodeInstalled(text);
    if (!record || record.product !== this.product || !isSafeName(record.edition)) return null;
    const dir = this.editionDir(record.edition);
    for (const file of record.files) {
      if (!isSafeName(file.name) || this.fs.size(this.fs.join(dir, file.name)) !== file.bytes) return null;
    }
    return record;
  }

  fileLocation(record: ChartPackInstalled, name: string): string | null {
    if (!record.files.some((f) => f.name === name) || !isSafeName(name)) return null;
    const path = this.fs.join(this.editionDir(record.edition), name);
    return this.fs.exists(path) ? path : null;
  }

  async filePath(name: string): Promise<string | null> {
    const record = await this.installed();
    return record ? this.fileLocation(record, name) : null;
  }

  private async sha256Of(path: string): Promise<string | null> {
    try {
      const hasher = new Sha256();
      await this.fs.hashFile(path, hasher);
      return hasher.digestHex();
    } catch {
      return null;
    }
  }

  /** The size check in `installed()` never hashes. This re-hashes every installed file; the stores call it once per
   * launch. A pack that fails is removed. */
  async verifyInstalled(): Promise<boolean> {
    const record = await this.installed();
    if (!record) return true;
    const dir = this.editionDir(record.edition);
    for (const file of record.files) {
      const digest = await this.sha256Of(this.fs.join(dir, file.name));
      if (digest !== file.sha256.toLowerCase()) {
        await this.remove(); // also stops a running download that would write into the folder being deleted
        return false;
      }
    }
    return true;
  }

  async remove(): Promise<void> {
    this.removing += 1; // a download cannot start while the folder is being deleted
    try {
      const running = this.running;
      if (running) {
        running.controller.abort();
        await running.done.catch(() => undefined);
      }
      await this.removeFiles();
    } finally {
      this.removing -= 1;
    }
  }

  private async removeFiles(): Promise<void> {
    try {
      await this.fs.remove(this.productDir);
    } catch (error) {
      this.options.log?.(`Could not remove ${this.product}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // MARK: Download

  download(
    manifest: ChartManifest,
    options: { progress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<ChartPackInstalled> {
    const region = regionName(this.product);
    if (this.removing > 0) return Promise.reject(new AppFailure({ kind: 'chartDownloadFailed', region }));
    // One download at a time per product: they share a staging folder. The same edition joins the running one.
    if (this.running) {
      if (this.running.edition === manifest.edition) return this.running.done;
      return Promise.reject(new AppFailure({ kind: 'chartDownloadFailed', region }));
    }
    const controller = new AbortController();
    const outer = options.signal;
    const forward = () => controller.abort();
    if (outer?.aborted) controller.abort();
    else outer?.addEventListener('abort', forward, { once: true });

    const done: Promise<ChartPackInstalled> = this.runDownload(manifest, controller.signal, options.progress).finally(
      () => {
        outer?.removeEventListener('abort', forward);
        if (this.running?.done === done) this.running = null;
      },
    );
    this.running = { edition: manifest.edition, controller, done };
    return done;
  }

  private async runDownload(
    manifest: ChartManifest,
    signal: AbortSignal,
    progress: ((fraction: number) => void) | undefined,
  ): Promise<ChartPackInstalled> {
    const fs = this.fs;
    const region = regionName(this.product);
    const fail = () => new AppFailure({ kind: 'chartDownloadFailed', region });
    // Manifest names become path components: refuse anything that could leave the product folder.
    if (
      manifest.files.length === 0 ||
      !isSafeName(manifest.edition) ||
      !manifest.files.every((f) => isSafeName(f.name))
    ) {
      throw fail();
    }
    const checkCancelled = () => {
      if (signal.aborted) throw new CancelledError();
    };
    checkCancelled();
    await fs.ensureDir(this.productDir);
    const stage = fs.join(this.productDir, `.partial-${manifest.edition}`);
    await fs.ensureDir(stage);

    const total = Math.max(1, manifestTotalBytes(manifest));
    let done = 0;
    for (const file of manifest.files) {
      const destination = fs.join(stage, file.name);
      const base = done;
      await this.fetchWithRetry(file, manifest.edition, destination, signal, (fileBytes) =>
        progress?.(Math.min(1, (base + fileBytes) / total)),
      );
      checkCancelled();
      // Verify before the file can ever be used. A bad file is deleted so a retry starts clean.
      const digest = await this.sha256Of(destination);
      if (digest === null || digest !== file.sha256.toLowerCase()) {
        await fs.remove(destination).catch(() => undefined);
        throw new AppFailure({ kind: 'chartCorrupted', region });
      }
      done += file.bytes;
      progress?.(Math.min(1, done / total));
    }
    checkCancelled();

    const finalDir = this.editionDir(manifest.edition);
    await fs.remove(finalDir).catch(() => undefined);
    await fs.move(stage, finalDir);
    await fs.excludeFromBackup?.(finalDir).catch(() => undefined); // re-downloadable

    const record: ChartPackInstalled = {
      product: this.product,
      edition: manifest.edition,
      editionLabel: manifestLabel(manifest),
      files: manifest.files.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256.toLowerCase() })),
      installedAtMs: this.now(),
    };
    await fs.writeText(fs.join(this.productDir, 'installed.json'), JSON.stringify(record));
    // One edition on disk: drop every other one now that the new one verified.
    for (const entry of await fs.list(this.productDir)) {
      if (entry === manifest.edition || entry === 'installed.json') continue;
      await fs.remove(fs.join(this.productDir, entry)).catch(() => undefined);
    }
    return record;
  }

  /** Absolute URL of a file: the host's `url` when it is https (or the base's own scheme), else `path` under the base,
   * else <base>/<product>/<edition>/<name>. */
  private resolve(file: ChartManifestFile, edition: string): string {
    const baseScheme = /^[a-z][a-z0-9+.-]*:/i.exec(this.baseUrl)?.[0].toLowerCase() ?? 'https:';
    if (
      (file.url && /^https:\/\//i.test(file.url)) ||
      (file.url && file.url.toLowerCase().startsWith(baseScheme) && baseScheme === 'http:')
    ) {
      return file.url;
    }
    if (file.path) {
      const segments = file.path.split('/').filter((s) => s !== '');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(file.path) && segments.every((s) => s !== '..' && s !== '.')) {
        return [this.baseUrl, ...segments.map(encodeURIComponent)].join('/');
      }
    }
    return this.productUrl(edition, file.name);
  }

  /** Retries a file after a transport error, with exponential backoff. The partial file stays on disk, so every retry
   * resumes with a Range request. Cancellation and non-transport errors propagate. */
  private async fetchWithRetry(
    file: ChartManifestFile,
    edition: string,
    destination: string,
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ): Promise<void> {
    let attempt = 1;
    for (;;) {
      try {
        await this.fetchFile(file, edition, destination, signal, onBytes);
        return;
      } catch (error) {
        const transport = error instanceof AppFailure && error.error.kind === 'networkUnavailable';
        if (!transport || attempt >= this.retry.maxAttempts) throw error;
        await this.sleep(retryDelayMs(this.retry, attempt, this.random), signal);
        attempt += 1;
      }
    }
  }

  /** Streams `file` to `destination`, resuming from a partial file with a Range request. */
  private async fetchFile(
    file: ChartManifestFile,
    edition: string,
    destination: string,
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ): Promise<void> {
    const fs = this.fs;
    const region = regionName(this.product);
    let existing = fs.size(destination) ?? 0;
    if (existing > file.bytes) {
      await fs.remove(destination);
      existing = 0;
    }
    if (existing === file.bytes) {
      onBytes(existing);
      return;
    }
    let status: number;
    try {
      ({ status } = await this.options.downloader.download({
        url: this.resolve(file, edition),
        destination,
        rangeStart: existing,
        signal,
        onBytes,
      }));
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) throw new CancelledError();
      throw new AppFailure({ kind: 'networkUnavailable' });
    }
    if (status !== 200 && status !== 206) throw new AppFailure({ kind: 'chartDownloadFailed', region });
    if ((fs.size(destination) ?? 0) !== file.bytes) throw new AppFailure({ kind: 'chartDownloadFailed', region });
  }
}
