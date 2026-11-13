// The pure parts of the Israel flight plan port (logic.ts). Not Swift test ports: the Swift cases are in
// israelFlightPlanViewModel.test.ts. The mailto block pins the issue #39 deviation: the FPL draft goes to ais@iaa.gov.il.
import { newAircraftProfile, newPilotProfile } from '../../../data/defaults';
import { FILING_ADDRESS, type IsraelFlightPlanInput } from '../../../domain/israel/flightPlanMessage';
import { IsraelRoutePlanner, makeRouteOptions } from '../../../domain/israel/routePlanner';
import { makeRouteClosure } from '../../../services/israelNotam';
import { FIXTURE_AERODROMES, FIXTURE_POINTS, FIXTURE_SEGMENTS, planAerodrome, planPoint, planSegment } from './fixture';
import {
  activeProfile,
  closureText,
  cautionBadgeText,
  computePlan,
  cruiseSpeedKnots,
  defaultDeparture,
  departureClockText,
  departureDateText,
  israelDayMirror,
  israelTimeMirror,
  flightPlanMailURL,
  israelEpoch,
  withDialogDay,
  withDialogTime,
  legRows,
  mailtoEncode,
  messageInput,
  pickedDeparture,
  planActivation,
  plannableAerodromes,
  searchableQuery,
  summaryCells,
  viaRefusal,
  windyURL,
  withIsraelDay,
  withIsraelTime,
} from './logic';

const NOW = Date.UTC(2026, 10, 12, 6, 26);

const input = (o: Partial<IsraelFlightPlanInput> = {}): IsraelFlightPlanInput => ({
  registration: '4X-CXA',
  cruiseSpeedKnots: 100,
  departure: NOW,
  picName: 'Israel Israeli',
  email: 'pilot@example.com',
  ...o,
});

describe('flightPlanMailURL (issue #39: addressed to the IAA, never to the pilot)', () => {
  const FPL = '(FPL-4XCXA-VG\n-C172/L-S/C\n-LLHZ0700)';

  test('pins the recipient, subject and encoded body', () => {
    expect(flightPlanMailURL(FPL, input())).toBe(
      'mailto:ais@iaa.gov.il?subject=FPL%204XCXA&body=%28FPL-4XCXA-VG%0D%0A-C172%2FL-S%2FC%0D%0A-LLHZ0700%29',
    );
  });

  test('the recipient is the filing address', () => {
    expect(FILING_ADDRESS).toBe('ais@iaa.gov.il');
    const url = flightPlanMailURL(FPL, input())!;
    expect(url.startsWith(`mailto:${FILING_ADDRESS}?`)).toBe(true);
    expect(new URL(url).pathname).toBe('ais@iaa.gov.il');
  });

  test('no pilot address leaks into the link, as To, Cc, Bcc or anywhere else', () => {
    for (const email of ['pilot@example.com', 'ais@pilot.example', 'someone+fpl@iaa.gov.il']) {
      const url = flightPlanMailURL(FPL, input({ email }))!;
      expect(url).not.toContain(email);
      expect(url).not.toContain(encodeURIComponent(email));
      const parsed = new URL(url);
      expect(parsed.pathname).toBe(FILING_ADDRESS);
      expect([...parsed.searchParams.keys()]).toEqual(['subject', 'body']);
    }
  });

  test('the same link with or without a pilot e-mail', () => {
    expect(flightPlanMailURL(FPL, input({ email: null }))).toBe(flightPlanMailURL(FPL, input()));
  });

  test('the subject carries the normalised registration', () => {
    expect(new URL(flightPlanMailURL(FPL, input({ registration: 'hlh' }))!).searchParams.get('subject')).toBe(
      'FPL 4XHLH',
    );
  });

  test('the body round-trips with CRLF line breaks (RFC 6068)', () => {
    const body = new URL(flightPlanMailURL(FPL, input())!).searchParams.get('body');
    expect(body).toBe(FPL.replace(/\n/g, '\r\n'));
  });

  test('text in the body cannot add a header or a recipient', () => {
    const hostile = 'RMK/A&cc=evil@example.com?to=x+y=z#frag';
    const url = flightPlanMailURL(hostile, input())!;
    const parsed = new URL(url);
    expect([...parsed.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(parsed.searchParams.get('body')).toBe(hostile);
    expect(parsed.hash).toBe('');
  });

  test('no message, no link', () => {
    expect(flightPlanMailURL('', input())).toBeNull();
  });

  test('mailtoEncode leaves only unreserved characters', () => {
    expect(mailtoEncode("a b(c)!'*~-._\r\nd\re")).toBe('a%20b%28c%29%21%27%2A~-._%0D%0Ad%0D%0Ae');
  });
});

describe('defaults and pickers', () => {
  test('defaultDeparture is the next full hour at least 30 minutes ahead', () => {
    expect(defaultDeparture(Date.UTC(2026, 10, 12, 6, 26))).toBe(Date.UTC(2026, 10, 12, 7));
    expect(defaultDeparture(Date.UTC(2026, 10, 12, 6, 31))).toBe(Date.UTC(2026, 10, 12, 8));
    expect(defaultDeparture(Date.UTC(2026, 10, 12, 6, 30))).toBe(Date.UTC(2026, 10, 12, 7));
    expect(defaultDeparture(Date.UTC(2026, 10, 12, 6))).toBe(Date.UTC(2026, 10, 12, 7));
  });

  test('cruiseSpeedKnots falls back to 100 without a positive profile speed', () => {
    expect(cruiseSpeedKnots(null)).toBe(100);
    expect(cruiseSpeedKnots(newAircraftProfile('4X-A', { cruiseSpeedKts: 0 }))).toBe(100);
    expect(cruiseSpeedKnots(newAircraftProfile('4X-A', { cruiseSpeedKts: 95 }))).toBe(95);
  });

  test('activeProfile: the active one, else the only one', () => {
    const a = newAircraftProfile('A');
    const b = newAircraftProfile('B', { isActive: true });
    expect(activeProfile([a, b])).toBe(b);
    expect(activeProfile([a])).toBe(a);
    expect(activeProfile([a, newAircraftProfile('C')])).toBeNull();
    expect(activeProfile([])).toBeNull();
  });

  test('searchableQuery needs two characters after trimming', () => {
    expect(searchableQuery(' L ')).toBeNull();
    expect(searchableQuery(' LL ')).toBe('LL');
    expect(searchableQuery('רא')).toBe('רא');
  });

  test('plannableAerodromes drops military and foreign aerodromes', () => {
    const list = [
      planAerodrome('LLHZ', { lat: 0, lon: 0 }),
      planAerodrome('LLRD', { lat: 0, lon: 0, use: 'military' }),
      planAerodrome('OJAI', { lat: 0, lon: 0, use: 'foreign' }),
      planAerodrome('UL1', { lat: 0, lon: 0, use: 'ultralight' }),
    ];
    expect(plannableAerodromes(list).map((a) => a.code)).toEqual(['LLHZ', 'UL1']);
  });

  test('viaRefusal names the network', () => {
    expect(viaRefusal('NOPE', 'cvfr')).toBe('NOPE is not a reporting point of the CVFR network.');
  });

  test('pickedDeparture keeps a future pick and refuses a past one: never before now', () => {
    expect(pickedDeparture(NOW + 15 * 60_000, NOW)).toBe(NOW + 15 * 60_000);
    expect(pickedDeparture(NOW - 24 * 3_600_000, NOW)).toBe(NOW);
  });

  test('the date and time pills read Israel local time, en_US', () => {
    expect(departureDateText(Date.UTC(2026, 10, 12, 8))).toBe('Nov 12, 2026');
    expect(departureClockText(Date.UTC(2026, 10, 12, 8))).toBe('10:00 AM');
    expect(departureClockText(Date.UTC(2026, 10, 12, 22, 5))).toBe('12:05 AM');
    expect(departureDateText(Date.UTC(2026, 10, 12, 22, 5))).toBe('Nov 13, 2026');
    expect(departureClockText(Date.UTC(2026, 10, 12, 13, 30))).toBe('3:30 PM');
  });

  test('israelEpoch is the inverse of the Israel wall clock, winter and summer time', () => {
    expect(israelEpoch(2026, 11, 12, 10, 0)).toBe(Date.UTC(2026, 10, 12, 8));
    expect(israelEpoch(2026, 7, 1, 10, 0)).toBe(Date.UTC(2026, 6, 1, 7));
  });

  test('the date pill keeps the time of day, the time pill keeps the day (Israel local)', () => {
    const departure = Date.UTC(2026, 10, 12, 8); // Nov 12 10:00 Israel
    expect(withIsraelDay(departure, Date.UTC(2026, 10, 14, 21, 30))).toBe(Date.UTC(2026, 10, 14, 8)); // picked Nov 14 23:30
    expect(withIsraelTime(departure, Date.UTC(2026, 10, 20, 12, 45))).toBe(Date.UTC(2026, 10, 12, 12, 45)); // 14:45
  });

  test('the Android dialog mirrors show the Israel date at local noon and the Israel time on a fixed date', () => {
    const departure = Date.UTC(2026, 10, 12, 8); // Nov 12 10:00 Israel
    const day = israelDayMirror(departure);
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours(), day.getMinutes()]).toEqual([
      2026, 10, 12, 12, 0,
    ]);
    const time = israelTimeMirror(departure);
    expect([time.getHours(), time.getMinutes()]).toEqual([10, 0]);
    expect(withDialogDay(departure, new Date(2026, 10, 14, 12, 0))).toBe(Date.UTC(2026, 10, 14, 8));
    expect(withDialogTime(departure, new Date(2000, 0, 15, 14, 45))).toBe(Date.UTC(2026, 10, 12, 12, 45));
  });

  test('the dialog mirrors are anchored away from any device DST change, so the device zone cannot alter the Israel fields', () => {
    // The old mirror (the Israel wall clock as a device-local Date) skipped or repeated an hour on the DEVICE's own DST
    // change: Israel Mar 14 2027 02:30 became 03:30 on a New York device. The time mirror is fixed on Jan 15 2000 and the
    // day mirror is local noon, neither of which is a DST change in any zone.
    const gap = Date.UTC(2027, 2, 14, 0, 30); // Israel Mar 14 2027 02:30, a US device-DST gap
    const time = israelTimeMirror(gap);
    expect([time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), time.getMinutes()]).toEqual([
      2000, 0, 15, 2, 30,
    ]);
    expect(withDialogTime(gap + 3_600_000, time)).toBe(gap);
    const day = israelDayMirror(gap);
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours(), day.getMinutes()]).toEqual([
      2027, 2, 14, 12, 0,
    ]);
    expect(withDialogDay(gap, day)).toBe(gap);
    // Every quarter hour across the Israel DST changes round-trips through both mirrors.
    for (const base of [Date.UTC(2027, 2, 25, 0), Date.UTC(2027, 9, 30, 0)]) {
      for (let q = 0; q < 12 * 4 * 2; q++) {
        const epoch = base + q * 900_000;
        const t = israelTimeMirror(epoch);
        expect(departureClockText(withDialogTime(epoch + 86_400_000 * 3, t))).toBe(departureClockText(epoch));
        expect(departureDateText(withDialogDay(epoch, israelDayMirror(epoch)))).toBe(departureDateText(epoch));
      }
    }
  });

  test('the repeated Israel hour: the instant is kept when the day or the time is unchanged, a new wall time takes the first occurrence', () => {
    // Oct 31 2027: Israel repeats 01:00 to 01:59 (summer time ends at 02:00 IDT = 23:00Z Oct 30).
    const first = Date.UTC(2027, 9, 30, 22, 30); // 01:30 IDT, the first occurrence
    const second = Date.UTC(2027, 9, 30, 23, 30); // 01:30 IST, the second
    expect(withIsraelTime(first, first)).toBe(first);
    expect(withIsraelTime(second, second)).toBe(second);
    expect(withIsraelDay(first, first)).toBe(first);
    expect(withIsraelDay(second, Date.UTC(2027, 9, 30, 23, 45))).toBe(second);
    expect(withDialogTime(second, israelTimeMirror(second))).toBe(second);
    expect(withDialogDay(second, israelDayMirror(second))).toBe(second);
    // A wall time entered afresh is ambiguous: the first occurrence.
    expect(israelEpoch(2027, 10, 31, 1, 30)).toBe(first);
    expect(withIsraelDay(Date.UTC(2027, 9, 29, 22, 30), Date.UTC(2027, 9, 30, 22, 30))).toBe(first);
    // Outside the repeat nothing changes.
    expect(israelEpoch(2026, 11, 12, 10, 0)).toBe(Date.UTC(2026, 10, 12, 8));
  });
});

describe('messageInput', () => {
  test('profiles fill the message; endurance from capacity and burn; the override wins for persons on board', () => {
    const aircraft = newAircraftProfile('4X-CXA', {
      icaoTypeDesignator: 'C172',
      aircraftType: 'Cessna 172S',
      cruiseSpeedKts: 105,
      fuelCapacityGallons: 50,
      fuelBurnGPH: 10,
      personsOnBoard: 2,
    });
    const pilot = newPilotProfile({ name: 'P', certificateNumber: '1', phone: '050', email: 'p@x' });
    const result = messageInput({ aircraft, pilot, personsOnBoardOverride: 3, departure: NOW });
    expect(result).toEqual({
      registration: '4X-CXA',
      typeDesignator: 'C172',
      typeDescription: 'Cessna 172S',
      cruiseSpeedKnots: 105,
      enduranceSeconds: 5 * 3600,
      personsOnBoard: 3,
      departure: NOW,
      picName: 'P',
      licenseNumber: '1',
      phone: '050',
      email: 'p@x',
    });
  });

  test('missing profiles leave the fields empty', () => {
    const result = messageInput({ aircraft: null, pilot: null, personsOnBoardOverride: null, departure: NOW });
    expect(result.registration).toBe('');
    expect(result.picName).toBe('');
    expect(result.enduranceSeconds).toBeNull();
    expect(result.personsOnBoard).toBeNull();
    expect(result.cruiseSpeedKnots).toBe(100);
  });
});

describe('closureText', () => {
  const base = {
    notamId: 'A1/26',
    routeKind: 'CVFR',
    routeName: null,
    chain: ['A', 'B'],
    validFrom: null,
    schedule: null,
  };

  test('full closure with an end today, another day, or none', () => {
    expect(closureText(makeRouteClosure({ ...base, validTo: Date.UTC(2026, 10, 12, 13, 30) }), NOW)).toBe(
      'CLSD to 13:30Z',
    );
    expect(closureText(makeRouteClosure({ ...base, validTo: Date.UTC(2026, 10, 3, 13, 30) }), NOW)).toBe(
      'CLSD to 3 Nov 13:30Z',
    );
    expect(closureText(makeRouteClosure({ ...base, validTo: null }), NOW)).toBe('CLSD');
  });

  test('partial closure lists closed and open altitudes, or EXC', () => {
    const partial = makeRouteClosure({
      ...base,
      validTo: null,
      partial: true,
      closedAltitudes: [{ op: 'AT', lowerFt: 2500, upperFt: null, ref: 'MSL' }],
      availableAltitudes: [{ op: 'AT', lowerFt: 3000, upperFt: null, ref: 'MSL', direction: null }],
    });
    expect(closureText(partial, NOW)).toBe('CLSD 2500 \u00B7 AVBL 3000');
    const exceptions = makeRouteClosure({ ...base, validTo: null, partial: true, exceptions: ['PPR FLT FM IAF'] });
    expect(closureText(exceptions, NOW, '1h20m')).toBe('CLSD EXC (data 1h20m old)');
  });

  test('an unread closure says CHECK NOTAM without an end', () => {
    const check = makeRouteClosure({ ...base, validTo: Date.UTC(2026, 10, 12, 13, 30), parsed: false });
    expect(closureText(check, NOW)).toBe('CHECK NOTAM');
  });
});

describe('plan text and activation (fixture route LLHZ -> LLIB)', () => {
  const planner = new IsraelRoutePlanner(FIXTURE_POINTS, FIXTURE_SEGMENTS);
  const plan = planner.route('LLHZ', 'LLIB', 100, makeRouteOptions({ departure: NOW }));

  test('summaryCells', () => {
    expect(summaryCells(plan)).toEqual([
      { label: 'DIST', value: '68.1 NM' },
      { label: 'ETE', value: '0:40' },
      { label: 'TAS', value: '100 KT' },
      { label: 'LEGS', value: '12' },
    ]);
  });

  test('legRows: route, published altitude for the direction flown, NM and minutes', () => {
    const rows = legRows(plan);
    expect(rows[0]).toEqual({
      key: '125-0',
      route: 'LLHZ \u2192 BAZRA',
      altitude: '800',
      distance: '3.4',
      eteMinutes: '2',
      badges: [],
    });
    expect(rows[1].altitude).toBe('800/1600');
  });

  test('cautionBadgeText adds the closure text and NOTAM id', () => {
    expect(cautionBadgeText({ kind: 'partialClosure', notamID: 'A1/26', text: 'CLSD 2500' })).toEqual({
      text: 'PARTIAL CLSD \u00B7 CLSD 2500 (A1/26)',
      blocksFiling: false,
    });
    expect(cautionBadgeText({ kind: 'checkNotam', notamID: 'A2/26' })).toEqual({
      text: 'CHECK NOTAM A2/26',
      blocksFiling: true,
    });
    expect(cautionBadgeText({ kind: 'military' })).toEqual({ text: 'MILITARY', blocksFiling: true });
  });

  test('windyURL from the first to the last point', () => {
    expect(windyURL(plan)).toBe('https://www.windy.com/distance/32.1794/34.8344/32.9806/35.5708');
    expect(windyURL(null)).toBeNull();
  });

  test('planActivation: legs with paths, first-leg distance, time and bearing, fuel at the burn rate', () => {
    const activation = planActivation(plan, newAircraftProfile('4X-CXA', { fuelBurnGPH: 9 }))!;
    expect(activation.activeRoute.legs).toHaveLength(12);
    expect(activation.activeRoute.currentLeg).toBe(0);
    expect(activation.activeRoute.legs[0]).toMatchObject({
      segmentID: 125,
      fromCode: 'LLHZ',
      toCode: 'BAZRA',
      altitudeText: '800',
    });
    expect(activation.activeRoute.legs[0].path).toEqual([
      [32.179444, 34.834444],
      [32.218611, 34.8825],
    ]);
    expect(activation.planDeparture).toBe('LLHZ');
    expect(activation.planDestination).toBe('LLIB');
    expect(activation.distanceToNext).toBeCloseTo(plan.legs[0].distanceNM);
    expect(activation.bearingToNext).toBeGreaterThan(40);
    expect(activation.bearingToNext).toBeLessThan(50);
    expect(activation.fuelGallons).toBeCloseTo((plan.legs.reduce((s, l) => s + l.eteSeconds, 0) / 3600) * 9);
    expect(planActivation(plan, null)!.fuelGallons).toBeNull();
  });

  test('computePlan without a feed: routed, closures not checked, message built', async () => {
    const outcome = await computePlan({
      departure: FIXTURE_AERODROMES[0],
      destination: FIXTURE_AERODROMES[1],
      via: [],
      network: 'cvfr',
      loaded: { points: FIXTURE_POINTS, segments: FIXTURE_SEGMENTS },
      report: null,
      departureTime: NOW,
      allowByRequest: false,
      allowMilitary: false,
      dayOverride: 'none',
      cruiseSpeedKnots: 100,
      input: input(),
      nowMs: NOW,
    });
    expect(outcome.plan?.legs).toHaveLength(12);
    expect(outcome.closuresChecked).toBe(false);
    expect(outcome.issues).toContainEqual({ kind: { kind: 'closuresNotChecked' }, blocksFiling: false });
    expect(outcome.fplText.startsWith('(FPL-4XCXA-VG')).toBe(true);
    expect(outcome.routeError).toBeNull();
  });

  test('computePlan through a via point the network does not know gives the error, not a throw', async () => {
    const a = planPoint(1, 'LLHZ', { kind: 'arp', lat: 32, lon: 34.8 });
    const b = planPoint(2, 'LLIB', { kind: 'arp', lat: 33, lon: 35.5 });
    const outcome = await computePlan({
      departure: planAerodrome('LLHZ', { lat: 32, lon: 34.8 }),
      destination: planAerodrome('LLIB', { lat: 33, lon: 35.5 }),
      via: ['NOPE'],
      network: 'cvfr',
      loaded: { points: [a, b], segments: [planSegment(1, a, b, { nm: 60 })] },
      report: null,
      departureTime: NOW,
      allowByRequest: false,
      allowMilitary: false,
      dayOverride: 'none',
      cruiseSpeedKnots: 100,
      input: input(),
      nowMs: NOW,
    });
    expect(outcome.plan).toBeNull();
    expect(outcome.routeError?.info).toEqual({ kind: 'unknownPoint', code: 'NOPE' });
    expect(outcome.fplText).toBe('');
  });
});
