// Port of TerminalProcedureService (Services/TerminalProcedureService.swift): FAA d-TPP (Digital Terminal Procedures
// Publication) client. Resolves the current 28-day chart cycle, downloads the ~16 MB d-TPP metafile once per cycle into a
// compact per-airport index persisted as JSON, and downloads chart PDFs on demand. Everything is cached under
// <baseDir>/{cycle}/ so charts work offline.
import { AppFailure } from '../../domain/errors';
import type { Airport } from '../../domain/core/models';
import { fetchWithTimeout } from '../http';
import { systemClock, type Clock, type FetchLike, type Logger } from '../ports';
import { type ChartFileSystem, type FileDownloader } from '../charts/ports';
import {
  cycleContaining,
  cycleIsCurrent,
  DTPP_REGION,
  decodeIndex,
  encodeIndex,
  indexCharts,
  isCycleCode,
  parseCycleInfo,
  parseMetafile,
  type DTPPCycle,
  type DTPPIndex,
  type TerminalChart,
} from './dtpp';

export const DTPP_INFO_URL = 'https://external-api.faa.gov/apra/dtpp/info';
export const DTPP_BASE_URL = 'https://aeronav.faa.gov/d-tpp';
export const DTPP_INDEX_FILE = 'index.json';
/** The metafile is about 16 MB; refuse anything past this before it is read into memory. */
export const DTPP_METAFILE_MAX_BYTES = 64 * 1024 * 1024;
/** A single chart PDF is a few MB; refuse anything past this. */
export const DTPP_PDF_MAX_BYTES = 64 * 1024 * 1024;
/** Swift: timeoutIntervalForRequest 30 s. */
export const DTPP_REQUEST_TIMEOUT_MS = 30_000;

export interface TerminalProcedureServiceLike {
  /** Charts published for an airport in the current (or newest cached) cycle, in metafile order. */
  charts(airport: Pick<Airport, 'icao' | 'faaID'>): Promise<TerminalChart[]>;
  /** Local path of the chart PDF, downloading it if it isn't cached yet. */
  pdfPath(chart: TerminalChart): Promise<string>;
  /** The cycle of the chart index currently in use (may be expired when offline). */
  currentCycle(): Promise<DTPPCycle>;
}

export interface TerminalProcedureServiceOptions {
  fetch: FetchLike;
  downloader: FileDownloader;
  fs: ChartFileSystem;
  /** Cache root (Swift: Application Support/efb-212/dtpp). */
  baseDir: string;
  now?: Clock;
  log?: Logger;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

/** A bare PDF file name: the last path component, letters, digits, dot, dash, underscore and space only. */
function safePdfName(pdfName: string): string | null {
  const last = pdfName.split('/').pop() ?? '';
  if (last === '' || !last.toUpperCase().endsWith('.PDF')) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(last) && !last.includes('..') ? last : null;
}

export class TerminalProcedureService implements TerminalProcedureServiceLike {
  private index: DTPPIndex | null = null;
  private loadTask: Promise<DTPPIndex> | null = null;
  private readonly pdfTasks = new Map<string, Promise<string>>();
  private tempCounter = 0;
  private readonly now: Clock;

  constructor(private readonly options: TerminalProcedureServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  // MARK: Public API

  async charts(airport: Pick<Airport, 'icao' | 'faaID'>): Promise<TerminalChart[]> {
    return indexCharts(await this.loadIndex(), airport.icao, airport.faaID);
  }

  async currentCycle(): Promise<DTPPCycle> {
    return (await this.loadIndex()).cycle;
  }

  pdfPath(chart: TerminalChart): Promise<string> {
    const failed = () => new AppFailure({ kind: 'chartDownloadFailed', region: chart.name });
    // pdf_name is a bare file name; never let it escape the cycle folder. The cycle becomes a folder and a URL part too.
    const fileName = safePdfName(chart.pdfName);
    if (fileName === null || !isCycleCode(chart.cycle)) return Promise.reject(failed());
    const destination = this.options.fs.join(this.cycleDirectory(chart.cycle), fileName);
    // JS-only: concurrent requests for the same PDF share one download.
    const running = this.pdfTasks.get(destination);
    if (running) return running;
    const task = this.fetchPdf(chart, fileName, destination).finally(() => {
      if (this.pdfTasks.get(destination) === task) this.pdfTasks.delete(destination);
    });
    this.pdfTasks.set(destination, task);
    return task;
  }

  private async fetchPdf(chart: TerminalChart, fileName: string, destination: string): Promise<string> {
    const fs = this.options.fs;
    const failed = () => new AppFailure({ kind: 'chartDownloadFailed', region: chart.name });
    if (fs.exists(destination)) {
      if (await this.isPdf(destination)) return destination;
      // A truncated or corrupt cached file is never trusted: drop it and download again.
      await fs.remove(destination).catch(() => undefined);
    }

    await fs.ensureDir(this.options.baseDir);
    const temp = this.tempPath();
    try {
      let status: number;
      try {
        ({ status } = await this.options.downloader.download({
          url: `${DTPP_BASE_URL}/${chart.cycle}/${fileName}`,
          destination: temp,
          rangeStart: 0,
          maxBytes: DTPP_PDF_MAX_BYTES,
        }));
      } catch (error) {
        this.options.log?.(
          `Chart download failed for ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw failed();
      }
      if (status < 200 || status > 299 || !(await this.isPdf(temp))) throw failed();

      try {
        await fs.ensureDir(this.cycleDirectory(chart.cycle));
        if (fs.exists(destination)) await fs.remove(destination);
        await fs.move(temp, destination);
      } catch {
        throw failed();
      }
    } finally {
      await fs.remove(temp).catch(() => undefined);
    }
    await this.purgeCycles(chart.cycle);
    return destination;
  }

  // MARK: Index loading

  /** Returns the in-use index: memory, then a current on-disk cycle, then a fresh download, falling back to the newest
   * cached (possibly expired) cycle when offline. */
  private loadIndex(): Promise<DTPPIndex> {
    const date = this.now();
    if (this.index && cycleIsCurrent(this.index.cycle, date)) return Promise.resolve(this.index);
    if (this.loadTask) return this.loadTask;
    const task: Promise<DTPPIndex> = this.resolveIndex(date)
      .then((resolved) => {
        this.index = resolved;
        return resolved;
      })
      .finally(() => {
        if (this.loadTask === task) this.loadTask = null;
      });
    this.loadTask = task;
    return task;
  }

  private async resolveIndex(date: number): Promise<DTPPIndex> {
    const cached = await this.cachedIndexes();
    const current = cached.find((i) => cycleIsCurrent(i.cycle, date));
    if (current) return current;

    try {
      const cycle = await this.resolveCycle(date);
      const fresh = await this.downloadIndex(cycle);
      try {
        await this.persist(fresh);
      } catch (error) {
        this.options.log?.(`Failed to persist d-TPP index: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.purgeCycles(fresh.cycle.code);
      return fresh;
    } catch (error) {
      this.options.log?.(`d-TPP index refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      if (cached.length > 0) return cached[0]; // Offline: serve the newest cycle we have; the UI flags it expired.
      if (error instanceof AppFailure) throw error;
      throw new AppFailure({ kind: 'chartDownloadFailed', region: DTPP_REGION });
    }
  }

  /** Current cycle from the FAA APRA info endpoint, or computed from the 28-day schedule. */
  private async resolveCycle(date: number): Promise<DTPPCycle> {
    const computed = cycleContaining(date);
    try {
      const response = await fetchWithTimeout(this.options.fetch, DTPP_INFO_URL, DTPP_REQUEST_TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      });
      if (response.status < 200 || response.status > 299) return computed;
      return parseCycleInfo(await response.text());
    } catch {
      this.options.log?.(`d-TPP info endpoint unavailable, using computed cycle ${computed.code}`);
      return computed;
    }
  }

  private async downloadIndex(cycle: DTPPCycle): Promise<DTPPIndex> {
    const fs = this.options.fs;
    await fs.ensureDir(this.options.baseDir);
    const temp = this.tempPath();
    try {
      const { status } = await this.options.downloader.download({
        url: `${DTPP_BASE_URL}/${cycle.code}/xml_data/d-tpp_Metafile.xml`,
        destination: temp,
        rangeStart: 0,
        maxBytes: DTPP_METAFILE_MAX_BYTES,
      });
      if (status < 200 || status > 299) throw new AppFailure({ kind: 'chartDownloadFailed', region: DTPP_REGION });
      if ((fs.size(temp) ?? 0) > DTPP_METAFILE_MAX_BYTES)
        throw new AppFailure({ kind: 'chartCorrupted', region: DTPP_REGION });
      const xml = await fs.readText(temp);
      if (xml === null) throw new AppFailure({ kind: 'chartCorrupted', region: DTPP_REGION });
      return parseMetafile(xml, cycle);
    } finally {
      await fs.remove(temp).catch(() => undefined);
    }
  }

  // MARK: Disk cache

  private cycleDirectory(code: string): string {
    return this.options.fs.join(this.options.baseDir, code);
  }

  private tempPath(): string {
    this.tempCounter += 1;
    return this.options.fs.join(this.options.baseDir, `.download-${this.tempCounter}.tmp`);
  }

  private async persist(index: DTPPIndex): Promise<void> {
    await this.options.fs.writeText(
      this.options.fs.join(this.cycleDirectory(index.cycle.code), DTPP_INDEX_FILE),
      encodeIndex(index),
    );
  }

  /** Cached indexes on disk, newest cycle first. */
  private async cachedIndexes(): Promise<DTPPIndex[]> {
    const fs = this.options.fs;
    let names: string[];
    try {
      names = await fs.list(this.options.baseDir);
    } catch {
      return [];
    }
    const out: DTPPIndex[] = [];
    for (const name of names.sort().reverse()) {
      if (!isCycleCode(name)) continue;
      try {
        const text = await fs.readText(fs.join(this.options.baseDir, name, DTPP_INDEX_FILE));
        const index = text === null ? null : decodeIndex(text);
        if (index) out.push(index);
      } catch {
        // unreadable folder: skip it
      }
    }
    return out;
  }

  /** Deletes cycle folders older than `code` (YYNN codes sort chronologically). */
  private async purgeCycles(code: string): Promise<void> {
    const fs = this.options.fs;
    let names: string[];
    try {
      names = await fs.list(this.options.baseDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (isCycleCode(name) && name < code) await fs.remove(fs.join(this.options.baseDir, name)).catch(() => undefined);
    }
  }

  private async isPdf(path: string): Promise<boolean> {
    try {
      const head = await this.options.fs.readHead(path, 4);
      return head !== null && head.length === 4 && PDF_MAGIC.every((b, i) => head[i] === b);
    } catch {
      return false;
    }
  }
}
