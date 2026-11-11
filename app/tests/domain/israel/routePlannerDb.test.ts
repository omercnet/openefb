// The Swift cases that run IsraelRoutePlanner over the real bundled israel-aviation.sqlite (opened from Node through the
// same install path as the app): IsraelRoutePlannerTests bundledNetworkRoutes..., IsraelLSABundledRouteTests, the
// aerodrome adapter's bundled ultralight check (IsraelNearestAndSearchTests) and CVFRDebriefTests
// plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes.
import {
  WHOLE_COUNTRY,
  type IsraelAviationDatabase,
  type IsraelReportingPoint,
  type IsraelRouteSegment,
} from '../../../src/data/aviation';
import { NOT_LANDABLE_USES, airport } from '../../../src/domain/israel/aerodromeAdapter';
import { isLandable } from '../../../src/domain/core/landableAirportFilter';
import { buildCVFRDebrief, publishedAltitudes } from '../../../src/domain/debrief/cvfrDebrief';
import type { CVFRTrackPoint } from '../../../src/domain/debrief/types';
import {
  IsraelRoutePlanner,
  haversineNm,
  legAltitudeText,
  legBearingTrue,
  legPolyline,
  makeRouteOptions,
  planIsFileable,
  planNetwork,
  planPointCodes,
  planTotalDistanceNM,
} from '../../../src/domain/israel/routePlanner';
import { openBundledIsrael } from '../../data/aviation/israelBundled';

/** Local Israel time (UTC+2 in November) as an absolute instant. */
const israel = (day: number, hour: number): number => Date.UTC(2026, 10, day, hour - 2);
const wednesday = israel(4, 10);
const saturday = israel(7, 10);

describe('IsraelRoutePlanner over the bundled database', () => {
  let db: IsraelAviationDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openBundledIsrael());
  });
  afterAll(async () => close());

  test('bundledNetworkRoutesHerzeliyaToRoshPinaOverCivilOpenSegments', async () => {
    const planner = new IsraelRoutePlanner(
      await db.reportingPoints(WHOLE_COUNTRY),
      await db.routeSegments(WHOLE_COUNTRY),
    );
    const plan = planner.route('LLHZ', 'LLIB', 100);
    expect(planPointCodes(plan)[0]).toBe('LLHZ');
    expect(planPointCodes(plan).at(-1)).toBe('LLIB');
    expect(Math.abs(planTotalDistanceNM(plan) - 68.138)).toBeLessThan(0.05);
    expect(planIsFileable(plan)).toBe(true);
    expect(plan.legs.every((l) => l.altitude !== null && !l.segment.isByRequest && !l.segment.isMilitary)).toBe(true);
  });

  test('routesOverTheRealLSANetworkOnASaturdayAndKeepsWeekendRoutesOutOnAWeekday', async () => {
    const lsaSegments = await db.routeSegments(WHOLE_COUNTRY, 'lsa');
    const planner = new IsraelRoutePlanner(await db.reportingPoints(WHOLE_COUNTRY, 'lsa'), lsaSegments);
    // Find a pair joined by a weekend-only route that is two-way and open (not by request).
    const weekend = lsaSegments.find((s) => s.activity === 'weekend' && !s.isByRequest && s.altitudeReverse !== null);
    expect(weekend).toBeDefined();
    if (!weekend) return;
    const onSaturday = planner.route(weekend.fromCode, weekend.toCode, 90, makeRouteOptions({ departure: saturday }));
    expect(planNetwork(onSaturday)).toBe('lsa');
    expect(planPointCodes(onSaturday)[0]).toBe(weekend.fromCode);
    expect(planPointCodes(onSaturday).at(-1)).toBe(weekend.toCode);
    expect(onSaturday.legs.every((l) => l.altitude !== null)).toBe(true);

    // Either no route or a route that avoids every weekend-only segment.
    let weekday = null;
    try {
      weekday = planner.route(weekend.fromCode, weekend.toCode, 90, makeRouteOptions({ departure: wednesday }));
    } catch {
      weekday = null;
    }
    expect(weekday?.legs.some((l) => l.segment.activity === 'weekend') ?? false).toBe(false);
  });

  test('theBundledUltralightStripsAreMarkedUltralightAndSkippedByNrst', async () => {
    const rishon = await db.aerodrome('LLRS');
    const einVered = await db.aerodrome('LLEV');
    expect(rishon?.use).toBe('ultralight');
    expect(einVered?.use).toBe('ultralight');
    // NRST skips NOT_LANDABLE_USES; the mapping itself stays faithful.
    expect(NOT_LANDABLE_USES).toContain(rishon?.use);
    expect(rishon && airport(rishon).icao).toBe('LLRS');
    const herzliya = await db.aerodrome('LLHZ');
    expect(herzliya && isLandable(airport(herzliya))).toBe(true);
  });

  // Swift plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes.
  test('plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes', async () => {
    const points = await db.reportingPoints(WHOLE_COUNTRY);
    const segments: IsraelRouteSegment[] = await db.routeSegments(WHOLE_COUNTRY);
    const plan = new IsraelRoutePlanner(points, segments).route('LLHZ', 'LLIB', 90);

    // Fly the planned polyline at 1 Hz, 150 ft above the (first) published number on every leg.
    const t0 = 1_700_000_000_000;
    const track: CVFRTrackPoint[] = [];
    let second = 0;
    for (const leg of plan.legs) {
      const published = publishedAltitudes(legAltitudeText(leg))[0] ?? 1500;
      const polyline = legPolyline(leg);
      for (let i = 0; i + 1 < polyline.length; i++) {
        const a = polyline[i];
        const b = polyline[i + 1];
        const steps = Math.max(1, Math.trunc(haversineNm(a, b) * 10));
        for (let step = 0; step < steps; step++) {
          const f = step / steps;
          track.push({
            timestamp: t0 + second * 1000,
            latitude: a.lat + (b.lat - a.lat) * f,
            longitude: a.lon + (b.lon - a.lon) * f,
            altitudeFeet: published + 150,
            groundSpeedKnots: 90,
            courseDegrees: legBearingTrue(leg),
          });
          second += 1;
        }
      }
    }
    const byCode = new Map<string, IsraelReportingPoint>();
    for (const p of points) if (!byCode.has(p.code)) byCode.set(p.code, p);

    const planned = plan.legs.map((l) => ({ segment: l.segment, forward: l.forward }));
    const debrief = buildCVFRDebrief({
      trackPoints: track,
      transcript: [],
      plannedLegs: planned,
      segments,
      points: byCode,
    });
    expect(debrief.fromPlan).toBe(true);
    expect(debrief.legs).toHaveLength(plan.legs.length);
    for (const leg of debrief.legs) {
      if (!leg.adherence) continue;
      const name = `${leg.fromCode}-${leg.toCode} ${leg.publishedAltitude ?? '-'} ${(leg.startTime - t0) / 1000}s`;
      expect({ name, fraction: leg.adherence.fractionWithin200 }).toEqual({ name, fraction: 1 });
      expect(leg.adherence.maxDeviationFeet).toBeLessThanOrEqual(150 + 1e-9);
    }
    expect(debrief.points[0]?.code).toBe('LLHZ');
    expect(debrief.points.at(-1)?.code).toBe('LLIB');
    expect(debrief.points.every((p) => p.distanceNM < 0.5)).toBe(true);

    // The same track without the plan matches the same network.
    const unplanned = buildCVFRDebrief({
      trackPoints: track,
      transcript: [],
      plannedLegs: null,
      segments,
      points: byCode,
    });
    expect(unplanned.legs.length).toBeGreaterThan(0);
    expect(unplanned.fromPlan).toBe(false);
  });
});
