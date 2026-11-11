// Port of ServiceTests/IsraelNotamServiceTests.swift (23 tests): the relay client against a fake fetch. The wire format
// is the output of web/notam-relay; the real relay output saved from a live scrape is decoded too, so a contract drift
// fails here. Plus tests for the NotamReadStateStore (its Swift cases live in IsraelBriefingViewModelTests, a U-ticket).
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppFailure } from '../domain/errors';
import {
  altitudeChartText,
  availableAltitudeLimit,
  closureCovers,
  closureHasSchedule,
  closureIsValid,
  closureKinds,
  closureLegs,
  closureSeverity,
  decodeIsraelNotamFeed,
  decodeRouteClosure,
  isSuperseded,
  makeRouteClosure,
  reportFreshness,
  type IsraelNotam,
  type IsraelNotamReport,
} from './israelNotam';
import { IsraelNotamError, IsraelNotamService, ISRAEL_NOTAM_STORAGE_KEY } from './israelNotamService';
import { NotamReadStateStore, readKey, NOTAM_READ_KEYS_STORAGE_KEY } from './notamReadStateStore';
import { REPO_ROOT } from './swiftFixtures';
import { fakeFetch, MemoryTextStorage, TestClock, type FakeFetch, type StubReply } from './testSupport';

const FEED_URL = 'https://relay.example/api/notams';
const generatedAt = 1_793_534_400_000; // 2026-11-01T12:00:00Z

/** One NOTAM with a closure, in the relay's JSON (JavaScript ISO dates with milliseconds). */
function feedJSON(generated = '2026-11-01T12:00:00.000Z'): string {
  return JSON.stringify({
    generatedAt: generated,
    source: { name: 'IAA AeroInfo', listUrl: 'https://x', detailUrlTemplate: 'https://y' },
    items: [
      {
        rowId: '2074111',
        id: 'C2269/26',
        type: 'NOTAMN',
        references: null,
        location: 'LLLL',
        locationDescription: 'Tel-Aviv FIR',
        created: '2026-10-25T14:31:00.000Z',
        q: {
          fir: 'LLLL',
          code: 'QARLC',
          traffic: 'IV',
          purpose: 'NBO',
          scope: 'E',
          lower: 10,
          upper: 25,
          centre: { lat: 32.716667, lon: 34.966667 },
          radiusNM: 8,
        },
        a: 'LLLL',
        validFrom: '2026-10-28T07:45:00.000Z',
        validTo: '2026-10-28T13:30:00.000Z',
        permanent: false,
        estimated: false,
        d: '0745-1030 1230-1330',
        e: 'HEL RTE CLSD GALIM-DAROM.',
        f: null,
        g: null,
        geometry: { polygon: null, circle: { centre: { lat: 32.716667, lon: 34.966667 }, radiusNM: 8 } },
        closures: [
          {
            notamId: 'C2269/26',
            routeKind: 'HEL',
            routeName: null,
            chain: ['GALIM', 'DAROM'],
            validFrom: '2026-10-28T07:45:00.000Z',
            validTo: '2026-10-28T13:30:00.000Z',
            schedule: '0745-1030 1230-1330',
          },
        ],
        cancelledBy: null,
        replacedBy: null,
        parsed: true,
        raw: '(C2269/26 NOTAMN ...',
      },
    ],
    closures: [
      {
        notamId: 'C2269/26',
        routeKind: 'HEL',
        routeName: null,
        chain: ['GALIM', 'DAROM'],
        validFrom: '2026-10-28T07:45:00.000Z',
        validTo: null,
        schedule: null,
      },
    ],
  });
}

const offline = (): never => {
  throw new TypeError('Network request failed');
};

function makeService(
  handler: (url: string, call: number) => StubReply | Promise<StubReply>,
  opts: { clock?: TestClock; url?: string | null; storage?: MemoryTextStorage } = {},
): { service: IsraelNotamService; fetch: FakeFetch } {
  const fetch = fakeFetch(handler);
  const url = opts.url === undefined ? FEED_URL : opts.url;
  const service = new IsraelNotamService({
    fetch,
    feedUrl: () => url,
    now: (opts.clock ?? new TestClock(generatedAt)).now,
    storage: opts.storage,
  });
  return { service, fetch };
}

// MARK: Decoding

test('decodesTheRelayFeedIncludingMillisecondDates', async () => {
  const { service } = makeService(() => ({ body: feedJSON() }));
  const report = await service.fetchFeed(false);

  expect(report.feed.generatedAt).toBe(generatedAt);
  expect(report.feed.items).toHaveLength(1);
  const item = report.feed.items[0];
  expect(item.id).toBe('C2269/26');
  expect(item.type).toBe('NOTAMN');
  expect(item.q?.lower).toBe(10);
  expect(item.q?.radiusNM).toBe(8);
  expect(item.validTo).toBe(1_793_194_200_000); // 2026-10-28T13:30Z
  expect(item.geometry.circle?.radiusNM).toBe(8);
  expect(item.geometry.polygon).toBeNull();
  expect(item.parsed).toBe(true);
  expect(isSuperseded(item)).toBe(false);

  const closure = report.feed.closures[0];
  expect(closure.chain).toEqual(['GALIM', 'DAROM']);
  expect(closure.validTo).toBeNull();
  expect(closureHasSchedule(closure)).toBe(false);
  expect(closureHasSchedule(item.closures[0])).toBe(true);
});

test('decodesDatesWithoutFractionalSeconds', async () => {
  const { service } = makeService(() => ({ body: feedJSON('2026-11-01T12:00:00Z') }));
  expect((await service.fetchFeed(false)).feed.generatedAt).toBe(generatedAt);
});

test('decodesTheRealRelayOutputSavedFromALiveScrape', () => {
  // web/notam-relay output on 2026-11-01 (docs/research/israel-cvfr-samples).
  const sample = join(REPO_ROOT, 'docs/research/israel-cvfr-samples/il-notam-relay-notams-2026-11-01.json');
  const feed = decodeIsraelNotamFeed(readFileSync(sample, 'utf8'));

  expect(feed.items).toHaveLength(125);
  expect(feed.items.every((i) => i.parsed)).toBe(true);
  expect(feed.closures).toHaveLength(26);
  const c2267 = feed.closures.find((c) => c.notamId === 'C2267/26');
  expect(c2267?.routeKind).toBe('CVFR');
  expect(c2267?.chain).toEqual(['GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS']);
  expect(feed.closures.find((c) => c.notamId === 'A0849/26')?.routeName).toBe('P68');
  expect(feed.items.some((i) => i.geometry.polygon !== null)).toBe(true);
});

// MARK: Saved copy (efb-zfm.12)

test('aRelaunchedOfflineServiceServesTheSavedFeedAsStale', async () => {
  const storage = new MemoryTextStorage();
  const clock = new TestClock(generatedAt);
  const first = makeService(() => ({ body: feedJSON() }), { clock, storage });
  await first.service.fetchFeed(false);
  await first.service.flush();

  // New process: empty memory, no signal.
  clock.advance(1_800);
  const relaunched = makeService(offline, { clock, storage });
  const report = await relaunched.service.fetchFeed(false);

  expect(report.refreshFailed).toBe(true);
  expect(report.feed.items).toHaveLength(1);
  expect(report.feed.closures).toHaveLength(1);
  expect(report.fetchedAt).toBe(generatedAt); // the original download time, not now
  expect(report.feed.generatedAt).toBe(generatedAt);
});

test('withoutASavedFeedAnOfflineFirstFetchStillFails', async () => {
  const { service } = makeService(offline, { storage: new MemoryTextStorage() });
  await expect(service.fetchFeed(false)).rejects.toBeInstanceOf(AppFailure);
});

test('anUnreadableSavedFeedIsIgnoredNotServed', async () => {
  const storage = new MemoryTextStorage();
  storage.files.set(ISRAEL_NOTAM_STORAGE_KEY, 'not json');
  const { service } = makeService(offline, { storage });
  await expect(service.fetchFeed(false)).rejects.toBeInstanceOf(AppFailure);
});

// MARK: Requests and cache

test('requestsTheConfiguredURLAsJSON', async () => {
  const { service, fetch } = makeService(() => ({ body: feedJSON() }));
  await service.fetchFeed(false);
  expect(fetch.calls[0].url).toBe(FEED_URL);
  expect(fetch.calls[0].init?.headers?.Accept).toBe('application/json');
});

test('servesTheCachedFeedForFiveMinutesThenRefreshes', async () => {
  const clock = new TestClock(generatedAt);
  const { service, fetch } = makeService(() => ({ body: feedJSON() }), { clock });

  await service.fetchFeed(false);
  clock.advance(299);
  await service.fetchFeed(false);
  expect(fetch.calls).toHaveLength(1);

  clock.advance(2);
  const refreshed = await service.fetchFeed(false);
  expect(fetch.calls).toHaveLength(2);
  expect(refreshed.fetchedAt).toBe(clock.now());
});

test('forceRefreshBypassesTheCache', async () => {
  const { service, fetch } = makeService(() => ({ body: feedJSON() }));
  await service.fetchFeed(false);
  await service.fetchFeed(true);
  expect(fetch.calls).toHaveLength(2);
});

// MARK: Failure handling

test('notConfiguredThrowsBeforeAnyRequest', async () => {
  const { service, fetch } = makeService(() => ({ body: feedJSON() }), { url: null });
  await expect(service.fetchFeed(false)).rejects.toEqual(new IsraelNotamError('notConfigured'));
  expect(fetch.calls).toHaveLength(0);
});

test('nonOKStatusIsReportedWithTheCode', async () => {
  const { service } = makeService(() => ({ status: 503, body: 'no feed yet' }));
  await expect(service.fetchFeed(false)).rejects.toEqual(new IsraelNotamError('badStatus', 503));
});

test('undecodableBodyIsAnError', async () => {
  const { service } = makeService(() => ({ body: '<html>blocked</html>' }));
  await expect(service.fetchFeed(false)).rejects.toEqual(new IsraelNotamError('undecodable'));
});

test('offlineMapsToNetworkUnavailable', async () => {
  const { service } = makeService(offline);
  await expect(service.fetchFeed(false)).rejects.toMatchObject({ error: { kind: 'networkUnavailable' } });
});

test('failedRefreshServesTheLastCopyFlaggedAndKeepsItsAge', async () => {
  let status = 200;
  const clock = new TestClock(generatedAt);
  const { service } = makeService(() => ({ status, body: feedJSON() }), { clock });

  const first = await service.fetchFeed(false);
  status = 503;
  clock.advance(600);
  const second = await service.fetchFeed(false);

  expect(first.refreshFailed).toBe(false);
  expect(second.refreshFailed).toBe(true);
  expect(second.feed).toEqual(first.feed);
  expect(second.fetchedAt).toBe(first.fetchedAt);

  // And it keeps retrying instead of treating the stale copy as fresh.
  status = 200;
  const third = await service.fetchFeed(false);
  expect(third.refreshFailed).toBe(false);
  expect(third.fetchedAt).toBe(clock.now());
});

// MARK: Staleness

test('freshnessFollowsTheRelaysScrapeTimeNotTheDownloadTime', async () => {
  const { service } = makeService(() => ({ body: feedJSON() }));
  const report = await service.fetchFeed(false);
  const scraped = report.feed.generatedAt;

  const fresh = reportFreshness(report, scraped + 10 * 60_000);
  expect(fresh.level).toBe('fresh');
  expect(fresh.text).toBe('10 min');

  const old = reportFreshness(report, scraped + 2 * 3_600_000);
  expect(old.level).toBe('old');
  expect(old.text).toBe('OLD 2h');

  const expired = reportFreshness(report, scraped + 7 * 3_600_000);
  expect(expired.level).toBe('expired');
  expect(expired.text).toBe('EXPIRED');
});

test('aDeadRelayCannotMakeOldDataLookCurrentOnAFreshDownload', () => {
  // Downloaded just now, but the relay last scraped 8 hours ago.
  const downloadedNow = generatedAt + 8 * 3_600_000;
  const report: IsraelNotamReport = {
    feed: { generatedAt, items: [], closures: [] },
    fetchedAt: downloadedNow,
    refreshFailed: false,
  };
  expect(reportFreshness(report, downloadedNow).level).toBe('expired');
});

// MARK: Closure validity

test('closureValidityWindow', () => {
  const closure = makeRouteClosure({
    notamId: 'C2269/26',
    routeKind: 'HEL',
    routeName: null,
    chain: ['GALIM', 'DAROM', 'ATLIT'],
    validFrom: 1_000_000,
    validTo: 2_000_000,
    schedule: null,
  });
  expect(closureIsValid(closure, 999_000)).toBe(false);
  expect(closureIsValid(closure, 1_000_000)).toBe(true);
  expect(closureIsValid(closure, 2_000_000)).toBe(true);
  expect(closureIsValid(closure, 2_001_000)).toBe(false);
  expect(closureLegs(closure).map((l) => `${l.from}>${l.to}`)).toEqual(['GALIM>DAROM', 'DAROM>ATLIT']);
});

test('permanentClosureHasNoEnd', () => {
  const closure = makeRouteClosure({
    notamId: 'C0005/26',
    routeKind: 'CVFR',
    routeName: null,
    chain: ['A', 'B'],
    validFrom: 1_000_000,
    validTo: null,
    schedule: null,
  });
  expect(closureIsValid(closure, 9_999_999_999_000)).toBe(true);
});

// MARK: Closure conditions (relay NOTAM-2)

const closureJSON = (extra: string): unknown =>
  JSON.parse(
    `{"notamId":"C2981/25","routeKind":"CVFR","routeName":null,"chain":["EIRON","ZMGID"],
     "validFrom":"2026-11-01T06:00:00.000Z","validTo":null,"schedule":null${extra}}`,
  );

test('decodesAltitudeConditionsExceptionsAndKinds', () => {
  const closure = decodeRouteClosure(
    closureJSON(`,"routeKinds":["CVFR","HEL"],
     "closedAltitudes":[{"op":"AT","lowerFt":2500,"upperFt":2500,"ref":"AMSL"}],
     "availableAltitudes":[{"op":"AT","lowerFt":3000,"upperFt":3000,"ref":"AMSL","direction":"BIDIRECTIONAL"}],
     "exceptions":["PPR FLT FM IAF"],"partial":true,"parsed":true,"raw":"CVFR RTE CLSD AT 2,500FT AMSL"`),
  );
  expect(closureKinds(closure)).toEqual(['CVFR', 'HEL']);
  expect(closureCovers(closure, 'cvfr') && closureCovers(closure, 'HEL') && !closureCovers(closure, 'ATS')).toBe(true);
  expect(closure.closedAltitudes?.map(altitudeChartText)).toEqual(['2500']);
  const available = closure.availableAltitudes?.[0];
  expect(available && altitudeChartText(availableAltitudeLimit(available))).toBe('3000');
  expect(available?.direction).toBe('BIDIRECTIONAL');
  expect(closure.exceptions).toEqual(['PPR FLT FM IAF']);
  expect(closureSeverity(closure)).toBe('partial');
});

test('aFeedFromAnOlderRelayReadsAsAFullClosureOfItsKind', () => {
  const closure = decodeRouteClosure(closureJSON(''));
  expect(closureSeverity(closure)).toBe('full');
  expect(closureKinds(closure)).toEqual(['CVFR']);
  expect(closure.closedAltitudes).toBeNull();
  expect(closure.exceptions).toBeNull();
});

test('unreadClosureIsCheckNotamAndAnUnreadableParsedFlagNeverMeansFullyRead', () => {
  const unread = decodeRouteClosure(closureJSON(',"parsed":false,"raw":"CVFR RTE CLSD"'));
  expect(closureSeverity(unread)).toBe('check');
  const garbled = decodeRouteClosure(closureJSON(',"parsed":"maybe"'));
  expect(closureSeverity(garbled)).toBe('check');
});

test('aMalformedConditionNeverCostsTheWholeClosure', () => {
  const closure = decodeRouteClosure(closureJSON(',"closedAltitudes":"nonsense","partial":true'));
  expect(closure.chain).toEqual(['EIRON', 'ZMGID']);
  expect(closure.closedAltitudes).toBeNull();
  expect(closureSeverity(closure)).toBe('partial');
});

test('altitudeLimitsReadAsChartText', () => {
  expect(altitudeChartText({ op: 'AT', lowerFt: 1200, upperFt: 1200, ref: 'AMSL' })).toBe('1200');
  expect(altitudeChartText({ op: 'BLW', lowerFt: null, upperFt: 1500, ref: 'AMSL' })).toBe('BLW 1500');
  expect(altitudeChartText({ op: 'ABV', lowerFt: 10_000, upperFt: null, ref: 'FL' })).toBe('ABV FL100');
  expect(altitudeChartText({ op: 'BTN', lowerFt: 1000, upperFt: 2000, ref: 'AMSL' })).toBe('1000-2000');
  expect(altitudeChartText({ op: 'AT', lowerFt: 800, upperFt: 800, ref: 'AGL' })).toBe('800 AGL');
});

// JS-only guards (port notes S1b)

test('concurrent callers share one download, and a forced refresh joins it too', async () => {
  let release: (r: StubReply) => void = () => undefined;
  const { service, fetch } = makeService(() => new Promise<StubReply>((resolve) => (release = resolve)));
  const a = service.fetchFeed(false);
  const b = service.fetchFeed(true);
  await Promise.resolve();
  await Promise.resolve();
  release({ body: feedJSON() });
  const [ra, rb] = await Promise.all([a, b]);
  expect(rb).toBe(ra);
  expect(fetch.calls).toHaveLength(1);
});

test('a feed missing a required field is rejected as undecodable', () => {
  const broken = JSON.parse(feedJSON()) as { items: Record<string, unknown>[] };
  delete broken.items[0].geometry;
  expect(() => decodeIsraelNotamFeed(JSON.stringify(broken))).toThrow();
  expect(() => decodeIsraelNotamFeed('{"generatedAt":"yesterday","items":[],"closures":[]}')).toThrow();
});

test('a failing disk write is logged and the feed is still served', async () => {
  const storage = new MemoryTextStorage();
  storage.failWrites = true;
  const logs: string[] = [];
  const service = new IsraelNotamService({
    fetch: fakeFetch(() => ({ body: feedJSON() })),
    feedUrl: () => FEED_URL,
    storage,
    log: (m) => logs.push(m),
  });
  expect((await service.fetchFeed()).feed.items).toHaveLength(1);
  await service.flush();
  expect(logs.some((l) => l.includes('Could not save'))).toBe(true);
});

test('the default feed URL is the deployed relay when no override function is given', async () => {
  const fetch = fakeFetch(() => ({ body: feedJSON() }));
  await new IsraelNotamService({ fetch }).fetchFeed();
  expect(fetch.calls[0].url).toBe('https://openefb-notam-relay.omerc.workers.dev/notams.json');
});

// MARK: NotamReadStateStore

const notam = (id: string, created: number | null): IsraelNotam => ({ id, created }) as unknown as IsraelNotam;

test('readKey is the id plus the created stamp in whole seconds, or the id alone', () => {
  expect(readKey(notam('C2269/26', Date.UTC(2026, 9, 25, 14, 31, 0, 123)))).toBe('C2269/26@2026-10-25T14:31:00Z');
  expect(readKey(notam('C1/26', null))).toBe('C1/26');
});

test('a re-issue with a new created stamp is unread again', async () => {
  const store = await NotamReadStateStore.open();
  store.markRead(notam('A1/26', 1_000_000));
  expect(store.isRead(notam('A1/26', 1_000_000))).toBe(true);
  expect(store.isRead(notam('A1/26', 2_000_000))).toBe(false);
  store.markUnread(notam('A1/26', 1_000_000));
  expect(store.isRead(notam('A1/26', 1_000_000))).toBe(false);
});

test('read keys persist, change notifications fire only on real changes, and prune drops stale keys', async () => {
  const storage = new MemoryTextStorage();
  const store = await NotamReadStateStore.open(storage);
  let notified = 0;
  store.subscribe(() => (notified += 1));
  const a = notam('A', null);
  const b = notam('B', null);
  store.markRead(a);
  store.markRead(a); // already read: no change
  store.markAllRead([a, b]);
  store.markUnread(notam('missing', null)); // not read: no change
  expect(notified).toBe(2);
  store.prune([b]);
  await store.flush();
  expect(JSON.parse(storage.files.get(NOTAM_READ_KEYS_STORAGE_KEY) ?? '[]')).toEqual(['B']);

  const reopened = await NotamReadStateStore.open(storage);
  expect(reopened.isRead(b)).toBe(true);
  expect(reopened.isRead(a)).toBe(false);
});

test('a damaged read-state file reads as nothing read', async () => {
  const storage = new MemoryTextStorage();
  storage.files.set(NOTAM_READ_KEYS_STORAGE_KEY, '{ nope');
  expect((await NotamReadStateStore.open(storage)).readKeys.size).toBe(0);
  storage.files.set(NOTAM_READ_KEYS_STORAGE_KEY, '{"a":1}');
  expect((await NotamReadStateStore.open(storage)).readKeys.size).toBe(0);
});

// Cached and saved feeds belong to the URL they came from.
test('a feed from relay A is never served for relay B, in memory or from the saved copy', async () => {
  const storage = new MemoryTextStorage();
  const clock = new TestClock(generatedAt);
  let url = 'https://a.example/notams.json';
  let failing = false;
  const fetch = fakeFetch((u): StubReply => {
    if (failing) throw new TypeError('Network request failed');
    return { body: feedJSON(u.includes('a.example') ? '2026-11-01T12:00:00.000Z' : '2026-11-01T11:00:00.000Z') };
  });
  const service = new IsraelNotamService({ fetch, feedUrl: () => url, now: clock.now, storage });
  const a = await service.fetchFeed();
  url = 'https://b.example/notams.json';
  const b = await service.fetchFeed(); // inside the 5 minute window, but another source: must fetch
  expect(fetch.calls.map((c) => c.url)).toEqual(['https://a.example/notams.json', 'https://b.example/notams.json']);
  expect(b.feed.generatedAt).not.toBe(a.feed.generatedAt);

  failing = true;
  clock.advance(1_000);
  url = 'https://c.example/notams.json';
  await service.flush();
  await expect(service.fetchFeed()).rejects.toBeInstanceOf(AppFailure); // nothing saved for C: A's and B's copies are not offered
  url = 'https://b.example/notams.json';
  const stale = await new IsraelNotamService({ fetch, feedUrl: () => url, now: clock.now, storage }).fetchFeed();
  expect(stale.refreshFailed).toBe(true);
  expect(stale.feed.generatedAt).toBe(b.feed.generatedAt); // B's own saved copy is
});

test('a body read that fails offline is networkUnavailable, not undecodable', async () => {
  const fetch = async () => ({
    status: 200,
    text: async (): Promise<string> => {
      throw new TypeError('Network request failed');
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  await expect(new IsraelNotamService({ fetch }).fetchFeed()).rejects.toMatchObject({
    error: { kind: 'networkUnavailable' },
  });
});
