// Port of OfflineLayer, SectionalCycle and OfflineTileMath (Services/OfflineMapService.swift).
import type { OfflineRegionBounds } from './bounds';

/** One downloadable tile layer of base-style.json. Each becomes its own offline pack. */
export const OFFLINE_LAYERS = ['sectional', 'street'] as const;
export type OfflineLayer = (typeof OFFLINE_LAYERS)[number];

interface LayerInfo {
  displayName: string;
  minZoom: number;
  maxZoom: number;
  detailDescription: string;
  styleSources: readonly string[];
  averageTileBytes: number;
}

// Sectional tiles only exist at z8-12; street z5-13 keeps the vector pack usable from CONUS overview to airport detail.
// Tile sizes were measured by hand over the SF Bay Area (Swift note); real sizes vary.
const INFO: Record<OfflineLayer, LayerInfo> = {
  sectional: {
    displayName: 'VFR Sectional',
    minZoom: 8,
    maxZoom: 12,
    detailDescription: 'Chart detail for planning and flying, regional view to airport view',
    styleSources: ['vfr-sectional'],
    averageTileBytes: 45_000,
  },
  street: {
    displayName: 'Street',
    minZoom: 5,
    maxZoom: 13,
    detailDescription: 'Roads and towns, country overview down to street detail',
    styleSources: ['openmaptiles'],
    averageTileBytes: 60_000,
  },
};

export const layerDisplayName = (l: OfflineLayer): string => INFO[l].displayName;
export const layerZoomRange = (l: OfflineLayer): { min: number; max: number } => ({
  min: INFO[l].minZoom,
  max: INFO[l].maxZoom,
});
export const layerDetailDescription = (l: OfflineLayer): string => INFO[l].detailDescription;
/** base-style.json source ids this layer needs. */
export const layerStyleSources = (l: OfflineLayer): readonly string[] => INFO[l].styleSources;
export const layerAverageTileBytes = (l: OfflineLayer): number => INFO[l].averageTileBytes;
/** Only sectional packs age out with the FAA chart cycle. */
export const layerExpiresWithChartCycle = (l: OfflineLayer): boolean => l === 'sectional';

// MARK: sectional cycle

export interface SectionalCycleWindow {
  /** Epoch ms. */
  effective: number;
  /** The next cycle's effective instant. */
  expires: number;
}

export const SECTIONAL_CYCLE_DAYS = 56;
/** 2026-10-29 09:01 UTC (FAA "Dates of Latest Editions"; editions are effective at 0901 UTC). */
export const SECTIONAL_ANCHOR_MS = Date.UTC(2026, 9, 29, 9, 1);
const CYCLE_MS = SECTIONAL_CYCLE_DAYS * 86_400_000;

/** Cycle in force at `atMs`; earlier cycles are computed backwards from the anchor. */
export function currentSectionalCycle(atMs: number): SectionalCycleWindow {
  const index = Math.floor((atMs - SECTIONAL_ANCHOR_MS) / CYCLE_MS);
  const effective = SECTIONAL_ANCHOR_MS + index * CYCLE_MS;
  return { effective, expires: effective + CYCLE_MS };
}

/** True when a chart effective at `chartEffectiveMs` is still the current edition at `atMs`. */
export const isSectionalCurrent = (chartEffectiveMs: number, atMs: number): boolean =>
  chartEffectiveMs >= currentSectionalCycle(atMs).effective;

/** Whole days until the current cycle expires. */
export const sectionalDaysRemaining = (atMs: number): number =>
  Math.floor((currentSectionalCycle(atMs).expires - atMs) / 86_400_000);

// MARK: tile math

function tileY(latitude: number, n: number): number {
  const clamped = Math.min(Math.max(latitude, -85.0511), 85.0511);
  const rad = (clamped * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.trunc(Math.min(Math.max(Math.floor(y), 0), n - 1));
}

/** Number of slippy-map tiles that cover `b` at every zoom in [minZoom, maxZoom]. */
export function tileCount(b: OfflineRegionBounds, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const xMin = Math.floor(((b.west + 180) / 360) * n);
    const xMax = Math.floor(((b.east + 180) / 360) * n);
    total += (xMax - xMin + 1) * (tileY(b.south, n) - tileY(b.north, n) + 1);
  }
  return total;
}

export function estimatedBytes(b: OfflineRegionBounds, layer: OfflineLayer): number {
  const { min, max } = layerZoomRange(layer);
  return tileCount(b, min, max) * layerAverageTileBytes(layer);
}

export const estimatedBytesForLayers = (b: OfflineRegionBounds, layers: readonly OfflineLayer[]): number =>
  layers.reduce((sum, l) => sum + estimatedBytes(b, l), 0);

/** ByteCountFormatter(.file) look: decimal units, KB whole, MB and up with at most one decimal. */
export function formatOfflineSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Zero KB';
  if (bytes < 1000) return `${Math.round(bytes)} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const text = i === 0 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return `${text} ${units[i]}`;
}
