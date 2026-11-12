// Map layers as data (plan risk R6): every source and layer the map draws is a plain object in a registry; the surface
// renders the registry with ONE loop, so the number of React children and native views is fixed no matter how many
// features are on screen. This file is platform-free; the MapLibre types are mirrored structurally.
import type { MapLayer, Region } from '../core';
import { regionSupports } from '../core';
import type { FeatureCollection } from './geojson';

export type LayerType = 'circle' | 'fill' | 'line' | 'symbol' | 'raster';

/** MapLibre style-spec expressions and values are plain JSON. */
export type StyleValue = string | number | boolean | null | StyleValue[] | { [k: string]: StyleValue };

export interface LayerSpec {
  /** Unique across the registry (also the native layer id). */
  id: string;
  type: LayerType;
  /** Id of an entry in the source registry (GeoJSON source id). */
  source: string;
  /** The user-facing layer toggle that shows this layer; null = always shown (ownship, ruler, route use their own). */
  layer: MapLayer | null;
  minzoom?: number;
  maxzoom?: number;
  filter?: StyleValue[];
  paint?: Record<string, StyleValue>;
  layout?: Record<string, StyleValue>;
  /** Paints that differ at night (merged over `paint`). */
  nightPaint?: Record<string, StyleValue>;
}

/** Data for every source id, keyed by source id. A missing key reads as an empty collection. */
export type SourceData = Readonly<Record<string, FeatureCollection>>;

/** Whether a layer is drawn: its toggle is on and the region has a source for it. Null toggles are always on. */
export function isLayerVisible(spec: LayerSpec, visible: ReadonlySet<MapLayer>, region: Region): boolean {
  if (spec.layer === null) return true;
  return visible.has(spec.layer) && regionSupports(region, spec.layer);
}

/** Ids of specs in draw order that are visible. Pure; the surface maps this to the native `visibility` layout. */
export function visibleLayerIds(specs: readonly LayerSpec[], visible: ReadonlySet<MapLayer>, region: Region): string[] {
  return specs.filter((s) => isLayerVisible(s, visible, region)).map((s) => s.id);
}

/** Validates a registry: unique layer ids, every layer's source known. Returns problems (empty = ok). */
export function validateRegistry(specs: readonly LayerSpec[], sourceIds: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const sources = new Set(sourceIds);
  for (const s of specs) {
    if (seen.has(s.id)) problems.push(`duplicate layer id ${s.id}`);
    seen.add(s.id);
    if (!sources.has(s.source)) problems.push(`layer ${s.id} references unknown source ${s.source}`);
  }
  // The surface nests each source's layers under it, so a source's specs must be contiguous or z-order would break.
  const closed = new Set<string>();
  let current: string | null = null;
  for (const s of specs) {
    if (s.source !== current) {
      if (current !== null) closed.add(current);
      if (closed.has(s.source)) problems.push(`layers of source ${s.source} are not contiguous (at ${s.id})`);
      current = s.source;
    }
  }
  return problems;
}
