// Port of IsraelLSAPlannerTests.swift: the planner's sport-aviation weekend rules and the LSA message cases. The weekend
// state table is in lsaTimeRules.test.ts; closure kinds per network are in closureMarks.test.ts; the bundled-network case is
// tests/domain/israel/routePlannerDb.test.ts.
import type {
  IsraelReportingPoint,
  IsraelRouteActivity,
  IsraelRouteNetwork,
  IsraelRouteSegment,
} from '../../data/aviation/israelTypes';
import { hebrewSummary, validate } from './flightPlanMessage';
import type { IsraelDayOverride } from './lsaTimeRules';
import {
  IsraelRouteError,
  IsraelRoutePlanner,
  makeRouteOptions,
  planIsFileable,
  planPointCodes,
  type IsraelRoutePlan,
} from './routePlanner';

/** Local Israel time (UTC+2 in November) as an absolute instant. */
const israel = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 10, day, hour - 2, minute);

// 2026-11-04 Wednesday, 06 Friday, 07 Saturday, 08 Sunday.
const wednesday = israel(4, 10);
const fridayMorning = israel(6, 10);
const fridayAfternoon = israel(6, 15);
const saturday = israel(7, 10);

const codes = ['A', 'B', 'C', 'D'];

function points(network: IsraelRouteNetwork = 'lsa'): IsraelReportingPoint[] {
  return codes.map((code, index) => ({
    id: index + 1,
    code,
    nameEnglish: code,
    nameHebrew: null,
    kind: 'compulsory',
    latitude: 32.0 + index * 0.01,
    longitude: 34.8,
    network,
  }));
}

function segment(
  id: number,
  from: string,
  to: string,
  nm: number,
  activity: IsraelRouteActivity,
  o: { network?: IsraelRouteNetwork; smallOnly?: boolean; source?: string | null } = {},
): IsraelRouteSegment {
  const index = (code: string): number => Math.max(codes.indexOf(code), 0) + 1;
  return {
    id,
    fromCode: from,
    toCode: to,
    fromPointID: index(from),
    toPointID: index(to),
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: nm,
    isCivil: true,
    isMilitary: false,
    isByRequest: false,
    bearingTrue: 90,
    altitudeForward: { published: '1500', feet: 1500 },
    altitudeReverse: { published: '1500', feet: 1500 },
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: 32.0, lon: 34.8 },
      { lat: 32.0, lon: 34.9 },
    ],
    network: o.network ?? 'lsa',
    activity,
    activitySource: o.source ?? null,
    smallOnly: o.smallOnly ?? false,
  };
}

// A-B-C is the short way (20 NM) and weekend-only; A-D-C is the longer way (30 NM) and open all week.
const diamond = [
  segment(1, 'A', 'B', 10, 'weekend'),
  segment(2, 'B', 'C', 10, 'weekend'),
  segment(3, 'A', 'D', 15, 'all_week'),
  segment(4, 'D', 'C', 15, 'all_week'),
];

const planner = (segments: IsraelRouteSegment[]) => new IsraelRoutePlanner(points(), segments);

function route(
  p: IsraelRoutePlanner,
  departure: number | null,
  speed = 90,
  dayOverride: IsraelDayOverride = 'none',
): IsraelRoutePlan {
  return p.route('A', 'C', speed, makeRouteOptions({ departure, dayOverride }));
}

describe('Israel LSA planner', () => {
  test('aWeekdayDepartureLeavesOutTheWeekendOnlyRoutes', () => {
    const plan = route(planner(diamond), wednesday);
    expect(planPointCodes(plan)).toEqual(['A', 'D', 'C']);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('aSaturdayDepartureUsesTheShortWeekendRoute', () => {
    const plan = route(planner(diamond), saturday);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planIsFileable(plan)).toBe(true);
    expect(plan.legs.every((l) => l.cautions.length === 0)).toBe(true);
  });

  test('fridayMorningKeepsTheRouteButBlocksFilingBecauseTheStartIsUnconfirmed', () => {
    const plan = route(planner(diamond), fridayMorning);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(plan.legs.every((l) => l.cautions.length === 1 && l.cautions[0].kind === 'weekendStartUnconfirmed')).toBe(
      true,
    );
    expect(planIsFileable(plan)).toBe(false);
    const issues = validate(plan);
    expect(issues).toContainEqual({ kind: { kind: 'weekendStartUnconfirmed', value: 'A-B' }, blocksFiling: true });
  });

  test('fridayAfternoonIsInUseByEveryPublishedRule', () => {
    const plan = route(planner(diamond), fridayAfternoon);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('aFlightThatCrossesTheEndOfSaturdayBlocksFilingOnTheLegAfterMidnight', () => {
    // 5 kt: each 10 NM leg takes 2 h. Departing Saturday 23:00, the second leg starts Sunday 01:00.
    const plan = route(planner(diamond), israel(7, 23), 5);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(plan.legs[0].cautions).toEqual([]);
    expect(plan.legs[1].cautions).toEqual([{ kind: 'notInUse' }]);
    expect(planIsFileable(plan)).toBe(false);
    expect(validate(plan)).toContainEqual({ kind: { kind: 'notInUse', value: 'B-C' }, blocksFiling: true });
  });

  test('aDeclaredHolidayLetsAWeekdayDepartureUseTheWeekendRoutes', () => {
    const plan = route(planner(diamond), wednesday, 90, 'holiday');
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('whenOnlyWeekendRoutesConnectThePointsTheReasonIsNotInUse', () => {
    const p = planner([segment(1, 'A', 'B', 10, 'weekend'), segment(2, 'B', 'C', 10, 'weekend')]);
    let thrown: unknown;
    try {
      route(p, wednesday);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(IsraelRouteError);
    const error = thrown as IsraelRouteError;
    expect(error.info).toEqual({ kind: 'noRoute', from: 'A', to: 'C', reason: 'notInUse' });
    expect(error.message).toContain('weekend');
  });

  test('withoutADepartureTheTimeRulesAreNotApplied', () => {
    expect(planPointCodes(route(planner(diamond), null))).toEqual(['A', 'B', 'C']);
  });

  test('specialAndUnspecifiedRoutesCarryANonBlockingCautionWithTheLayersText', () => {
    const p = planner([
      segment(1, 'A', 'B', 10, 'special', { source: 'מיוחד' }),
      segment(2, 'B', 'C', 10, 'unspecified', { source: 'C' }),
    ]);
    const plan = route(p, wednesday);
    expect(plan.legs.map((l) => l.cautions)).toEqual([
      [{ kind: 'specialConditions', text: 'מיוחד' }],
      [{ kind: 'specialConditions', text: 'C' }],
    ]);
    expect(planIsFileable(plan)).toBe(true);
    expect(validate(plan).every((i) => !i.blocksFiling)).toBe(true);
  });

  test('smallAircraftOnlyRoutesAreMarked', () => {
    const p = planner([
      segment(1, 'A', 'B', 10, 'all_week', { smallOnly: true }),
      segment(2, 'B', 'C', 10, 'all_week'),
    ]);
    const plan = route(p, wednesday);
    expect(plan.legs.map((l) => l.cautions)).toEqual([[{ kind: 'smallAircraftOnly' }], []]);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('cvfrSegmentsIgnoreTheWeekendRule', () => {
    const segments = diamond.map((s) =>
      segment(s.id, s.fromCode, s.toCode, s.lengthNM ?? 0, 'weekend', { network: 'cvfr' }),
    );
    const p = new IsraelRoutePlanner(points('cvfr'), segments);
    const plan = route(p, wednesday);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('theHebrewSummaryNamesTheNetworkTheRouteIsFlownOn', () => {
    const input = { registration: '4X-ABC', cruiseSpeedKnots: 90, departure: saturday, picName: 'Test Pilot' };
    const lsa = route(planner(diamond), saturday);
    expect(hebrewSummary(lsa, input).startsWith('תכנית טיסה בנתיבי התעופה הספורטיבית')).toBe(true);
    const cvfrPlanner = new IsraelRoutePlanner(points('cvfr'), [
      segment(1, 'A', 'B', 10, 'unspecified', { network: 'cvfr' }),
      segment(2, 'B', 'C', 10, 'unspecified', { network: 'cvfr' }),
    ]);
    const cvfr = route(cvfrPlanner, saturday);
    expect(hebrewSummary(cvfr, input).startsWith('תכנית טיסה בנתיבי התובלה הנמוכים')).toBe(true);
  });
});
