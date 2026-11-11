// Ownship chevron and route line features (MapService.updateOwnship, redrawOwnship, updateRoute, clearRoute).
import { greatCirclePoints, type Coordinate } from '../core';
import { OWNSHIP_LIVE_ICON, OWNSHIP_STALE_ICON } from './layers';
import { collection, EMPTY_COLLECTION, point, type FeatureCollection } from './geojson';

/**
 * The ownship exists only once there is a fix: before that the source is empty, so a chevron at a placeholder position
 * never reads as the aircraft's live position. `stale` greys the chevron (a frozen position never looks current).
 * A non-finite heading draws north (JS-only guard: NaN would reach the native renderer).
 */
export function ownshipFeatures(position: Coordinate | null, headingTrue: number, stale: boolean): FeatureCollection {
  if (!position) return EMPTY_COLLECTION;
  return collection([
    point(position.lat, position.lon, {
      heading: Number.isFinite(headingTrue) ? headingTrue : 0,
      icon: stale ? OWNSHIP_STALE_ICON : OWNSHIP_LIVE_ICON,
    }),
  ]);
}

const line = (coords: Coordinate[]): FeatureCollection =>
  collection([
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords.map((c) => [c.lon, c.lat]) },
      properties: {},
    },
  ]);

/** Great-circle route line between departure and destination (100 points). */
export function routeLineGreatCircle(departure: Coordinate, destination: Coordinate): FeatureCollection {
  const pts = greatCirclePoints(departure, destination, 100);
  // Coincident endpoints yield one point; a LineString needs two (JS-only guard).
  return pts.length >= 2 ? line(pts) : EMPTY_COLLECTION;
}

/**
 * A routed path along its own vertices (Israel CVFR route). Fewer than two points draws nothing, as in Swift, where the
 * guard returned before touching the source (here: an empty route, so a stale path never lingers).
 */
export const routeLinePath = (path: readonly Coordinate[]): FeatureCollection =>
  path.length >= 2 ? line([...path]) : EMPTY_COLLECTION;
