// Port of Services/IsraelBriefingMapHighlight.swift, data half: "Show on map" for a briefing NOTAM draws the NOTAM's
// area (E) polygon, circle, or the Q-line circle) and any closed chains in one source, and frames them. The layer specs
// are in ./layers; adding them to the map and moving the camera are the surface's job. Input types are the fields of
// L3's IsraelNotam this reads (structurally compatible).
import type { Coordinate } from '../../core';
import { collection, type Feature, type FeatureCollection, type Position } from '../geojson';

export interface IsraelBriefingNotamInput {
  geometry: {
    /** Ring from E); at least three points, not closed. */
    polygon: readonly Coordinate[] | null;
    circle: { centre: Coordinate; radiusNM: number } | null;
  };
  q: { centre: Coordinate | null; radiusNM: number | null } | null;
  closures: readonly { chain: readonly string[] }[];
}

/** Ring approximating a circle of `radiusNM` nautical miles around `centre` (flat-earth degrees, as Swift). */
export function circleRing(centre: Coordinate, radiusNM: number, points = 72): Coordinate[] {
  const latStep = radiusNM / 60;
  const lonStep = radiusNM / (60 * Math.max(0.1, Math.cos((centre.lat * Math.PI) / 180)));
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * 2 * Math.PI;
    return { lat: centre.lat + latStep * Math.sin(angle), lon: centre.lon + lonStep * Math.cos(angle) };
  });
}

/** Areas (rings, not closed) and lines (chains) to draw for a NOTAM. `pointLookup` resolves a chain code. */
export function briefingShapes(
  notam: IsraelBriefingNotamInput,
  pointLookup: (code: string) => Coordinate | null,
): { rings: Coordinate[][]; lines: Coordinate[][] } {
  let rings: Coordinate[][] = [];
  let qLineFallback = false;
  const { polygon, circle } = notam.geometry;
  const q = notam.q;
  if (polygon !== null && polygon.length >= 3) {
    rings.push([...polygon]);
  } else if (circle !== null) {
    rings.push(circleRing(circle.centre, circle.radiusNM));
    qLineFallback = true; // the relay copies the Q-line circle here for route closures
  } else if (q !== null && q.centre !== null && q.radiusNM !== null && q.radiusNM < 100) {
    // A Q-line circle of 100 NM or more is a FIR-wide placeholder, not a place.
    rings.push(circleRing(q.centre, q.radiusNM));
    qLineFallback = true;
  }
  const lines: Coordinate[][] = [];
  for (const closure of notam.closures) {
    const coordinates = closure.chain.map(pointLookup).filter((c): c is Coordinate => c !== null);
    if (coordinates.length >= 2) lines.push(coordinates);
  }
  // A route closure is the chain itself; the Q-line circle is only the NOTAM's scope and, filled, read as "this
  // whole area is closed" (UX-IL).
  if (qLineFallback && lines.length > 0) rings = [];
  return { rings, lines };
}

const position = (c: Coordinate): Position => [c.lon, c.lat];

/**
 * The `il-brief-highlight` source for a NOTAM in `color` (Swift recoloured both layers per call; here the colour is a
 * feature property). Null when there is nothing drawable (Swift `show` returned false). Rings are closed for GeoJSON.
 */
export function israelBriefingHighlightSource(
  notam: IsraelBriefingNotamInput,
  pointLookup: (code: string) => Coordinate | null,
  color: string,
): FeatureCollection | null {
  const { rings, lines } = briefingShapes(notam, pointLookup);
  if (rings.length === 0 && lines.length === 0) return null;
  const features: Feature[] = [];
  for (const ring of rings) {
    const coords = ring.map(position);
    coords.push(coords[0]!);
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { color } });
  }
  for (const line of lines) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.map(position) },
      properties: { color },
    });
  }
  return collection(features);
}

/** The box the map frames (Swift used 100 pt edge padding); null when there is nothing to frame. */
export function israelBriefingBounds(
  notam: IsraelBriefingNotamInput,
  pointLookup: (code: string) => Coordinate | null,
): { south: number; west: number; north: number; east: number } | null {
  const { rings, lines } = briefingShapes(notam, pointLookup);
  const all = [...rings.flat(), ...lines.flat()];
  const first = all[0];
  if (first === undefined) return null;
  const box = { south: first.lat, north: first.lat, west: first.lon, east: first.lon };
  for (const c of all) {
    box.south = Math.min(box.south, c.lat);
    box.north = Math.max(box.north, c.lat);
    box.west = Math.min(box.west, c.lon);
    box.east = Math.max(box.east, c.lon);
  }
  return box;
}
