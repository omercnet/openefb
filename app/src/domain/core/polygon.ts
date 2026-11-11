// Port of Core/PolygonGeometry.swift. Rings are arrays of [lat, lon] pairs (Swift order, not GeoJSON).
import type { Coordinate } from './geometry';

export type Ring = number[][];

/** Nautical miles per degree of latitude (flat-earth approximation used for edge distances). */
export const NM_PER_DEGREE_LATITUDE = 60;

const validVertices = (ring: Ring): number[][] => ring.filter((v) => v.length >= 2);

/** Even-odd point-in-polygon. Rings with fewer than 3 vertices contain nothing. */
export function ringContains(point: Coordinate, ring: Ring): boolean {
  const v = validVertices(ring);
  if (v.length < 3) return false;
  let inside = false;
  let j = v.length - 1;
  for (let i = 0; i < v.length; i++) {
    const [latI, lonI] = v[i];
    const [latJ, lonJ] = v[j];
    if (latI > point.lat !== latJ > point.lat) {
      const lonAtCrossing = lonI + ((point.lat - latI) / (latJ - latI)) * (lonJ - lonI);
      if (point.lon < lonAtCrossing) inside = !inside;
    }
    j = i;
  }
  return inside;
}

function distanceFromOriginToSegment(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return Math.hypot(a.x, a.y);
  const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

/** Distance in NM from the point to the nearest polygon edge (closing edge included), or null for fewer than 2 vertices. */
export function distanceToEdgeNm(point: Coordinate, ring: Ring): number | null {
  const v = validVertices(ring);
  if (v.length < 2) return null;
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const project = (p: number[]) => ({
    x: (p[1] - point.lon) * NM_PER_DEGREE_LATITUDE * cosLat,
    y: (p[0] - point.lat) * NM_PER_DEGREE_LATITUDE,
  });
  let best = Number.MAX_VALUE;
  for (let i = 0; i < v.length; i++) {
    best = Math.min(best, distanceFromOriginToSegment(project(v[i]), project(v[(i + 1) % v.length])));
  }
  return best;
}

/** 0 inside the ring, otherwise the distance to the nearest edge. */
export function distanceNmToRing(point: Coordinate, ring: Ring): number | null {
  if (ringContains(point, ring)) return 0;
  return distanceToEdgeNm(point, ring);
}

/** Vertex average (closing duplicate vertex dropped), or null for an empty ring. */
export function ringCentroid(ring: Ring): Coordinate | null {
  const v = validVertices(ring);
  if (v.length > 1) {
    const first = v[0];
    const last = v[v.length - 1];
    if (first.length === last.length && first.every((n, i) => n === last[i])) v.pop();
  }
  if (v.length === 0) return null;
  return {
    lat: v.reduce((s, p) => s + p[0], 0) / v.length,
    lon: v.reduce((s, p) => s + p[1], 0) / v.length,
  };
}
