// Port of Core/ActiveRoute.swift: the activated multi-leg route (Israel CVFR plan).
// Immutable: advance/goBack return the next state. Times are epoch ms; coordinates are { lat, lon }.
import type { Coordinate } from '../core/geometry';

/** IsraelRouteFollowing.defaultOffRouteThresholdNM; the following ticket (L3) owns the original. */
export const DEFAULT_OFF_ROUTE_THRESHOLD_NM = 1.0;

/** Distance from the next point at which a leg counts as reached. */
export const ARRIVAL_RADIUS_NM = 0.5;

export interface ActiveRouteLeg {
  segmentID: number;
  fromCode: string;
  toCode: string;
  fromLatitude: number;
  fromLongitude: number;
  toLatitude: number;
  toLongitude: number;
  altitudeText: string;
  distanceNM: number;
  /** [lat, lon] pairs; fewer than 2 means a straight line from -> to. */
  path: number[][];
}

/** Swift ActiveRouteLeg.init defaults. */
export function makeLeg(
  l: Pick<ActiveRouteLeg, 'fromCode' | 'toCode' | 'toLatitude' | 'toLongitude' | 'altitudeText' | 'distanceNM'> &
    Partial<ActiveRouteLeg>,
): ActiveRouteLeg {
  return { segmentID: 0, fromLatitude: 0, fromLongitude: 0, path: [], ...l };
}

export const legFromCoordinate = (l: ActiveRouteLeg): Coordinate => ({ lat: l.fromLatitude, lon: l.fromLongitude });
export const legToCoordinate = (l: ActiveRouteLeg): Coordinate => ({ lat: l.toLatitude, lon: l.toLongitude });

export function legVertices(l: ActiveRouteLeg): number[][] {
  if (l.path.length >= 2) return l.path;
  return [
    [l.fromLatitude, l.fromLongitude],
    [l.toLatitude, l.toLongitude],
  ];
}

/** Every run of digits in the altitude text, in order ("3500 / 4500" -> [3500, 4500]). ASCII digits only. */
export function legPublishedAltitudesFeet(l: ActiveRouteLeg): number[] {
  return (l.altitudeText.match(/[0-9]+/g) ?? []).map(Number);
}

export type RouteSide = 'L' | 'R';

export interface ActiveRouteFollowing {
  crossTrackNM: number | null;
  side: RouteSide | null;
  isOffRoute: boolean;
  altitudeDeviationFeet: number | null;
  altitudeDeviationSince: number | null;
  isAltitudeCaution: boolean;
  nextPointETA: number | null;
}

export const emptyFollowing = (): ActiveRouteFollowing => ({
  crossTrackNM: null,
  side: null,
  isOffRoute: false,
  altitudeDeviationFeet: null,
  altitudeDeviationSince: null,
  isAltitudeCaution: false,
  nextPointETA: null,
});

export interface ActiveRoute {
  legs: readonly ActiveRouteLeg[];
  currentLeg: number;
  following: ActiveRouteFollowing;
  offRouteThresholdNM: number;
}

export function makeActiveRoute(
  legs: readonly ActiveRouteLeg[],
  overrides: Partial<Omit<ActiveRoute, 'legs'>> = {},
): ActiveRoute {
  return {
    legs,
    currentLeg: 0,
    following: emptyFollowing(),
    offRouteThresholdNM: DEFAULT_OFF_ROUTE_THRESHOLD_NM,
    ...overrides,
  };
}

export const currentLeg = (r: ActiveRoute): ActiveRouteLeg | null => r.legs[r.currentLeg] ?? null;
export const nextLeg = (r: ActiveRoute): ActiveRouteLeg | null => r.legs[r.currentLeg + 1] ?? null;
export const isLastLeg = (r: ActiveRoute): boolean => r.currentLeg >= r.legs.length - 1;
export const departureCode = (r: ActiveRoute): string | null => r.legs[0]?.fromCode ?? null;
export const destinationCode = (r: ActiveRoute): string | null => r.legs[r.legs.length - 1]?.toCode ?? null;
export const departureCoordinate = (r: ActiveRoute): Coordinate | null =>
  r.legs.length ? legFromCoordinate(r.legs[0]) : null;
export const destinationCoordinate = (r: ActiveRoute): Coordinate | null =>
  r.legs.length ? legToCoordinate(r.legs[r.legs.length - 1]) : null;

/** Move to the next leg and reset following; unchanged on the last leg. */
export function advance(r: ActiveRoute): ActiveRoute {
  if (isLastLeg(r)) return r;
  return { ...r, currentLeg: r.currentLeg + 1, following: emptyFollowing() };
}

/** Move to the previous leg and reset following; unchanged on the first leg. */
export function goBack(r: ActiveRoute): ActiveRoute {
  if (r.currentLeg <= 0) return r;
  return { ...r, currentLeg: r.currentLeg - 1, following: emptyFollowing() };
}

/** Distance to the next point plus every leg after the current one. */
export function remainingNm(r: ActiveRoute, distanceToNext: number): number {
  return distanceToNext + r.legs.slice(r.currentLeg + 1).reduce((s, l) => s + l.distanceNM, 0);
}
