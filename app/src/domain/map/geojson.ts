// Minimal GeoJSON types for map source data. Structurally compatible with the global GeoJSON namespace and the
// MapLibre RN `data` prop, without importing either (src/domain is platform-free).
export type Position = [number, number]; // [lon, lat]

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export type Properties = Record<string, string | number | boolean | null>;

export interface Feature {
  type: 'Feature';
  id?: string | number;
  geometry: Geometry;
  properties: Properties;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

export const EMPTY_COLLECTION: FeatureCollection = Object.freeze({
  type: 'FeatureCollection',
  features: [] as Feature[],
}) as FeatureCollection;

export const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

export const point = (lat: number, lon: number, properties: Properties, id?: string | number): Feature => ({
  type: 'Feature',
  ...(id === undefined ? {} : { id }),
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

/**
 * Polygon feature from a [lat, lon] ring; null for degenerate rings (fewer than 3 usable points). Points with fewer
 * than two numbers or non-finite values are dropped (Swift `compactMap` on `count >= 2`, plus a JS-only finite check).
 * The ring is closed explicitly, as GeoJSON requires (MapLibre native closed it implicitly).
 */
export function polygonFeature(ring: readonly (readonly number[])[], properties: Properties): Feature | null {
  const coords: Position[] = [];
  for (const p of ring) {
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) coords.push([p[1]!, p[0]!]);
  }
  if (coords.length < 3) return null;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  // A closed ring needs four positions: [A, B, A] is a line, not an area.
  if (coords.length < 4) return null;
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties };
}
