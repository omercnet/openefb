// Port of the OfflineMapService behaviour (create, pause, resume, delete, refresh, errors) over an injected engine.
// The engine is the platform half: MapLibre RN OfflineManager in src/adapters/maplibreOffline.ts, a fake in tests.
import { AppFailure, type AppError } from '../errors';
import { toLngLatBounds, type OfflineRegionBounds } from './bounds';
import { currentSectionalCycle, layerExpiresWithChartCycle, layerZoomRange, type OfflineLayer } from './layers';
import {
  decodeContext,
  encodeContext,
  packStyle,
  styleStatus,
  type OfflinePackContext,
  type OfflinePackState,
  type OfflinePackSummary,
  type OfflineStatus,
} from './packModel';
import type { MapStyle } from '../core';

export type EnginePackState = 'inactive' | 'active' | 'complete' | 'invalid';

export interface EnginePack {
  /** Engine-assigned id (not the context id). */
  id: string;
  /** The context JSON written at creation. */
  metadata: unknown;
  state: EnginePackState;
  completedResources: number;
  requiredResources: number;
  completedBytes: number;
}

export interface EngineCreateOptions {
  /** A style JSON document (MapLibre accepts it where a URL would go). */
  styleJson: string;
  bounds: [number, number, number, number]; // west, south, east, north
  minZoom: number;
  maxZoom: number;
  metadata: string;
}

export interface OfflineEngine {
  /** Creates the pack (not started). `onProgress`/`onError` carry the engine pack id. */
  createPack(
    options: EngineCreateOptions,
    onProgress: (enginePackId: string) => void,
    onError: (enginePackId: string, message: string) => void,
  ): Promise<{ id: string }>;
  listPacks(): Promise<EnginePack[]>;
  resume(enginePackId: string): Promise<void>;
  pause(enginePackId: string): Promise<void>;
  delete(enginePackId: string): Promise<void>;
}

export interface OfflineServiceDeps {
  engine: OfflineEngine;
  /** The parsed base-style.json (the app bundle's copy). */
  baseStyle: () => unknown;
  now?: () => number;
  newId?: () => string;
}

export interface OfflineSnapshot {
  packs: readonly OfflinePackSummary[];
  storageUsedBytes: number;
  lastError: AppError | null;
}

const stateFor = (s: EnginePackState): OfflinePackState =>
  s === 'complete'
    ? { kind: 'complete' }
    : s === 'active'
      ? { kind: 'downloading' }
      : s === 'invalid'
        ? { kind: 'failed', reason: 'Removed' }
        : { kind: 'paused' };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class OfflineMapService {
  private readonly deps: OfflineServiceDeps;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly listeners = new Set<() => void>();
  private packs: OfflinePackSummary[] = [];
  private storageUsedBytes = 0;
  private lastError: AppError | null = null;
  /** Context id -> engine pack id. Rebuilt on every refresh. */
  private engineIds = new Map<string, string>();
  private styleCache = new Map<OfflineLayer, string>();
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private version = 0;
  private cached: OfflineSnapshot | null = null;
  private cachedVersion = -1;

  constructor(deps: OfflineServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => `${this.now()}-${Math.random().toString(16).slice(2)}`);
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): OfflineSnapshot => {
    if (!this.cached || this.cachedVersion !== this.version) {
      this.cached = { packs: this.packs, storageUsedBytes: this.storageUsedBytes, lastError: this.lastError };
      this.cachedVersion = this.version;
    }
    return this.cached;
  };

  private emit(): void {
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  private fail(error: AppError): void {
    this.lastError = error;
    this.emit();
  }

  clearError(): void {
    if (this.lastError) {
      this.lastError = null;
      this.emit();
    }
  }

  status(visible: OfflineRegionBounds, style: MapStyle, atMs: number = this.now()): OfflineStatus {
    return styleStatus(visible, style, this.packs, atMs);
  }

  // MARK: downloads

  private styleFor(layer: OfflineLayer): string {
    const hit = this.styleCache.get(layer);
    if (hit) return hit;
    const json = JSON.stringify(packStyle(layer, this.deps.baseStyle()));
    this.styleCache.set(layer, json);
    return json;
  }

  /**
   * One pack per layer. A layer whose style or creation fails does not stop the others (JS-only; Swift threw out of the
   * loop). Creation errors set `lastError`; a corrupt base style is rethrown after the other layers were attempted.
   */
  async download(name: string, region: OfflineRegionBounds, layers: readonly OfflineLayer[]): Promise<void> {
    const cycle = currentSectionalCycle(this.now());
    let styleFailure: AppFailure | null = null;
    for (const layer of layers) {
      let styleJson: string;
      try {
        styleJson = this.styleFor(layer);
      } catch (e) {
        if (e instanceof AppFailure) {
          this.fail(e.error); // also thrown below so a caller can react
          styleFailure ??= e;
        } else if (!(e instanceof AppFailure))
          this.fail({ kind: 'chartDownloadFailed', region: `${name}: ${messageOf(e)}` });
        continue;
      }
      const context: OfflinePackContext = {
        id: this.newId(),
        name,
        layer,
        bounds: region,
        cycleEffective: layerExpiresWithChartCycle(layer) ? cycle.effective : null,
        createdAt: this.now(),
      };
      const { min, max } = layerZoomRange(layer);
      try {
        const created = await this.deps.engine.createPack(
          { styleJson, bounds: toLngLatBounds(region), minZoom: min, maxZoom: max, metadata: encodeContext(context) },
          () => void this.refresh(),
          (enginePackId, message) => this.onPackError(enginePackId, message),
        );
        await this.deps.engine.resume(created.id);
      } catch (e) {
        this.fail({ kind: 'chartDownloadFailed', region: `${name}: ${messageOf(e)}` });
      }
    }
    await this.refresh();
    if (styleFailure) throw styleFailure;
  }

  private onPackError(enginePackId: string, message: string): void {
    const ctxId = [...this.engineIds.entries()].find(([, e]) => e === enginePackId)?.[0];
    const ctx = this.packs.find((p) => p.context.id === ctxId)?.context;
    const label = ctx ? `${ctx.name} (${ctx.layer})` : 'Offline pack';
    this.fail({ kind: 'chartDownloadFailed', region: `${label}: ${message}` });
    void this.refresh();
  }

  async pause(pack: OfflinePackSummary): Promise<void> {
    await this.control(pack, (id) => this.deps.engine.pause(id), 'Pause failed');
  }

  async resume(pack: OfflinePackSummary): Promise<void> {
    await this.control(pack, (id) => this.deps.engine.resume(id), 'Resume failed');
  }

  private async control(pack: OfflinePackSummary, act: (id: string) => Promise<void>, what: string): Promise<void> {
    const id = this.engineIds.get(pack.context.id);
    if (id) {
      try {
        await act(id);
      } catch (e) {
        this.fail({ kind: 'chartDownloadFailed', region: `${what}: ${messageOf(e)}` });
      }
    }
    await this.refresh();
  }

  /** The pack disappears from the list at once; a failed engine delete reports and the refresh restores it. */
  async delete(pack: OfflinePackSummary): Promise<void> {
    const id = this.engineIds.get(pack.context.id);
    if (!id) return;
    this.engineIds.delete(pack.context.id);
    this.packs = this.packs.filter((p) => p.context.id !== pack.context.id);
    this.emit();
    try {
      await this.deps.engine.delete(id);
    } catch (e) {
      this.fail({ kind: 'chartDownloadFailed', region: `Delete failed: ${messageOf(e)}` });
    }
    await this.refresh();
  }

  async redownload(pack: OfflinePackSummary): Promise<void> {
    await this.delete(pack);
    await this.download(pack.context.name, pack.context.bounds, [pack.context.layer]);
  }

  // MARK: refresh

  /** Reads the engine's packs. Overlapping calls coalesce into one follow-up read, so the latest state always wins. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const run = (async () => {
      do {
        this.refreshAgain = false;
        await this.readOnce();
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = run;
    return run;
  }

  private async readOnce(): Promise<void> {
    let list: EnginePack[];
    try {
      list = await this.deps.engine.listPacks();
    } catch (e) {
      // Keep what we have: a failed read must not read as "no packs".
      this.fail({ kind: 'chartDownloadFailed', region: `Offline packs unavailable: ${messageOf(e)}` });
      return;
    }
    const ids = new Map<string, string>();
    const summaries: OfflinePackSummary[] = [];
    let bytes = 0;
    for (const p of list) {
      const context = decodeContext(p.metadata);
      if (!context) continue; // not ours (or malformed): ignored, never deleted
      ids.set(context.id, p.id);
      const completedBytes = Number.isFinite(p.completedBytes) ? p.completedBytes : 0;
      bytes += completedBytes;
      summaries.push({
        context,
        state: stateFor(p.state),
        completedResources: p.completedResources,
        expectedResources: p.requiredResources,
        completedBytes,
      });
    }
    this.engineIds = ids;
    this.packs = summaries.sort((a, b) => b.context.createdAt - a.context.createdAt);
    this.storageUsedBytes = bytes;
    this.emit();
  }
}

/** Shape of MapLibre RN's `OfflinePackStatus`, mirrored so the mapping stays platform-free and testable. */
export interface RnPackStatus {
  state: 'inactive' | 'active' | 'complete';
  completedResourceCount: number;
  completedResourceSize: number;
  requiredResourceCount: number;
}

/**
 * RN pack + status to the engine shape. RN reports no `invalid` state, and a pack whose status call failed is passed as
 * `status: null`: it reads inactive with zero progress, never complete.
 */
export function toEnginePack(id: string, metadata: unknown, status: RnPackStatus | null): EnginePack {
  const ok = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    id,
    metadata,
    state: status?.state ?? 'inactive',
    completedResources: ok(status?.completedResourceCount),
    requiredResources: ok(status?.requiredResourceCount),
    completedBytes: ok(status?.completedResourceSize),
  };
}
