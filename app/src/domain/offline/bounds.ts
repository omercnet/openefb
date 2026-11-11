// Port of OfflineRegionBounds (Services/OfflineMapService.swift). Degrees; normalised so south <= north, west <= east.
import type { Coordinate } from '../core';

export interface OfflineRegionBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Swapped min/max are reordered. No antimeridian handling (a box over the date line becomes the wrong-way-around box). */
export const bounds = (south: number, west: number, north: number, east: number): OfflineRegionBounds => ({
  south: Math.min(south, north),
  north: Math.max(south, north),
  west: Math.min(west, east),
  east: Math.max(west, east),
});

/** Box of `halfNM` nautical miles around a point. Latitude is not clamped (Swift identical). */
export function boundsAround(center: Coordinate, halfNM: number): OfflineRegionBounds {
  const dLat = halfNM / 60; // 1 degree latitude = 60 NM
  const dLon = halfNM / (60 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.05));
  return bounds(center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon);
}

export const boundsCenter = (b: OfflineRegionBounds): Coordinate => ({
  lat: (b.south + b.north) / 2,
  lon: (b.west + b.east) / 2,
});

export const boundsContain = (outer: OfflineRegionBounds, other: OfflineRegionBounds): boolean =>
  other.south >= outer.south && other.north <= outer.north && other.west >= outer.west && other.east <= outer.east;

/** Touching edges intersect (zero-area overlap counts). */
export const boundsIntersect = (a: OfflineRegionBounds, b: OfflineRegionBounds): boolean =>
  !(b.east < a.west || b.west > a.east || b.north < a.south || b.south > a.north);

/** MapLibre RN bounds order: [west, south, east, north]. */
export const toLngLatBounds = (b: OfflineRegionBounds): [number, number, number, number] => [
  b.west,
  b.south,
  b.east,
  b.north,
];

export interface SectionalArea {
  readonly name: string;
  readonly bounds: OfflineRegionBounds;
}

/** Contiguous-US FAA sectional areas (approximate coverage boxes; they overlap neighbours slightly). */
export const CONTIGUOUS_US_SECTIONAL_AREAS: readonly SectionalArea[] = [
  { name: 'Seattle', bounds: bounds(44, -125, 49, -117) },
  { name: 'Great Falls', bounds: bounds(44, -117, 49, -109) },
  { name: 'Billings', bounds: bounds(44, -109, 49, -101) },
  { name: 'Twin Cities', bounds: bounds(44, -101, 49, -93) },
  { name: 'Green Bay', bounds: bounds(44, -93, 48, -85) },
  { name: 'Lake Huron', bounds: bounds(44, -85, 48, -77) },
  { name: 'Montreal', bounds: bounds(44, -77, 48, -69) },
  { name: 'Halifax', bounds: bounds(44, -69, 48, -61) },
  { name: 'Klamath Falls', bounds: bounds(40, -125, 44, -117) },
  { name: 'Salt Lake City', bounds: bounds(40, -117, 44, -109) },
  { name: 'Cheyenne', bounds: bounds(40, -109, 44, -101) },
  { name: 'Omaha', bounds: bounds(40, -101, 44, -93) },
  { name: 'Chicago', bounds: bounds(40, -93, 44, -85) },
  { name: 'Detroit', bounds: bounds(40, -85, 44, -77) },
  { name: 'New York', bounds: bounds(40, -77, 44, -69) },
  { name: 'San Francisco', bounds: bounds(36, -125, 40, -118) },
  { name: 'Las Vegas', bounds: bounds(35.75, -118, 40, -111) },
  { name: 'Denver', bounds: bounds(35.75, -111, 40, -104) },
  { name: 'Wichita', bounds: bounds(36, -104, 40, -97) },
  { name: 'Kansas City', bounds: bounds(36, -97, 40, -90) },
  { name: 'Cincinnati', bounds: bounds(36, -90, 40, -83) },
  { name: 'Washington', bounds: bounds(36, -83, 40, -77) },
  { name: 'Los Angeles', bounds: bounds(32, -121.5, 36, -115) },
  { name: 'Phoenix', bounds: bounds(31.25, -115, 35.75, -109) },
  { name: 'Albuquerque', bounds: bounds(32, -109, 36, -102) },
  { name: 'Dallas-Ft Worth', bounds: bounds(32, -102, 36, -95) },
  { name: 'Memphis', bounds: bounds(32, -95, 36, -88) },
  { name: 'Atlanta', bounds: bounds(32, -88, 36, -81) },
  { name: 'Charlotte', bounds: bounds(32, -81, 36, -75) },
  { name: 'El Paso', bounds: bounds(28, -109, 32, -103) },
  { name: 'San Antonio', bounds: bounds(28, -103, 32, -97) },
  { name: 'Houston', bounds: bounds(28, -97, 32, -91) },
  { name: 'New Orleans', bounds: bounds(28, -91, 32, -85) },
  { name: 'Jacksonville', bounds: bounds(28, -85, 32, -79) },
  { name: 'Brownsville', bounds: bounds(24, -103, 28, -97) },
  { name: 'Miami', bounds: bounds(24, -83, 28, -79) },
];
