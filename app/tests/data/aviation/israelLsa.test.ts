// Port of efb-212Tests/DataTests/IsraelLSADatabaseTests.swift: the sport-aviation (LSA) network in the bundled
// israel-aviation.sqlite (CAAI "Sportiv 2026.zip" imports).
import { WHOLE_COUNTRY, type IsraelAviationDatabase, type IsraelRouteActivity } from '../../../src/data/aviation';
import { openBundledIsrael } from './israelBundled';

describe('Israel LSA database', () => {
  let db: IsraelAviationDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openBundledIsrael());
  });
  afterAll(async () => close());

  test('lsaNetworkHasTheCounts', async () => {
    const points = await db.reportingPoints(WHOLE_COUNTRY, 'lsa');
    const segments = await db.routeSegments(WHOLE_COUNTRY, 'lsa');
    expect(segments).toHaveLength(229);
    expect(points).toHaveLength(215 + 6); // 215 published points + 6 route ends the points layer does not list
    expect(
      points
        .filter((p) => p.kind === 'unlisted')
        .map((p) => p.code)
        .sort(),
    ).toEqual(['BKRML', 'BSARN', 'BSARS', 'BSHAN', 'BSVTA', 'MACHR']);
  });

  test('theCVFRQueriesNeverSeeLSARows', async () => {
    expect(await db.reportingPoints(WHOLE_COUNTRY)).toHaveLength(198);
    expect(await db.routeSegments(WHOLE_COUNTRY)).toHaveLength(275);
    expect(await db.routeSegment('AAKKO', 'GALIM')).toBeNull(); // an LSA-only route
    expect(await db.routeSegment('AAKKO', 'GALIM', 'lsa')).not.toBeNull();
    expect(await db.reportingPoint('AFULA', 'lsa')).toBeNull(); // a CVFR-only point
    expect(await db.reportingPoint('AFULA')).not.toBeNull();
  });

  test('aCodeInBothNetworksResolvesToThatNetworksPoint', async () => {
    const cvfr = await db.reportingPoint('LLRS', 'cvfr');
    const lsa = await db.reportingPoint('LLRS', 'lsa');
    expect(cvfr?.network).toBe('cvfr');
    expect(lsa?.network).toBe('lsa');
    expect(cvfr?.id).not.toBe(lsa?.id);
  });

  test('everyLSASegmentEndsAtPointsOfItsOwnNetwork', async () => {
    const points = new Map((await db.reportingPoints(WHOLE_COUNTRY, 'lsa')).map((p) => [p.id, p]));
    for (const segment of await db.routeSegments(WHOLE_COUNTRY, 'lsa')) {
      const name = `${segment.fromCode}-${segment.toCode}`;
      expect(segment.network).toBe('lsa');
      expect([name, points.get(segment.fromPointID)?.code]).toEqual([name, segment.fromCode]);
      expect([name, points.get(segment.toPointID)?.code]).toEqual([name, segment.toCode]);
      expect(segment.polyline.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('activityComesFromTheLayersLocalType', async () => {
    const segments = await db.routeSegments(WHOLE_COUNTRY, 'lsa');
    const count = (activity: IsraelRouteActivity): number => segments.filter((s) => s.activity === activity).length;
    expect(count('all_week')).toBe(96);
    expect(count('weekend')).toBe(92);
    expect(count('special')).toBe(39);
    expect(count('unspecified')).toBe(2); // 'C' and 'AllWeek/Weekend': kept verbatim, never guessed
    const odd = segments
      .filter((s) => s.activity === 'unspecified')
      .flatMap((s) => s.activitySource ?? [])
      .sort();
    expect(odd).toEqual(['AllWeek/Weekend', 'C']);
  });

  test('oneWayRoutesPublishNoReverseAltitude', async () => {
    const oneWay = await db.routeSegment('ESTOL', 'LTRUN', 'lsa');
    expect(oneWay?.altitudeForward?.feet).toBe(2200);
    expect(oneWay?.altitudeReverse).toBeNull();
    expect(oneWay?.activity).toBe('weekend');
    expect(oneWay?.isByRequest).toBe(true);
    const twoWay = await db.routeSegment('HADRA', 'ORAKV', 'lsa');
    expect(twoWay?.altitudeForward?.feet).toBe(1000);
    expect(twoWay?.altitudeReverse?.feet).toBe(400);
    expect(twoWay?.activity).toBe('all_week');
    expect((await db.routeSegments(WHOLE_COUNTRY, 'lsa')).filter((s) => s.altitudeReverse === null)).toHaveLength(21);
  });

  test('weekendRuleIsStoredAsPublishedText', async () => {
    const rule = (await db.metadata()).lsaWeekendRule;
    expect(rule?.fridayStartDefault).toBe('06:00');
    expect(rule?.fridayStartLatestPublished).toBe('14:00');
    expect(rule?.holidayEveStart).toBe('14:00');
    expect(rule?.textHebrew).toContain('ימי שישי');
    expect(rule?.source).toContain('B-08');
  });
});
