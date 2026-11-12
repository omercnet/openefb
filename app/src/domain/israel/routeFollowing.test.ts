// Port of IsraelRouteFollowingTests.swift (route following for an active Israel CVFR route).
import {
  advance,
  goBack,
  legPublishedAltitudesFeet,
  makeActiveRoute,
  makeLeg,
  type ActiveRoute,
} from '../route/activeRoute';
import {
  ALTITUDE_GRACE_SECONDS,
  DEFAULT_OFF_ROUTE_THRESHOLD_NM,
  configuredOffRouteThresholdNm,
  crossTrack,
  progress as followProgress,
} from './routeFollowing';

// Two legs: A (32.00N 34.80E) -> B (32.30N 34.80E), due north (18 NM), then B -> C (32.30N 35.10E), due east.
function route(altitudeA = '2500', offRouteNM = 1.0): ActiveRoute {
  const legs = [
    makeLeg({
      segmentID: 1,
      fromCode: 'AAAAA',
      toCode: 'BBBBB',
      fromLatitude: 32.0,
      fromLongitude: 34.8,
      toLatitude: 32.3,
      toLongitude: 34.8,
      altitudeText: altitudeA,
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
  ];
  return makeActiveRoute(legs, { offRouteThresholdNM: offRouteNM });
}

const t0 = 1_800_000_000_000;
/** 1 NM of longitude at latitude 32.15 in degrees. */
const degreesPerNMEast = 1 / (60 * Math.cos((32.15 * Math.PI) / 180));

function progress(
  r: ActiveRoute,
  lat: number,
  lon: number,
  opts: { altitude?: number | null; groundSpeed?: number; at?: number } = {},
) {
  const altitude = opts.altitude === undefined ? 2500 : opts.altitude;
  return followProgress(r, { lat, lon }, altitude, opts.groundSpeed ?? 100, opts.at ?? t0);
}
const sec = (s: number) => t0 + s * 1000;

describe('Cross-track and side', () => {
  test('eastOfANorthboundLegIsRightAndWestIsLeft', () => {
    const east = crossTrack({ lat: 32.15, lon: 34.8 + 0.8 * degreesPerNMEast }, [
      [32.0, 34.8],
      [32.3, 34.8],
    ]);
    expect(east?.side).toBe('R');
    expect(Math.abs((east?.distanceNM ?? 99) - 0.8)).toBeLessThan(0.02);
    const west = crossTrack({ lat: 32.15, lon: 34.8 - 0.8 * degreesPerNMEast }, [
      [32.0, 34.8],
      [32.3, 34.8],
    ]);
    expect(west?.side).toBe('L');
    expect(Math.abs((west?.distanceNM ?? 99) - 0.8)).toBeLessThan(0.02);
  });

  test('crossTrackUsesTheNearestSegmentOfABentLeg', () => {
    const bent = [
      [32.0, 34.8],
      [32.3, 34.8],
      [32.3, 35.1],
    ];
    const result = crossTrack({ lat: 32.3 + 0.5 / 60, lon: 34.95 }, bent);
    expect(Math.abs((result?.distanceNM ?? 99) - 0.5)).toBeLessThan(0.02);
    expect(result?.side).toBe('L');
  });

  test('needs two usable vertices (JS guard for short vertex rows)', () => {
    expect(crossTrack({ lat: 32, lon: 34.8 }, [[32.0, 34.8]])).toBeNull();
    expect(crossTrack({ lat: 32, lon: 34.8 }, [[32.0], [32.3, 34.8]])).toBeNull();
    expect(crossTrack({ lat: 32, lon: 34.8 }, [])).toBeNull();
  });

  test('a zero-length segment measures to its point', () => {
    const r = crossTrack({ lat: 32.0 + 1 / 60, lon: 34.8 }, [
      [32.0, 34.8],
      [32.0, 34.8],
    ]);
    expect(r?.distanceNM).toBeCloseTo(1, 3);
  });

  test('offRouteCautionFollowsTheThreshold', () => {
    const beyond = progress(route(), 32.15, 34.8 + 1.5 * degreesPerNMEast);
    expect(beyond.route.following.isOffRoute).toBe(true);
    expect(beyond.route.following.side).toBe('R');
    const within = progress(route(), 32.15, 34.8 + 0.5 * degreesPerNMEast);
    expect(within.route.following.isOffRoute).toBe(false);
    // The pilot's own threshold: 2 NM makes the 1.5 NM fix on-route.
    const relaxed = progress(route('2500', 2.0), 32.15, 34.8 + 1.5 * degreesPerNMEast);
    expect(relaxed.route.following.isOffRoute).toBe(false);
  });
});

describe('Sequencing', () => {
  test('staysOnTheLegAwayFromTheToPoint', () => {
    const result = progress(route(), 32.15, 34.8);
    expect(result.route.currentLeg).toBe(0);
    expect(Math.abs((result.distanceToNextNM ?? 0) - 9)).toBeLessThan(0.1);
  });

  test('sequencesWithinHalfANauticalMileOfTheToPoint', () => {
    const result = progress(route(), 32.3 - 0.4 / 60, 34.8);
    expect(result.route.currentLeg).toBe(1);
    expect(result.route.legs[result.route.currentLeg].toCode).toBe('CCCCC');
  });

  test('doesNotSequenceJustOutsideHalfANauticalMile', () => {
    expect(progress(route(), 32.3 - 0.6 / 60, 34.8).route.currentLeg).toBe(0);
  });

  test('sequencesWhenAbeamThePointOffToTheSide', () => {
    // Past the end of the northbound leg, 0.8 NM east of it, 0.6 NM beyond B: 1.0 NM from B, abeam passed.
    expect(progress(route(), 32.3 + 0.6 / 60, 34.8 + 0.8 * degreesPerNMEast).route.currentLeg).toBe(1);
  });

  test('doesNotSequenceAbeamWhenFarFromThePoint', () => {
    // Beyond the end of the leg but 4 NM from B: not a pass of B.
    expect(progress(route(), 32.3 + 4.0 / 60, 34.8).route.currentLeg).toBe(0);
  });

  test('doesNotSequenceWithinAbeamLimitBeforeTheEndOfTheLeg', () => {
    // 1 NM short of B: inside the 2 NM abeam limit but the projection has not passed B.
    expect(progress(route(), 32.3 - 1.0 / 60, 34.8).route.currentLeg).toBe(0);
  });

  test('lastLegNeverSequencesPastTheEnd', () => {
    const result = progress(advance(route()), 32.3, 35.1);
    expect(result.route.currentLeg).toBe(1);
  });

  test('a fix can pass several short legs at once', () => {
    const legs = [0, 1, 2].map((i) =>
      makeLeg({
        segmentID: i,
        fromCode: `P${i}`,
        toCode: `P${i + 1}`,
        fromLatitude: 32 + i * 0.001,
        fromLongitude: 34.8,
        toLatitude: 32 + (i + 1) * 0.001,
        toLongitude: 34.8,
        altitudeText: '2500',
        distanceNM: 0.06,
      }),
    );
    const result = followProgress(makeActiveRoute(legs), { lat: 32.0031, lon: 34.8 }, 2500, 100, t0);
    expect(result.route.currentLeg).toBe(2);
  });

  test('an empty route returns no distance', () => {
    const result = followProgress(makeActiveRoute([]), { lat: 32, lon: 34.8 }, 2500, 100, t0);
    expect(result.distanceToNextNM).toBeNull();
    expect(result.route.following.crossTrackNM).toBeNull();
  });

  test('manualNextAndPreviousStayInBounds', () => {
    let r = route();
    r = goBack(r);
    expect(r.currentLeg).toBe(0);
    r = advance(r);
    expect(r.currentLeg).toBe(1);
    r = advance(r);
    expect(r.currentLeg).toBe(1);
    r = goBack(r);
    expect(r.currentLeg).toBe(0);
  });

  test('manualSequenceResetsTheFollowingStatus', () => {
    let r = progress(route(), 32.15, 34.8 + 1.5 * degreesPerNMEast).route;
    expect(r.following.isOffRoute).toBe(true);
    r = advance(r);
    expect(r.following.isOffRoute).toBe(false);
    expect(r.following.crossTrackNM).toBeNull();
  });
});

describe('Altitude', () => {
  test('altitudeCautionNeedsMoreThan30SecondsOutsideTheBand', () => {
    let r = route();
    // 2850 ft against 2500: +350, outside +/-300.
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: t0 }).route;
    expect(r.following.altitudeDeviationFeet).toBe(350);
    expect(r.following.isAltitudeCaution).toBe(false);
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: sec(29) }).route;
    expect(r.following.isAltitudeCaution).toBe(false);
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: sec(31) }).route;
    expect(r.following.isAltitudeCaution).toBe(true);
  });

  test('exactly 30 seconds is not yet a caution (strictly greater)', () => {
    let r = progress(route(), 32.15, 34.8, { altitude: 2850, at: t0 }).route;
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: sec(ALTITUDE_GRACE_SECONDS) }).route;
    expect(r.following.isAltitudeCaution).toBe(false);
  });

  test('exactly 300 ft is inside the band', () => {
    const r = progress(route(), 32.15, 34.8, { altitude: 2800 }).route;
    expect(r.following.altitudeDeviationFeet).toBe(300);
    expect(r.following.altitudeDeviationSince).toBeNull();
  });

  test('returningInsideTheBandResetsTheTimer', () => {
    let r = route();
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: t0 }).route;
    r = progress(r, 32.15, 34.8, { altitude: 2700, at: sec(20) }).route;
    expect(r.following.altitudeDeviationSince).toBeNull();
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: sec(40) }).route;
    r = progress(r, 32.15, 34.8, { altitude: 2850, at: sec(60) }).route;
    expect(r.following.isAltitudeCaution).toBe(false); // only 20 s since the second excursion began
  });

  test('twoNumberAltitudeComparesAgainstBoth', () => {
    let r = route('2500/3500');
    // 3600 is 100 ft from 3500: fine. 3000 is 500 from both: caution once 30 s pass.
    r = progress(r, 32.15, 34.8, { altitude: 3600, at: t0 }).route;
    expect(r.following.altitudeDeviationFeet).toBe(100);
    r = progress(r, 32.15, 34.8, { altitude: 3000, at: sec(40) }).route;
    r = progress(r, 32.15, 34.8, { altitude: 3000, at: sec(80) }).route;
    expect(r.following.isAltitudeCaution).toBe(true);
  });

  test('noAltitudeCautionNearDepartureOrDestination', () => {
    let r = route();
    // 2 NM north of A, 800 ft: far below 2500, but inside the 3 NM climb-out window.
    const nearDeparture = 32.0 + 2.0 / 60;
    r = progress(r, nearDeparture, 34.8, { altitude: 800, at: t0 }).route;
    r = progress(r, nearDeparture, 34.8, { altitude: 800, at: sec(60) }).route;
    expect(r.following.isAltitudeCaution).toBe(false);
    expect(r.following.altitudeDeviationFeet).toBeNull();

    // The destination is the end of the last leg: 2 NM west of C on the last leg.
    let last = advance(route());
    const nearDestination = 35.1 - 2.0 * degreesPerNMEast;
    last = progress(last, 32.3, nearDestination, { altitude: 1200, at: t0 }).route;
    last = progress(last, 32.3, nearDestination, { altitude: 1200, at: sec(60) }).route;
    expect(last.following.isAltitudeCaution).toBe(false);
  });

  test('cautionRunsOnceClearOfTheTerminalWindow', () => {
    let r = route();
    const enRoute = 32.0 + 5.0 / 60; // 5 NM from A
    r = progress(r, enRoute, 34.8, { altitude: 1800, at: t0 }).route;
    r = progress(r, enRoute, 34.8, { altitude: 1800, at: sec(31) }).route;
    expect(r.following.isAltitudeCaution).toBe(true);
    expect(r.following.altitudeDeviationFeet).toBe(-700);
  });

  test('unknownAltitudeNeverRaisesTheCaution', () => {
    let r = route();
    r = progress(r, 32.15, 34.8, { altitude: null, at: t0 }).route;
    r = progress(r, 32.15, 34.8, { altitude: null, at: sec(120) }).route;
    expect(r.following.isAltitudeCaution).toBe(false);
    expect(r.following.altitudeDeviationFeet).toBeNull();
  });

  test('a leg with no published altitude clears the deviation', () => {
    const r = progress(route('---'), 32.15, 34.8, { altitude: 5000 }).route;
    expect(r.following.altitudeDeviationFeet).toBeNull();
  });
});

describe('ETA and thresholds', () => {
  test('etaIsDistanceOverGroundSpeedAndNilWhenSlow', () => {
    const fast = progress(route(), 32.15, 34.8, { groundSpeed: 90 }); // 9 NM at 90 kt = 6 min
    expect(Math.abs((fast.route.following.nextPointETA ?? 0) - t0 - 360_000)).toBeLessThan(5000);
    const slow = progress(route(), 32.15, 34.8, { groundSpeed: 10 });
    expect(slow.route.following.nextPointETA).toBeNull();
    const boundary = progress(route(), 32.15, 34.8, { groundSpeed: 30 });
    expect(boundary.route.following.nextPointETA).toBeNull();
  });

  test('publishedAltitudesParseSingleAndTwoNumberText', () => {
    expect(legPublishedAltitudesFeet(route().legs[0])).toEqual([2500]);
    expect(legPublishedAltitudesFeet(route('2500/3500').legs[0])).toEqual([2500, 3500]);
    expect(legPublishedAltitudesFeet(route('---').legs[0])).toEqual([]);
  });

  test('configuredOffRouteThresholdNm falls back to the shared default (re-exported, not duplicated)', () => {
    expect(DEFAULT_OFF_ROUTE_THRESHOLD_NM).toBe(1.0);
    expect(configuredOffRouteThresholdNm(null)).toBe(1.0);
    expect(configuredOffRouteThresholdNm(0)).toBe(1.0);
    expect(configuredOffRouteThresholdNm(Number.NaN)).toBe(1.0);
    expect(configuredOffRouteThresholdNm(2.5)).toBe(2.5);
  });
});
