// Port of OfflinePackContext/State/Summary, OfflineStatus(+Resolver) and OfflinePackStyle (OfflineMapService.swift).
import { AppFailure } from '../errors';
import type { MapStyle } from '../core';
import { boundsContain, boundsIntersect, type OfflineRegionBounds } from './bounds';
import {
  isSectionalCurrent,
  layerExpiresWithChartCycle,
  layerStyleSources,
  OFFLINE_LAYERS,
  type OfflineLayer,
} from './layers';

/** Metadata stored with each pack. Dates are epoch ms; `cycleEffective` is null for layers without a cycle. */
export interface OfflinePackContext {
  id: string;
  name: string;
  layer: OfflineLayer;
  bounds: OfflineRegionBounds;
  cycleEffective: number | null;
  createdAt: number;
}

export type OfflinePackState =
  { kind: 'downloading' } | { kind: 'paused' } | { kind: 'complete' } | { kind: 'failed'; reason: string };

export interface OfflinePackSummary {
  context: OfflinePackContext;
  state: OfflinePackState;
  completedResources: number;
  expectedResources: number;
  completedBytes: number;
}

export const packIsFailed = (p: OfflinePackSummary): boolean => p.state.kind === 'failed';

export function packFraction(p: OfflinePackSummary): number {
  if (!(p.expectedResources > 0)) return p.state.kind === 'complete' ? 1 : 0;
  return Math.min(1, p.completedResources / p.expectedResources);
}

/** MapLibre can mark a pack complete with tiles missing: only complete AND all resources present counts. */
export const packHasAllResources = (p: OfflinePackSummary): boolean =>
  p.state.kind === 'complete' && p.completedResources >= p.expectedResources;

/** A sectional pack without a cycle never expires (Swift: a malformed context reads current forever). */
export function packIsExpired(p: OfflinePackSummary, atMs: number): boolean {
  const { layer, cycleEffective } = p.context;
  if (!layerExpiresWithChartCycle(layer) || cycleEffective === null) return false;
  return !isSectionalCurrent(cycleEffective, atMs);
}

export type OfflineStatus = 'ready' | 'partial' | 'notDownloaded' | 'expired';

export const offlineStatusLabel = (s: OfflineStatus): string =>
  ({
    ready: 'Offline: ready',
    partial: 'Offline: partial',
    notDownloaded: 'Offline: not downloaded',
    expired: 'Offline: expired',
  })[s];

export const layersForStyle = (style: MapStyle): OfflineLayer[] =>
  style === 'vfrSectional' ? ['sectional', 'street'] : ['street'];

export function layerStatus(
  visible: OfflineRegionBounds,
  layer: OfflineLayer,
  packs: readonly OfflinePackSummary[],
  atMs: number,
): OfflineStatus {
  const relevant = packs.filter(
    (p) => p.context.layer === layer && boundsIntersect(p.context.bounds, visible) && !packIsFailed(p),
  );
  if (relevant.length === 0) return 'notDownloaded';
  const current = relevant.filter((p) => !packIsExpired(p, atMs));
  if (current.some((p) => packHasAllResources(p) && boundsContain(p.context.bounds, visible))) return 'ready';
  if (current.length === 0) return 'expired';
  return 'partial';
}

/** Worst layer wins: notDownloaded, then expired, then partial. */
export function styleStatus(
  visible: OfflineRegionBounds,
  style: MapStyle,
  packs: readonly OfflinePackSummary[],
  atMs: number,
): OfflineStatus {
  const layers = layersForStyle(style);
  if (layers.length === 0) return 'notDownloaded';
  const statuses = layers.map((l) => layerStatus(visible, l, packs, atMs));
  if (statuses.includes('notDownloaded')) return 'notDownloaded';
  if (statuses.includes('expired')) return 'expired';
  if (statuses.includes('partial')) return 'partial';
  return 'ready';
}

// MARK: per-layer style document

interface StyleLike {
  sources?: Record<string, unknown>;
  layers?: { source?: unknown }[];
  glyphs?: unknown;
  [k: string]: unknown;
}

/**
 * base-style.json reduced to one layer's sources and the layers that draw them; `glyphs` dropped unless street (no
 * symbol layers, so no font downloads). Throws chartCorrupted for a style without `sources` and `layers`.
 */
export function packStyle(layer: OfflineLayer, base: unknown): Record<string, unknown> {
  const style = base as StyleLike | null;
  if (
    !style ||
    typeof style !== 'object' ||
    !style.sources ||
    typeof style.sources !== 'object' ||
    !Array.isArray(style.layers)
  ) {
    throw new AppFailure({ kind: 'chartCorrupted', region: 'base-style.json' });
  }
  const wanted = new Set(layerStyleSources(layer));
  const out: Record<string, unknown> = { ...style };
  out.sources = Object.fromEntries(Object.entries(style.sources).filter(([k]) => wanted.has(k)));
  out.layers = style.layers.filter((l) => typeof l?.source === 'string' && wanted.has(l.source));
  if (layer !== 'street') delete out.glyphs;
  out.name = `Kanaf offline ${layer}`;
  return out;
}

// MARK: context codec (MLNOfflinePack.context JSON)

export const encodeContext = (c: OfflinePackContext): string => JSON.stringify(c);

/** Null for anything malformed (Swift `try? JSONDecoder().decode`). Bounds are re-normalised. */
export function decodeContext(raw: unknown): OfflinePackContext | null {
  try {
    const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return null;
    const b = o.bounds as Record<string, unknown> | undefined;
    const nums = b ? [b.south, b.west, b.north, b.east] : [];
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.createdAt !== 'number') return null;
    if (!OFFLINE_LAYERS.includes(o.layer as OfflineLayer)) return null;
    if (nums.length !== 4 || !nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (o.cycleEffective !== null && typeof o.cycleEffective !== 'number') return null;
    const [south, west, north, east] = nums as number[];
    return {
      id: o.id,
      name: o.name,
      layer: o.layer as OfflineLayer,
      bounds: { south: south!, west: west!, north: north!, east: east! },
      cycleEffective: o.cycleEffective ?? null,
      createdAt: o.createdAt,
    };
  } catch {
    return null;
  }
}
