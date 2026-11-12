// Port of efb-212/Services/MapQueryRegion.swift: bounds-based airport query radius, requery decision and thinning.
import { distanceNm, type Airport, type Coordinate } from '../core';

/** Largest radius we ever ask the database for. Beyond this the whole CONUS is in view. */
export const MAX_RADIUS_NM = 500;
/** Smallest radius, so a very zoomed-in view still finds the field under the aircraft. */
export const MIN_RADIUS_NM = 5;
/** Margin added to the visible half-diagonal so airports at the screen edge are included. */
export const MARGIN_FACTOR = 1.1;
/** Most airport features we hand to MapLibre at once. */
export const MAX_AIRPORT_COUNT = 600;
/** Re-query thresholds: the centre moved this far, or the radius changed this much. */
export const REQUERY_DISTANCE_NM = 5;
export const REQUERY_RADIUS_RATIO = 0.2;
/** Below this map zoom the airport layer shows only towered public airports, queried over the whole region. */
export const LOW_ZOOM_THRESHOLD = 7.0;
/** Largest region radius for the low-zoom towered query (covers CONUS from its centre). */
export const MAX_LOW_ZOOM_RADIUS_NM = 3000;
/** Grid columns across the longer visible axis for low-zoom spatial thinning. */
export const LOW_ZOOM_GRID_CELLS = 28;

export const isLowZoom = (zoom: number): boolean => zoom < LOW_ZOOM_THRESHOLD;

/** Great-circle distance in nautical miles (same haversine as the core geometry). */
export const haversineNM = (a: Coordinate, b: Coordinate): number => distanceNm(a, b);

export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * One airport per grid cell over the visible bounds. Deterministic: the lowest ICAO id wins a cell.
 * Degenerate bounds return the input unchanged.
 */
export function thinSpatially(airports: Airport[], b: GeoBounds, cells: number = LOW_ZOOM_GRID_CELLS): Airport[] {
  const cell = Math.max(b.north - b.south, b.east - b.west) / cells;
  if (!(cell > 0)) return airports;
  const best = new Map<string, Airport>();
  for (const a of airports) {
    const key = `${Math.floor((a.latitude - b.south) / cell)},${Math.floor((a.longitude - b.west) / cell)}`;
    const existing = best.get(key);
    if (existing && existing.icao <= a.icao) continue;
    best.set(key, a);
  }
  return [...best.values()].sort((x, y) => (x.icao < y.icao ? -1 : x.icao > y.icao ? 1 : 0));
}

function farthestCornerNM(center: Coordinate, ne: Coordinate, sw: Coordinate): number {
  const corners: Coordinate[] = [ne, sw, { lat: ne.lat, lon: sw.lon }, { lat: sw.lat, lon: ne.lon }];
  return Math.max(...corners.map((c) => haversineNM(center, c)));
}

/** Like `radiusNM` but capped at MAX_LOW_ZOOM_RADIUS_NM, covering the whole visible region. */
export function lowZoomRadiusNM(center: Coordinate, ne: Coordinate, sw: Coordinate): number {
  const farthest = farthestCornerNM(center, ne, sw);
  return Math.min(Math.max(farthest * MARGIN_FACTOR, MIN_RADIUS_NM), MAX_LOW_ZOOM_RADIUS_NM);
}

/** Radius covering everything on screen: farthest visible corner plus margin, clamped to [MIN, MAX]. */
export function radiusNM(center: Coordinate, ne: Coordinate, sw: Coordinate): number {
  const farthest = farthestCornerNM(center, ne, sw);
  return Math.min(Math.max(farthest * MARGIN_FACTOR, MIN_RADIUS_NM), MAX_RADIUS_NM);
}

/** Whether the region changed enough to hit the database again. */
export function shouldRequery(
  lastCenter: Coordinate | null,
  lastRadiusNM: number | null,
  center: Coordinate,
  radius: number,
): boolean {
  if (lastCenter == null || lastRadiusNM == null) return true;
  if (haversineNM(lastCenter, center) >= REQUERY_DISTANCE_NM) return true;
  const ratio = Math.abs(radius - lastRadiusNM) / Math.max(lastRadiusNM, 0.001);
  return ratio >= REQUERY_RADIUS_RATIO;
}

/** 0 = ICAO-coded fixed-wing airport, 1 = other fixed-wing field, 2 = heliport/seaplane/ultralight. */
export function priorityRank(airport: Airport): 0 | 1 | 2 {
  if (airport.type !== 'airport') return 2;
  return /^[A-Z]{4}$/.test(airport.icao) ? 0 : 1;
}

/** Keep at most `maxCount` airports, ICAO first, then by distance from the centre. Untouched when it fits. */
export function thin(airports: Airport[], center: Coordinate, maxCount: number = MAX_AIRPORT_COUNT): Airport[] {
  if (airports.length <= maxCount) return airports;
  return airports
    .map((airport) => ({
      rank: priorityRank(airport),
      distance: haversineNM(center, { lat: airport.latitude, lon: airport.longitude }),
      airport,
    }))
    .sort((l, r) => (l.rank !== r.rank ? l.rank - r.rank : l.distance - r.distance))
    .slice(0, maxCount)
    .map((r) => r.airport);
}
