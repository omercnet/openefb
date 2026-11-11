// Port of IsraelFlightPlanMessageTests.swift.
import type { IsraelPointKind, IsraelReportingPoint, IsraelRouteSegment } from '../../data/aviation/israelTypes';
import {
  canFile,
  fpl,
  hebrewSummary,
  hhmm,
  isICAOLocation,
  issueMessage,
  registrationField,
  validate,
  type IsraelFlightPlanInput,
  type IsraelFlightPlanIssue,
} from './flightPlanMessage';
import { IsraelRoutePlanner, makeRouteOptions, type IsraelRouteLeg, type IsraelRoutePlan } from './routePlanner';

function point(
  id: number,
  code: string,
  kind: IsraelPointKind = 'compulsory',
  he: string | null = null,
): IsraelReportingPoint {
  return {
    id,
    code,
    nameEnglish: code,
    nameHebrew: he,
    kind,
    latitude: 32.0 + id * 0.01,
    longitude: 34.8,
    network: 'cvfr',
  };
}

function segment(
  id: number,
  from: IsraelReportingPoint,
  to: IsraelReportingPoint,
  o: { nm?: number; forward?: string | null; reverse?: string | null; byRequest?: boolean; military?: boolean } = {},
): IsraelRouteSegment {
  const forward = o.forward === undefined ? '1500' : o.forward;
  const reverse = o.reverse === undefined ? '2000' : o.reverse;
  const alt = (p: string | null) => (p === null ? null : { published: p, feet: Number(p) });
  return {
    id,
    fromCode: from.code,
    toCode: to.code,
    fromPointID: from.id,
    toPointID: to.id,
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: o.nm ?? 10,
    isCivil: !o.military,
    isMilitary: o.military ?? false,
    isByRequest: o.byRequest ?? false,
    bearingTrue: 0,
    altitudeForward: alt(forward),
    altitudeReverse: alt(reverse),
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: from.latitude, lon: from.longitude },
      { lat: to.latitude, lon: to.longitude },
    ],
    network: 'cvfr',
    activity: 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

/** 29 Sep 2022 11:00 UTC, the AIP's example departure. */
const departure = 1_664_449_200_000;

function route(stops: IsraelReportingPoint[]): IsraelRoutePlan {
  const segments = stops.slice(1).map((to, i) => segment(i + 1, stops[i], to));
  return new IsraelRoutePlanner(stops, segments).route(stops[0].code, stops[stops.length - 1].code, 90);
}

function input(o: Partial<IsraelFlightPlanInput> = {}): IsraelFlightPlanInput {
  return {
    registration: 'HLH',
    typeDesignator: 'ULAC',
    typeDescription: null,
    cruiseSpeedKnots: 90,
    enduranceSeconds: 4 * 3600,
    personsOnBoard: 2,
    departure,
    picName: 'Israel Israeli',
    licenseNumber: '1234',
    phone: '054-123 4567',
    ...o,
  };
}

describe('FPL text', () => {
  test('goldenMessageMatchesTheAIPExampleLayout', () => {
    const plan = route([point(1, 'LLRS', 'arp'), point(2, 'NTAIM'), point(3, 'NSHRM'), point(4, 'LLMG', 'arp')]);
    const expected = [
      '(FPL-4XHLH-VG',
      '-ULAC/L-S/C',
      '-LLRS1100',
      '-N0090VFR NTAIM NSHRM',
      '-LLMG0020',
      '-DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567',
      '-E/0400 P/002)',
    ].join('\n');
    expect(fpl(plan, input())).toBe(expected);
  });

  test('nonICAOStripsUseZZZZWithDepAndDestInField18', () => {
    const plan = route([point(1, 'GVULT', 'arp'), point(2, 'NTAIM'), point(3, 'KKDEM', 'arp')]);
    const expected = [
      '(FPL-4XABC-VG',
      '-C172/L-S/C',
      '-ZZZZ1100',
      '-N0090VFR NTAIM',
      '-ZZZZ0014',
      '-DEP/GVULT DEST/KKDEM DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567',
      '-E/0400 P/002)',
    ].join('\n');
    expect(fpl(plan, input({ registration: 'ABC', typeDesignator: 'C172' }))).toBe(expected);
  });

  test('mixedICAOAndStripKeepsTheICAOCodeAndZZZZOnlyWhereNeeded', () => {
    const text = fpl(route([point(1, 'LLHZ', 'arp'), point(2, 'GVULT', 'arp')]), input());
    expect(text).toContain('\n-LLHZ1100\n');
    expect(text).toContain('\n-N0090VFR DCT\n');
    expect(text).toContain('\n-ZZZZ0007\n');
    expect(text).toContain('-DEST/GVULT DOF/220929 RMK/');
    expect(text).not.toContain('DEP/');
  });

  test('missingTypeDesignatorFallsBackToZZZZWithTYP', () => {
    const text = fpl(
      route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]),
      input({ typeDesignator: null, typeDescription: 'Cessna 172SP' }),
    );
    expect(text).toContain('\n-ZZZZ/L-S/C\n');
    expect(text).toContain('-TYP/CESSNA 172SP DOF/220929 RMK/');
  });

  test('missingEnduranceAndPersonsAreOmittedNotInvented', () => {
    const text = fpl(
      route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]),
      input({ enduranceSeconds: null, personsOnBoard: null }),
    );
    expect(text.endsWith('CELL 0541234567)')).toBe(true);
    expect(text).not.toContain('E/');
    expect(text).not.toContain('P/');
  });

  test('persons without endurance stands alone on the last line', () => {
    const text = fpl(route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]), input({ enduranceSeconds: null }));
    expect(text.endsWith('\n-P/002)')).toBe(true);
  });

  test('registrationGetsThe4XPrefixOnlyWhenShort', () => {
    expect(registrationField('HLH')).toBe('4XHLH');
    expect(registrationField('4X-HLH')).toBe('4XHLH');
    expect(registrationField('4xabc')).toBe('4XABC');
    expect(registrationField('N4543A')).toBe('N4543A');
    expect(registrationField('')).toBe('');
    expect(registrationField(' - ')).toBe('');
  });

  test('icaoLocationMeansFourLettersStartingLL', () => {
    expect(isICAOLocation('LLHZ')).toBe(true);
    expect(isICAOLocation('llhz')).toBe(true);
    expect(isICAOLocation('GVULT')).toBe(false);
    expect(isICAOLocation('NAAN')).toBe(false);
    expect(isICAOLocation('KSQL')).toBe(false);
    expect(isICAOLocation('LL12')).toBe(false);
  });

  test('free text is folded to upper-case ASCII (accents dropped, hyphens and brackets split nothing)', () => {
    const plan = route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]);
    const text = fpl(plan, input({ picName: 'Zoë (Ben-Ami) Müller', licenseNumber: 'A-12' }));
    expect(text).toContain('RMK/PIC ZOE BEN AMI MULLER LICENSE A 12 CELL');
  });

  test('an empty plan gives empty text', () => {
    const empty: IsraelRoutePlan = { legs: [], cruiseSpeedKnots: 90 };
    expect(fpl(empty, input())).toBe('');
    expect(hebrewSummary(empty, input())).toBe('');
  });

  test('hhmm clamps negatives and floors to whole minutes', () => {
    expect(hhmm(-5)).toBe('0000');
    expect(hhmm(3599)).toBe('0059');
    expect(hhmm(4 * 3600)).toBe('0400');
    expect(hhmm(Number.NaN)).toBe('0000');
  });
});

describe('Hebrew summary', () => {
  test('hebrewSummaryUsesLocalIsraelTimeAndHebrewNames', () => {
    const plan = route([point(1, 'LLHZ', 'arp', 'הרצליה'), point(2, 'NTAIM'), point(3, 'LLIB', 'arp', 'ראש פינה')]);
    const f = '\u2068';
    const p = '\u2069';
    // 11:00 UTC on 29 Sep 2022 is 14:00 in Israel (IDT); 20 NM at 90 kt lands 14:13.
    expect(hebrewSummary(plan, input())).toBe(
      [
        'תכנית טיסה בנתיבי התובלה הנמוכים',
        `המראה: ${f}הרצליה${p}, ${f}29.09.2022${p} בשעה ${f}14:00${p} זמן מקומי`,
        `נתיב: ${f}הרצליה${p} - ${f}NTAIM${p} - ${f}ראש פינה${p}`,
        `נחיתה: ${f}ראש פינה${p} בשעה ${f}14:13${p} זמן מקומי`,
      ].join('\n'),
    );
  });
});

describe('Validation', () => {
  const clean = () => route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]);
  const kinds = (issues: IsraelFlightPlanIssue[]) => issues.map((i) => i.kind);

  test('cleanRouteWithFullProfilesHasNoIssuesAndCanBeFiled', () => {
    const issues = validate(clean(), { input: input() });
    expect(issues).toEqual([]);
    expect(canFile(issues)).toBe(true);
  });

  test('byRequestAndMilitarySegmentsBlockFiling', () => {
    const [a, b, c] = [point(1, 'A'), point(2, 'B'), point(3, 'C')];
    const planner = new IsraelRoutePlanner(
      [a, b, c],
      [segment(1, a, b, { byRequest: true }), segment(2, b, c, { military: true })],
    );
    const plan = planner.route('A', 'C', 90, makeRouteOptions({ allowByRequest: true, allowMilitary: true }));
    const issues = validate(plan);
    expect(kinds(issues)).toEqual([
      { kind: 'byRequestSegment', value: 'A-B' },
      { kind: 'militarySegment', value: 'B-C' },
    ]);
    expect(canFile(issues)).toBe(false);
  });

  test('wrongWayLegBlocksFiling', () => {
    const [a, b] = [point(1, 'A'), point(2, 'B')];
    const oneWay = segment(1, a, b, { forward: '1500', reverse: null });
    // A hand-built plan flying B -> A against the published direction.
    const leg: IsraelRouteLeg = {
      segment: oneWay,
      from: b,
      to: a,
      forward: false,
      altitude: null,
      distanceNM: 10,
      eteSeconds: 400,
      cautions: [],
    };
    const issues = validate({ legs: [leg], cruiseSpeedKnots: 90 });
    expect(kinds(issues)).toEqual([{ kind: 'wrongWay', value: 'B-A' }]);
    expect(canFile(issues)).toBe(false);
  });

  test('closedSegmentBlocksFilingEvenWhenThePlanWasBuiltBeforeTheNotam', () => {
    const plan = clean();
    const issues = validate(plan, {
      closures: new Map([[plan.legs[0].segment.id, { kind: 'full', notamID: 'C1/26' }]]),
    });
    expect(kinds(issues)).toEqual([{ kind: 'closedSegment', value: 'LLHZ-LLIB (C1/26)' }]);
    expect(canFile(issues)).toBe(false);
  });

  test('a check closure blocks filing and names the NOTAM', () => {
    const plan = clean();
    const issues = validate(plan, {
      closures: new Map([[plan.legs[0].segment.id, { kind: 'check', notamID: 'C3/26' }]]),
    });
    expect(kinds(issues)).toEqual([{ kind: 'checkNotam', value: 'C3/26' }]);
    expect(canFile(issues)).toBe(false);
    expect(issueMessage(issues[0])).toContain('NOTAM C3/26 may close part of this route');
  });

  test('partialClosureWarnsWithoutBlocking', () => {
    const plan = clean();
    const issues = validate(plan, {
      closures: new Map([[plan.legs[0].segment.id, { kind: 'partial', notamID: 'C2/26', text: 'CLSD 2000' }]]),
    });
    expect(issues).toEqual([]);
  });

  test('uncheckedClosuresAndMissingProfileFieldsWarnButDoNotBlock', () => {
    const issues = validate(clean(), { closuresChecked: false, input: input({ enduranceSeconds: null, phone: null }) });
    expect(kinds(issues)).toEqual([
      { kind: 'closuresNotChecked' },
      { kind: 'missingAircraftField', value: 'endurance' },
      { kind: 'missingPilotField', value: 'phone' },
    ]);
    expect(canFile(issues)).toBe(true);
  });

  test('missingRegistrationBlocksFilingBecauseTheMessageHasNoAircraftId', () => {
    const issues = validate(clean(), { input: input({ registration: '' }) });
    expect(kinds(issues)).toEqual([{ kind: 'missingAircraftField', value: 'registration' }]);
    expect(canFile(issues)).toBe(false);
  });

  test('missingPilotNameBlocksFiling', () => {
    const issues = validate(clean(), { input: input({ picName: '  ' }) });
    expect(kinds(issues)).toEqual([{ kind: 'missingPilotField', value: 'name' }]);
    expect(canFile(issues)).toBe(false);
  });

  test('missing license and persons warn without blocking, in Swift order', () => {
    const issues = validate(clean(), { input: input({ licenseNumber: '', personsOnBoard: null }) });
    expect(kinds(issues)).toEqual([
      { kind: 'missingAircraftField', value: 'persons on board' },
      { kind: 'missingPilotField', value: 'license' },
    ]);
    expect(canFile(issues)).toBe(true);
  });

  test('unresolvedClosureBlocksFilingEvenWhenTheRouteIsOtherwiseClean', () => {
    const unresolved = [{ notamID: 'C7/26', unknownCodes: ['NOWHERE'], unmatchedLegs: [] }];
    const issues = validate(clean(), { unresolved });
    expect(kinds(issues)).toEqual([{ kind: 'unresolvedClosure', value: 'C7/26' }]);
    expect(issueMessage(issues[0]).startsWith('Unresolved closure: check NOTAM C7/26')).toBe(true);
    expect(canFile(issues)).toBe(false);
  });

  test('the same issue is reported once', () => {
    const [a, b, c] = [point(1, 'A'), point(2, 'B'), point(3, 'C')];
    const planner = new IsraelRoutePlanner([a, b, c], [segment(1, a, b), segment(2, b, c)]);
    const plan = planner.route('A', 'C', 90);
    const twice = { legs: [...plan.legs, plan.legs[0]], cruiseSpeedKnots: 90 };
    const closures = new Map([[1, { kind: 'check' as const, notamID: 'C3/26' }]]);
    expect(validate(twice, { closures })).toHaveLength(1);
  });
});

describe('review fixes', () => {
  test('a check-NOTAM caution on the plan blocks filing without a closure map', () => {
    const plan = route([point(1, 'LLHZ', 'arp'), point(2, 'LLIB', 'arp')]);
    const cautioned = {
      ...plan,
      legs: [{ ...plan.legs[0], cautions: [{ kind: 'checkNotam' as const, notamID: 'C3/26' }] }],
    };
    const issues = validate(cautioned);
    expect(issues).toEqual([{ kind: { kind: 'checkNotam', value: 'C3/26' }, blocksFiling: true }]);
    expect(canFile(issues)).toBe(false);
  });
});
