// The pure steps of the US flight planner (logic.ts): search threshold, route math, ETE text, what the plan writes into
// navigation and clears from it, the camera fit, the saved record, and the text the sheet and the summary card show.
import { newAircraftProfile, newFlightPlanRecord } from '../../../data/defaults';
import { NO_NAVIGATION, type ActiveNavigation } from '../../../domain/route/navigation';
import { makeActiveRoute, makeLeg } from '../../../domain/route/activeRoute';
import { KOAK, KPAO, KSQL } from './fixture';
import {
  DEFAULT_CRUISE_SPEED_KTS,
  activeAircraft,
  byLastUsed,
  cruiseSpeedKts,
  formattedETE,
  planRecord,
  publishPlan,
  publishesRoute,
  relativeText,
  routeBounds,
  routeEstimate,
  routeLabel,
  savedPlanAccessibilityLabel,
  savedPlanDistanceText,
  searchableQuery,
  summaryMetrics,
  withdrawPlan,
} from './logic';

const aircraft = (o: { speed?: number | null; burn?: number | null; active?: boolean } = {}) =>
  newAircraftProfile('N4543A', {
    cruiseSpeedKts: o.speed ?? null,
    fuelBurnGPH: o.burn ?? null,
    isActive: o.active ?? true,
  });

describe('search', () => {
  test('two characters search, fewer do not; the text is not trimmed', () => {
    expect(searchableQuery('')).toBeNull();
    expect(searchableQuery('K')).toBeNull();
    expect(searchableQuery('KP')).toBe('KP');
    expect(searchableQuery('K ')).toBe('K ');
  });

  test('characters are counted, not UTF-16 units', () => {
    expect(searchableQuery('\u{1F6E9}')).toBeNull(); // one character, two units
  });
});

describe('route math', () => {
  test('the active aircraft is the one marked active; a lone inactive profile is not used', () => {
    const inactive = aircraft({ active: false });
    const active = aircraft({ speed: 120 });
    expect(activeAircraft([inactive])).toBeNull();
    expect(activeAircraft([inactive, active])).toBe(active);
    expect(activeAircraft([])).toBeNull();
  });

  test('cruise speed falls back to 100 kt without a positive speed', () => {
    expect(cruiseSpeedKts(null)).toBe(DEFAULT_CRUISE_SPEED_KTS);
    expect(cruiseSpeedKts(aircraft({ speed: null }))).toBe(100);
    expect(cruiseSpeedKts(aircraft({ speed: 0 }))).toBe(100);
    expect(cruiseSpeedKts(aircraft({ speed: -5 }))).toBe(100);
    expect(cruiseSpeedKts(aircraft({ speed: 135 }))).toBe(135);
  });

  test('distance, ETE and fuel at the aircraft speed and burn', () => {
    const estimate = routeEstimate(KPAO, KOAK, aircraft({ speed: 120, burn: 9 }));
    expect(estimate.distanceNM).toBeCloseTo(16.41, 2);
    expect(estimate.estimatedTimeSeconds).toBeCloseTo((estimate.distanceNM / 120) * 3600, 6);
    expect(estimate.estimatedFuelGallons).toBeCloseTo((estimate.distanceNM / 120) * 9, 6);
  });

  test('no fuel without a positive burn', () => {
    expect(routeEstimate(KPAO, KOAK, aircraft({ speed: 120, burn: 0 })).estimatedFuelGallons).toBeNull();
    expect(routeEstimate(KPAO, KOAK, aircraft({ speed: 120, burn: null })).estimatedFuelGallons).toBeNull();
    expect(routeEstimate(KPAO, KOAK, null).estimatedFuelGallons).toBeNull();
  });

  test('formattedETE truncates to whole minutes and reads 0:00 for a non-finite time', () => {
    expect(formattedETE(0)).toBe('0:00');
    expect(formattedETE(119.9)).toBe('0:01');
    expect(formattedETE(36_000)).toBe('10:00');
    expect(formattedETE(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formattedETE(Number.NaN)).toBe('0:00');
  });
});

describe('navigation', () => {
  const leftover: ActiveNavigation = {
    ...NO_NAVIGATION,
    directTo: KSQL,
    activeFlightPlan: true,
    activeRoute: makeActiveRoute([
      makeLeg({
        fromCode: 'A',
        toCode: 'B',
        toLatitude: 32.3,
        toLongitude: 34.8,
        altitudeText: '2500',
        distanceNM: 18,
      }),
    ]),
    distanceToNext: 4.2,
    bearingToNext: 295,
    estimatedTimeEnroute: 168,
  };

  test('a published plan replaces the Direct-To and a leftover route and carries its numbers', () => {
    const estimate = routeEstimate(KPAO, KOAK, null);
    const nav = publishPlan(leftover, { ...estimate, departure: KPAO, destination: KOAK });
    expect(nav).toEqual({
      directTo: null,
      activeFlightPlan: true,
      activeRoute: null,
      planDeparture: 'KPAO',
      planDestination: 'KOAK',
      planDestinationCoordinate: { lat: KOAK.latitude, lon: KOAK.longitude },
      planFuelGallons: null,
      distanceToNext: estimate.distanceNM,
      bearingToNext: expect.any(Number),
      estimatedTimeEnroute: estimate.estimatedTimeSeconds,
    });
    // KPAO to KOAK runs a little west of north.
    expect(nav.bearingToNext).toBeGreaterThan(340);
    expect(nav.bearingToNext).toBeLessThan(360);
  });

  test('withdrawing the plan clears its fields and the flag without a Direct-To', () => {
    const planned = publishPlan(NO_NAVIGATION, {
      ...routeEstimate(KPAO, KSQL, null),
      departure: KPAO,
      destination: KSQL,
    });
    expect(withdrawPlan(planned)).toEqual(NO_NAVIGATION);
  });

  test('withdrawing the plan keeps a Direct-To with its live numbers', () => {
    const nav = withdrawPlan({ ...leftover, planDeparture: 'KPAO', planDestination: 'KOAK', planFuelGallons: 3 });
    expect(nav.directTo?.icao).toBe('KSQL');
    expect(nav.activeFlightPlan).toBe(true);
    expect([nav.distanceToNext, nav.bearingToNext, nav.estimatedTimeEnroute]).toEqual([4.2, 295, 168]);
    expect([nav.planDeparture, nav.planDestination, nav.planDestinationCoordinate, nav.planFuelGallons]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  test('only the automatic restore over a Direct-To leaves navigation alone', () => {
    expect(publishesRoute(true, leftover)).toBe(true);
    expect(publishesRoute(false, leftover)).toBe(false);
    expect(publishesRoute(false, NO_NAVIGATION)).toBe(true);
  });

  test('the camera fit spans both ends with half a degree around them', () => {
    expect(routeBounds(KOAK, KPAO)).toEqual({
      sw: { lat: KPAO.latitude - 0.5, lon: KOAK.longitude - 0.5 },
      ne: { lat: KOAK.latitude + 0.5, lon: KPAO.longitude + 0.5 },
    });
  });
});

describe('persistence', () => {
  test('the saved record has both ends, the numbers and the cruise speed recovered from distance and ETE', () => {
    const estimate = routeEstimate(KPAO, KSQL, aircraft({ speed: 120, burn: 9 }));
    const record = planRecord(
      { ...estimate, departure: KPAO, destination: KSQL },
      { now: () => 1234, newId: () => 'id-1' },
    );
    expect(record).toMatchObject({
      id: 'id-1',
      departureICAO: 'KPAO',
      departureName: 'Palo Alto',
      departureLatitude: KPAO.latitude,
      departureLongitude: KPAO.longitude,
      destinationICAO: 'KSQL',
      destinationName: 'San Carlos',
      destinationLatitude: KSQL.latitude,
      destinationLongitude: KSQL.longitude,
      totalDistanceNM: estimate.distanceNM,
      estimatedTimeSeconds: estimate.estimatedTimeSeconds,
      estimatedFuelGallons: estimate.estimatedFuelGallons,
      lastUsedAt: 1234,
      createdAt: 1234,
      // Not set by savePlan: the record defaults.
      cruiseAltitude: 3000,
      fuelBurnGPH: null,
      name: null,
    });
    expect(record.cruiseSpeedKts).toBeCloseTo(120, 6);
  });

  test('a zero-distance plan saves 100 kt instead of dividing by zero', () => {
    const record = planRecord({ ...routeEstimate(KPAO, KPAO, null), departure: KPAO, destination: KPAO });
    expect(record.cruiseSpeedKts).toBe(100);
  });

  test('saved plans sort by last use, newest first, ties in their order', () => {
    const a = newFlightPlanRecord({ newId: () => 'a', lastUsedAt: 10 });
    const b = newFlightPlanRecord({ newId: () => 'b', lastUsedAt: 30 });
    const c = newFlightPlanRecord({ newId: () => 'c', lastUsedAt: 10 });
    expect(byLastUsed([a, b, c]).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('display text', () => {
  test('summary metrics: distance and ETE, fuel only with an estimate', () => {
    expect(summaryMetrics({ distanceNM: 125.44, ete: '1:15', fuelGallons: 12.25 })).toEqual([
      { label: 'Distance', value: '125.4', unit: 'nm', accessibilityValue: '125.4 nautical miles' },
      { label: 'Estimated time en route', value: '1:15', unit: 'ETE', accessibilityValue: '1:15' },
      { label: 'Fuel', value: '12.3', unit: 'gal', accessibilityValue: '12.3 gallons' },
    ]);
    expect(summaryMetrics({ distanceNM: 0, ete: '0:00', fuelGallons: null }).map((m) => m.label)).toEqual([
      'Distance',
      'Estimated time en route',
    ]);
  });

  test('route label and saved distance', () => {
    expect(routeLabel('KPAO', 'KMOD')).toBe('Route KPAO to KMOD');
    expect(savedPlanDistanceText({ totalDistanceNM: 7 })).toBe('7.0 nm');
    expect(savedPlanDistanceText({ totalDistanceNM: 104.46 })).toBe('104.5 nm');
  });

  test('relative time: the two largest units, the second only when not zero', () => {
    const now = 1_000_000_000_000;
    expect(relativeText(now, now)).toBe('0 seconds');
    expect(relativeText(now - 1000, now)).toBe('1 second');
    expect(relativeText(now - 45_000, now)).toBe('45 seconds');
    expect(relativeText(now - 125_000, now)).toBe('2 minutes, 5 seconds');
    expect(relativeText(now - 2 * 3600_000, now)).toBe('2 hours');
    expect(relativeText(now - (3600_000 + 60_000 + 1000), now)).toBe('1 hour, 1 minute');
    expect(relativeText(now - (3 * 86_400_000 + 5 * 3600_000), now)).toBe('3 days, 5 hours');
    expect(relativeText(now + 90_000, now)).toBe('1 minute, 30 seconds'); // future: same text, no "in"
  });

  test('saved row label speaks route, distance, age and the active mark', () => {
    const record = newFlightPlanRecord({
      departureICAO: 'KPAO',
      destinationICAO: 'KSQL',
      totalDistanceNM: 7,
      lastUsedAt: 0,
    });
    expect(savedPlanAccessibilityLabel(record, 7200_000, false)).toBe('KPAO to KSQL, 7.0 nm, 2 hours');
    expect(savedPlanAccessibilityLabel(record, 7200_000, true)).toBe('KPAO to KSQL, 7.0 nm, 2 hours, Active plan');
  });
});
