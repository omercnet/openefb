// Ports of efb-212Tests/ServiceTests/LiveNavigationProgressTests.swift and ClearDirectToTests
// (MapGPSRecordingFixesTests.swift): Direct-To, US plan and Israel route progress, and clearing.
import { distanceNm, type Airport } from '../core';
import { makeActiveRoute, makeLeg } from './activeRoute';
import {
  NO_NAVIGATION,
  clearActiveNavigation,
  hasActiveNavigation,
  sequenceActiveRoute,
  setDirectTo,
  updateActiveRouteProgress,
  type ActiveNavigation,
  type NavigationFix,
} from './navigation';

const overPaloAlto = { lat: 37.4611, lon: -122.115 };
/** Roughly halfway from KPAO to KSQL. */
const halfwayToSanCarlos = { lat: 37.4865, lon: -122.1822 };
const ksqlCoordinate = { lat: 37.5119, lon: -122.2494 };
const ksql = { icao: 'KSQL', name: 'San Carlos', latitude: 37.5119, longitude: -122.2494 } as Airport;
const NOW = Date.UTC(2026, 10, 14, 12);

const fix = (
  position: { lat: number; lon: number },
  groundSpeedKt: number,
  altitudeFeet: number | null = null,
): NavigationFix => ({
  position,
  groundSpeedKt,
  altitudeFeet,
});

const twoLegRoute = () =>
  makeActiveRoute([
    makeLeg({
      segmentID: 1,
      fromCode: 'AAAAA',
      toCode: 'BBBBB',
      fromLatitude: 32.0,
      fromLongitude: 34.8,
      toLatitude: 32.3,
      toLongitude: 34.8,
      altitudeText: '2500',
      distanceNM: 18,
    }),
    makeLeg({
      segmentID: 2,
      fromCode: 'BBBBB',
      toCode: 'CCCCC',
      fromLatitude: 32.3,
      fromLongitude: 34.8,
      toLatitude: 32.3,
      toLongitude: 35.1,
      altitudeText: '3500',
      distanceNM: 15.2,
    }),
  ]);

describe('live navigation progress', () => {
  it('Direct-To numbers follow each fix', () => {
    let nav = setDirectTo(NO_NAVIGATION, ksql, fix(overPaloAlto, 90), NOW);
    const firstDistance = nav.distanceToNext!;
    const firstETE = nav.estimatedTimeEnroute!;
    const firstBearing = nav.bearingToNext!;
    expect(firstDistance).not.toBeNull();
    expect(firstETE).not.toBeNull();
    expect(firstBearing).toBeGreaterThan(280); // KSQL lies west-northwest of KPAO
    expect(firstBearing).toBeLessThan(310);

    nav = updateActiveRouteProgress(nav, fix(halfwayToSanCarlos, 90), NOW);
    const secondDistance = nav.distanceToNext!;
    const secondETE = nav.estimatedTimeEnroute!;
    expect(secondDistance).toBeLessThan(firstDistance * 0.6);
    expect(secondETE).toBeLessThan(firstETE);
    expect(Math.abs(secondETE - (secondDistance / 90) * 3600)).toBeLessThan(1);
    expect(nav.bearingToNext).toBeGreaterThan(280);
    expect(nav.bearingToNext).toBeLessThan(310);
  });

  it('time to is unknown below 30 knots', () => {
    const nav = updateActiveRouteProgress(
      { ...NO_NAVIGATION, directTo: ksql, activeFlightPlan: true },
      fix(overPaloAlto, 20),
      NOW,
    );
    expect(nav.distanceToNext).not.toBeNull();
    expect(nav.bearingToNext).not.toBeNull();
    expect(nav.estimatedTimeEnroute).toBeNull();
  });

  it('US plan destination numbers update per fix', () => {
    let nav: ActiveNavigation = { ...NO_NAVIGATION, activeFlightPlan: true, planDestinationCoordinate: ksqlCoordinate };
    nav = updateActiveRouteProgress(nav, fix(overPaloAlto, 100), NOW);
    const first = nav.distanceToNext!;
    expect(Math.abs(first - distanceNm(overPaloAlto, ksqlCoordinate))).toBeLessThan(0.01);

    nav = updateActiveRouteProgress(nav, fix(halfwayToSanCarlos, 100), NOW);
    const second = nav.distanceToNext!;
    expect(second).toBeLessThan(first);
    expect(Math.abs(nav.estimatedTimeEnroute! - (second / 100) * 3600)).toBeLessThan(1);
    expect(nav.bearingToNext).not.toBeNull();
  });

  it('clearing navigation drops bearing and destination, and a later fix does not bring them back', () => {
    let nav: ActiveNavigation = { ...NO_NAVIGATION, activeFlightPlan: true, planDestinationCoordinate: ksqlCoordinate };
    nav = updateActiveRouteProgress(nav, fix(overPaloAlto, 100), NOW);
    expect(nav.bearingToNext).not.toBeNull();

    nav = clearActiveNavigation(nav);
    expect(nav.bearingToNext).toBeNull();
    expect(nav.planDestinationCoordinate).toBeNull();
    expect(nav.distanceToNext).toBeNull();
    expect(nav.estimatedTimeEnroute).toBeNull();

    nav = updateActiveRouteProgress(nav, fix(overPaloAlto, 100), NOW);
    expect(nav.distanceToNext).toBeNull();
    expect(nav.bearingToNext).toBeNull();
  });

  it('an Israel route still measures to the active leg point', () => {
    const nav = updateActiveRouteProgress(
      { ...NO_NAVIGATION, activeRoute: twoLegRoute(), activeFlightPlan: true },
      fix({ lat: 32.1, lon: 34.8 }, 90), // on the first leg, heading north
      NOW,
    );
    expect(nav.activeRoute!.legs[nav.activeRoute!.currentLeg]!.toCode).toBe('BBBBB');
    expect(Math.abs(nav.distanceToNext! - 12)).toBeLessThan(0.2); // 0.2 degrees of latitude = 12 NM
    const bearing = nav.bearingToNext!;
    expect(bearing < 1 || bearing > 359).toBe(true); // due north
    expect(Math.abs(nav.estimatedTimeEnroute! - (nav.distanceToNext! / 90) * 3600)).toBeLessThan(1);
  });

  it('a Direct-To without a fix shows no old numbers', () => {
    const left: ActiveNavigation = {
      ...NO_NAVIGATION,
      distanceToNext: 18.4,
      bearingToNext: 341,
      estimatedTimeEnroute: 676,
    };
    const nav = setDirectTo(left, ksql, null, NOW);
    expect(nav.directTo?.icao).toBe('KSQL');
    expect(nav.distanceToNext).toBeNull();
    expect(nav.bearingToNext).toBeNull();
    expect(nav.estimatedTimeEnroute).toBeNull();
  });

  it('without a fix, progress leaves the navigation as it is', () => {
    const nav: ActiveNavigation = { ...NO_NAVIGATION, directTo: ksql, activeFlightPlan: true, distanceToNext: 3 };
    expect(updateActiveRouteProgress(nav, null, NOW)).toBe(nav);
  });
});

describe('clear Direct-To', () => {
  it('clear removes the Direct-To and the strip values', () => {
    let nav = setDirectTo(NO_NAVIGATION, ksql, fix(overPaloAlto, 90), NOW);
    expect(nav.directTo?.icao).toBe('KSQL');
    expect(nav.activeFlightPlan).toBe(true);
    expect(nav.distanceToNext).not.toBeNull();
    expect(nav.estimatedTimeEnroute).not.toBeNull();
    expect(hasActiveNavigation(nav)).toBe(true);

    nav = clearActiveNavigation(nav);
    expect(nav.directTo).toBeNull();
    expect(nav.activeFlightPlan).toBe(false);
    expect(nav.distanceToNext).toBeNull();
    expect(nav.estimatedTimeEnroute).toBeNull();
    expect(hasActiveNavigation(nav)).toBe(false);
  });

  it('clear also drops a route summary', () => {
    const nav = clearActiveNavigation({
      ...NO_NAVIGATION,
      activeFlightPlan: true,
      planDeparture: 'KPAO',
      planDestination: 'KSQL',
      distanceToNext: 12,
    });
    expect(nav.planDeparture).toBeNull();
    expect(nav.planDestination).toBeNull();
    expect(hasActiveNavigation(nav)).toBe(false);
  });
});

describe('sequence the active route', () => {
  it('next and previous move the leg and remeasure from ownship', () => {
    const start: ActiveNavigation = { ...NO_NAVIGATION, activeRoute: twoLegRoute(), activeFlightPlan: true };
    const at = fix({ lat: 32.0, lon: 34.8 }, 0);
    const next = sequenceActiveRoute(start, true, at, NOW);
    expect(next.activeRoute!.currentLeg).toBe(1);
    expect(next.distanceToNext).toBeCloseTo(distanceNm({ lat: 32.0, lon: 34.8 }, { lat: 32.3, lon: 35.1 }), 1);
    const back = sequenceActiveRoute(next, false, at, NOW);
    expect(back.activeRoute!.currentLeg).toBe(0);
  });

  it('without a fix the leg length stands in for the distance', () => {
    const next = sequenceActiveRoute(
      { ...NO_NAVIGATION, activeRoute: twoLegRoute(), activeFlightPlan: true },
      true,
      null,
      NOW,
    );
    expect(next.distanceToNext).toBe(15.2);
  });

  it('does nothing without a route', () => {
    expect(sequenceActiveRoute(NO_NAVIGATION, true, null, NOW)).toBe(NO_NAVIGATION);
  });
});
