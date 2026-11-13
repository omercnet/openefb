// Port of ServiceTests/TFRServiceTests.swift: 15 of 20. The WFS and detail fixtures are read in place from the Swift test
// file. Not ported here: pointInPolygon and distanceToEdgeInNauticalMiles (L1's PolygonGeometry, tested in
// domain/core/polygon.test.ts) and the three proximity-alert cases (ported with ProximityAlertService, S1e).
import { tfrAltitudeDescription, tfrAltitudeFeet, tfrIsActive } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import {
  joinTfrs,
  matchTfrArea,
  parseTfrDetail,
  parseTfrFeatures,
  tfrAltitudeFromCode,
  parseXnotamCoordinate,
  type TfrDetail,
  type TfrDetailArea,
} from './tfr';
import { tfrDetailUrl, TfrService } from './tfrService';
import { swiftRawFixture } from './swiftFixtures';
import { fakeFetch, TestClock, type FakeFetch, type StubReply } from './testSupport';

const SWIFT = 'ServiceTests/TFRServiceTests.swift';
const wfsJSON = swiftRawFixture(SWIFT, 'wfsJSON');
const detail4348 = swiftRawFixture(SWIFT, 'detail4348');
const detail2934 = swiftRawFixture(SWIFT, 'detail2934');
const utc = (iso: string) => Date.parse(iso);

function joinedFixtureTFRs() {
  const features = parseTfrFeatures(wfsJSON);
  const details = new Map<string, TfrDetail>([
    ['6/4348', parseTfrDetail(detail4348) as TfrDetail],
    ['9/2934', parseTfrDetail(detail2934) as TfrDetail],
  ]);
  return joinTfrs(features, details);
}

// MARK: WFS GeoJSON

test('parsesWFSFeaturesSwappingLonLatToLatLon', () => {
  const features = parseTfrFeatures(wfsJSON);
  expect(features).toHaveLength(3);
  const first = features[0];
  expect(first.notamID).toBe('6/4348'); // from NOTAM_KEY "6/4348-1-FDC-F"
  expect(first.type).toBe('SECURITY');
  expect(first.state).toBe('ND');
  expect(first.facility).toBe('ZMP');
  expect(first.title.startsWith('GRAND FORKS AFB, ND')).toBe(true);
  // GeoJSON position [-97.64778425, 47.96078719] is [lon, lat]
  expect(first.ring[0]).toEqual([47.96078719, -97.64778425]);
  expect(first.ring).toHaveLength(38);
  expect(first.ring.every((p) => p[0] > 47 && p[0] < 49 && p[1] < -97 && p[1] > -98)).toBe(true);
  expect(features[2].notamID).toBe('9/2934');
  expect(features[2].type).toBe('VIP');
});

test('parsesLastModificationAsUTC', () => {
  const first = parseTfrFeatures(wfsJSON)[0];
  expect(first.lastModifiedRaw).toBe('202603051701'); // yyyyMMddHHmm
  expect(first.lastModified).toBe(utc('2026-03-05T17:01:00Z'));
});

test('rejectsNonFeatureCollection', () => {
  expect(() => parseTfrFeatures('[{"notam_id":"6/4085"}]')).toThrow();
});

// MARK: XNOTAM detail

test('parsesDetailDatesAsUTCAndAreaLimits', () => {
  const detail = parseTfrDetail(detail4348);
  expect(detail?.notamID).toBe('6/4348');
  // XML says codeTimeZone CDT but the NOTAM text confirms these are UTC
  expect(detail?.effectiveDate).toBe(utc('2026-03-08T07:00:00Z'));
  expect(detail?.expirationDate).toBe(utc('2026-11-01T06:59:00Z'));
  expect(detail?.areas).toHaveLength(2);

  const areaA = detail?.areas.find((a) => a.id === '364');
  expect(areaA?.floor).toEqual({ value: 0, reference: 'agl' });
  expect(areaA?.ceiling).toEqual({ value: 2400, reference: 'msl' });
  expect(areaA?.ring).toHaveLength(5); // only <abdMergedArea> vertices, not <aseShapes>
  expect(areaA?.ring[0]).toEqual([48.01666667, -97.39194444]); // "48.01666667N" / "97.39194444W"

  const areaB = detail?.areas.find((a) => a.id === '366');
  expect(areaB?.name).toBe('Area B');
  expect(areaB?.floor).toEqual({ value: 2400, reference: 'msl' });
  expect(areaB?.ceiling).toEqual({ value: 180, reference: 'flightLevel' });
  expect(areaB?.ring).toHaveLength(38);
});

test('missingDetailDatesMeanOpenEnded', () => {
  const detail = parseTfrDetail(detail2934);
  expect(detail?.effectiveDate).toBeNull();
  expect(detail?.expirationDate).toBeNull();
  expect(detail?.areas).toHaveLength(1);
  expect(detail?.areas[0].ceiling).toEqual({ value: 1500, reference: 'agl' });
});

test('malformedDetailReturnsNil', () => {
  expect(parseTfrDetail('<html><body>404')).toBeNull();
});

test('altitudeCodesMapToReferences', () => {
  expect(tfrAltitudeFromCode('ALT', '17999', 'FT')).toEqual({ value: 17999, reference: 'msl' });
  expect(tfrAltitudeFromCode('HEI', '3000', 'FT')).toEqual({ value: 3000, reference: 'agl' });
  expect(tfrAltitudeFromCode('ALT', '430', 'FL')).toEqual({ value: 430, reference: 'flightLevel' });
  expect(tfrAltitudeFromCode(null, '100', 'FT')).toBeNull();
  expect(tfrAltitudeFromCode('ALT', null, 'FT')).toBeNull();
  expect(tfrAltitudeFeet({ value: 180, reference: 'flightLevel' })).toBe(18000);
});

// MARK: Join

test('joinMatchesEachPolygonToItsOwnArea', () => {
  const tfrs = joinedFixtureTFRs();
  expect(tfrs.map((t) => t.id)).toEqual(['6/4348#0', '6/4348#1', '9/2934#0']);
  // WFS polygon 0 (38 vertices) is Area B; polygon 1 (5 vertices) is the unnamed surface area
  expect(tfrs[0].floor).toEqual({ value: 2400, reference: 'msl' });
  expect(tfrs[0].ceiling).toEqual({ value: 180, reference: 'flightLevel' });
  expect(tfrAltitudeDescription(tfrs[0])).toBe("2400' MSL-FL180");
  expect(tfrAltitudeDescription(tfrs[1])).toBe("SFC-2400' MSL");
  expect(tfrs[0].effectiveDate).toBe(utc('2026-03-08T07:00:00Z'));
  expect(tfrs[1].expirationDate).toBe(utc('2026-11-01T06:59:00Z'));
  expect(tfrAltitudeDescription(tfrs[2])).toBe("SFC-1500' AGL");
  expect([tfrs[2].effectiveDate, tfrs[2].expirationDate]).toEqual([null, null]);
});

test('joinWithoutDetailLeavesAltitudesAndTimesUnknown', () => {
  const tfrs = joinTfrs(parseTfrFeatures(wfsJSON), new Map());
  expect(tfrs).toHaveLength(3);
  expect(tfrs.every((t) => t.floor === null && t.ceiling === null)).toBe(true);
  expect(tfrs.every((t) => tfrAltitudeDescription(t) === 'See NOTAM')).toBe(true);
  expect(tfrs.every((t) => t.effectiveDate === null && t.expirationDate === null)).toBe(true);
});

test('indistinguishableAreasWithDifferentLimitsAreNotGuessed', () => {
  // Same footprint published twice with different limits (as in FDC 6/3002 Areas C and E)
  const ring = [
    [64.0, -149.0],
    [64.0, -148.0],
    [65.0, -148.0],
    [65.0, -149.0],
    [64.0, -149.0],
  ];
  const areaC: TfrDetailArea = {
    id: 'C',
    name: 'C',
    floor: { value: 2600, reference: 'agl' },
    ceiling: { value: 430, reference: 'flightLevel' },
    ring,
  };
  const areaE: TfrDetailArea = {
    id: 'E',
    name: 'E',
    floor: { value: 1000, reference: 'agl' },
    ceiling: { value: 2600, reference: 'agl' },
    ring,
  };
  expect(matchTfrArea(ring, [areaC, areaE])).toBeNull();
  const sameLimits: TfrDetailArea = { id: 'C2', name: 'Copy', floor: areaC.floor, ceiling: areaC.ceiling, ring };
  expect(matchTfrArea(ring, [areaC, sameLimits])?.ceiling).toEqual(areaC.ceiling);
});

// MARK: Activity

test('activityFollowsDetailDates', () => {
  const tfrs = joinedFixtureTFRs();
  const during = utc('2026-10-30T12:00:00Z');
  const after = utc('2026-11-01T07:00:00Z');
  const before = utc('2026-03-08T06:59:00Z');
  expect(tfrIsActive(tfrs[1], during)).toBe(true);
  expect(tfrIsActive(tfrs[1], after)).toBe(false);
  expect(tfrIsActive(tfrs[1], before)).toBe(false);
  expect(tfrIsActive(tfrs[2], after)).toBe(true); // until further notice: always active
});

// MARK: Service (network stubbed)

function makeFetch(state: { failing: boolean }): FakeFetch {
  return fakeFetch((url): StubReply => {
    if (state.failing) throw new TypeError('Network request failed');
    if (url.includes('geoserver')) return { body: wfsJSON };
    if (url.endsWith('detail_6_4348.xml')) return { body: detail4348 };
    return { status: 404, body: '<html>404</html>' }; // 9/2934 detail unavailable
  });
}

const T0 = 1_793_390_000_000;

test('serviceJoinsLiveDataAndCachesForTenMinutes', async () => {
  const fetch = makeFetch({ failing: false });
  const clock = new TestClock(T0);
  const service = new TfrService({ fetch, now: clock.now });

  const first = await service.currentTFRs();
  expect(first.fetchedAt).toBe(T0);
  expect(first.tfrs).toHaveLength(3);
  expect(tfrAltitudeDescription(first.tfrs[0])).toBe("2400' MSL-FL180");
  expect(tfrAltitudeDescription(first.tfrs[2])).toBe('See NOTAM'); // detail 404
  expect(fetch.calls).toHaveLength(3); // WFS + 2 details

  clock.advance(9 * 60); // 9 minutes later: served from cache, no requests
  expect(await service.currentTFRs()).toEqual(first);
  expect(fetch.calls).toHaveLength(3);

  clock.advance(2 * 60); // 11 minutes after the fetch: WFS again; unchanged 6/4348 detail is reused, failed 9/2934 retried
  const refreshed = await service.currentTFRs();
  expect(refreshed.fetchedAt).toBe(first.fetchedAt + 11 * 60_000);
  const urls = fetch.calls.map((c) => c.url);
  expect(urls).toHaveLength(5);
  expect(urls.filter((u) => u.endsWith('detail_6_4348.xml'))).toHaveLength(1);
  expect(urls.filter((u) => u.endsWith('detail_9_2934.xml'))).toHaveLength(2);
});

test('serviceServesLastGoodSnapshotWhenOffline', async () => {
  const state = { failing: false };
  const clock = new TestClock(T0);
  const service = new TfrService({ fetch: makeFetch(state), now: clock.now });
  const first = await service.currentTFRs();
  state.failing = true;
  clock.advance(30 * 60);
  expect(await service.currentTFRs()).toEqual(first); // same fetchedAt, so the UI shows 30 min data age
});

test('serviceThrowsWhenNothingWasEverFetched', async () => {
  const service = new TfrService({ fetch: makeFetch({ failing: true }) });
  await expect(service.currentTFRs()).rejects.toBeInstanceOf(AppFailure);
});

// JS-only guards (port notes S1d)

test('a detail url is only built for ids of the FAA shape', () => {
  expect(tfrDetailUrl('6/4348')).toBe('https://tfr.faa.gov/download/detail_6_4348.xml');
  for (const bad of ['6/4348?x=1', '../x', '6/4348#a', 'a b', '', '6/43\n48']) expect(tfrDetailUrl(bad)).toBeNull();
});

test('a NOTAM key that is not safe in a URL gets no detail request but still shows its polygon', async () => {
  const body = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        properties: { NOTAM_KEY: '6/4?x=1-1-FDC-F', TITLE: 'T' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [3, 4],
              [5, 6],
              [1, 2],
            ],
          ],
        },
      },
    ],
  });
  const fetch = fakeFetch((url): StubReply => ({ body: url.includes('geoserver') ? body : '' }));
  const snapshot = await new TfrService({ fetch }).currentTFRs();
  expect(snapshot.tfrs).toHaveLength(1);
  expect(fetch.calls).toHaveLength(1);
});

test('detail fetches run at most six at a time and a cancelled NOTAM is dropped from the cache', async () => {
  const ids = Array.from({ length: 14 }, (_, i) => `1/${1000 + i}`);
  const feature = (id: string) => ({
    properties: { NOTAM_KEY: `${id}-1-FDC-F`, LAST_MODIFICATION_DATETIME: '202603051701' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [1, 2],
          [3, 4],
          [5, 6],
          [1, 2],
        ],
      ],
    },
  });
  let active = 0;
  let peak = 0;
  let list = ids;
  const fetch = fakeFetch(async (url): Promise<StubReply> => {
    if (url.includes('geoserver')) return { body: JSON.stringify({ features: list.map(feature) }) };
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 1));
    active -= 1;
    return { body: detail2934 };
  });
  const clock = new TestClock(T0);
  const service = new TfrService({ fetch, now: clock.now });
  await service.currentTFRs();
  expect(peak).toBeLessThanOrEqual(6);
  expect(peak).toBeGreaterThan(1);
  expect(fetch.calls).toHaveLength(15);
  list = ids.slice(0, 2);
  clock.advance(700);
  await service.currentTFRs();
  expect(fetch.calls).toHaveLength(16); // only the WFS again: both remaining details are cached
});

test('concurrent callers share one refresh; a failed refresh is retried by the next call', async () => {
  const state = { failing: true };
  const fetch = makeFetch(state);
  const service = new TfrService({ fetch });
  await expect(Promise.all([service.currentTFRs(), service.currentTFRs()])).rejects.toBeInstanceOf(AppFailure);
  expect(fetch.calls).toHaveLength(1);
  state.failing = false;
  expect((await service.currentTFRs()).tfrs).toHaveLength(3);
});

test('malformed features and coordinates are skipped, not fatal', () => {
  const body = JSON.stringify({
    features: [
      { properties: { NOTAM_KEY: '' }, geometry: { type: 'Polygon', coordinates: [] } },
      { properties: { NOTAM_KEY: '1/1-x' }, geometry: { type: 'Point', coordinates: [1, 2] } },
      {
        properties: { NOTAM_KEY: '1/2-x' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [3, 4],
            ],
          ],
        },
      },
      {
        properties: { NOTAM_KEY: '1/3-x' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              ['x', 4],
              [5, 6],
            ],
          ],
        },
      },
      {
        properties: { NOTAM_KEY: '1/4-x', TITLE: ' ' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [1, 2],
                [3, 4],
                [5, 6],
              ],
            ],
            [[[1, 2]]],
          ],
        },
      },
    ],
  });
  const features = parseTfrFeatures(body);
  expect(features.map((f) => f.notamID)).toEqual(['1/4']);
  expect(features[0].title).toBe('TFR 1/4');
  expect(parseXnotamCoordinate('40.5N')).toBe(40.5);
  expect(parseXnotamCoordinate('105.5W')).toBe(-105.5);
  expect(parseXnotamCoordinate('')).toBeNull();
  expect(parseXnotamCoordinate('12X')).toBeNull();
});

// Q10 (owner-approved deviation from Swift, 2026-11-13): a changed NOTAM whose detail refetch fails shows "See NOTAM".
function wfsWithStamp(stamp: string): string {
  const doc = JSON.parse(wfsJSON) as { features: { properties: Record<string, unknown> }[] };
  for (const f of doc.features)
    if (String(f.properties.NOTAM_KEY).startsWith('6/4348')) f.properties.LAST_MODIFICATION_DATETIME = stamp;
  return JSON.stringify(doc);
}

test('a changed NOTAM whose detail refetch fails shows See NOTAM, an unchanged one keeps its detail', async () => {
  const state = { stamp: '202603051701', detailOk: true };
  const fetch = fakeFetch((url): StubReply => {
    if (url.includes('geoserver')) return { body: wfsWithStamp(state.stamp) };
    if (url.endsWith('detail_6_4348.xml')) return state.detailOk ? { body: detail4348 } : { status: 503 };
    return { status: 404 };
  });
  const clock = new TestClock(T0);
  const service = new TfrService({ fetch, now: clock.now });
  const first = await service.currentTFRs();
  expect(tfrAltitudeDescription(first.tfrs[0])).toBe("2400' MSL-FL180");

  // Unchanged stamp, detail endpoint now failing: nothing is refetched, the detail stays.
  state.detailOk = false;
  clock.advance(700);
  const unchanged = await service.currentTFRs();
  expect(tfrAltitudeDescription(unchanged.tfrs[0])).toBe("2400' MSL-FL180");
  expect(unchanged.tfrs[0].effectiveDate).toBe(utc('2026-03-08T07:00:00Z'));

  // The NOTAM changed and its refetch fails: the superseded limits are gone.
  state.stamp = '202603061200';
  clock.advance(700);
  const changed = await service.currentTFRs();
  expect(tfrAltitudeDescription(changed.tfrs[0])).toBe('See NOTAM');
  expect([changed.tfrs[0].effectiveDate, changed.tfrs[0].expirationDate]).toEqual([null, null]);
  expect(tfrAltitudeDescription(changed.tfrs[1])).toBe('See NOTAM');

  // A later refresh that succeeds shows the new details again (the failed one was retried, not cached).
  state.detailOk = true;
  clock.advance(700);
  const recovered = await service.currentTFRs();
  expect(tfrAltitudeDescription(recovered.tfrs[0])).toBe("2400' MSL-FL180");
});

test('a first fetch with failing details still shows See NOTAM (unchanged behaviour)', async () => {
  const fetch = fakeFetch((url): StubReply => (url.includes('geoserver') ? { body: wfsJSON } : { status: 503 }));
  const snapshot = await new TfrService({ fetch }).currentTFRs();
  expect(snapshot.tfrs.every((t) => tfrAltitudeDescription(t) === 'See NOTAM')).toBe(true);
});
