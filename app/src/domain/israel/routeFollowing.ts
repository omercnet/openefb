// Port of Services/IsraelRouteFollowing.swift: pure route-following maths for an active Israel CVFR route.
// No state, no clock: every function takes the position, the altitude and `now` (epoch ms).
// Units: degrees WGS-84, nautical miles, feet MSL, knots, seconds.
import type { Coordinate } from '../core/geometry';
import { distanceNm } from '../core/geometry';
import {
  ARRIVAL_RADIUS_NM,
  DEFAULT_OFF_ROUTE_THRESHOLD_NM,
  advance,
  currentLeg,
  departureCoordinate,
  destinationCoordinate,
  isLastLeg,
  legPublishedAltitudesFeet,
  legToCoordinate,
  legVertices,
  type ActiveRoute,
  type ActiveRouteLeg,
  type RouteSide,
} from '../route/activeRoute';

// Swift's defaultOffRouteThresholdNM lives in domain/route (L2 needed it first); re-exported, not duplicated.
export { DEFAULT_OFF_ROUTE_THRESHOLD_NM };

/** Altitude caution band around the published altitude, feet. */
export const ALTITUDE_TOLERANCE_FEET = 300;
/** The deviation must last longer than this before the caution shows, seconds. */
export const ALTITUDE_GRACE_SECONDS = 30;
/** No altitude caution within this distance of the departure or destination (climb, descent), NM. */
export const TERMINAL_SUPPRESSION_NM = 3;
/** Passing abeam only counts when within this distance of the TO point, NM. */
export const ABEAM_LIMIT_NM = 2;
/** ETE is only meaningful above this ground speed, knots. */
export const MINIMUM_GROUND_SPEED_KNOTS = 30;

/**
 * The pilot's configured off-route threshold, or the default. Swift reads UserDefaults
 * ("israelOffRouteThresholdNM"); the storage read belongs to the caller, which passes the stored value.
 */
export function configuredOffRouteThresholdNm(stored: number | null | undefined): number {
  return stored != null && stored > 0 ? stored : DEFAULT_OFF_ROUTE_THRESHOLD_NM;
}

/** Local flat projection of `point` relative to `origin`, NM (x east, y north). */
export function offsetNm(point: Coordinate, origin: Coordinate): { x: number; y: number } {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return { x: (point.lon - origin.lon) * 60 * cosLat, y: (point.lat - origin.lat) * 60 };
}

const isVertex = (v: readonly number[] | undefined): v is readonly number[] => !!v && v.length >= 2;

/**
 * Distance from `point` to the polyline (a list of [lat, lon]) and the side it lies on, looking along the
 * direction of the polyline. The nearest segment decides. null for fewer than two vertices.
 */
export function crossTrack(
  point: Coordinate,
  vertices: readonly (readonly number[])[],
): { distanceNM: number; side: RouteSide } | null {
  const usable = vertices.filter(isVertex);
  if (usable.length < 2) return null;
  let best: { distanceNM: number; side: RouteSide } | null = null;
  for (let i = 0; i < usable.length - 1; i++) {
    const a = { lat: usable[i][0], lon: usable[i][1] };
    const b = { lat: usable[i + 1][0], lon: usable[i + 1][1] };
    const ab = offsetNm(b, a);
    const ap = offsetNm(point, a);
    const lengthSquared = ab.x * ab.x + ab.y * ab.y;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / lengthSquared)) : 0;
    const dx = ap.x - t * ab.x;
    const dy = ap.y - t * ab.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Positive cross product (ab x ap) = the point lies counter-clockwise of the direction = left.
    const side: RouteSide = ab.x * ap.y - ab.y * ap.x > 0 ? 'L' : 'R';
    if (best === null || distance < best.distanceNM) best = { distanceNM: distance, side };
  }
  return best;
}

/**
 * True when the aircraft has passed the leg's TO point: within ARRIVAL_RADIUS_NM of it, or abeam it
 * (past the end of the last segment, within ABEAM_LIMIT_NM).
 */
export function hasReachedEnd(leg: ActiveRouteLeg, position: Coordinate): boolean {
  const to = legToCoordinate(leg);
  const toDistance = distanceNm(position, to);
  if (toDistance <= ARRIVAL_RADIUS_NM) return true;
  if (toDistance > ABEAM_LIMIT_NM) return false;
  const vertices = legVertices(leg).filter(isVertex);
  if (vertices.length < 2) return false;
  const prev = vertices[vertices.length - 2];
  const a = { lat: prev[0], lon: prev[1] };
  const ab = offsetNm(to, a);
  const ap = offsetNm(position, a);
  // Past the end of the last segment: the projection of the position lies beyond the TO point.
  return ap.x * ab.x + ap.y * ab.y > ab.x * ab.x + ab.y * ab.y;
}

/**
 * Signed feet from the nearest published altitude (+ above). Two-number text compares against both.
 * null when the leg publishes no altitude.
 */
export function altitudeDeviationFeet(altitudeFeet: number, published: readonly number[]): number | null {
  let best: number | null = null;
  for (const p of published) {
    const d = altitudeFeet - p;
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** Within TERMINAL_SUPPRESSION_NM of the departure or destination aerodrome. */
export function isNearTerminal(position: Coordinate, route: ActiveRoute): boolean {
  const departure = departureCoordinate(route);
  if (departure && distanceNm(position, departure) <= TERMINAL_SUPPRESSION_NM) return true;
  const destination = destinationCoordinate(route);
  if (destination && distanceNm(position, destination) <= TERMINAL_SUPPRESSION_NM) return true;
  return false;
}

/** Result of one fix: the route with its sequencing and following status, and the distance to the next point. */
export interface RouteProgress {
  route: ActiveRoute;
  distanceToNextNM: number | null;
}

/**
 * Advance the route for a fix and refresh the following status.
 * `altitudeFeet` null means no vertical fix (no altitude caution then); `nowMs` is epoch ms.
 */
export function progress(
  startRoute: ActiveRoute,
  position: Coordinate,
  altitudeFeet: number | null,
  groundSpeedKnots: number,
  nowMs: number,
): RouteProgress {
  let route = startRoute;
  // Auto-sequence: a fix can pass several short legs at once.
  for (let leg = currentLeg(route); leg && !isLastLeg(route) && hasReachedEnd(leg, position); leg = currentLeg(route)) {
    route = advance(route);
  }
  const leg = currentLeg(route);
  if (!leg) return { route, distanceToNextNM: null };

  const toNext = distanceNm(position, legToCoordinate(leg));
  const following = { ...route.following };

  const track = crossTrack(position, legVertices(leg));
  if (track) {
    following.crossTrackNM = track.distanceNM;
    following.side = track.side;
    following.isOffRoute = track.distanceNM > route.offRouteThresholdNM;
  } else {
    following.crossTrackNM = null;
    following.side = null;
    following.isOffRoute = false;
  }

  // seconds = NM / knots * 3600
  following.nextPointETA =
    groundSpeedKnots > MINIMUM_GROUND_SPEED_KNOTS ? nowMs + (toNext / groundSpeedKnots) * 3600 * 1000 : null;

  const published = legPublishedAltitudesFeet(leg);
  const deviation =
    altitudeFeet != null && published.length > 0 && !isNearTerminal(position, route)
      ? altitudeDeviationFeet(altitudeFeet, published)
      : null;
  if (deviation !== null) {
    following.altitudeDeviationFeet = deviation;
    if (Math.abs(deviation) > ALTITUDE_TOLERANCE_FEET) {
      const since = following.altitudeDeviationSince ?? nowMs;
      following.altitudeDeviationSince = since;
      following.isAltitudeCaution = (nowMs - since) / 1000 > ALTITUDE_GRACE_SECONDS;
    } else {
      following.altitudeDeviationSince = null;
      following.isAltitudeCaution = false;
    }
  } else {
    following.altitudeDeviationFeet = null;
    following.altitudeDeviationSince = null;
    following.isAltitudeCaution = false;
  }

  return { route: { ...route, following }, distanceToNextNM: toNext };
}
