// Port of ServiceTests/IsraelAlertTests.swift, suite IsraelAlertServiceTests (9 tests). The evaluator suites are L3's.
import type { IsraelAviationDatabase } from '../data/aviation/israelDatabase';
import type {
  IsraelAerodrome,
  IsraelAirspace,
  IsraelReportingPoint,
  IsraelRouteSegment,
} from '../data/aviation/israelTypes';
import type { Region } from '../domain/core/region';
import type { IsraelAlert } from '../domain/israel/alertEvaluator';
import { makeActiveRoute, makeLeg } from '../domain/route/activeRoute';
import type { IsraelNotamReport } from './israelNotam';
import { IsraelAlertService, type ClosureMarkBuilder } from './israelAlertService';

const t0 = 1_800_000_000_000;
const center = { lat: 32.0, lon: 34.9 };
const outside = { lat: 32.0, lon: 35.4 };

function prohibited(): IsraelAirspace {
  const h = 0.05;
  const ring = [
    { lat: center.lat - h, lon: center.lon - h },
    { lat: center.lat - h, lon: center.lon + h },
    { lat: center.lat + h, lon: center.lon + h },
    { lat: center.lat + h, lon: center.lon - h },
  ];
  return {
    id: 1,
    kind: 'P',
    code: 'LLP04',
    nameEnglish: 'Haifa Oil Refinery',
    nameHebrew: null,
    label: null,
    authority: 'civil',
    floor: { feet: 0, reference: 'SFC', publishedText: null },
    ceiling: { feet: 3000, reference: 'MSL', publishedText: null },
    polygons: [[ring]],
  };
}

interface FakeData {
  areas?: IsraelAirspace[];
  points?: IsraelReportingPoint[];
  segments?: IsraelRouteSegment[];
  aerodromes?: IsraelAerodrome[];
  failNear?: boolean;
  openCalls?: { n: number };
}

function database(data: FakeData = {}): IsraelAviationDatabase {
  return {
    airspacesNear: async () => {
      if (data.failNear) throw new Error('db');
      return data.areas ?? [];
    },
    airspacesOfKind: async () => [],
    reportingPoints: async () => data.points ?? [],
    routeSegments: async () => data.segments ?? [],
    aerodrome: async (code: string) => data.aerodromes?.find((a) => a.code === code) ?? null,
  } as unknown as IsraelAviationDatabase;
}

function service(data: FakeData = {}, extra: Partial<ConstructorParameters<typeof IsraelAlertService>[0]> = {}) {
  return new IsraelAlertService({
    databaseProvider: async () => {
      if (data.openCalls) data.openCalls.n += 1;
      return database(data);
    },
    notamFetcher: null,
    borderBuffers: null,
    ...extra,
  });
}

const fix = (
  s: IsraelAlertService,
  at: { lat: number; lon: number },
  nowMs: number,
  o: { region?: Region; speed?: number; route?: ReturnType<typeof makeActiveRoute> | null; altitude?: number } = {},
) =>
  s.update({
    region: o.region ?? 'israel',
    route: o.route ?? null,
    position: at,
    altitudeFeet: o.altitude ?? 2000,
    trackTrue: 0,
    groundSpeedKnots: o.speed ?? 0,
    nowMs,
  });

test('outsideIsraelNothingIsEvaluated', async () => {
  const s = service({ areas: [prohibited()] });
  await fix(s, center, t0, { region: 'us' });
  expect(s.alerts).toEqual([]);
});

test('raisesOnceAndCallsTheHapticOnlyForNewAlerts', async () => {
  const s = service({ areas: [prohibited()] });
  let raised = 0;
  s.onRaised = (a) => (raised += a.length);
  await fix(s, center, t0);
  expect(s.alerts).toHaveLength(1);
  expect(raised).toBe(1);
  await fix(s, center, t0 + 6000);
  expect(s.alerts).toHaveLength(1);
  expect(raised).toBe(1); // already showing: no second haptic
});

test('evaluationIsThrottledToOncePerFiveSeconds', async () => {
  // The Swift mock answers by position; the fake answers the area only when the fix is near it.
  const near = new IsraelAlertService({
    databaseProvider: async () =>
      ({
        ...database({ areas: [prohibited()] }),
        airspacesNear: async (c: { lat: number }) => (c.lat === 32.0 ? [prohibited()] : []),
      }) as unknown as IsraelAviationDatabase,
    notamFetcher: null,
    borderBuffers: null,
  });
  await fix(near, outside, t0);
  expect(near.alerts).toEqual([]);
  await fix(near, center, t0 + 2000); // inside, but inside the throttle
  expect(near.alerts).toEqual([]);
  await fix(near, center, t0 + 6000);
  expect(near.alerts).toHaveLength(1);
});

function switching() {
  const state = { inside: true };
  const s = new IsraelAlertService({
    databaseProvider: async () =>
      ({
        ...database(),
        airspacesNear: async () => (state.inside ? [prohibited()] : []),
      }) as unknown as IsraelAviationDatabase,
    notamFetcher: null,
    borderBuffers: null,
  });
  return { s, state };
}

test('anAlertStaysUpForTenSecondsAfterItStopsApplying', async () => {
  const { s, state } = switching();
  await fix(s, center, t0);
  expect(s.alerts).toHaveLength(1);
  state.inside = false;
  await fix(s, outside, t0 + 6000);
  expect(s.alerts).toHaveLength(1); // held: 6 s since last seen
});

test('theHeldAlertClearsAfterTheHoldTime', async () => {
  const { s, state } = switching();
  await fix(s, center, t0);
  state.inside = false;
  await fix(s, outside, t0 + 11_000);
  expect(s.alerts).toEqual([]);
});

test('leavingIsraelClearsEverything', async () => {
  const s = service({ areas: [prohibited()] });
  await fix(s, center, t0);
  expect(s.alerts.length).toBeGreaterThan(0);
  await fix(s, center, t0 + 1000, { region: 'us' });
  expect(s.alerts).toEqual([]);
});

test('suspendingForALostFixDropsTheAlertsAndTheNextFixEvaluatesAtOnce', async () => {
  const s = service({ areas: [prohibited()] });
  await fix(s, center, t0);
  expect(s.alerts.length).toBeGreaterThan(0);
  s.suspend();
  expect(s.alerts).toEqual([]); // the last ones must not stay up as if current
  // One second later is inside the 5 s throttle, but a resumed fix is evaluated immediately.
  await fix(s, center, t0 + 1000);
  expect(s.alerts.length).toBeGreaterThan(0);
});

test('aClosureNewlyCoveringALegAheadRaisesOnceAndIsRedWhenFull', async () => {
  const point = (id: number, code: string, lat: number) =>
    ({
      id,
      code,
      nameEnglish: code,
      nameHebrew: null,
      kind: 'compulsory',
      latitude: lat,
      longitude: 34.9,
      network: 'cvfr',
    }) as IsraelReportingPoint;
  const a = point(1, 'AAAAA', 32.0);
  const b = point(2, 'BBBBB', 32.3);
  const segment = {
    id: 5,
    fromCode: 'AAAAA',
    toCode: 'BBBBB',
    fromPointID: 1,
    toPointID: 2,
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: 18,
    isCivil: true,
    isMilitary: false,
    isByRequest: false,
    bearingTrue: 0,
    altitudeForward: { published: '2500', feet: 2500 },
    altitudeReverse: null,
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [],
    network: 'cvfr',
    activity: 'unknown',
    activitySource: null,
    smallOnly: false,
  } as unknown as IsraelRouteSegment;
  const s = service({ points: [a, b], segments: [segment] });
  const route = makeActiveRoute([
    makeLeg({
      segmentID: 5,
      fromCode: 'AAAAA',
      toCode: 'BBBBB',
      toLatitude: 32.3,
      toLongitude: 34.9,
      altitudeText: '2500',
      distanceNM: 18,
    }),
  ]);
  const raised: IsraelAlert[] = [];
  s.onRaised = (x) => raised.push(...x);
  const here = { lat: 32.1, lon: 34.9 };

  await fix(s, here, t0, { route, altitude: 2500, speed: 100 }); // no closure yet
  expect(s.alerts).toEqual([]);

  const closure = {
    notamId: 'C9/26',
    routeKind: 'CVFR',
    routeName: null,
    chain: ['AAAAA', 'BBBBB'],
    validFrom: null,
    validTo: null,
    schedule: null,
  };
  const report: IsraelNotamReport = {
    feed: { generatedAt: t0, items: [], closures: [closure] },
    fetchedAt: t0,
    refreshFailed: false,
  };
  await s.setReport(report, t0 + 6000);
  await fix(s, here, t0 + 6000, { route, altitude: 2500, speed: 100 });
  expect(raised).toHaveLength(1);
  expect(raised[0].severity).toBe('warning'); // full closure is red
  expect(raised[0].kind).toBe('closure');
  await fix(s, here, t0 + 12_000, { route, altitude: 2500, speed: 100 });
  expect(raised).toHaveLength(1); // still showing: no second haptic
});

test('theSquawkReminderAppearsOnDepartureAndOnlyOnce', async () => {
  const s = service();
  let raised = 0;
  s.onRaised = (a) => (raised += a.filter((x) => x.id === 'squawk').length);
  await fix(s, outside, t0, { speed: 0 });
  await fix(s, outside, t0 + 6000, { speed: 60 });
  expect(s.alerts.some((a) => a.id === 'squawk')).toBe(true);
  await fix(s, outside, t0 + 12_000, { speed: 90 });
  expect(raised).toBe(1);
});

// JS-only guards (port notes S1e)

test('a database that fails to open is retried at the next evaluation; a failing lookup still gives the other alerts', async () => {
  let opens = 0;
  const s = new IsraelAlertService({
    databaseProvider: async () => {
      opens += 1;
      if (opens === 1) throw new Error('not yet');
      return database({ failNear: true });
    },
    notamFetcher: null,
    borderBuffers: null,
  });
  await fix(s, outside, t0, { speed: 0 });
  await fix(s, outside, t0 + 6000, { speed: 60 }); // reopens; the airspace lookup throws, the squawk reminder still shows
  expect(opens).toBe(2);
  expect(s.alerts.some((a) => a.id === 'squawk')).toBe(true);
});

test('an evaluation overtaken by a suspend does not publish', async () => {
  let release: (a: IsraelAirspace[]) => void = () => undefined;
  const s = new IsraelAlertService({
    databaseProvider: async () =>
      ({
        ...database(),
        airspacesNear: () => new Promise<IsraelAirspace[]>((r) => (release = r)),
      }) as unknown as IsraelAviationDatabase,
    notamFetcher: null,
    borderBuffers: null,
  });
  const pending = fix(s, center, t0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  s.suspend();
  release([prohibited()]);
  await pending;
  expect(s.alerts).toEqual([]);
});

test('the notam fetcher runs in the background, a failing fetch keeps the previous report, and marks follow it', async () => {
  const closureMarks: ClosureMarkBuilder = async (report) =>
    new Map(report ? [[5, { notamID: 'X', text: 'CLSD', schedule: null, severity: 'full', notes: [] }]] : []);
  let fetches = 0;
  const s = service(
    {},
    {
      notamFetcher: async () => {
        fetches += 1;
        if (fetches > 1) throw new Error('offline');
        return { feed: { generatedAt: t0, items: [], closures: [] }, fetchedAt: t0, refreshFailed: false };
      },
      closureMarks,
    },
  );
  const route = makeActiveRoute([
    makeLeg({
      segmentID: 5,
      fromCode: 'A',
      toCode: 'B',
      toLatitude: 32.3,
      toLongitude: 34.9,
      altitudeText: '',
      distanceNM: 1,
    }),
  ]);
  await fix(s, outside, t0, { route });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await fix(s, outside, t0 + 6000, { route }); // rebuilds the marks from the fetched report
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await fix(s, outside, t0 + 12_000, { route }); // marks are used at the next evaluation
  expect(s.alerts.some((a) => a.kind === 'closure')).toBe(true);
  await fix(s, outside, t0 + 400_000, { route }); // a second fetch fails: the report stays
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await fix(s, outside, t0 + 406_000, { route });
  expect(fetches).toBe(2);
  expect(s.alerts.some((a) => a.kind === 'closure')).toBe(true);
});

test('a provider that throws synchronously is retried at the next evaluation (the failed load is not cached)', async () => {
  let opens = 0;
  const s = new IsraelAlertService({
    databaseProvider: (() => {
      opens += 1;
      if (opens === 1) throw new Error('sync boom');
      return Promise.resolve(database({ areas: [prohibited()] }));
    }) as () => Promise<IsraelAviationDatabase>,
    notamFetcher: null,
    borderBuffers: null,
  });
  await fix(s, center, t0);
  expect(s.alerts).toEqual([]);
  await fix(s, center, t0 + 6000);
  expect(opens).toBe(2);
  expect(s.alerts).toHaveLength(1);
});

test('an evaluation dropped by a suspend does not leave the next fix waiting out the throttle', async () => {
  let release: (a: IsraelAirspace[]) => void = () => undefined;
  let first = true;
  const s = new IsraelAlertService({
    databaseProvider: async () =>
      ({
        ...database(),
        airspacesNear: () =>
          first ? new Promise<IsraelAirspace[]>((r) => (release = r)) : Promise.resolve([prohibited()]),
      }) as unknown as IsraelAviationDatabase,
    notamFetcher: null,
    borderBuffers: null,
  });
  const pending = fix(s, center, t0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  s.suspend(); // nothing shown yet: the early return must still reopen the throttle
  first = false;
  release([]);
  await pending;
  await fix(s, center, t0 + 1000); // inside 5 s of the dropped evaluation
  expect(s.alerts).toHaveLength(1);
});

test('a region change while an evaluation is in flight drops it and clears the squawk state', async () => {
  let release: (a: IsraelAirspace[]) => void = () => undefined;
  const s = new IsraelAlertService({
    databaseProvider: async () =>
      ({
        ...database(),
        airspacesNear: () => new Promise<IsraelAirspace[]>((r) => (release = r)),
      }) as unknown as IsraelAviationDatabase,
    notamFetcher: null,
    borderBuffers: null,
  });
  const pending = fix(s, center, t0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await fix(s, center, t0 + 1000, { region: 'us' });
  release([prohibited()]);
  await pending;
  expect(s.alerts).toEqual([]);
});

test('a throwing onRaised, a throwing fetcher and a throwing mark builder do not break evaluation', async () => {
  const logs: string[] = [];
  const s = service(
    { areas: [prohibited()] },
    {
      notamFetcher: () => {
        throw new Error('sync fetch failure');
      },
      closureMarks: () => {
        throw new Error('marks failure');
      },
      log: (m) => logs.push(m),
    },
  );
  s.onRaised = () => {
    throw new Error('haptic failure');
  };
  await fix(s, center, t0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await fix(s, center, t0 + 6000);
  expect(s.alerts).toHaveLength(1);
  expect(logs.some((l) => l.includes('onRaised'))).toBe(true);
  expect(logs.some((l) => l.includes('marks failure'))).toBe(true);
});

test('a throwing rule is logged and the other alerts still show', async () => {
  const logs: string[] = [];
  const s = service(
    {},
    {
      borderBuffers: {
        get borders(): never {
          throw new Error('bad buffers');
        },
      } as never,
      log: (m) => logs.push(m),
    },
  );
  await fix(s, outside, t0, { speed: 0 });
  await fix(s, outside, t0 + 6000, { speed: 60 });
  expect(logs.some((l) => l.includes('border alerts failed'))).toBe(true);
  expect(s.alerts.some((a) => a.id === 'squawk')).toBe(true);
});

// Review follow-ups (PR #54)

test('closure alerts come from the marks of this evaluation: an expired closure is not raised from the previous marks', async () => {
  const state = { closed: true };
  const closureMarks: ClosureMarkBuilder = async () =>
    new Map(
      state.closed ? [[5, { notamID: 'X', text: 'CLSD', schedule: null, severity: 'full' as const, notes: [] }]] : [],
    );
  const s = service({}, { closureMarks });
  const route = makeActiveRoute([
    makeLeg({
      segmentID: 5,
      fromCode: 'A',
      toCode: 'B',
      toLatitude: 32.3,
      toLongitude: 34.9,
      altitudeText: '',
      distanceNM: 1,
    }),
  ]);
  await fix(s, outside, t0, { route });
  expect(s.alerts.some((a) => a.kind === 'closure')).toBe(true);
  state.closed = false; // the closure ended (or the feed aged out)
  await fix(s, outside, t0 + 30_000, { route }); // past the hold time: nothing should keep it up
  expect(s.alerts.some((a) => a.kind === 'closure')).toBe(false);
});
