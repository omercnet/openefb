// Port of efb-212Tests/DataTests/BundledAviationDataTests.swift and the Swift-independent cases of
// BundledAirportQueriesTests.swift. Runs against the real efb-212/Resources/aviation.sqlite (referenced in place, as the
// port brief requires), installed into a temp directory exactly as the app does. This is also the check that R-tree and
// FTS5 work on the Node sqlite used in Jest.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AIRPORT_TYPES,
  AIRSPACE_CLASSES,
  BUNDLED_DATA_VERSION,
  FREQUENCY_TYPES,
  LIGHTING_TYPES,
  NAVAID_TYPES,
  OWNERSHIP_TYPES,
  SURFACE_TYPES,
  createAviationDatabase,
  openAviationDatabaseFile,
  type AviationDatabase,
} from '../../../src/data/aviation';
import { distanceNm } from '../../../src/domain/geo';
import { makeTempDir, nodeInstallPlatform } from './nodeFiles';

const BUNDLED = path.resolve(__dirname, '../../../../efb-212/Resources/aviation.sqlite');
const kpaoCoord = { lat: 37.4611, lon: -122.115 };

/** Distinct values of `column` in `table` of the bundled database, with row counts. */
function distinctValues(table: string, column: string): Map<string, number> {
  const sqlite = new DatabaseSync(BUNDLED, { readOnly: true });
  try {
    const rows = sqlite.prepare(`SELECT ${column} AS value, COUNT(*) AS n FROM ${table} GROUP BY ${column}`).all();
    return new Map(rows.map((row) => [row.value === null ? '<NULL>' : String(row.value), Number(row.n)]));
  } finally {
    sqlite.close();
  }
}

const unmapped = (values: Map<string, number>, known: readonly string[]): string[] =>
  [...values.keys()].filter((value) => !known.includes(value)).sort();

describe('Bundled Aviation Data Tests', () => {
  test('everyFrequencyTypeInBundledDBIsAKnownEnumCase', () => {
    const values = distinctValues('frequencies', 'type');
    expect(values.size).toBeGreaterThan(0);
    expect(unmapped(values, FREQUENCY_TYPES)).toEqual([]);
  });

  test('everyNavaidTypeInBundledDBIsAKnownEnumCase', () => {
    const values = distinctValues('navaids', 'type');
    expect(values.size).toBeGreaterThan(0);
    expect(unmapped(values, NAVAID_TYPES)).toEqual([]);
  });

  test('everyAirportRunwayTypeInBundledDBIsAKnownEnumCase', () => {
    expect(unmapped(distinctValues('airports', 'type'), AIRPORT_TYPES)).toEqual([]);
    expect(unmapped(distinctValues('runways', 'surface'), SURFACE_TYPES)).toEqual([]);
    expect(unmapped(distinctValues('runways', 'lighting'), LIGHTING_TYPES)).toEqual([]);
  });
});

describe('Bundled Airport Queries Tests', () => {
  let db: AviationDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const handle = await openAviationDatabaseFile(
      nodeInstallPlatform(BUNDLED, path.join(makeTempDir(), 'install')),
      BUNDLED_DATA_VERSION,
    );
    db = createAviationDatabase(handle);
    close = () => handle.close();
  }, 60_000);

  afterAll(async () => close());

  test('kpaoHasRunwaysAndPlausibleFields', async () => {
    const kpao = await db.airport('KPAO');
    expect(kpao).not.toBeNull();
    expect(kpao?.runways.length).toBeGreaterThan(0);
    expect(kpao?.runways.every((r) => r.length > 0)).toBe(true); // feet
    expect(Math.abs((kpao?.latitude ?? 0) - 37.46)).toBeLessThan(0.05);
    expect(Math.abs((kpao?.longitude ?? 0) + 122.11)).toBeLessThan(0.05);
    expect(Math.abs((kpao?.elevation ?? 0) - 4)).toBeLessThan(10); // feet MSL
  });

  test('nearestToKPAOStartsWithKPAOThenAscendsInDistance', async () => {
    const nearest = await db.nearestAirports(kpaoCoord, 6);
    expect(nearest).toHaveLength(6);
    expect(nearest[0]?.icao).toBe('KPAO');
    const distances = nearest.map((a) => distanceNm(kpaoCoord, { lat: a.latitude, lon: a.longitude }));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  test('searchFindsWellKnownAirportsByIdentifierAndName', async () => {
    expect((await db.searchAirports('KSQL', 5)).map((a) => a.icao)).toContain('KSQL');
    expect((await db.searchAirports('San Carlos', 10)).map((a) => a.icao)).toContain('KSQL');
  });

  test('everyAirportInAPacificBoxIsInsideValidCoordinateRanges', async () => {
    const all = await db.airportsNear({ lat: 37.5, lon: -122.0 }, 300);
    expect(all.length).toBeGreaterThan(50);
    expect(all.every((a) => a.latitude >= -90 && a.latitude <= 90 && a.longitude >= -180 && a.longitude <= 180)).toBe(
      true,
    );
    expect(all.every((a) => a.elevation >= -300 && a.elevation <= 15000)).toBe(true); // feet MSL
    expect(new Set(all.map((a) => a.icao)).size).toBe(all.length);
  });

  test('ownershipAndMagneticVariationAreRealNotDefaults', async () => {
    const kpao = await db.airport('KPAO');
    expect(kpao?.ownership).toBe('public');
    // NASR MAG_VARN 15E in 1995 epoch: east is positive.
    expect(kpao?.magneticVariation).toBe(15);
    expect((await db.airport('KSQL'))?.patternAltitude).toBe(800); // feet AGL

    // The OurAirports import marked every field public: all three classes must now exist.
    const ownership = distinctValues('airports', 'ownership');
    expect(ownership.get('public') ?? 0).toBeGreaterThan(1000);
    expect(ownership.get('private') ?? 0).toBeGreaterThan(1000);
    expect(ownership.get('military') ?? 0).toBeGreaterThan(50);
    expect(unmapped(ownership, OWNERSHIP_TYPES)).toEqual([]);
  });

  test('kpaoRunwayEndsMatchNASRSurveyWithinAMeter', async () => {
    const kpao = await db.airport('KPAO');
    const runway = kpao?.runways.find((r) => r.id === '13/31');
    expect(runway).toBeDefined();
    // FAA NASR APT_RWY_END, cycle 2026-10-29 (degrees).
    const nasr13 = { lat: 37.46375061, lon: -122.11765513 };
    const nasr31 = { lat: 37.45849213, lon: -122.11243811 };
    const metres = 1852;
    expect(
      distanceNm({ lat: runway?.baseEndLatitude ?? 0, lon: runway?.baseEndLongitude ?? 0 }, nasr13) * metres,
    ).toBeLessThan(1);
    expect(
      distanceNm({ lat: runway?.reciprocalEndLatitude ?? 0, lon: runway?.reciprocalEndLongitude ?? 0 }, nasr31) *
        metres,
    ).toBeLessThan(1);
  });

  test('dataCycleIsOneNASR28DayCycle', async () => {
    const cycle = await db.dataCycle();
    expect(cycle?.source).toContain('NASR');
    const day = 86_400_000;
    expect(((cycle?.expiresMs ?? 0) - (cycle?.effectiveMs ?? 0)) / day).toBe(28);
    // Effective dates fall on the 28-day grid anchored at 2026-10-29 00:00 UTC.
    const anchor = 1_793_232_000_000;
    expect(((cycle?.effectiveMs ?? 0) - anchor) % (28 * day)).toBe(0);
  });

  test('airspaceIsRealClassBCDPolygonsNotCircles', async () => {
    // Over San Francisco International: Class B, surface floor, polygon geometry.
    const sfo = await db.airspacesContaining({ lat: 37.6213, lon: -122.379 });
    const bravo = sfo.find((a) => a.classification === 'bravo' && a.floor === 0);
    expect(bravo).toBeDefined();
    expect(bravo?.ceiling).toBe(10000); // feet MSL
    expect(bravo?.geometry.kind).toBe('polygon');
    if (bravo?.geometry.kind === 'polygon') expect(bravo.geometry.coordinates.length).toBeGreaterThanOrEqual(4);

    // Palo Alto Class D surrounds KPAO.
    const pao = await db.airspacesContaining(kpaoCoord);
    expect(pao.some((a) => a.classification === 'delta' && a.name.includes('PALO ALTO'))).toBe(true);

    expect(unmapped(distinctValues('airspaces', 'class'), AIRSPACE_CLASSES)).toEqual([]);
    expect([...distinctValues('airspaces', 'radius_nm').keys()]).toEqual(['<NULL>']);
  });

  test('spotCheckKPAOKSQLKSFOSearchAndNearest', async () => {
    for (const [query, icao] of [
      ['KPAO', 'KPAO'],
      ['KSQL', 'KSQL'],
      ['KSFO', 'KSFO'],
      ['San Francisco', 'KSFO'],
    ] as const) {
      expect((await db.searchAirports(query, 10)).map((a) => a.icao)).toContain(icao);
    }
    const nearest = (await db.nearestAirports(kpaoCoord, 12)).map((a) => a.icao);
    expect(nearest[0]).toBe('KPAO');
    expect(nearest).toContain('KSQL');
    const ksfo = await db.airport('KSFO');
    expect(ksfo?.runways.length).toBeGreaterThanOrEqual(4);
    expect(ksfo?.frequencies.some((f) => f.type === 'tower')).toBe(true);
  });
});
