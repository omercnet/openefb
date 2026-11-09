// Units: positions in degrees (WGS84), distances in nautical miles. Pure functions, no platform imports.

/** A position. Replaces CLLocationCoordinate2D from the SwiftUI app. */
export interface Coordinate {
  lat: number;
  lon: number;
}

/** Earth radius in nautical miles: 3440.065, the value every Swift service uses, so ported tests compare exactly. */
export const EARTH_RADIUS_NM = 3440.065;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two positions (haversine), in nautical miles. */
export function distanceNm(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
