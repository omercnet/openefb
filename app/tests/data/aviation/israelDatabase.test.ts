// Port of efb-212Tests/DataTests/IsraelAviationDatabaseTests.swift (data cases; the Region gate and the NOTAM closure
// mapper cases belong to other tickets, see docs/port-notes/D5.md). Runs on the real bundled israel-aviation.sqlite.
import fs from 'node:fs';
import path from 'node:path';
import {
  WHOLE_COUNTRY,
  airspaceContainsAltitude,
  openIsraelDatabaseFile,
  segmentAltitude,
  type IsraelAviationDatabase,
} from '../../../src/data/aviation';
import { AppFailure } from '../../../src/domain/errors';
import { openBundledIsrael } from './israelBundled';
import { makeTempDir, nodeInstallPlatform } from './nodeFiles';

describe('Israel Aviation Database Tests', () => {
  let db: IsraelAviationDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openBundledIsrael());
  });
  afterAll(async () => close());

  describe('counts (AIP: 198 points, 275 segments, 39 CTR/ATZ, 113 P/R/D, 9 TMA, 42 runways)', () => {
    test('bundledDataMatchesTheAIPCounts', async () => {
      expect(await db.reportingPoints(WHOLE_COUNTRY)).toHaveLength(198);
      expect(await db.routeSegments(WHOLE_COUNTRY)).toHaveLength(275);
      let ctrAtz = 0;
      for (const kind of ['CTR', 'ATZ', 'CTA'] as const) ctrAtz += (await db.airspacesOfKind(kind)).length;
      expect(ctrAtz).toBe(39);
      let prd = 0;
      for (const kind of ['P', 'R', 'D'] as const) prd += (await db.airspacesOfKind(kind)).length;
      expect(prd).toBe(113);
      expect(await db.airspacesOfKind('TMA')).toHaveLength(9);
      expect(await db.airspacesOfKind('FIR')).toHaveLength(1);
      expect(await db.runwaysIn(WHOLE_COUNTRY)).toHaveLength(42);
    });

    test('everySegmentEndpointResolvesToAPoint', async () => {
      const unknown: string[] = [];
      for (const segment of await db.routeSegments(WHOLE_COUNTRY)) {
        const name = `${segment.fromCode}-${segment.toCode}`;
        if (!(await db.knowsPoint(segment.fromCode))) unknown.push(`${segment.fromCode} of ${name}`);
        if (!(await db.knowsPoint(segment.toCode))) unknown.push(`${segment.toCode} of ${name}`);
      }
      expect(unknown).toEqual([]);
    });
  });

  describe('points', () => {
    test('knownPointsKeepTheirCoordinatesAndKinds', async () => {
      const tavor = await db.reportingPoint('TAVOR');
      expect(Math.abs((tavor?.latitude ?? 0) - 32.690278)).toBeLessThan(1e-5); // degrees
      expect(Math.abs((tavor?.longitude ?? 0) - 35.42)).toBeLessThan(1e-5); // degrees
      expect(tavor?.kind).toBe('onRequest');
      expect(tavor?.nameEnglish).toBe('Kfar Tavor');
      expect((await db.reportingPoint('DESHE'))?.kind).toBe('compulsory');
      const herzliya = await db.reportingPoint('llhz'); // lookups ignore case
      expect(herzliya?.kind).toBe('arp');
      expect(Math.abs((herzliya?.latitude ?? 0) - 32.179444)).toBeLessThan(1e-5);
      expect(await db.reportingPoint('NOPE1')).toBeNull();
    });

    test('pointsInARegionAreOnlyThoseInsideIt', async () => {
      // A box around Haifa bay: contains HAIFA-area points, not Eilat's.
      const north = { minLatitude: 32.6, maxLatitude: 33.0, minLongitude: 34.9, maxLongitude: 35.2 };
      const points = await db.reportingPoints(north);
      expect(points.length).toBeGreaterThan(0);
      expect(
        points.every((p) => p.latitude >= 32.6 && p.latitude <= 33.0 && p.longitude >= 34.9 && p.longitude <= 35.2),
      ).toBe(true);
      expect(points.length).toBeLessThan(198);
    });

    test('theDuplicateLLNVCodeResolvesToThePointTheRoutesUse', async () => {
      const segment = await db.routeSegment('LLNV', 'ARRAD');
      const point = await db.reportingPoint('LLNV');
      expect(segment).not.toBeNull();
      expect(point?.id).toBe(segment?.fromPointID);
    });
  });

  describe('segments', () => {
    test('aSegmentCarriesItsAltitudeForBothDirections', async () => {
      const segment = await db.routeSegment('TAVOR', 'DESHE'); // Kfar Tavor - Karey Deshe
      expect(segment).not.toBeNull();
      if (segment === null) return;
      expect(segment.altitudeForward?.feet).toBe(2500); // feet MSL, northbound
      expect(segment.altitudeReverse?.feet).toBe(3000); // feet MSL, southbound
      expect(Math.abs(segment.bearingTrue - 27.8)).toBeLessThan(0.2); // degrees true
      expect(segment.isCivil && !segment.isMilitary && !segment.isByRequest).toBe(true);
      expect(segment.polyline.length).toBeGreaterThanOrEqual(2);
      expect(segmentAltitude(segment, false)?.published).toBe('3000');
      // Stored in one direction only: the lookup does not invent the opposite segment.
      expect(await db.routeSegment('DESHE', 'TAVOR')).toBeNull();
    });

    test('aTwoNumberAltitudeIsKeptAsPublishedWithoutPickingOne', async () => {
      const segment = await db.routeSegment('HOTRM', 'DAROM');
      expect(segment?.altitudeForward?.feet).toBe(1500);
      expect(segment?.altitudeReverse?.published).toBe('1000/2000');
      expect(segment?.altitudeReverse?.feet).toBeNull();
    });

    test('theHazerimSegmentsUseTheHazerimCodeNotHazors', async () => {
      expect(await db.routeSegment('LLHB', 'OFKIM')).not.toBeNull();
      expect(await db.routeSegment('LLHS', 'OFKIM')).toBeNull();
    });

    test('segmentsInARegionIncludeOnlyThoseCrossingIt', async () => {
      const galilee = { minLatitude: 32.85, maxLatitude: 32.95, minLongitude: 35.5, maxLongitude: 35.56 };
      const segments = await db.routeSegments(galilee);
      expect(segments.some((s) => s.toCode === 'DESHE' || s.fromCode === 'DESHE')).toBe(true);
      expect(segments.length).toBeLessThan(275);
    });
  });

  describe('airspace', () => {
    // LLP07 Hadera Power Station: prohibited, surface to 2,000 ft MSL, 1 km circle around 322813N 0345311E.
    test('pointInAirspaceAtAndOutsideItsCeiling', async () => {
      const centre = { lat: 32.470278, lon: 34.886389 };
      const codes = async (altitude: number | null) =>
        (await db.airspacesContaining(centre, altitude)).map((a) => a.code);
      expect(await codes(0)).toContain('LLP07'); // surface
      expect(await codes(1_000)).toContain('LLP07');
      expect(await codes(2_000)).toContain('LLP07'); // at the ceiling
      expect(await codes(2_001)).not.toContain('LLP07'); // above it
      expect(await codes(null)).toContain('LLP07'); // no altitude: lateral only
      const outside = { lat: 32.52, lon: 34.886389 }; // ~3 NM north
      expect((await db.airspacesContaining(outside, 1_000)).some((a) => a.code === 'LLP07')).toBe(false);
    });

    // Ben-Gurion TMA sector "LLBG TMA 6 000 - 9 000".
    test('pointInAirspaceAtAndOutsideItsFloor', async () => {
      const inside = { lat: 32.00194, lon: 35.08091 };
      const inSector = async (altitude: number) =>
        (await db.airspacesContaining(inside, altitude)).some((a) => a.label === 'LLBG TMA 6 000 - 9 000');
      expect(await inSector(5_999)).toBe(false); // below the floor
      expect(await inSector(6_000)).toBe(true); // at the floor
      expect(await inSector(9_000)).toBe(true); // at the ceiling
      expect(await inSector(9_001)).toBe(false); // above it
      const tma = (await db.airspacesOfKind('TMA')).find((a) => a.label === 'LLBG TMA 6 000 - 9 000');
      expect(tma?.floor.feet).toBe(6000);
      expect(tma?.floor.reference).toBe('MSL');
      expect(tma?.ceiling.feet).toBe(9000);
      expect(tma?.authority).toBe('civil');
    });

    test('surfaceFloorsAndUnlimitedCeilingsAreExplicit', async () => {
      const fir = (await db.airspacesOfKind('FIR'))[0];
      expect(fir?.floor.reference).toBe('SFC');
      expect(fir?.ceiling.reference).toBe('UNL');
      expect(fir !== undefined && airspaceContainsAltitude(fir, 45_000)).toBe(true);
      const haifaCTR = (await db.airspacesOfKind('CTR')).find((a) => a.code === 'LLHA');
      // CAAI publishes 3000/3500 (3500 at weekends): the larger volume is used, the text kept.
      expect(haifaCTR?.ceiling.feet).toBe(3500);
      expect(haifaCTR?.ceiling.publishedText).toBe('3000/3500');
    });

    test('nearbyAirspacesIncludeThoseWhoseBoxMeetsTheRadius', async () => {
      const hadera = { lat: 32.470278, lon: 34.886389 };
      expect((await db.airspacesNear(hadera, 1)).some((a) => a.code === 'LLP07')).toBe(true);
      const eilat = { lat: 29.55, lon: 34.95 };
      expect((await db.airspacesNear(eilat, 1)).some((a) => a.code === 'LLP07')).toBe(false);
    });
  });

  describe('runways', () => {
    test('runwaysCarryDesignatorsAndEnds', async () => {
      const herzliya = (await db.runwaysOfAerodrome('LLHZ'))[0];
      expect(herzliya?.designatorA).toBe('11');
      expect(herzliya?.designatorB).toBe('29');
      expect(herzliya?.lengthMetres).toBe(903); // metres
      // End A (runway 11) lies north-west of end B (runway 29).
      expect((herzliya?.endA.lon ?? 0) < (herzliya?.endB.lon ?? 0)).toBe(true);
      expect(await db.runwaysOfAerodrome('LLBG')).toHaveLength(3);
    });
  });

  describe('metadata and attribution', () => {
    test('metadataNamesTheAmendmentAndCarriesTheAttribution', async () => {
      const metadata = await db.metadata();
      expect(metadata.aipAmendment).toBeNull(); // never guessed: the GDBs don't carry it
      expect(metadata.effectiveDate).toBeNull();
      expect(metadata.sourceDataDate).toBe('2026-10-25'); // newest GDB zip member timestamp
      expect(metadata.downloadDate).toBe('2026-11-02'); // the Sportiv zip was saved on 2 Nov
      expect(metadata.schemaVersion).toBe(3);
      expect(metadata.attribution).toBe(
        'Aeronautical data: Civil Aviation Authority of Israel (CAAI), data of 25 Oct 2026',
      );
      expect(metadata.sourceURLs).toContain('https://www.gov.il/he/pages/aip?chapterIndex=11');
    });
  });

  describe('opening', () => {
    test('aMissingFileIsReportedAsUnavailableRegionData', async () => {
      const dir = makeTempDir();
      const failure = await openIsraelDatabaseFile(nodeInstallPlatform(path.join(dir, 'no-such.sqlite'), dir)).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(AppFailure);
      expect((failure as AppFailure).error).toEqual({ kind: 'regionDataUnavailable', region: 'Israel' });
    });

    test('aFileThatIsNotTheDatabaseIsReportedAsCorrupted', async () => {
      const dir = makeTempDir();
      const garbage = path.join(dir, 'garbage.sqlite');
      fs.writeFileSync(garbage, 'not a database', 'utf8');
      const failure = await openIsraelDatabaseFile(nodeInstallPlatform(garbage, path.join(dir, 'install'))).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(AppFailure);
      expect((failure as AppFailure).error.kind).toBe('databaseCorrupted');
    });
  });
});
