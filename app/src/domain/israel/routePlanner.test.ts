// Port of IsraelRoutePlannerTests.swift (fixtures, shortest path, direction, restrictions, closures, via points).
// The report-driven closure cases (`closures(from:)`) are in closureMarks.test.ts.
import type { IsraelReportingPoint, IsraelRouteSegment } from '../../data/aviation/israelTypes';
import {
  IsraelRouteError,
  IsraelRoutePlanner,
  legAltitudeText,
  legBearingTrue,
  legPolyline,
  makeRouteOptions,
  planIsFileable,
  planPointCodes,
  planTotalDistanceNM,
  planTotalETESeconds,
  type IsraelRoutePlan,
  type IsraelSegmentClosure,
} from './routePlanner';

const codes = ['A', 'B', 'C', 'D', 'E', 'F', 'Z'];

function points(): IsraelReportingPoint[] {
  return codes.map((code, index) => ({
    id: index + 1,
    code,
    nameEnglish: code,
    nameHebrew: null,
    kind: 'compulsory',
    latitude: 32.0 + index * 0.01,
    longitude: 34.8,
    network: 'cvfr',
  }));
}

const idOf = (code: string): number => Math.max(codes.indexOf(code), 0) + 1;

function segment(
  id: number,
  from: string,
  to: string,
  nm: number,
  o: { forward?: string | null; reverse?: string | null; military?: boolean; byRequest?: boolean } = {},
): IsraelRouteSegment {
  const forward = o.forward === undefined ? '1500' : o.forward;
  const reverse = o.reverse === undefined ? '2000' : o.reverse;
  const alt = (p: string | null) => (p === null ? null : { published: p, feet: Number(p) });
  return {
    id,
    fromCode: from,
    toCode: to,
    fromPointID: idOf(from),
    toPointID: idOf(to),
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: nm,
    isCivil: !o.military,
    isMilitary: o.military ?? false,
    isByRequest: o.byRequest ?? false,
    bearingTrue: 90,
    altitudeForward: alt(forward),
    altitudeReverse: alt(reverse),
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: 32.0, lon: 34.8 },
      { lat: 32.0, lon: 34.9 },
    ],
    network: 'cvfr',
    activity: 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

// A-B-C is the short way (20 NM); A-D-C is the detour (30 NM).
const diamond = [
  segment(1, 'A', 'B', 10),
  segment(2, 'B', 'C', 10),
  segment(3, 'A', 'D', 15),
  segment(4, 'D', 'C', 15),
];

const planner = (segments: IsraelRouteSegment[], closures: [number, IsraelSegmentClosure][] = []) =>
  new IsraelRoutePlanner(points(), segments, new Map(closures));

function noRoute(
  p: IsraelRoutePlanner,
  from: string,
  to: string,
  options = makeRouteOptions(),
): IsraelRouteError | null {
  try {
    p.route(from, to, 90, options);
    return null;
  } catch (e) {
    return e as IsraelRouteError;
  }
}

describe('Shortest path', () => {
  test('takesTheShortestOpenPathAndSumsDistanceAndEte', () => {
    const plan = planner(diamond).route('A', 'C', 90);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planTotalDistanceNM(plan)).toBe(20);
    expect(Math.abs(planTotalETESeconds(plan) - 800)).toBeLessThan(0.001); // 20 NM at 90 kt
    expect(planIsFileable(plan)).toBe(true);
  });

  test('eachLegCarriesTheAltitudePublishedForTheDirectionFlown', () => {
    const p = planner([segment(1, 'A', 'B', 10, { forward: '1500', reverse: '2000' })]);
    const out = p.route('A', 'B', 90);
    const back = p.route('B', 'A', 90);
    expect(legAltitudeText(out.legs[0])).toBe('1500');
    expect(legAltitudeText(back.legs[0])).toBe('2000');
    // Flown backwards, the leg's polyline and bearing run to -> from.
    expect(legBearingTrue(back.legs[0])).toBe(270);
    expect(legBearingTrue(out.legs[0])).toBe(90);
    expect(legPolyline(back.legs[0])).toEqual([
      { lat: 32.0, lon: 34.9 },
      { lat: 32.0, lon: 34.8 },
    ]);
  });

  test('sameStartAndEndGivesAnEmptyRoute', () => {
    expect(planner(diamond).route('A', 'A', 90).legs).toEqual([]);
  });

  test('codes match case-insensitively and a missing segment length falls back to the polyline', () => {
    const noLength = { ...segment(1, 'A', 'B', 10), lengthNM: null };
    const plan = planner([noLength]).route('a', 'b', 90);
    // 0.1 degree of longitude at 32N is about 5.08 NM
    expect(planTotalDistanceNM(plan)).toBeGreaterThan(5);
    expect(planTotalDistanceNM(plan)).toBeLessThan(5.2);
  });

  test('a segment naming a point the caller did not supply gets a synthetic point at the polyline end', () => {
    const plan = new IsraelRoutePlanner(points().slice(0, 1), [segment(1, 'A', 'B', 10)]).route('A', 'A', 90);
    expect(plan.legs).toEqual([]);
    const p = new IsraelRoutePlanner([points()[0], { ...points()[1], id: 99 }], [segment(1, 'A', 'B', 10)]);
    const routed = p.route('A', 'B', 90);
    expect(routed.legs[0].to.latitude).toBe(32.01);
  });

  test('a code shared by two points resolves to the copy the segments reference', () => {
    const dup: IsraelReportingPoint[] = [
      { ...points()[0], id: 50, latitude: 1 },
      { ...points()[0], id: 1, latitude: 2 },
    ];
    const p = new IsraelRoutePlanner([...dup, points()[1]], [segment(1, 'A', 'B', 10)]);
    expect(p.point('A')?.id).toBe(1);
  });
});

describe('Direction', () => {
  test('oneWaySegmentIsNotFlownAgainstItsPublishedDirection', () => {
    const p = planner([segment(1, 'E', 'A', 10, { forward: '1500', reverse: null })]);
    expect(planPointCodes(p.route('E', 'A', 90))).toEqual(['E', 'A']);
    expect(noRoute(p, 'A', 'E')?.info).toEqual({ kind: 'noRoute', from: 'A', to: 'E', reason: 'oneWay' });
  });

  test('returnRouteDiffersWhenASegmentIsOneWay', () => {
    // A -> B is one-way (10 NM); B back to A has to go round through F (22 NM).
    const p = planner([
      segment(1, 'A', 'B', 10, { forward: '1500', reverse: null }),
      segment(2, 'B', 'F', 10),
      segment(3, 'F', 'A', 12),
    ]);
    const out = p.route('A', 'B', 90);
    const back = p.returnRoute(out);
    expect(planPointCodes(out)).toEqual(['A', 'B']);
    expect(planPointCodes(back)).toEqual(['B', 'F', 'A']);
    expect(planTotalDistanceNM(back)).toBe(22);
  });

  test('returnRoute of an empty plan is the plan', () => {
    const empty: IsraelRoutePlan = { legs: [], cruiseSpeedKnots: 90 };
    expect(planner(diamond).returnRoute(empty)).toBe(empty);
  });
});

describe('By request and military', () => {
  test('byRequestSegmentsAreExcludedByDefault', () => {
    const p = planner([...diamond, segment(5, 'A', 'C', 5, { byRequest: true })]);
    expect(planPointCodes(p.route('A', 'C', 90))).toEqual(['A', 'B', 'C']);
  });

  test('byRequestOverrideTakesTheDashedShortcutButIsNotFileable', () => {
    const p = planner([...diamond, segment(5, 'A', 'C', 5, { byRequest: true })]);
    const plan = p.route('A', 'C', 90, makeRouteOptions({ allowByRequest: true }));
    expect(planPointCodes(plan)).toEqual(['A', 'C']);
    expect(plan.legs[0].cautions).toEqual([{ kind: 'byRequest' }]);
    expect(planIsFileable(plan)).toBe(false);
  });

  test('militarySegmentsNeedTheirOwnOverrideAndAreNotFileable', () => {
    const p = planner([segment(1, 'A', 'B', 10, { military: true })]);
    expect(noRoute(p, 'A', 'B')?.info).toEqual({ kind: 'noRoute', from: 'A', to: 'B', reason: 'restricted' });
    const plan = p.route('A', 'B', 90, makeRouteOptions({ allowMilitary: true }));
    expect(plan.legs[0].cautions).toEqual([{ kind: 'military' }]);
    expect(planIsFileable(plan)).toBe(false);
  });
});

describe('Closures', () => {
  test('fullClosureForcesTheDetour', () => {
    const plan = planner(diamond, [[2, { kind: 'full', notamID: 'C1/26' }]]).route('A', 'C', 90);
    expect(planPointCodes(plan)).toEqual(['A', 'D', 'C']);
    expect(planTotalDistanceNM(plan)).toBe(30);
  });

  test('partialClosureKeepsTheSegmentWithACautionThatDoesNotBlockFiling', () => {
    const closure: IsraelSegmentClosure = { kind: 'partial', notamID: 'C2/26', text: 'CLSD 2000 AVBL 3000' };
    const plan = planner(diamond, [[2, closure]]).route('A', 'C', 90);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(plan.legs[plan.legs.length - 1].cautions).toEqual([
      { kind: 'partialClosure', notamID: 'C2/26', text: 'CLSD 2000 AVBL 3000' },
    ]);
    expect(planIsFileable(plan)).toBe(true);
  });

  test('unreadClosureKeepsTheSegmentButBlocksFiling', () => {
    const plan = planner(diamond, [[2, { kind: 'check', notamID: 'C3/26' }]]).route('A', 'C', 90);
    expect(planPointCodes(plan)).toEqual(['A', 'B', 'C']);
    expect(planIsFileable(plan)).toBe(false);
  });

  test('noRouteNamesClosureAsTheReason', () => {
    const p = planner(diamond, [
      [2, { kind: 'full', notamID: 'C1/26' }],
      [4, { kind: 'full', notamID: 'C4/26' }],
    ]);
    const error = noRoute(p, 'A', 'C');
    expect(error?.info).toEqual({ kind: 'noRoute', from: 'A', to: 'C', reason: 'closed' });
    expect(error?.hebrewDescription).toBe('לא נמצא נתיב פתוח בין A ל-C');
    expect(error?.message).toBe('No open route between A and C: the only routes are closed by NOTAM.');
  });

  test('noRouteToAnIsolatedPointIsDisconnected', () => {
    const error = noRoute(planner(diamond), 'A', 'Z');
    expect(error?.info).toEqual({ kind: 'noRoute', from: 'A', to: 'Z', reason: 'disconnected' });
    expect(error?.message).toBe('No open route between A and Z.');
  });

  test('unknownPointIsReported', () => {
    const error = noRoute(planner(diamond), 'A', 'NOWHERE');
    expect(error?.info).toEqual({ kind: 'unknownPoint', code: 'NOWHERE' });
    expect(error?.message).toBe('NOWHERE is not on the route network.');
    expect(error?.hebrewDescription).toBe('NOWHERE אינה נקודה ברשת הנתיבים');
  });

  test('the reason text names each cause', () => {
    const p = planner([segment(1, 'A', 'B', 10, { forward: '1500', reverse: null })]);
    expect(noRoute(p, 'B', 'A')?.message).toContain('one-way');
    const q = planner([segment(1, 'A', 'B', 10, { byRequest: true })]);
    expect(noRoute(q, 'A', 'B')?.message).toContain('ATC or IAF approval');
  });
});

describe('Via points', () => {
  test('viaPointForcesThePathThroughIt', () => {
    expect(planPointCodes(planner(diamond).route('A', 'C', 90, makeRouteOptions(), ['D']))).toEqual(['A', 'D', 'C']);
  });

  test('viaPointOnTheShortPathAddsNothing', () => {
    expect(planPointCodes(planner(diamond).route('A', 'C', 90, makeRouteOptions(), ['B']))).toEqual(['A', 'B', 'C']);
  });

  test('a via point that is not on the network is reported before routing', () => {
    expect(() => planner(diamond).route('A', 'C', 90, makeRouteOptions(), ['NOWHERE'])).toThrow(IsraelRouteError);
  });
});
