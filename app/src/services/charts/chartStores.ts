// Ports of IsraelChartStore.swift and IsraelDiagramStore.swift: UI-facing state of the official CAAI CVFR chart pack and
// of the CAAI aerodrome diagram pack: what is installed, the latest servable edition on the host, download progress and
// errors. Both observe through `subscribe` / `getVersion` (useSyncExternalStore) instead of @Observable.
// Download ownership: every download runs in a DownloadSlot, so a paused, replaced or removed run can never write state
// after the action that superseded it.
import { errorDescription } from '../../domain/core/errorInfo';
import { AppFailure } from '../../domain/errors';
import { failureText } from '../http';
import type { Logger, TextStorage } from '../ports';
import { regionName, type ChartPackServiceLike } from './chartPackService';
import { DownloadSlot } from './downloadSlot';
import { IsraelDiagramPack, loadDiagramPack } from './diagramPack';
import {
  chartBadgeText,
  isServable,
  installedTotalBytes,
  manifestTotalBytes,
  resolveChartStatus,
  type ChartManifest,
  type ChartPackInstalled,
  type ChartStatus,
} from './manifest';
import { CancelledError, type ChartFileSystem } from './ports';

class Observable {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  constructor(private readonly log?: Logger) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  protected changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.log?.(`Chart store listener failed: ${String(error)}`);
      }
    }
  }
}

export interface ChartStoreOptions {
  service: ChartPackServiceLike;
  /** Developer setting; the caller must return false in release builds. */
  allowUnpublished?: () => boolean;
  log?: Logger;
}

/** The official CAAI CVFR chart pack (IL-9). The Offline Maps screen drives it; the map observes `status` and `packPath`. */
export class IsraelChartStore extends Observable {
  installed: ChartPackInstalled | null = null;
  /** Latest servable edition on the host; null when none is published, or when the host was unreachable. */
  latest: ChartManifest | null = null;
  isChecking = false;
  /** True when the last update check could not reach the host (the installed pack still works). */
  checkFailed = false;
  /** 0...1 while a download runs; null when idle. */
  downloadProgress: number | null = null;
  /** Fraction reached when the pilot paused; the partial file is kept and Download resumes it. */
  pausedProgress: number | null = null;
  errorMessage: string | null = null;

  private readonly service: ChartPackServiceLike;
  private readonly slot = new DownloadSlot();
  private verified = false;
  private refreshSeq = 0;

  private constructor(private readonly options: ChartStoreOptions) {
    super(options.log);
    this.service = options.service;
  }

  /** Creates the store and reads what is installed (Swift reads it synchronously in init). */
  static async open(options: ChartStoreOptions): Promise<IsraelChartStore> {
    const store = new IsraelChartStore(options);
    store.installed = await options.service.installed();
    return store;
  }

  get status(): ChartStatus {
    return resolveChartStatus(this.installed, this.latest);
  }

  get badgeText(): string {
    return chartBadgeText(this.status);
  }

  get isDownloading(): boolean {
    return this.downloadProgress !== null;
  }

  /** MBTiles file the map reads; null when nothing valid is installed. */
  get packPath(): string | null {
    const installed = this.installed;
    const pack = installed?.files.find((f) => f.name.endsWith('.mbtiles'));
    return installed && pack ? this.service.fileLocation(installed, pack.name) : null;
  }

  /** Size shown on the download row: the latest edition when there is one to fetch, else what is installed. */
  get offeredBytes(): number | null {
    return this.latest ? manifestTotalBytes(this.latest) : this.installed ? installedTotalBytes(this.installed) : null;
  }

  /** Re-read the device state and ask the host for the latest servable edition. */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;
    const installed = await this.service.installed();
    if (seq !== this.refreshSeq) return;
    if (!this.slot.active) this.installed = installed;
    await this.verifyInstalledOnce();
    if (seq !== this.refreshSeq) return;
    this.isChecking = true;
    this.changed();
    try {
      const latest = await this.service.latestServable(this.options.allowUnpublished?.() ?? false);
      if (seq !== this.refreshSeq) return;
      this.latest = latest;
      this.checkFailed = false;
    } catch {
      if (seq !== this.refreshSeq) return;
      // Offline or host down: keep what is installed, say the check failed, never invent an edition.
      this.latest = null;
      this.checkFailed = true;
    } finally {
      if (seq === this.refreshSeq) {
        this.isChecking = false;
        this.changed();
      }
    }
  }

  /** Hashes the installed pack once per launch. A pack that fails its check is removed and the pilot is told, instead
   * of the map drawing from a corrupt file. */
  private async verifyInstalledOnce(): Promise<void> {
    if (this.verified || !this.installed) return;
    this.verified = true;
    if (!(await this.service.verifyInstalled())) {
      this.installed = null;
      this.errorMessage = errorDescription({ kind: 'chartCorrupted', region: regionName(this.service.product) });
      this.changed();
    }
  }

  /** Download (or resume) the latest servable edition. Returns at once; observe `downloadProgress`. */
  startDownload(): void {
    const manifest = this.latest;
    if (this.slot.active || !manifest) return;
    this.errorMessage = null;
    this.pausedProgress = null;
    this.downloadProgress = 0;
    this.changed();
    this.slot.start(async (signal, isCurrent) => {
      try {
        const record = await this.service.download(manifest, {
          signal,
          progress: (fraction) => {
            if (isCurrent() && this.downloadProgress !== null) {
              this.downloadProgress = fraction;
              this.changed();
            }
          },
        });
        if (isCurrent()) this.installed = record;
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof CancelledError) {
          // Pause: the partial file stays and the next start resumes it.
          this.pausedProgress = this.downloadProgress;
        } else {
          this.errorMessage = failureText(error, errorDescription);
        }
      } finally {
        if (isCurrent()) {
          this.downloadProgress = null;
          this.changed();
        }
      }
    });
  }

  /** Stop the download; the partial file is kept so Resume continues from there. */
  async pauseDownload(): Promise<void> {
    await this.slot.abort();
  }

  async remove(): Promise<void> {
    await this.slot.abort({ invalidate: true });
    await this.service.remove();
    this.installed = null;
    this.pausedProgress = null;
    this.downloadProgress = null;
    this.changed();
  }
}

/** Storage key of the edition that was published and validated when it was downloaded (Swift: UserDefaults
 * `israelDiagramsServedEdition`). */
export const DIAGRAM_SERVED_EDITION_KEY = 'IsraelDiagrams/served-edition.txt';

export interface DiagramStoreOptions extends ChartStoreOptions {
  fs: ChartFileSystem;
  /** Holds the served edition; omit for memory only. */
  storage?: TextStorage;
}

/** The CAAI aerodrome diagram pack (IL-13). Download, verification and install are ChartPackService with product `il-diagrams`. */
export class IsraelDiagramStore extends Observable {
  pack: IsraelDiagramPack | null = null;
  /** Latest servable edition on the host; null when none is published or the host was unreachable. */
  latest: ChartManifest | null = null;
  isChecking = false;
  /** 0...1 while a download runs; null when idle. */
  downloadProgress: number | null = null;
  errorMessage: string | null = null;

  private readonly service: ChartPackServiceLike;
  private readonly slot = new DownloadSlot();
  private servedEdition: string | null = null;
  private verified = false;
  private refreshSeq = 0;
  private reloadSeq = 0;

  private constructor(private readonly options: DiagramStoreOptions) {
    super(options.log);
    this.service = options.service;
  }

  static async open(options: DiagramStoreOptions): Promise<IsraelDiagramStore> {
    const store = new IsraelDiagramStore(options);
    try {
      store.servedEdition = (await options.storage?.read(DIAGRAM_SERVED_EDITION_KEY)) ?? null;
    } catch {
      store.servedEdition = null;
    }
    await store.reload();
    return store;
  }

  get isDownloading(): boolean {
    return this.downloadProgress !== null;
  }

  availability(icao: string) {
    return this.pack?.availability(icao) ?? ({ kind: 'none' } as const);
  }

  /** Re-read what is on the device. A reload that was overtaken by a newer one is dropped. */
  async reload(): Promise<void> {
    const seq = ++this.reloadSeq;
    const pack = await loadDiagramPack({
      service: this.service,
      fs: this.options.fs,
      servedEdition: this.servedEdition,
      allowUnpublished: this.options.allowUnpublished?.() ?? false,
    });
    if (seq !== this.reloadSeq) return;
    this.pack = pack;
    this.changed();
  }

  /** Ask the host for the latest servable edition. The installed pack keeps working when it fails. The installed pack is
   * re-hashed once per launch; a pack that fails is removed and the pilot is told. */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;
    this.isChecking = true;
    this.changed();
    try {
      if (!this.verified && this.pack) {
        this.verified = true;
        if (!(await this.service.verifyInstalled())) {
          await this.reload();
          this.errorMessage = errorDescription({ kind: 'chartCorrupted', region: regionName(this.service.product) });
        }
      }
      let latest: ChartManifest | null = null;
      try {
        latest = await this.service.latestServable(this.options.allowUnpublished?.() ?? false);
      } catch {
        latest = null; // Swift `try?`
      }
      if (seq === this.refreshSeq) this.latest = latest;
    } finally {
      if (seq === this.refreshSeq) this.isChecking = false;
      this.changed();
    }
  }

  /** True when the host has a servable edition that is not the installed one. */
  get canDownload(): boolean {
    return this.latest !== null && this.pack?.edition !== this.latest.edition;
  }

  startDownload(): void {
    const manifest = this.latest;
    if (this.slot.active || !manifest) return;
    this.errorMessage = null;
    this.downloadProgress = 0;
    this.changed();
    this.slot.start(async (signal, isCurrent) => {
      try {
        const installed = await this.service.download(manifest, {
          signal,
          progress: (fraction) => {
            if (isCurrent() && this.downloadProgress !== null) {
              this.downloadProgress = fraction;
              this.changed();
            }
          },
        });
        if (!isCurrent()) return;
        if (isServable(manifest, false)) {
          this.servedEdition = installed.edition;
          try {
            await this.options.storage?.write(DIAGRAM_SERVED_EDITION_KEY, installed.edition);
          } catch (error) {
            this.options.log?.(`Could not save the served diagram edition: ${String(error)}`);
          }
        }
        await this.reload();
      } catch (error) {
        if (isCurrent() && !(error instanceof CancelledError)) {
          this.errorMessage =
            error instanceof AppFailure ? errorDescription(error.error) : failureText(error, errorDescription);
        }
      } finally {
        if (isCurrent()) {
          this.downloadProgress = null;
          this.changed();
        }
      }
    });
  }

  /** Stop the download; the partial file is kept. */
  async pauseDownload(): Promise<void> {
    await this.slot.abort();
  }
}
