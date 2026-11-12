// The three cases of efb-212Tests/ServiceTests/IsraelBriefingFilterTests.swift that test the sheet rather than the filter
// (BriefingTimeFormat, IsraelBriefingGeometry; the other 17 are in domain/israel/briefingFilter.test.ts), then JS-only
// cases for the view's text and decisions.
import {
  briefingRows,
  makeBriefingQuery,
  makeBriefingRoute,
  type BriefingRow,
} from '../../../domain/israel/briefingFilter';
import type { IsraelLatLon } from '../../../domain/israel/notamTypes';
import type { IsraelNotam } from '../../../services/israelNotam';
import { closure, hours, notam, t0 } from './__fixtures__/briefingFixtures';
import { FIXTURE_NOTAM_COUNT, FIXTURE_NOW, captureBriefingData } from './fixture';
import {
  BriefingTimeFormat,
  DEFAULT_FILTERS,
  IsraelBriefingGeometry,
  briefingQuery,
  briefingWindow,
  canShowOnMap,
  closureBadge,
  distanceNote,
  distanceText,
  filterSummary,
  highlightTint,
  otherRouteLabel,
  plainText,
  statusContent,
  visibleRows,
  windowText,
} from './logic';

describe('Israel briefing filter', () => {
  // MARK: Time text

  test('validityShowsLocalAndZuluAndPerm', () => {
    // 2027-01-15 08:00Z is 10:00 in Israel (UTC+2 in winter).
    const from = 1_800_000_000 * 1000;
    const n = notam('T', { from, to: from + 3600 * 1000, permanent: false });
    const local = BriefingTimeFormat.validity(n, true);
    const zulu = BriefingTimeFormat.validity(n, false);
    expect(local.startsWith('LT ')).toBe(true);
    expect(zulu.startsWith('UTC ')).toBe(true);
    expect(zulu).toContain('Z');
    expect(BriefingTimeFormat.validity(notam('P', { permanent: true }), false).endsWith('to PERM')).toBe(true);
  });

  test('localTimeIsTwoHoursAheadOfZuluInWinter', () => {
    const date = 1_800_000_000 * 1000; // 2027-01-15 08:00Z
    expect(BriefingTimeFormat.zulu(date)).toBe('15 Jan 08:00Z');
    expect(BriefingTimeFormat.local(date)).toBe('15 Jan 10:00');
  });

  // MARK: Route kind versus the pilot's network (UX-IL, efb-aac.20)

  test('aRouteClosureDrawsItsChainNotTheScopeCircleButAnAreaNotamKeepsItsCircle', () => {
    const lookup = (code: string): IsraelLatLon =>
      code === 'GALIM' ? { lat: 32.7, lon: 34.9 } : { lat: 32.8, lon: 35.0 };
    const route = notam('RC', { circle: [{ lat: 32.7, lon: 34.9 }, 60], closures: [closure('X', { kind: 'CVFR' })] });
    const shapes = IsraelBriefingGeometry.shapes(route, lookup);
    expect(shapes.rings).toEqual([]); // a 60 NM filled disc read as "this whole area is closed"
    expect(shapes.lines.length).toBe(1);

    const area = notam('AR', { circle: [{ lat: 32.7, lon: 34.9 }, 5] });
    expect(IsraelBriefingGeometry.shapes(area, lookup).rings.length).toBe(1);
  });
});

const rowOf = (n: IsraelNotam): BriefingRow =>
  briefingRows([n], makeBriefingQuery({ window: { start: t0, end: hours(3) } }))[0];

describe('briefing sheet logic, JS-only', () => {
  test('BriefingTimeFormat marks EST and unknown ends, and summer time is UTC+3', () => {
    const summer = Date.parse('2027-07-01T06:30:00Z');
    expect(BriefingTimeFormat.local(summer)).toBe('1 Jul 09:30');
    const est = { ...notam('E', { from: summer, to: summer + 3600 * 1000 }), estimated: true };
    expect(BriefingTimeFormat.validity(est, false)).toBe('UTC 1 Jul 06:30Z to 1 Jul 07:30Z EST');
    expect(BriefingTimeFormat.validity(notam('U', { from: null, to: null }), true)).toBe('LT ? to ?');
  });

  test('the Q-line circle is drawn only under 100 NM, and only without a closure chain', () => {
    const q = (radiusNM: number) => ({
      ...notam('Q'),
      q: {
        fir: 'LLLL',
        code: 'QRTCA',
        traffic: 'V',
        purpose: 'BO',
        scope: 'W',
        lower: 0,
        upper: 50,
        centre: { lat: 32, lon: 35 },
        radiusNM,
      },
    });
    expect(IsraelBriefingGeometry.shapes(q(5), () => null).rings.length).toBe(1);
    expect(IsraelBriefingGeometry.shapes(q(150), () => null).rings).toEqual([]);
    expect(canShowOnMap(q(5))).toBe(true);
    expect(canShowOnMap(q(150))).toBe(false);
    expect(canShowOnMap(notam('N'))).toBe(false);
    expect(canShowOnMap(notam('C', { closures: [closure('C')] }))).toBe(true);
    expect(canShowOnMap(notam('S', { closures: [closure('S', { chain: ['GALIM'] })] }))).toBe(false);
    const ring = IsraelBriefingGeometry.circleRing({ lat: 32, lon: 35 }, 6);
    expect(ring.length).toBe(72);
    expect(ring[0].lat).toBeCloseTo(32);
    expect(ring[18].lat).toBeCloseTo(32.1);
  });

  test('badges: CLOSED, PARTIAL, CHECK NOTAM and the neutral other-route label', () => {
    expect(closureBadge(rowOf(notam('F', { closures: [closure('F')] })))).toMatchObject({
      text: 'CLOSED',
      tone: 'warning',
      testID: 'briefing-badge-closed',
    });
    expect(closureBadge(rowOf(notam('P', { closures: [closure('P', { partial: true })] })))?.text).toBe('PARTIAL');
    expect(closureBadge(rowOf(notam('K', { e: 'CVFR RTE CLSD' })))).toMatchObject({
      text: 'CHECK NOTAM',
      testID: 'briefing-badge-check-notam',
    });
    expect(closureBadge(rowOf(notam('N')))).toBeNull();
    const hel = rowOf(notam('H', { closures: [closure('H', { kind: 'HEL', kinds: ['HEL', 'ULTRALIGHT'] })] }));
    expect(otherRouteLabel(hel)).toEqual({
      text: 'HEL + ULTRALIGHT ROUTE CLSD',
      accessibilityLabel: 'HEL + ULTRALIGHT routes closed. Not your route network.',
    });
    expect(highlightTint(hel)).toBe('info');
    expect(highlightTint(rowOf(notam('F', { closures: [closure('F')] })))).toBe('closure');
    expect(highlightTint(rowOf(notam('K', { e: 'ATS RTE J14 CLSD' })))).toBe('caution');
  });

  test('row text: E) on one line, raw when unparsed, distances', () => {
    expect(plainText(notam('A', { e: 'LINE ONE\nLINE TWO  ' }))).toBe('LINE ONE LINE TWO');
    expect(plainText({ ...notam('B', { e: 'IGNORED' }), parsed: false })).toBe('RAW B');
    expect(distanceText(null)).toBeNull();
    expect(distanceText(0.4)).toBe('On the reference');
    expect(distanceText(12.4)).toBe('12 NM away');
  });

  test('filter summary, window caption and the missing-reference notes', () => {
    expect(filterSummary(DEFAULT_FILTERS)).toBe('Flight');
    expect(
      filterSummary({
        ...DEFAULT_FILTERS,
        distanceChoice: 'ownship',
        corridorNM: 30,
        aerodromeFilter: ' llhz ',
        unreadOnly: true,
      }),
    ).toBe('Flight \u00B7 Ownship 30 NM \u00B7 LLHZ \u00B7 Unread');
    expect(windowText(briefingWindow('next6h', null, t0))).toBe('Valid 15 Jan 10:00 to 15 Jan 16:00 LT, PERM always');
    expect(distanceNote({ distanceChoice: 'route', route: null, ownship: null })).toBe(
      'No planned or active route. Plan a flight to filter by route.',
    );
    expect(distanceNote({ distanceChoice: 'ownship', route: null, ownship: null })).toBe('No GPS position yet.');
    expect(distanceNote({ distanceChoice: 'off', route: null, ownship: null })).toBeNull();
  });

  test('the query takes its reference, aerodromes and network from the route', () => {
    const route = makeBriefingRoute({
      codes: ['LLHZ', 'GALIM', 'llib'],
      points: [{ lat: 32, lon: 35 }],
      network: 'lsa',
    });
    const q = briefingQuery({ ...DEFAULT_FILTERS, distanceChoice: 'route', route, ownship: null }, t0);
    expect(q.reference).toEqual({ kind: 'route', route });
    expect([...q.routeAerodromes].sort()).toEqual(['LLHZ', 'LLIB']);
    expect(q.network).toBe('lsa');
    expect(
      briefingQuery({ ...DEFAULT_FILTERS, distanceChoice: 'ownship', route, ownship: null }, t0).reference,
    ).toEqual({ kind: 'none' });
  });

  test('status: old, stale shown on request, refresh failed, loading and error', () => {
    const base = { report: null, isLoading: false, errorMessage: null, showStaleList: false };
    expect(statusContent(base, t0)).toEqual({ kind: 'empty' });
    expect(statusContent({ ...base, isLoading: true }, t0)).toEqual({ kind: 'loading' });
    expect(statusContent({ ...base, errorMessage: 'offline' }, t0)).toEqual({
      kind: 'error',
      banner: { text: 'NOTAMs not loaded: offline', tone: 'warning' },
    });
    const feed = (ageHours: number, refreshFailed = false) => ({
      feed: { generatedAt: hours(-ageHours), items: [], closures: [] },
      fetchedAt: t0,
      refreshFailed,
    });
    const old = statusContent({ ...base, report: feed(2, true) }, t0);
    expect(old).toMatchObject({
      kind: 'feed',
      banners: [{ text: 'List is OLD. Re-check NOTAMs with the IAA before flying.', tone: 'caution' }],
      showStaleButton: false,
      trailing: [{ text: 'Refresh failed. Showing the copy downloaded earlier.', tone: 'caution' }],
    });
    const stale = statusContent({ ...base, report: feed(8), showStaleList: true }, t0);
    expect(stale).toMatchObject({
      banners: [],
      showStaleButton: false,
      trailing: [{ text: 'Showing a stale list. It is NOT current.' }],
    });
  });

  test('the capture fixture: an expired 117-NOTAM feed on the route, hidden until asked', () => {
    const data = captureBriefingData();
    const status = statusContent(data, FIXTURE_NOW);
    expect(status).toMatchObject({
      kind: 'feed',
      count: FIXTURE_NOTAM_COUNT,
      freshness: { level: 'expired', text: 'EXPIRED' },
      banners: [
        {
          text: 'NOTAM feed is EXPIRED. The list is not current and is hidden. Check NOTAMs with the IAA.',
          tone: 'warning',
        },
      ],
      showStaleButton: true,
      trailing: [],
    });
    expect(FIXTURE_NOTAM_COUNT).toBe(117);
    expect(filterSummary(data)).toBe('Flight \u00B7 Route 25 NM');
    expect(visibleRows(data, FIXTURE_NOW, () => false)).toEqual([]);
    const shown = visibleRows({ ...data, showStaleList: true }, FIXTURE_NOW, () => false);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0].closure).toBe('full');
    expect(new Set(shown.map((r) => r.notam.rowId)).size).toBe(shown.length);
  });
});
