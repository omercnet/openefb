// Port of efb-212Tests/ServiceTests/IsraelBriefingFilterTests.swift: flight window, distance, aerodrome filters and the
// closures-first order. Not ported here: the BriefingTimeFormat cases (Views/Briefing, U4) and the
// IsraelBriefingGeometry case (IsraelBriefingMapHighlight, M1); see docs/port-notes/L3b.md.
import { makeActiveRoute, makeLeg } from '../route/activeRoute';
import {
  briefingDistanceNM,
  briefingRouteAerodromes,
  briefingRouteFromActive,
  briefingRows,
  flightWindow,
  makeBriefingQuery,
  makeBriefingRoute,
  windowIncludes,
  type BriefingQuery,
  type BriefingReference,
  type BriefingWindow,
} from './briefingFilter';
import type { IsraelLatLon, IsraelNotam, IsraelRouteClosure } from './notamTypes';

// BriefingFixtures
const t0 = 1_800_000_000 * 1000;
const hours = (h: number): number => t0 + h * 3600 * 1000;

function fClosure(
  id: string,
  opts: { chain?: string[]; partial?: boolean; parsed?: boolean } = {},
): IsraelRouteClosure {
  return {
    notamId: id,
    routeKind: 'CVFR',
    routeName: null,
    chain: opts.chain ?? ['GALIM', 'DAROM'],
    validFrom: null,
    validTo: null,
    schedule: null,
    partial: opts.partial ?? null,
    parsed: opts.parsed ?? null,
  };
}

interface NotamOpts {
  location?: string;
  type?: string;
  created?: number | null;
  from?: number | null;
  to?: number | null;
  permanent?: boolean;
  e?: string;
  circle?: [IsraelLatLon, number];
  polygon?: IsraelLatLon[];
  closures?: IsraelRouteClosure[];
  cancelledBy?: string;
}

function notam(id: string, o: NotamOpts = {}): IsraelNotam {
  const location = o.location ?? 'LLLL';
  return {
    rowId: `row-${id}`,
    id,
    type: o.type ?? 'NOTAMN',
    references: null,
    location,
    locationDescription: null,
    created: o.created === undefined ? hours(-48) : o.created,
    q: null,
    a: location,
    validFrom: o.from === undefined ? hours(-1) : o.from,
    validTo: o.to === undefined ? hours(2) : o.to,
    permanent: o.permanent ?? false,
    estimated: false,
    d: null,
    e: o.e ?? 'TEXT',
    f: null,
    g: null,
    geometry: {
      polygon: o.polygon ?? null,
      circle: o.circle ? { centre: o.circle[0], radiusNM: o.circle[1] } : null,
    },
    closures: o.closures ?? [],
    parsed: true,
    cancelledBy: o.cancelledBy ?? null,
    replacedBy: null,
    raw: `RAW ${id}`,
  };
}

function query(
  o: {
    window?: BriefingWindow;
    reference?: BriefingReference;
    corridor?: number;
    aerodrome?: string;
    route?: string[];
  } = {},
): BriefingQuery {
  return makeBriefingQuery({
    window: o.window ?? { start: t0, end: hours(3) },
    reference: o.reference ?? { kind: 'none' },
    corridorNM: o.corridor ?? 25,
    aerodrome: o.aerodrome ?? '',
    routeAerodromes: new Set(o.route ?? []),
  });
}

describe('Israel briefing filter', () => {
  // MARK: Window

  test('windowIsDeparturePlusETEWhenPlanned', () => {
    const route = makeBriefingRoute({ codes: [], points: [], departure: hours(5), eteSeconds: 5400 });
    const window = flightWindow(route, t0);
    expect(window.start).toBe(hours(5));
    expect(window.end).toBe(hours(6.5));
  });

  test('windowDefaultsToNowPlusThreeHoursWithoutAPlan', () => {
    const noDeparture = makeBriefingRoute({ codes: [], points: [], departure: null, eteSeconds: null });
    for (const route of [null, noDeparture]) {
      const window = flightWindow(route, t0);
      expect(window.start).toBe(t0);
      expect(window.end).toBe(hours(3));
    }
  });

  test('validityTouchingTheWindowEdgesCounts', () => {
    const window = { start: t0, end: hours(3) };
    expect(windowIncludes(window, notam('A', { from: hours(-5), to: t0 }))).toBe(true); // ends exactly at start
    expect(windowIncludes(window, notam('B', { from: hours(3), to: hours(9) }))).toBe(true); // starts exactly at end
    expect(windowIncludes(window, notam('C', { from: hours(-5), to: hours(-0.01) }))).toBe(false); // ended before
    expect(windowIncludes(window, notam('D', { from: hours(3.01), to: hours(9) }))).toBe(false); // starts after
  });

  test('permanentNotamsAreAlwaysIncludedAndOpenEndsAreTreatedAsOpen', () => {
    const window = { start: t0, end: hours(3) };
    expect(windowIncludes(window, notam('P', { from: hours(-900), to: hours(-800), permanent: true }))).toBe(true);
    expect(windowIncludes(window, notam('O', { from: hours(-1), to: null }))).toBe(true);
  });

  // MARK: Order

  test('closuresComeFirstFullThenPartialThenCheckThenRouteAerodromesThenTheRest', () => {
    const notams = [
      notam('OTHER', { location: 'LLBG' }),
      notam('ROUTE-AD', { location: 'LLHZ' }),
      notam('UNDRAWN', { e: 'ATS RTE J14 CLSD' }),
      notam('UNPARSED', { closures: [fClosure('UNPARSED', { parsed: false })] }),
      notam('PARTIAL', { closures: [fClosure('PARTIAL', { partial: true })] }),
      notam('FULL', { closures: [fClosure('FULL')] }),
    ];
    const rows = briefingRows(notams, query({ route: ['LLHZ'] }));
    expect(rows.map((r) => r.notam.id)).toEqual(['FULL', 'PARTIAL', 'UNDRAWN', 'UNPARSED', 'ROUTE-AD', 'OTHER']);
    expect(rows.map((r) => r.section)).toEqual([
      'closures',
      'closures',
      'closures',
      'closures',
      'routeAerodromes',
      'other',
    ]);
  });

  test('aClosureWithNothingDrawableIsMarkedCheckNotam', () => {
    const rows = briefingRows([notam('J14', { e: 'ATS RTE J14 CLSD' })], query());
    expect(rows[0]?.needsCheck).toBe(true);
    expect(rows[0]?.closure).toBe('none');
  });

  test('aPlainNotamIsNotMarkedCheck', () => {
    const rows = briefingRows([notam('X', { e: 'RWY 12 CLSD' })], query());
    expect(rows[0]?.needsCheck).toBe(false);
  });

  test('supersededAndCancellationNotamsAreDropped', () => {
    const notams = [notam('OLD', { cancelledBy: 'C2/26' }), notam('CANCEL', { type: 'NOTAMC' }), notam('KEEP')];
    expect(briefingRows(notams, query()).map((r) => r.notam.id)).toEqual(['KEEP']);
  });

  // MARK: Aerodrome

  test('aerodromeFilterMatchesLocationOrMentionInEText', () => {
    const notams = [
      notam('HZ', { location: 'LLHZ' }),
      notam('FIR', { location: 'LLLL', e: 'ARR LLHZ PROC CHANGED' }),
      notam('BG', { location: 'LLBG' }),
    ];
    const rows = briefingRows(notams, query({ aerodrome: ' llhz ' }));
    expect(new Set(rows.map((r) => r.notam.id))).toEqual(new Set(['HZ', 'FIR']));
  });

  // MARK: Distance

  const ownship: IsraelLatLon = { lat: 32.0, lon: 34.8 };

  test('circleGapIsCentreDistanceMinusRadius', () => {
    // Centre 20 NM due north, radius 5 NM -> 15 NM gap.
    const north = { lat: 32.0 + 20.0 / 60.0, lon: 34.8 };
    const gap = briefingDistanceNM(notam('N', { circle: [north, 5] }), { kind: 'ownship', point: ownship });
    expect(gap).not.toBeNull();
    expect(Math.abs((gap ?? 0) - 15)).toBeLessThan(0.1);
  });

  test('corridorKeepsNotamsWithinItAndDropsTheRest', () => {
    const north = { lat: 32.0 + 20.0 / 60.0, lon: 34.8 };
    const notams = [notam('N', { circle: [north, 5] })];
    const tight = briefingRows(notams, query({ reference: { kind: 'ownship', point: ownship }, corridor: 10 }));
    const wide = briefingRows(notams, query({ reference: { kind: 'ownship', point: ownship }, corridor: 20 }));
    expect(tight).toEqual([]);
    expect(wide.map((r) => r.notam.id)).toEqual(['N']);
    const gap = wide[0]?.distanceNM ?? -1;
    expect(Math.abs(gap - 15)).toBeLessThan(0.1);
  });

  test('notamWithoutAnAreaIsKeptWhenFiltering', () => {
    const rows = briefingRows(
      [notam('NOAREA')],
      query({ reference: { kind: 'ownship', point: ownship }, corridor: 5 }),
    );
    expect(rows.map((r) => r.notam.id)).toEqual(['NOAREA']);
    expect(rows[0]?.distanceNM).toBeNull();
  });

  test('polygonCrossedByARouteLegIsInsideEvenWithNoRoutePointInIt', () => {
    const square = [
      { lat: 32.05, lon: 34.75 },
      { lat: 32.05, lon: 34.85 },
      { lat: 31.95, lon: 34.85 },
      { lat: 31.95, lon: 34.75 },
    ];
    const route = makeBriefingRoute({
      codes: ['A', 'B'],
      points: [
        { lat: 32.0, lon: 34.5 },
        { lat: 32.0, lon: 35.1 },
      ],
      departure: null,
      eteSeconds: null,
    });
    const gap = briefingDistanceNM(notam('POLY', { polygon: square }), { kind: 'route', route });
    expect(gap).toBe(0);
  });

  test('polygonBesideARouteIsMeasuredToItsNearestEdge', () => {
    // Square 0.1 deg wide whose south edge sits 6 NM north of an east-west route.
    const square = [
      { lat: 32.2, lon: 34.75 },
      { lat: 32.2, lon: 34.85 },
      { lat: 32.1, lon: 34.85 },
      { lat: 32.1, lon: 34.75 },
    ];
    const route = makeBriefingRoute({
      codes: ['A', 'B'],
      points: [
        { lat: 32.0, lon: 34.5 },
        { lat: 32.0, lon: 35.1 },
      ],
      departure: null,
      eteSeconds: null,
    });
    const gap = briefingDistanceNM(notam('POLY', { polygon: square }), { kind: 'route', route });
    expect(gap).not.toBeNull();
    expect(Math.abs((gap ?? 0) - 6)).toBeLessThan(0.1);
  });

  // MARK: Route kind versus the pilot's network (UX-IL, efb-aac.20)

  const kindClosure = (kind: string, kinds: string[] | null = null): IsraelRouteClosure => ({
    notamId: 'X',
    routeKind: kind,
    routeName: null,
    chain: ['GALIM', 'DAROM'],
    validFrom: null,
    validTo: null,
    schedule: null,
    routeKinds: kinds,
  });

  test('aHelOrUltralightRouteClosureIsNotAClosureForACvfrPilot', () => {
    const hel = notam('HEL', { closures: [kindClosure('HEL')] });
    const ultralight = notam('UL', { closures: [kindClosure('ULTRALIGHT')] });
    const ats = notam('ATS', { closures: [kindClosure('ATS')] });
    const rows = briefingRows([hel, ultralight, ats], query());

    expect(rows.every((r) => r.closure === 'none' && !r.needsCheck && r.section === 'other')).toBe(true);
    expect(rows.find((r) => r.notam.id === 'HEL')?.otherRouteKinds).toEqual(['HEL']);
    expect(rows.find((r) => r.notam.id === 'UL')?.otherRouteKinds).toEqual(['ULTRALIGHT']);
  });

  test('aClauseThatNamesCvfrAmongOthersStaysRedAndCarriesNoOtherKindLabel', () => {
    const both = notam('BOTH', { closures: [kindClosure('CVFR', ['CVFR', 'HEL'])] });
    const row = briefingRows([both], query())[0];
    expect(row?.closure).toBe('full');
    expect(row?.section).toBe('closures');
    expect(row?.otherRouteKinds).toEqual([]);
  });

  test('anUltralightClosureIsRedForAnLsaPilotAndACvfrClosureIsNot', () => {
    const q: BriefingQuery = { ...query(), network: 'lsa' };
    const ultralight = notam('UL', { closures: [kindClosure('ULTRALIGHT')] });
    const cvfr = notam('CV', { closures: [kindClosure('CVFR')] });
    const rows = briefingRows([ultralight, cvfr], q);
    expect(rows.find((r) => r.notam.id === 'UL')?.closure).toBe('full');
    expect(rows.find((r) => r.notam.id === 'CV')?.closure).toBe('none');
    expect(rows.find((r) => r.notam.id === 'CV')?.otherRouteKinds).toEqual(['CVFR']);
  });
});

// Characterisation of the BriefingRoute pieces the Swift suite exercises only through the view model.
describe('BriefingRoute sources', () => {
  test('route aerodromes are the 4-letter LL codes, upper-cased', () => {
    const route = makeBriefingRoute({ codes: ['llhz', 'GALIM', 'LLBG', 'KSQL', 'LLX'], points: [] });
    expect(briefingRouteAerodromes(route)).toEqual(new Set(['LLHZ', 'LLBG']));
    expect(route.network).toBe('cvfr');
  });

  test('an active route gives its codes and the departure point first, with no departure time', () => {
    const active = makeActiveRoute([
      makeLeg({
        fromCode: 'LLHZ',
        toCode: 'GALIM',
        toLatitude: 32.5,
        toLongitude: 34.9,
        altitudeText: '',
        distanceNM: 1,
      }),
      makeLeg({
        fromCode: 'GALIM',
        toCode: 'LLHA',
        toLatitude: 32.8,
        toLongitude: 35.0,
        altitudeText: '',
        distanceNM: 1,
      }),
    ]);
    const route = briefingRouteFromActive(active, { lat: 32.18, lon: 34.83 });
    expect(route?.codes).toEqual(['LLHZ', 'GALIM', 'LLHA']);
    expect(route?.points).toEqual([
      { lat: 32.18, lon: 34.83 },
      { lat: 32.5, lon: 34.9 },
      { lat: 32.8, lon: 35.0 },
    ]);
    expect(route?.departure).toBeNull();
    expect(briefingRouteFromActive(makeActiveRoute([]), null)).toBeNull();
    expect(briefingRouteFromActive(active, null)?.points).toHaveLength(2);
  });
});
