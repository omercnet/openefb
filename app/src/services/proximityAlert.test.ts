// Port of ServiceTests/ProximityAlertAltitudeTests.swift (10 tests) and the three proximity cases of
// ServiceTests/TFRServiceTests.swift (the TFR fixtures are read in place from the Swift test file).
import type { Airspace, Tfr } from '../domain/core/models';
import { AppFailure } from '../domain/errors';
import { joinTfrs, parseTfrDetail, parseTfrFeatures, type TfrDetail } from './tfr';
import {
  airspaceAlerts,
  alertIsInside,
  alertRelationLabel,
  tfrAlerts,
  verticalRelation,
  type ProximityAlert,
} from './proximityAlert';
import { ProximityAlertService, type AirspaceSource } from './proximityAlertService';
import { swiftRawFixture } from './swiftFixtures';

const box = (latMin: number, latMax: number, lonMin: number, lonMax: number): Airspace['geometry'] => ({
  kind: 'polygon',
  coordinates: [
    [latMin, lonMin],
    [latMin, lonMax],
    [latMax, lonMax],
    [latMax, lonMin],
    [latMin, lonMin],
  ],
});

// Stacked SFO Class B shelves (simplified): SFC-10000 core, 3000-10000 and 6000-10000 rings.
const shelf = (id: string, floor: number, geometry: Airspace['geometry']): Airspace => ({
  id,
  classification: 'bravo',
  name: 'SFO Class B',
  floor,
  ceiling: 10000,
  geometry,
});
const core = shelf('core', 0, box(37.6, 37.65, -122.42, -122.35));
const middle = shelf('middle', 3000, box(37.5, 37.75, -122.52, -122.25));
const outer = shelf('outer', 6000, box(37.3, 37.95, -122.8, -122.0));
const shelves = [core, middle, outer];

/** Inside the middle and outer rings only (laterally outside the core). */
const ringPoint = { lat: 37.7, lon: -122.3 };
const centerPoint = { lat: 37.625, lon: -122.385 };

const alertsAt = (altitude: number | null, at = ringPoint) => airspaceAlerts(at, altitude, shelves).alerts;
const insideIDs = (alerts: ProximityAlert[]) => new Set(alerts.filter(alertIsInside).map((a) => a.id));

test('belowTheShelfIsNearNotInside', () => {
  const alerts = alertsAt(2000); // under the 3000 ft floor
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts.every((a) => !alertIsInside(a))).toBe(true);
  expect(alerts.every((a) => alertRelationLabel(a) === 'NEAR')).toBe(true);
  expect(alerts.some((a) => a.vertical === 'below')).toBe(true);
});

test('insideTheMiddleShelfOnlyAlertsInsideForThatShelf', () => {
  const alerts = alertsAt(4500); // above 3000 floor, below the 6000 outer floor
  expect(insideIDs(alerts)).toEqual(new Set([`airspace-${middle.id}`]));
  const outerAlert = alerts.find((a) => a.id === `airspace-${outer.id}`);
  expect(outerAlert?.vertical).toBe('below');
  expect(outerAlert && alertIsInside(outerAlert)).toBe(false);
});

test('insideBothShelvesAtHigherAltitude', () => {
  expect(insideIDs(alertsAt(8000))).toEqual(new Set([`airspace-${middle.id}`, `airspace-${outer.id}`]));
});

test('aboveTheCeilingIsNearNotInside', () => {
  const alerts = alertsAt(11000);
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts.every((a) => a.vertical === 'above' && !alertIsInside(a))).toBe(true);
});

test('surfaceShelfContainsLowAltitude', () => {
  expect(insideIDs(alertsAt(500, centerPoint))).toEqual(new Set([`airspace-${core.id}`]));
});

test('limitsAreInclusive', () => {
  expect(verticalRelation(3000, 3000, 10000)).toBe('within');
  expect(verticalRelation(10000, 3000, 10000)).toBe('within');
  expect(verticalRelation(2999, 3000, 10000)).toBe('below');
  expect(verticalRelation(10001, 3000, 10000)).toBe('above');
});

test('unknownAltitudeNeverSaysInside', () => {
  for (const at of [ringPoint, centerPoint]) {
    const alerts = alertsAt(null, at);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.vertical === 'unknown' && !alertIsInside(a) && alertRelationLabel(a) === 'NEAR')).toBe(
      true,
    );
  }
});

test('outsideLaterallyStillUsesClassThreshold', () => {
  // ~2 NM north of the outer ring (37.95): within the 5 NM Class B threshold
  const near = alertsAt(8000, { lat: 37.95 + 2 / 60, lon: -122.4 });
  expect(near).toHaveLength(1);
  expect(alertIsInside(near[0])).toBe(false);
  expect(near[0].distance).toBeGreaterThan(1.5);
  // ~20 NM away: no alert
  expect(alertsAt(8000, { lat: 37.95 + 20 / 60, lon: -122.4 })).toEqual([]);
});

// MARK: Service state

const source = (state: { airspaces: Airspace[]; error: Error | null }): AirspaceSource => ({
  airspaces: async () => {
    if (state.error) throw state.error;
    return state.airspaces;
  },
});
const t0 = 1_000_000_000;

test('serviceStateReflectsAltitude', async () => {
  const service = new ProximityAlertService({ source: source({ airspaces: shelves, error: null }) });
  await service.checkProximity(ringPoint, 2000, t0);
  expect(service.isInAirspace).toBe(false);
  expect(service.activeAlerts.length).toBeGreaterThan(0);

  await service.checkProximity(ringPoint, 8000, t0 + 5000); // throttled inside 10 s
  expect(service.isInAirspace).toBe(false);

  await service.checkProximity(ringPoint, 8000, t0 + 11_000);
  expect(service.isInAirspace).toBe(true);

  await service.checkProximity(ringPoint, null, t0 + 22_000);
  expect(service.isInAirspace).toBe(false);
  expect(service.nearestAirspaceDistance).toBe(0);
});

test('aDatabaseErrorIsReportedNotShownAsNoAlert', async () => {
  const state = { airspaces: shelves, error: null as Error | null };
  const service = new ProximityAlertService({ source: source(state) });
  await service.checkProximity(ringPoint, 8000, t0);
  expect(service.isInAirspace).toBe(true);
  expect(service.checkUnavailable).toBe(false);

  state.error = new AppFailure({ kind: 'databaseCorrupted' });
  await service.checkProximity(ringPoint, 8000, t0 + 11_000);
  expect(service.checkUnavailable).toBe(true); // not just an empty alert list
  expect(service.activeAlerts).toEqual([]);
  expect(service.isInAirspace).toBe(false);

  state.error = null;
  await service.checkProximity(ringPoint, 8000, t0 + 22_000);
  expect(service.checkUnavailable).toBe(false);
  expect(service.isInAirspace).toBe(true);
});

// MARK: TFR proximity (TFRServiceTests)

const SWIFT = 'ServiceTests/TFRServiceTests.swift';
function joinedFixtureTFRs(): Tfr[] {
  const details = new Map<string, TfrDetail>([
    ['6/4348', parseTfrDetail(swiftRawFixture(SWIFT, 'detail4348')) as TfrDetail],
    ['9/2934', parseTfrDetail(swiftRawFixture(SWIFT, 'detail2934')) as TfrDetail],
  ]);
  return joinTfrs(parseTfrFeatures(swiftRawFixture(SWIFT, 'wfsJSON')), details);
}
const utc = (iso: string) => Date.parse(iso);

test('proximityAlertUsesPolygonBoundary', () => {
  const surfaceArea = joinedFixtureTFRs().find((t) => t.id === '6/4348#1') as Tfr; // lat 47.908-48.017, lon -97.450 to -97.392
  const now = utc('2026-10-30T12:00:00Z');

  const inside = tfrAlerts({ lat: 47.96, lon: -97.42 }, [surfaceArea], now);
  expect(inside).toHaveLength(1);
  expect(inside[0].distance).toBe(0);
  expect(inside[0].altitude).toBe("SFC-2400' MSL");
  expect(inside[0].type).toBe('tfr');

  // 2 NM south of the southern edge (47.90833333 - 2/60)
  const near = tfrAlerts({ lat: 47.875, lon: -97.42 }, [surfaceArea], now);
  expect(Math.abs(near[0].distance - 2)).toBeLessThan(0.01);

  // 6 NM south of the edge: beyond the 3 NM threshold
  expect(tfrAlerts({ lat: 47.80833333, lon: -97.42 }, [surfaceArea], now)).toEqual([]);
});

test('proximityAlertIgnoresInactiveTFRs', () => {
  const surfaceArea = joinedFixtureTFRs().find((t) => t.id === '6/4348#1') as Tfr;
  expect(tfrAlerts({ lat: 47.96, lon: -97.42 }, [surfaceArea], utc('2026-11-02T00:00:00Z'))).toEqual([]);
});

test('proximityAlertsSortedNearestFirst', () => {
  // Inside Area B (which surrounds the surface area) and 2 NM south of the surface area; FDC 9/2934 in Dallas is ~900 NM away
  const alerts = tfrAlerts({ lat: 47.875, lon: -97.42 }, joinedFixtureTFRs(), utc('2026-10-30T12:00:00Z'));
  expect(alerts.map((a) => a.id)).toEqual(['tfr-6/4348#0', 'tfr-6/4348#1']);
  expect(alerts[0].distance).toBe(0);
  expect(alerts[0].altitude).toBe("2400' MSL-FL180");
  expect(alerts[0].name.startsWith('TFR 6/4348 \u2014 ')).toBe(true);
});

// JS-only guards (port notes S1e)

test('a late database answer cannot overwrite a newer check', async () => {
  const releases: ((a: Airspace[]) => void)[] = [];
  const slow: AirspaceSource = { airspaces: () => new Promise<Airspace[]>((resolve) => releases.push(resolve)) };
  const service = new ProximityAlertService({ source: slow });
  const first = service.checkProximity(ringPoint, 8000, t0);
  const second = service.checkProximity(ringPoint, 8000, t0 + 11_000);
  releases[1](shelves); // the newer check answers first
  await second;
  expect(service.isInAirspace).toBe(true);
  releases[0]([]); // the older answer arrives late
  await first;
  expect(service.isInAirspace).toBe(true);
  expect(service.activeAlerts.length).toBeGreaterThan(0);
});

test('TFR alerts merge with airspace alerts and replace older TFR alerts; non-finite altitude is unknown', async () => {
  const service = new ProximityAlertService({ source: source({ airspaces: shelves, error: null }) });
  await service.checkProximity(ringPoint, 8000, t0);
  const airspaceCount = service.activeAlerts.length;
  const tfrs = joinedFixtureTFRs();
  service.checkTFRProximity({ lat: 47.875, lon: -97.42 }, tfrs, utc('2026-10-30T12:00:00Z'));
  expect(service.activeAlerts.length).toBe(airspaceCount + 2);
  service.checkTFRProximity({ lat: 0, lon: 0 }, tfrs, utc('2026-10-30T12:00:00Z'));
  expect(service.activeAlerts).toHaveLength(airspaceCount);
  expect(verticalRelation(Number.NaN, 0, 100)).toBe('unknown');
});

test('circle airspaces, short centres and unlimited ceilings', () => {
  const circle: Airspace = {
    id: 'c',
    classification: 'charlie',
    name: 'C',
    floor: 1200,
    ceiling: 99999,
    geometry: { kind: 'circle', center: [37.0, -122.0], radiusNM: 5 },
  };
  const inside = airspaceAlerts({ lat: 37.0, lon: -122.0 }, 2000, [circle]);
  expect(inside.alerts[0].altitude).toBe("1200'-UNL");
  expect(inside.nearestDistance).toBe(0);
  const outside = airspaceAlerts({ lat: 37.0 + 7 / 60, lon: -122.0 }, 2000, [circle]); // 2 NM outside, threshold 3
  expect(outside.alerts).toHaveLength(1);
  expect(outside.alerts[0].distance).toBeCloseTo(2, 1);
  const broken: Airspace = { ...circle, id: 'b', geometry: { kind: 'circle', center: [37.0], radiusNM: 5 } };
  expect(airspaceAlerts({ lat: 37, lon: -122 }, 2000, [broken])).toEqual({
    alerts: [],
    nearestDistance: Number.MAX_VALUE,
  });
});
