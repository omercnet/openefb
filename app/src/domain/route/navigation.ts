// The active navigation (Direct-To, an Israel multi-leg route or a US plan's destination) and its live progress. Port of
// AppState's navigation fields and Core/Extensions/AppState+Navigation.swift, plus NearestAirportViewModel.setDirectTo.
// Plain values in, plain values out: the app store holds the result.
import { bearingDeg, distanceNm, type Airport, type Coordinate } from '../core';
import { progress } from '../israel/routeFollowing';
import { advance, currentLeg, goBack, legToCoordinate, type ActiveRoute } from './activeRoute';

export interface ActiveNavigation {
  directTo: Airport | null;
  /** Direct-To or a plan is being flown (AppState.activeFlightPlan). */
  activeFlightPlan: boolean;
  activeRoute: ActiveRoute | null;
  planDeparture: string | null;
  planDestination: string | null;
  planDestinationCoordinate: Coordinate | null;
  /** US gallons. */
  planFuelGallons: number | null;
  /** Nautical miles. */
  distanceToNext: number | null;
  /** Degrees true, ownship to the next waypoint. */
  bearingToNext: number | null;
  /** Seconds. */
  estimatedTimeEnroute: number | null;
}

/** What progress needs from a fix. */
export interface NavigationFix {
  position: Coordinate;
  /** Feet MSL; null without a vertical fix (the altitude caution never runs then). */
  altitudeFeet: number | null;
  groundSpeedKt: number;
}

export const NO_NAVIGATION: ActiveNavigation = {
  directTo: null,
  activeFlightPlan: false,
  activeRoute: null,
  planDeparture: null,
  planDestination: null,
  planDestinationCoordinate: null,
  planFuelGallons: null,
  distanceToNext: null,
  bearingToNext: null,
  estimatedTimeEnroute: null,
};

/** Below this ground speed (knots) the time to the next point is unknown. */
const ETE_MIN_GROUND_SPEED_KT = 30;

export const hasActiveNavigation = (nav: ActiveNavigation): boolean => nav.directTo !== null || nav.activeFlightPlan;

/** AppState.clearActiveNavigation: the pilot picked the wrong field or is done with the leg. */
export const clearActiveNavigation = (_nav: ActiveNavigation): ActiveNavigation => NO_NAVIGATION;

function withProgress(
  nav: ActiveNavigation,
  distanceNM: number,
  bearing: number,
  groundSpeedKt: number,
): ActiveNavigation {
  return {
    ...nav,
    distanceToNext: distanceNM,
    bearingToNext: bearing,
    estimatedTimeEnroute: groundSpeedKt > ETE_MIN_GROUND_SPEED_KT ? (distanceNM / groundSpeedKt) * 3600 : null,
  };
}

/**
 * Refresh DTG, bearing and ETE for whichever navigation is active: Direct-To (wins over a plan), an Israel multi-leg route
 * (also advances the leg and the following status), or a US direct plan's destination. Unchanged without a fix or
 * navigation. Called on every fix.
 */
export function updateActiveRouteProgress(
  nav: ActiveNavigation,
  fix: NavigationFix | null,
  nowMs: number,
): ActiveNavigation {
  if (!fix) return nav;
  const { position, groundSpeedKt } = fix;
  if (nav.directTo) {
    const target = { lat: nav.directTo.latitude, lon: nav.directTo.longitude };
    return withProgress(nav, distanceNm(position, target), bearingDeg(position, target), groundSpeedKt);
  }
  if (nav.activeRoute) {
    const step = progress(nav.activeRoute, position, fix.altitudeFeet, groundSpeedKt, nowMs);
    const leg = currentLeg(step.route);
    const next = { ...nav, activeRoute: step.route };
    if (step.distanceToNextNM === null || !leg) return next;
    return withProgress(next, step.distanceToNextNM, bearingDeg(position, legToCoordinate(leg)), groundSpeedKt);
  }
  if (nav.planDestinationCoordinate) {
    const target = nav.planDestinationCoordinate;
    return withProgress(nav, distanceNm(position, target), bearingDeg(position, target), groundSpeedKt);
  }
  return nav;
}

/**
 * NearestAirportViewModel.setDirectTo: fly direct to `airport`. The previous navigation's numbers are dropped first, so
 * without a fix none of them shows as this Direct-To's.
 */
export function setDirectTo(
  nav: ActiveNavigation,
  airport: Airport,
  fix: NavigationFix | null,
  nowMs: number,
): ActiveNavigation {
  const direct = {
    ...nav,
    directTo: airport,
    activeFlightPlan: true,
    distanceToNext: null,
    bearingToNext: null,
    estimatedTimeEnroute: null,
  };
  return updateActiveRouteProgress(direct, fix, nowMs);
}

/** AppState.sequenceActiveRoute: manual next or previous leg, then a progress refresh. */
export function sequenceActiveRoute(
  nav: ActiveNavigation,
  forward: boolean,
  fix: NavigationFix | null,
  nowMs: number,
): ActiveNavigation {
  if (!nav.activeRoute) return nav;
  const route = forward ? advance(nav.activeRoute) : goBack(nav.activeRoute);
  const leg = currentLeg(route);
  let distanceToNext = nav.distanceToNext;
  if (leg && fix) distanceToNext = distanceNm(fix.position, legToCoordinate(leg));
  else if (leg) distanceToNext = leg.distanceNM;
  return updateActiveRouteProgress({ ...nav, activeRoute: route, distanceToNext }, fix, nowMs);
}
