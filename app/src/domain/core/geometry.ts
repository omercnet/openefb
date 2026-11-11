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

const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Initial bearing from a to b in degrees [0, 360) (port of CLLocation.bearing(to:)). */
export function bearingDeg(a: Coordinate, b: Coordinate): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon) - toRad(a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Position reached from `from` after `distanceNm` along `bearingDegrees` (port of destination(distanceNM:bearingDegrees:)). */
export function destinationPoint(from: Coordinate, distance: number, bearingDegrees: number): Coordinate {
  const angular = distance / EARTH_RADIUS_NM;
  const bearing = toRad(bearingDegrees);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** count + 1 evenly spaced points along the great circle from start to end (slerp). Coincident points give [start]. */
export function greatCirclePoints(start: Coordinate, end: Coordinate, count = 100): Coordinate[] {
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);
  const lat2 = toRad(end.lat);
  const lon2 = toRad(end.lon);
  const d =
    2 *
    Math.asin(
      Math.sqrt(Math.sin((lat1 - lat2) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon1 - lon2) / 2) ** 2),
    );
  if (!(d > 1e-10)) return [start];
  const sinD = Math.sin(d);
  const out: Coordinate[] = [];
  for (let i = 0; i <= count; i++) {
    const f = i / count;
    const a = Math.sin((1 - f) * d) / sinD;
    const b = Math.sin(f * d) / sinD;
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    out.push({ lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) });
  }
  return out;
}
