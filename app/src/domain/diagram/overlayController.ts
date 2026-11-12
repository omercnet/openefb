// Port of the decision logic of efb-212/Services/AirportDiagramOverlay.swift: which airports' diagrams to load for the
// camera, show/hide by zoom, retry and unavailable bookkeeping. Georeferencing and rendering are NOT here (owner decision
// Q6): they are precomputed offline (tools/apd-georef, tools/caai-apd) into the chart packs, so the app only displays an
// image placed by four corners. The chart-pack side is the `DiagramPackSource` port below.
//
// Reconciled with S1c (`services/charts/diagramGeoreference.ts`, `diagramPack.ts`): the pack side is adapted in
// adapters/israelDiagramSource.ts, and the corners come from `clipCornersForImageSource` (MapLibre order: top-left,
// top-right, bottom-right, bottom-left, each [lon, lat]), so no corner order is defined here.
import type { Coordinate, Region } from '../core';
import { distanceNm } from '../core';

export const DIAGRAM_MIN_ZOOM = 14;
export const DIAGRAM_MAX_AIRPORTS = 3;
export const DIAGRAM_OPACITY = 0.85;
/** Loading starts slightly before the overlay becomes visible. */
export const DIAGRAM_PRELOAD_ZOOM = DIAGRAM_MIN_ZOOM - 0.5;
export const DIAGRAM_RETRY_AFTER_MS = 300_000;
/** Backing opacity by zoom: translucent at 14 so the chart stays visible, nearly solid while taxiing. */
export const DIAGRAM_BACKING_OPACITY_STOPS: readonly (readonly [number, number])[] = [
  [14, 0.85],
  [15, 0.97],
];
export const DIAGRAM_DAY_BACKING = '#FFFFFF';
export const DIAGRAM_NIGHT_BACKING = '#1A1A1A'; // white 0.10
/** Night ink: raster-brightness-min lifts black ink to this luminance (the image background is transparent). */
export const DIAGRAM_NIGHT_BRIGHTNESS = { min: 0.72, max: 0.82 } as const;
/** Fixed pool of slots so the number of native sources and layers is bounded (R6). */
export const DIAGRAM_SLOTS = DIAGRAM_MAX_AIRPORTS;

/** A ready-to-draw diagram: the rendered image (file uri) and its four ground corners, `clipCornersForImageSource` order. */
export interface DiagramOverlayImage {
  icao: string;
  imageUri: string;
  /** [lon, lat] x4: top-left, top-right, bottom-right, bottom-left. */
  coordinates: [number, number][];
}

export type DiagramLookup = { kind: 'ready'; image: DiagramOverlayImage } | { kind: 'unavailable'; reason: string };

export interface DiagramCandidate {
  icao: string;
  position: Coordinate;
}

export interface DiagramPackSource {
  /**
   * Candidate airports around a point (US: database airports of type airport; Israel: aerodromes with a georeferenced
   * diagram in the pack). Rejects on a lookup error.
   */
  candidates(region: Region, center: Coordinate, radiusNM: number): Promise<DiagramCandidate[]>;
  /** The diagram for an airport: ready, or unavailable for this session. Rejects on a transient error (retried later). */
  diagramFor(region: Region, icao: string): Promise<DiagramLookup>;
}

export interface DiagramCamera {
  center: Coordinate;
  zoom: number;
  northEast: Coordinate;
  southWest: Coordinate;
}

export interface DiagramSlot {
  slot: number;
  image: DiagramOverlayImage;
}

export interface DiagramOverlaySnapshot {
  version: number;
  slots: readonly DiagramSlot[];
  shownAirports: readonly string[];
  failedAirports: readonly string[];
  /** True while at least one diagram is drawn and the overlay is enabled and zoomed in. */
  isShowing: boolean;
  /** Whether the layers should be visible (enabled, not remotely disabled, zoom >= 14). */
  visible: boolean;
}

export interface DiagramOverlayDeps {
  source: DiagramPackSource;
  enabled: () => boolean;
  /** Remote kill switch (Israel overlay in Swift). */
  remotelyDisabled: () => boolean;
  now?: () => number;
}

export class DiagramOverlayController {
  private readonly deps: DiagramOverlayDeps;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private region: Region = 'us';
  private entries = new Map<string, DiagramSlot>();
  private loading = new Set<string>();
  private unavailable = new Set<string>();
  private failedAt = new Map<string, number>();
  private camera: DiagramCamera | null = null;
  /** Bumped by region change and dispose: loads started under an older epoch are dropped when they finish. */
  private epoch = 0;
  private visible = false;
  private version = 0;
  private cached: DiagramOverlaySnapshot | null = null;
  private disposed = false;

  constructor(deps: DiagramOverlayDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): DiagramOverlaySnapshot => {
    if (this.cached && this.cached.version === this.version) return this.cached;
    const slots = [...this.entries.values()].sort((a, b) => a.slot - b.slot);
    this.cached = {
      version: this.version,
      slots,
      shownAirports: slots.map((s) => s.image.icao).sort(),
      failedAirports: [...this.failedAt.keys()].sort(),
      isShowing: this.visible && slots.length > 0,
      visible: this.visible,
    };
    return this.cached;
  };

  private emit(): void {
    if (this.disposed) return;
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    this.listeners.clear();
  }

  /** Region change drops everything (Swift `region.didSet`) and re-evaluates for the last camera. */
  setRegion(region: Region): Promise<void> {
    if (region === this.region) return Promise.resolve();
    this.region = region;
    this.epoch += 1;
    this.entries.clear();
    this.loading.clear();
    this.unavailable.clear();
    this.failedAt.clear();
    this.emit();
    return this.refresh();
  }

  /** The user toggled the overlay or the kill switch changed. */
  refresh(): Promise<void> {
    return this.onCamera(this.camera);
  }

  private isWaitingToRetry(icao: string): boolean {
    const failed = this.failedAt.get(icao);
    return failed !== undefined && this.now() - failed < DIAGRAM_RETRY_AFTER_MS;
  }

  /** Call when the camera settles (Swift polled every 0.75 s and skipped tiny moves; the surface already debounces). */
  async onCamera(camera: DiagramCamera | null): Promise<void> {
    this.camera = camera;
    if (!camera || this.disposed) return;
    const allowed = this.deps.enabled() && !this.deps.remotelyDisabled();
    const visible = allowed && camera.zoom >= DIAGRAM_MIN_ZOOM;
    if (visible !== this.visible) {
      this.visible = visible;
      this.emit();
    }
    if (!allowed || camera.zoom < DIAGRAM_PRELOAD_ZOOM) return;

    const diagonalNM = distanceNm(camera.southWest, camera.northEast);
    const radiusNM = Math.max(1, diagonalNM / 2); // half the diagonal
    const epoch = this.epoch;
    const region = this.region;
    let candidates: DiagramCandidate[];
    try {
      candidates = await this.deps.source.candidates(region, camera.center, radiusNM);
    } catch {
      return; // Swift `return`: try again on the next camera change
    }
    if (epoch !== this.epoch) return;
    const wanted = candidates
      .filter((c) => !this.unavailable.has(c.icao) && !this.isWaitingToRetry(c.icao))
      .map((c) => ({ c, d: distanceNm(camera.center, c.position) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, DIAGRAM_MAX_AIRPORTS)
      .map((x) => x.c);
    const jobs: Promise<void>[] = [];
    for (const c of wanted) {
      if (this.entries.has(c.icao) || this.loading.has(c.icao)) continue;
      this.loading.add(c.icao);
      jobs.push(this.load(region, c, epoch));
    }
    await Promise.all(jobs);
  }

  private async load(region: Region, c: DiagramCandidate, epoch: number): Promise<void> {
    try {
      const result = await this.deps.source.diagramFor(region, c.icao);
      if (epoch !== this.epoch) return;
      if (result.kind === 'unavailable') {
        this.unavailable.add(c.icao);
        return;
      }
      this.failedAt.delete(c.icao);
      this.place(result.image);
    } catch {
      if (epoch !== this.epoch) return;
      this.failedAt.set(c.icao, this.now());
      this.emit();
    } finally {
      if (epoch === this.epoch) this.loading.delete(c.icao);
    }
  }

  /** Takes a free slot, or evicts the diagram farthest from the camera centre (JS-only: Swift kept every entry). */
  private place(image: DiagramOverlayImage): void {
    const used = new Set([...this.entries.values()].map((e) => e.slot));
    let slot = -1;
    for (let i = 0; i < DIAGRAM_SLOTS; i++) {
      if (!used.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      const centre = this.camera?.center;
      let victim: DiagramSlot | null = null;
      let worst = -1;
      for (const e of this.entries.values()) {
        const tl = e.image.coordinates[0];
        const d = centre && tl ? distanceNm(centre, { lat: tl[1], lon: tl[0] }) : 0;
        if (d > worst) {
          worst = d;
          victim = e;
        }
      }
      if (!victim) return;
      slot = victim.slot;
      this.entries.delete(victim.image.icao);
    }
    this.entries.set(image.icao, { slot, image });
    this.emit();
  }
}

/** Opacity of the backing fill at a zoom level: linear between the stops, clamped outside (MapLibre `interpolate`). */
export function backingOpacityAt(zoom: number): number {
  const stops = DIAGRAM_BACKING_OPACITY_STOPS;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (!Number.isFinite(zoom) || zoom <= first[0]) return first[1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, o1] = stops[i]!;
    const [z0, o0] = stops[i - 1]!;
    if (zoom <= z1) return o0 + ((o1 - o0) * (zoom - z0)) / (z1 - z0);
  }
  return last[1];
}
