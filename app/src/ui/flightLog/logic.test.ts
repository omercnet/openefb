// Ports of FlightLogNextTests.swift, PredictionRowsTests.swift and the FlightLogStrip cases of
// LiveNavigationProgressTests.swift / MapGPSRecordingFixesTests.swift. Same names, inputs and expected values.
import type { PredictedEvent, PredictedKind, PredictedSeverity } from '../../domain/prediction';
import { makeActiveRoute, makeLeg } from '../../domain/route';
import {
  FlightLogVisibility,
  altitudeText,
  clockText,
  deviceTimeZone,
  nextDataSpoken,
  nextDataText,
  nextIdent,
  nextItemId,
  nextItemSeconds,
  nextItems,
  offRouteText,
  predictionsOn,
  printfFixed,
  holdText,
  routeTitle,
  scaleTop,
  spokenAssumption,
  spokenDuration,
  spokenEvent,
  spokenTitle,
  splitNext,
  tapeFloor,
  timeToText,
  type NavState,
  type NextItem,
} from './logic';

const noNav: NavState = {
  directTo: null,
  activeFlightPlan: false,
  activeRoute: null,
  planDeparture: null,
  planDestination: null,
};

describe('Flight log NEXT data line (FlightLogNextTests)', () => {
  const utc = 'UTC';
  /** 2026-01-01 15:41:00 UTC, epoch ms. */
  const eta = 1_767_282_060_000;

  test('freshFixShowsFormattedValues', () => {
    const args = { distanceNM: 18.4, bearingTrue: 41, eta, timeZone: utc, stale: false };
    expect(nextDataText(args)).toBe('18.4 NM \u00B7 041\u00B0 \u00B7 ETA 15:41');
    expect(nextDataSpoken(args)).toBe('18.4 NM \u00B7 041\u00B0 \u00B7 ETA 15:41');
  });

  test('staleFixDashesEverything', () => {
    const text = nextDataText({ distanceNM: 18.4, bearingTrue: 41, eta, timeZone: utc, stale: true });
    expect(text).toBe('--- NM \u00B7 ---\u00B0 \u00B7 ETA ---');
    expect(text.includes('18.4') || text.includes('041') || text.includes('15:41')).toBe(false);
  });

  test('staleFixAnnouncesNoNumbersAndSaysStale', () => {
    const spoken = nextDataSpoken({ distanceNM: 18.4, bearingTrue: 41, eta, timeZone: utc, stale: true });
    expect(spoken.endsWith(', stale')).toBe(true);
    expect(spoken.includes('18.4') || spoken.includes('041') || spoken.includes('15:41')).toBe(false);
  });

  test('missingValuesDash', () => {
    const args = { distanceNM: null, bearingTrue: null, eta: null, stale: false };
    expect(nextDataText(args)).toBe('--- NM \u00B7 ---\u00B0 \u00B7 ETA ---');
    expect(nextDataSpoken(args)).toBe('');
  });

  test('partialValuesDashOnlyTheMissingOnes', () => {
    const args = { distanceNM: 3.2, bearingTrue: null, eta: null, stale: false };
    expect(nextDataText(args)).toBe('3.2 NM \u00B7 ---\u00B0 \u00B7 ETA ---');
    expect(nextDataSpoken(args)).toBe('3.2 NM');
  });
});

describe('Flight log prediction rows (PredictionRowsTests)', () => {
  const event = (
    volume: string,
    seconds: number,
    {
      kind = 'floor',
      severity = 'caution',
      limit = 3000,
      title = 'B floor 3,000',
    }: { kind?: PredictedKind; severity?: PredictedSeverity; limit?: number | null; title?: string } = {},
  ): PredictedEvent => ({
    volumeID: volume,
    kind,
    severity,
    secondsAhead: seconds,
    coordinate: { lat: 37.5, lon: -122.2 },
    limitFeetMSL: limit,
    title,
    assumption: 'at 312\u00B0, +300 fpm',
  });
  const ids = (items: NextItem[]) => items.map(nextItemId);

  // Order

  test('eventFirstWhenSooner', () => {
    const items = nextItems([event('B', 110)], [676, 900]);
    expect(ids(items)).toEqual(['event/B/floor', 'waypoint/0', 'waypoint/1']);
  });

  test('waypointFirstWhenSooner', () => {
    const items = nextItems([event('B', 372)], [120, 676]);
    expect(ids(items)).toEqual(['waypoint/0', 'event/B/floor', 'waypoint/1']);
  });

  test('mergesInTimeOrderAndKeepsRouteOrder', () => {
    const events = [event('C', 500), event('B', 110)]; // unsorted on purpose
    const items = nextItems(events, [300, 450, 700]);
    expect(ids(items)).toEqual(['event/B/floor', 'waypoint/0', 'waypoint/1', 'event/C/floor', 'waypoint/2']);
    expect(items.map(nextItemSeconds)).toEqual([110, 300, 450, 500, 700]);
  });

  test('eventWinsATie', () => {
    const items = nextItems([event('B', 300)], [300]);
    expect(ids(items)).toEqual(['event/B/floor', 'waypoint/0']);
  });

  test('waypointWithoutTimeNeverGoesAheadOfAnEvent', () => {
    const items = nextItems([event('B', 590)], [null, null]);
    expect(ids(items)).toEqual(['event/B/floor', 'waypoint/0', 'waypoint/1']);
  });

  test('noEventsLeavesTheRouteAsIs', () => {
    // Predictions off or a stale fix: AppState holds no events, so only the route remains.
    const items = nextItems([], [120, 676]);
    expect(ids(items)).toEqual(['waypoint/0', 'waypoint/1']);
  });

  test('eventsWithoutNavigation', () => {
    const items = nextItems([event('B', 110)], []);
    expect(ids(items)).toEqual(['event/B/floor']);
  });

  // Cap

  test('capsLaterRowsAndCountsTheRest', () => {
    const items = nextItems([event('B', 110), event('C', 372)], [300, 450, 700, 900]);
    const iPad = splitNext(items, 3);
    expect(iPad.top && nextItemId(iPad.top)).toBe('event/B/floor');
    expect(ids(iPad.later)).toEqual(['waypoint/0', 'event/C/floor', 'waypoint/1']);
    expect(iPad.hiddenCount).toBe(2);

    const rail = splitNext(items, 2);
    expect(rail.later.length).toBe(2);
    expect(rail.hiddenCount).toBe(3);
  });

  test('emptySplit', () => {
    const split = splitNext([], 3);
    expect(split.top).toBeNull();
    expect(split.later).toEqual([]);
    expect(split.hiddenCount).toBe(0);
  });

  // Tape floor

  test('tapeFloorIsTheSoonestFloorOrBoundaryAboveTheSurface', () => {
    const events = [
      event('P4', 60, { kind: 'lateral', severity: 'warning', limit: 0, title: 'P 4' }), // surface: no floor
      event('D', 90, { kind: 'ceiling', limit: 2500, title: 'D ceiling 2,500' }), // a ceiling
      event('C', 400, { limit: 1500, title: 'B floor 1,500' }),
      event('B', 110),
    ];
    const floor = tapeFloor(events);
    expect(floor?.feet).toBe(3000);
    expect(floor?.secondsAhead).toBe(110);
    expect(floor?.label).toBe('B floor 3,000');
    expect(tapeFloor([])).toBeNull();
  });

  test('scaleKeepsTheFloorOnTheTape', () => {
    expect(scaleTop(2450, 3000)).toBe(4000);
    expect(scaleTop(2450, 3600)).toBe(5000);
    expect(scaleTop(2450, 4000)).toBe(5000);
    expect(scaleTop(5000, 3000)).toBe(10000);
    expect(scaleTop(2450)).toBe(4000);
  });

  // Text

  test('spokenEventStatesSeverityTimeAndAssumption', () => {
    expect(spokenEvent(event('B', 110))).toBe(
      'Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold track 312 and climb 300 feet per minute',
    );
    const restricted: PredictedEvent = {
      volumeID: 'R',
      kind: 'lateral',
      severity: 'warning',
      secondsAhead: 125,
      coordinate: { lat: 32, lon: 35 },
      limitFeetMSL: null,
      title: 'P 4',
      assumption: 'at 041\u00B0, -500 fpm',
    };
    expect(spokenEvent(restricted)).toBe(
      'Warning, P 4 in 2 minutes 5 seconds, if you hold track 041 and descend 500 feet per minute',
    );
  });

  test('assumptionLines', () => {
    expect(holdText('at 312\u00B0, +300 fpm')).toBe('If you hold 312\u00B0 and +300 fpm');
    expect(holdText('at 312\u00B0, level')).toBe('If you hold 312\u00B0 and level');
    expect(spokenAssumption('at 312\u00B0, level')).toBe('if you hold track 312 and stay level');
    expect(spokenTitle('CTR LLHA')).toBe('CTR LLHA');
  });

  test('spokenTitleOnlyNamesAirspaceClasses', () => {
    expect(spokenTitle('D 5')).toBe('D 5');
    expect(spokenTitle('A')).toBe('A');
    expect(spokenTitle('D')).toBe('Class D');
    expect(spokenTitle('B floor 3,000')).toBe('Class B floor 3,000 feet');
    expect(spokenTitle('C ceiling 4,000')).toBe('Class C ceiling 4,000 feet');
  });

  /** The map reads the toggle the way the Layers switch stores it, and "YES" from a launch argument. */
  test('predictionsToggleReadsStoredAndLaunchArgumentValues', () => {
    const defaults = new Map<string, unknown>();
    const read = (key: string) => defaults.get(key);
    expect(predictionsOn(read)).toBe(FlightLogVisibility.predictionsDefault);
    defaults.set(FlightLogVisibility.predictionsKey, 'YES');
    expect(predictionsOn(read)).toBe(true);
    defaults.set(FlightLogVisibility.predictionsKey, false);
    expect(predictionsOn(read)).toBe(false);
  });
});

describe('Live navigation progress (LiveNavigationProgressTests, FlightLogStrip cases)', () => {
  /** A Direct-To taken during a route is the next waypoint everywhere it is shown. */
  test('directToIsTheNextWaypointOverAnActiveRoute', () => {
    const activeRoute = makeActiveRoute([
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
    ]);
    expect(nextIdent({ ...noNav, activeRoute, activeFlightPlan: true, directTo: 'KSQL' })).toBe('KSQL');
  });
});

describe('Clear Direct-To (MapGPSRecordingFixesTests, routeTitle assertions)', () => {
  // The NearestAirportViewModel.setDirectTo / clearDirectTo and AppState.clearActiveNavigation steps belong to U4 and
  // the AppState spine; here the AppState they leave behind is written out and only routeTitle is checked.
  test('clearRemovesDirectToAndStripValues', () => {
    expect(routeTitle({ ...noNav, directTo: 'KSQL', activeFlightPlan: true })).toBe('DIRECT KSQL');
    expect(routeTitle(noNav)).toBeNull();
  });

  test('clearAlsoDropsARouteSummary', () => {
    const plan = { ...noNav, activeFlightPlan: true, planDeparture: 'KPAO', planDestination: 'KSQL' };
    expect(routeTitle(plan)).toBe('KPAO \u2192 KSQL');
  });
});

// Characterisation of the remaining static text functions (no Swift test of their own).
describe('FlightLogStrip text helpers', () => {
  test('timeToText and spokenDuration: m:ss under an hour, h:mm above', () => {
    expect(timeToText(552)).toBe('9:12');
    expect(timeToText(676.4)).toBe('11:16');
    expect(timeToText(3900)).toBe('1:05');
    expect(timeToText(-5)).toBe('0:00');
    expect(spokenDuration(676)).toBe('11 minutes 16 seconds');
    expect(spokenDuration(110)).toBe('1 minute 50 seconds');
    expect(spokenDuration(3900)).toBe('1 hour 5 minutes');
  });

  test('clockText is 24 h in the given zone', () => {
    expect(clockText(1_767_282_060_000, 'UTC')).toBe('15:41');
    expect(clockText(1_767_282_060_000, 'Asia/Jerusalem')).toBe('17:41');
    expect(clockText(Date.UTC(2026, 10, 9, 2, 11, 0), 'America/Los_Angeles')).toBe('18:11');
  });

  test('clockText dashes a non-finite time or a missing part', () => {
    expect(clockText(Infinity, 'UTC')).toBe('---');
    expect(clockText(NaN, 'UTC')).toBe('---');
    const spy = jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([]);
    try {
      expect(clockText(1_767_282_060_000, 'UTC')).toBe('---');
    } finally {
      spy.mockRestore();
    }
  });

  test('clockText falls back to the device zone for an unknown zone', () => {
    const ms = 1_767_282_060_000;
    expect(() => clockText(ms, 'Not/AZone')).not.toThrow();
    expect(clockText(ms, 'Not/AZone')).toBe(clockText(ms, deviceTimeZone()));
  });

  test('clockText builds one formatter per zone', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    try {
      clockText(0, 'Pacific/Auckland');
      clockText(60_000, 'Pacific/Auckland');
      clockText(120_000, 'Pacific/Auckland');
      expect(spy.mock.calls.filter((c) => c[1]?.timeZone === 'Pacific/Auckland').length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('printfFixed rounds exact halves to even like %.Nf', () => {
    expect(printfFixed(348.5, 0)).toBe('348');
    expect(printfFixed(349.5, 0)).toBe('350');
    expect(printfFixed(0.25, 1)).toBe('0.2');
    expect(printfFixed(14.94, 1)).toBe('14.9');
  });

  test('printfFixed: only exact binary halves are ties', () => {
    const cases: [number, number, string][] = [
      [0.35, 1, '0.3'],
      [0.45, 1, '0.5'],
      [0.05, 1, '0.1'],
      [1.15, 1, '1.1'],
      [0.25, 1, '0.2'],
      [0.75, 1, '0.8'],
      [2.5, 0, '2'],
      [3.5, 0, '4'],
      [348.5, 0, '348'],
      [349.5, 0, '350'],
      [0.125, 2, '0.12'],
      [0.375, 2, '0.38'],
      [-0.25, 1, '-0.2'],
      [-2.5, 0, '-2'],
      [-0.04, 1, '-0.0'],
    ];
    for (const [value, digits, text] of cases)
      expect([value, digits, printfFixed(value, digits)]).toEqual([value, digits, text]);
  });

  test('printfFixed does not throw on NaN or infinities', () => {
    expect(() => [NaN, Infinity, -Infinity].map((v) => printfFixed(v, 1))).not.toThrow();
    expect([NaN, Infinity, -Infinity].map((v) => printfFixed(v, 1))).toEqual(['nan', 'inf', '-inf']);
  });

  test('printfFixed matches an exact round-half-even oracle on every hundredth 0.00 to 300.00', () => {
    const view = new DataView(new ArrayBuffer(8));
    /** %.1f from the exact IEEE-754 value: mantissa * 2^exponent as a BigInt rational, round half to even. */
    const oracle = (x: number): string => {
      view.setFloat64(0, x);
      const bits = view.getBigUint64(0);
      const biased = Number((bits >> 52n) & 0x7ffn);
      const fraction = bits & ((1n << 52n) - 1n);
      const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
      const exponent = (biased === 0 ? 1 : biased) - 1075;
      let num = mantissa * 10n;
      let den = 1n;
      if (exponent >= 0) num <<= BigInt(exponent);
      else den <<= BigInt(-exponent);
      let q = num / den;
      const twice = 2n * (num % den);
      if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
      return `${q / 10n}.${q % 10n}`;
    };
    const wrong: string[] = [];
    for (let i = 0; i <= 30000; i += 1) {
      const x = i / 100;
      if (printfFixed(x, 1) !== oracle(x)) wrong.push(`${x}: ${printfFixed(x, 1)} != ${oracle(x)}`);
    }
    expect(wrong).toEqual([]);
  });

  test('routeTitle for a CVFR route names the next point, its altitude and the destination', () => {
    const activeRoute = makeActiveRoute([
      makeLeg({
        fromCode: 'LLHZ',
        toCode: 'MIDAA',
        toLatitude: 0,
        toLongitude: 0,
        altitudeText: '1500',
        distanceNM: 9,
      }),
      makeLeg({
        fromCode: 'MIDAA',
        toCode: 'LLIB',
        toLatitude: 0,
        toLongitude: 0,
        altitudeText: '2500',
        distanceNM: 30,
      }),
    ]);
    const nav = { ...noNav, activeFlightPlan: true, activeRoute, planDeparture: 'LLHZ', planDestination: 'LLIB' };
    expect(routeTitle(nav)).toBe('\u2192 MIDAA 1500 FT \u00B7 LLIB');
    expect(nextIdent(nav)).toBe('MIDAA');
    expect(nextIdent({ ...nav, activeRoute: null })).toBe('LLIB');
    expect(nextIdent({ ...nav, activeFlightPlan: false })).toBeNull();
  });

  test('offRouteText and altitudeText', () => {
    const following = {
      crossTrackNM: 0.84,
      side: 'R' as const,
      isOffRoute: true,
      altitudeDeviationFeet: -349.6,
      altitudeDeviationSince: null,
      isAltitudeCaution: true,
      nextPointETA: null,
    };
    expect(offRouteText(following)).toBe('0.8 NM RIGHT OF ROUTE');
    expect(offRouteText({ ...following, side: 'L' })).toBe('0.8 NM LEFT OF ROUTE');
    expect(offRouteText({ ...following, side: null })).toBeNull();
    expect(altitudeText(following, '2500')).toBe('350 FT LOW \u00B7 FLY 2500');
    expect(altitudeText({ ...following, altitudeDeviationFeet: 350 }, '2500')).toBe('350 FT HIGH \u00B7 FLY 2500');
    expect(altitudeText({ ...following, altitudeDeviationFeet: null }, '2500')).toBeNull();
  });
});
