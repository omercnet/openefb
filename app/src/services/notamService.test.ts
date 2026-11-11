// Port of ServiceTests/NotamServiceTests.swift (14 tests): FAA NOTAM API parsing, effective-window filtering,
// closure-first ordering, credential gating, auth headers and pagination. The documented-format page is read in place
// from the Swift test file.
import type { Airport } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import {
  activeSorted,
  compareBriefingOrder,
  effectiveWindowDescription,
  isEffective,
  locationQuery,
  makeNotam,
  notamClosure,
  parseNotamResponse,
} from './notam';
import {
  NOTAM_FETCH_BUDGET_SECONDS,
  NOTAM_MAX_PAGES,
  NOTAM_PAGE_SIZE,
  NotamError,
  NotamService,
  type NotamCredentials,
} from './notamService';
import { swiftRawFixture } from './swiftFixtures';
import { fakeFetch, TestClock, type FakeFetch, type StubReply } from './testSupport';

const SWIFT_TESTS = 'ServiceTests/NotamServiceTests.swift';
const kpaoPage = swiftRawFixture(SWIFT_TESTS, 'kpaoPage');

/** Reference time for window tests: 2026-10-30 18:00Z. */
const now = 1_793_383_200_000;
const iso = (s: string) => Date.parse(s);

const kpao = { icao: 'KPAO', faaID: 'PAO' } as Pick<Airport, 'icao' | 'faaID'>;

/** One-item documented-format page with a permanent NOTAM, for network tests run at wall-clock time. */
function permanentPage(number: string, pageNum: number, totalPages: number): string {
  return JSON.stringify({
    pageSize: 100,
    pageNum,
    totalCount: totalPages,
    totalPages,
    items: [
      {
        type: 'Feature',
        properties: {
          coreNOTAMData: {
            notamEvent: { scenario: '6000' },
            notam: {
              id: `NOTAM_1_${number.replace('/', '')}`,
              series: '',
              number,
              type: 'N',
              issued: '2020-01-02T10:00:00.000Z',
              selectionCode: 'QFAXX',
              location: 'PAO',
              effectiveStart: '2020-01-02T10:00:00.000Z',
              effectiveEnd: 'PERM',
              text: 'AD AP BCN OPS CHANGED',
              classification: 'DOM',
              icaoLocation: 'KPAO',
            },
            notamTranslation: [],
          },
        },
        geometry: { type: 'GeometryCollection', geometries: [] },
      },
    ],
  });
}

const pageNumber = (url: string): number => Number(/[?&]pageNum=(\d+)/.exec(url)?.[1] ?? 0);
const queryOf = (url: string): Record<string, string> =>
  Object.fromEntries(
    url
      .split('?')[1]
      .split('&')
      .map((kv) => kv.split('=') as [string, string]),
  );

const creds: NotamCredentials = { clientID: 'test-id', clientSecret: 'test-secret' };

function makeService(
  fetch: FakeFetch,
  opts: { credentials?: NotamCredentials | null; clock?: TestClock } = {},
): NotamService {
  const credentials = opts.credentials === undefined ? creds : opts.credentials;
  return new NotamService({ fetch, credentials: async () => credentials, now: opts.clock?.now });
}

// MARK: Decoding

test('decodesDocumentedGeoJsonPage', () => {
  const page = parseNotamResponse(kpaoPage);
  expect(page.pageNum).toBe(1);
  expect(page.totalPages).toBe(1);
  expect(page.totalCount).toBe(6);
  expect(page.notams).toHaveLength(6);

  const rwy = page.notams.find((n) => n.number === '10/118');
  expect(rwy).toBeDefined();
  expect(rwy?.id).toBe('NOTAM_1_74120871');
  expect(rwy?.text).toBe('RWY 13/31 CLSD');
  expect(rwy?.selectionCode).toBe('QMRLC');
  expect(rwy?.icaoLocation).toBe('KPAO');
  expect(rwy?.location).toBe('PAO');
  expect(rwy?.classification).toBe('DOM');
  expect(rwy?.effectiveStart).toBe(iso('2026-10-30T14:00:00Z'));
  expect(rwy?.effectiveEnd).toBe(iso('2026-10-31T02:00:00Z'));
  expect(rwy?.isPermanent).toBe(false);
  // LOCAL_FORMAT translation preferred over the ICAO rendering
  expect(rwy?.fullText).toBe('!PAO 10/118 PAO RWY 13/31 CLSD 2610301400-2610310200');

  const perm = page.notams.find((n) => n.number === '02/007');
  expect(perm?.isPermanent).toBe(true);
  expect(perm?.effectiveEnd).toBeNull();
  expect(perm && effectiveWindowDescription(perm)).toBe('Feb 3 1720Z \u2013 PERM');
});

test('classifiesClosuresByQCodeAndText', () => {
  const page = parseNotamResponse(kpaoPage);
  const closure = (number: string) => {
    const n = page.notams.find((x) => x.number === number);
    return n ? notamClosure(n) : undefined;
  };
  expect(closure('10/120')).toBe('aerodrome');
  expect(closure('10/118')).toBe('runway');
  expect(closure('10/101')).toBeNull(); // taxiway closure that merely mentions RWY 13/31
  expect(closure('02/007')).toBeNull(); // "AD AP" without CLSD

  // Text-only detection when the Q-code is absent
  const textOnlyRunway = makeNotam({
    id: 'x',
    number: '1/1',
    effectiveStart: null,
    effectiveEnd: null,
    text: 'RWY 31R CLSD EXC TAXI',
  });
  const textOnlyAirport = makeNotam({
    id: 'y',
    number: '1/2',
    effectiveStart: null,
    effectiveEnd: null,
    text: 'AD AP CLSD TO NON PPR ACFT',
  });
  expect(notamClosure(textOnlyRunway)).toBe('runway');
  expect(notamClosure(textOnlyAirport)).toBe('aerodrome');
});

// MARK: Effective window

test('keepsOnlyNotamsEffectiveNow', () => {
  const page = parseNotamResponse(kpaoPage);
  const active = new Set(activeSorted(page.notams, now).map((n) => n.number));
  expect(active).toEqual(new Set(['10/101', '10/118', '10/120', '02/007']));
  expect(active.has('10/090')).toBe(false); // expired 10-29 2359Z
  expect(active.has('10/125')).toBe(false); // starts 11-05
});

test('effectiveWindowBoundaries', () => {
  const start = now;
  const end = now + 3_600_000;
  const notam = makeNotam({ id: 'b', number: '10/200', effectiveStart: start, effectiveEnd: end, text: 'TWY A CLSD' });
  expect(isEffective(notam, start)).toBe(true); // start is inclusive
  expect(isEffective(notam, start - 1000)).toBe(false);
  expect(isEffective(notam, end - 1000)).toBe(true);
  expect(isEffective(notam, end)).toBe(false); // end is exclusive

  const cancellation = makeNotam({
    id: 'c',
    number: '10/201',
    type: 'C',
    effectiveStart: start,
    effectiveEnd: end,
    text: 'TWY A CLSD',
  });
  expect(activeSorted([cancellation], start)).toEqual([]);
});

// MARK: Ordering

test('sortsAerodromeThenRunwayClosuresFirst', () => {
  const page = parseNotamResponse(kpaoPage);
  // AD closure, RWY closure, then the rest newest-effective first
  expect(activeSorted(page.notams, now).map((n) => n.number)).toEqual(['10/120', '10/118', '10/101', '02/007']);
});

// MARK: Location query

test('usesIcaoLocationForIcaoIdentsAndDomesticOtherwise', () => {
  expect(locationQuery(kpao)).toEqual({ name: 'icaoLocation', value: 'KPAO' });
  expect(locationQuery({ icao: '0Q5', faaID: '0Q5' })).toEqual({ name: 'domesticLocation', value: '0Q5' });
});

// MARK: Network behavior

test('missingKeyThrowsNotConfiguredWithoutNetworkCall', async () => {
  const fetch = fakeFetch(() => ({ body: kpaoPage }));
  const service = makeService(fetch, { credentials: null });
  await expect(service.fetchNotams(kpao)).rejects.toEqual(new NotamError('notConfigured'));
  expect(fetch.calls).toHaveLength(0);
});

test('sendsAuthHeadersFollowsPaginationAndCaches', async () => {
  const fetch = fakeFetch((url) => ({ body: permanentPage(`0${pageNumber(url)}/001`, pageNumber(url), 2) }));
  const service = makeService(fetch);

  const report = await service.fetchNotams(kpao);
  expect(new Set(report.notams.map((n) => n.number))).toEqual(new Set(['01/001', '02/001']));
  expect(report.location).toBe('KPAO');

  expect(fetch.calls).toHaveLength(2);
  fetch.calls.forEach((call, index) => {
    expect(call.init?.headers?.client_id).toBe('test-id');
    expect(call.init?.headers?.client_secret).toBe('test-secret');
    expect(call.url.startsWith('https://external-api.faa.gov/notamapi/v1/notams?')).toBe(true);
    const query = queryOf(call.url);
    expect(query.icaoLocation).toBe('KPAO');
    expect(query.responseFormat).toBe('geoJson');
    expect(query.pageNum).toBe(String(index + 1));
    expect(query.pageSize).toBe(String(NOTAM_PAGE_SIZE));
  });

  // Second fetch within 10 minutes is served from cache
  const cached = await service.fetchNotams(kpao);
  expect(cached.fetchedAt).toBe(report.fetchedAt);
  expect(fetch.calls).toHaveLength(2);
});

test('unauthorizedResponseThrowsCredentialsRejected', async () => {
  const service = makeService(fakeFetch(() => ({ status: 401, body: '{"error":"invalid_client"}' })));
  await expect(service.fetchNotams(kpao)).rejects.toEqual(new NotamError('credentialsRejected'));
});

// MARK: Reliability (efb-zfm.15)

test('aFailedRefreshServesTheLastGoodCopyFlaggedWithItsOriginalAge', async () => {
  const clock = new TestClock(Date.now());
  let failing = false;
  const fetch = fakeFetch((): StubReply => {
    if (failing) throw new TypeError('Network request failed');
    return { body: permanentPage('01/001', 1, 1) };
  });
  const service = makeService(fetch, { clock });
  const good = await service.fetchNotams(kpao);
  expect(good.refreshFailed).toBe(false);

  failing = true; // flips the stub to failing
  clock.advance(1_200); // cache (10 min) has expired, so a refresh is attempted
  const stale = await service.fetchNotams(kpao);

  expect(stale.refreshFailed).toBe(true);
  expect(stale.notams).toEqual(good.notams);
  expect(stale.fetchedAt).toBe(good.fetchedAt); // the badge ages from the last good download
});

test('aFailureWithNothingSavedStillThrows', async () => {
  const service = makeService(
    fakeFetch(() => {
      throw new Error('timed out');
    }),
  );
  await expect(service.fetchNotams(kpao)).rejects.toBeInstanceOf(AppFailure);
});

test('theNumberOfSequentialPagesIsCappedAndTheListIsMarkedIncomplete', async () => {
  const fetch = fakeFetch((url) => ({ body: permanentPage(`0${pageNumber(url)}/001`, pageNumber(url), 20) }));
  const report = await makeService(fetch).fetchNotams(kpao);
  expect(fetch.calls).toHaveLength(NOTAM_MAX_PAGES);
  expect(report.isIncomplete).toBe(true);
});

test('aCompleteListIsNotMarkedIncomplete', async () => {
  const fetch = fakeFetch((url) => ({ body: permanentPage(`0${pageNumber(url)}/001`, pageNumber(url), 2) }));
  expect((await makeService(fetch).fetchNotams(kpao)).isIncomplete).toBe(false);
});

test('theTimeBudgetStopsFurtherPagesAndMarksTheListIncomplete', async () => {
  const clock = new TestClock(Date.now());
  const fetch = fakeFetch(() => {
    clock.advance(NOTAM_FETCH_BUDGET_SECONDS); // the first page used the whole budget
    return { body: permanentPage('01/001', 1, 4) };
  });
  const report = await makeService(fetch, { clock }).fetchNotams(kpao);
  expect(fetch.calls).toHaveLength(1);
  expect(report.isIncomplete).toBe(true);
});

// JS-only guards (port notes S1b)

test('a second call for the same airport while a download runs joins it', async () => {
  let release: (r: StubReply) => void = () => undefined;
  const fetch = fakeFetch(() => new Promise<StubReply>((resolve) => (release = resolve)));
  const service = makeService(fetch);
  const a = service.fetchNotams(kpao);
  const b = service.fetchNotams(kpao);
  await Promise.resolve();
  await Promise.resolve();
  release({ body: permanentPage('01/001', 1, 1) });
  const [ra, rb] = await Promise.all([a, b]);
  expect(fetch.calls).toHaveLength(1);
  expect(rb).toBe(ra);
});

test('an offline fetch is networkUnavailable, other transport failures are weatherFetchFailed', async () => {
  const offline = makeService(
    fakeFetch(() => {
      throw new TypeError('Network request failed');
    }),
  );
  await expect(offline.fetchNotams(kpao)).rejects.toMatchObject({ error: { kind: 'networkUnavailable' } });
  const other = makeService(
    fakeFetch(() => {
      throw new Error('boom');
    }),
  );
  await expect(other.fetchNotams(kpao)).rejects.toMatchObject({ error: { kind: 'weatherFetchFailed' } });
});

test('a 500 and a malformed body are weatherFetchFailed, and neither is cached', async () => {
  let reply: StubReply = { status: 500 };
  const fetch = fakeFetch(() => reply);
  const service = makeService(fetch);
  await expect(service.fetchNotams(kpao)).rejects.toMatchObject({ error: { kind: 'weatherFetchFailed' } });
  reply = { body: '<html>' };
  await expect(service.fetchNotams(kpao)).rejects.toMatchObject({ error: { kind: 'weatherFetchFailed' } });
  reply = { body: permanentPage('01/001', 1, 1) };
  expect((await service.fetchNotams(kpao)).notams).toHaveLength(1);
  expect(fetch.calls).toHaveLength(3);
});

test('a failing refresh with a rejected key still serves the last good copy, flagged', async () => {
  const clock = new TestClock(Date.now());
  let status = 200;
  const fetch = fakeFetch(() => ({ status, body: permanentPage('01/001', 1, 1) }));
  const service = makeService(fetch, { clock });
  await service.fetchNotams(kpao);
  status = 403;
  clock.advance(1_200);
  expect((await service.fetchNotams(kpao)).refreshFailed).toBe(true);
});

test('a wrong-typed field rejects the page like Swift Decodable does', () => {
  expect(() => parseNotamResponse('{"totalPages":"2","items":[]}')).toThrow();
  expect(() => parseNotamResponse('[]')).toThrow();
  expect(parseNotamResponse('{"items":[{"properties":{}}]}').notams).toEqual([]);
});

test('an EST suffix on a FAA time is dropped before parsing', () => {
  const body = JSON.stringify({
    items: [
      {
        properties: {
          coreNOTAMData: { notam: { id: 'a', effectiveStart: '2026-10-30T14:00:00Z EST', effectiveEnd: 'garbage' } },
        },
      },
    ],
  });
  const [n] = parseNotamResponse(body).notams;
  expect(n.effectiveStart).toBe(iso('2026-10-30T14:00:00Z'));
  expect(n.effectiveEnd).toBeNull();
  expect(n.number).toBe('a');
});

test('briefing order is a consistent comparator and breaks ties by number', () => {
  const mk = (number: string, start: number | null) =>
    makeNotam({ id: number, number, effectiveStart: start, effectiveEnd: null, text: 'X' });
  expect(compareBriefingOrder(mk('2', 5), mk('1', 5))).toBe(1);
  expect(compareBriefingOrder(mk('1', 5), mk('1', 5))).toBe(0);
  expect(compareBriefingOrder(mk('1', null), mk('2', 1))).toBe(1);
});

test('a body read that fails offline is networkUnavailable, not an unreadable page', async () => {
  const fetch = async () => ({
    status: 200,
    text: async (): Promise<string> => {
      throw new TypeError('Network request failed');
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const service = new NotamService({ fetch, credentials: async () => creds });
  await expect(service.fetchNotams(kpao)).rejects.toMatchObject({ error: { kind: 'networkUnavailable' } });
});

test('activeSorted returns copies: editing a result cannot change the cache', async () => {
  const fetch = fakeFetch(() => ({ body: permanentPage('01/001', 1, 1) }));
  const service = makeService(fetch);
  const first = await service.fetchNotams(kpao);
  first.notams[0].effectiveEnd = 1; // would make the cached entry ineffective
  first.notams[0].text = 'EDITED';
  const second = await service.fetchNotams(kpao);
  expect(second.notams).toHaveLength(1);
  expect(second.notams[0].text).toBe('AD AP BCN OPS CHANGED');
});

test('a download that started before clearCache does not repopulate the cache', async () => {
  let release: (r: StubReply) => void = () => undefined;
  let call = 0;
  const fetch = fakeFetch(() => {
    call += 1;
    return call === 1
      ? new Promise<StubReply>((resolve) => (release = resolve))
      : { body: permanentPage('02/002', 1, 1) };
  });
  const service = makeService(fetch);
  const old = service.fetchNotams(kpao);
  await Promise.resolve();
  await Promise.resolve();
  service.clearCache();
  const fresh = await service.fetchNotams(kpao); // starts its own download, does not join the cleared one
  expect(fresh.notams[0].number).toBe('02/002');
  release({ body: permanentPage('01/001', 1, 1) });
  await old;
  expect((await service.fetchNotams(kpao)).notams[0].number).toBe('02/002'); // the late result did not overwrite
  expect(fetch.calls).toHaveLength(2);
});
