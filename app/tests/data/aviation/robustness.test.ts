// Port of efb-212Tests/DataTests/AviationDatabaseRobustnessTests.swift (the aviation half; the DatabaseManager,
// UnavailableDatabaseService and AppState cases belong to D2 and the services track, see docs/port-notes/D5.md).
import fs from 'node:fs';
import path from 'node:path';
import { AppFailure } from '../../../src/domain/errors';
import {
  INSTALLED_FILE_NAME,
  createAviationDatabase,
  ftsMatchExpression,
  VERSION_MARKER_FILE_NAME,
  installBundledDatabase,
  installFingerprint,
  openAviationDatabaseFile,
} from '../../../src/data/aviation';
import { makeDatabase, writeDatabaseFile, type AirportRow } from './fixtures';
import { makeTempDir, nodeInstallFiles, nodeInstallPlatform } from './nodeFiles';

const bayArea: AirportRow[] = [
  { icao: 'KPAO', name: 'Palo Alto', faaID: 'PAO', lat: 37.4611, lon: -122.115 },
  { icao: 'KSQL', name: 'San Carlos', faaID: 'SQL', lat: 37.5119, lon: -122.2494 },
  { icao: 'KSFO', name: 'San Francisco Intl', faaID: 'SFO', lat: 37.6213, lon: -122.379 },
  { icao: 'KSJC', name: 'Norman Y Mineta San Jose Intl', faaID: 'SJC', lat: 37.3626, lon: -121.9291 },
];
const paloAlto = { lat: 37.4611, lon: -122.115 };

describe('AviationDatabase Robustness Tests', () => {
  describe('nearest airports (circle, not box)', () => {
    // The first search box (25 NM half-side) contains a corner airport at ~35 NM and excludes an airport at 27 NM due
    // east. The nearest airport must be the closer one outside the box.
    test('nearestPrefersCloserAirportOutsideFirstBoxOverCornerAirport', async () => {
      // At latitude 0 the box is square in degrees: half-side 25/60 = 0.4167 deg.
      const corner: AirportRow = { icao: 'CORN', name: 'Corner Field', lat: 0.41, lon: 0.41 }; // ~34.8 NM
      const closer: AirportRow = { icao: 'EAST', name: 'East Field', lat: 0.0, lon: 0.45 }; // 27.0 NM
      const db = makeDatabase({ airports: [corner, closer] });
      const center = { lat: 0, lon: 0 };

      expect((await db.nearestAirports(center, 1)).map((a) => a.icao)).toEqual(['EAST']);
      expect((await db.nearestAirports(center, 2)).map((a) => a.icao)).toEqual(['EAST', 'CORN']);
    });

    test('nearestIsSortedByGreatCircleDistance', async () => {
      const db = makeDatabase({ airports: bayArea });
      const nearest = await db.nearestAirports(paloAlto, 4);
      expect(nearest.map((a) => a.icao)).toEqual(['KPAO', 'KSQL', 'KSJC', 'KSFO']);
    });

    test('nearestReturnsFewerThanRequestedWhenCircleIsExhausted', async () => {
      const db = makeDatabase({ airports: bayArea });
      const newYork = { lat: 40.6413, lon: -73.7781 };

      // Bay Area is >2,000 NM away; the search stops at the max radius and returns nothing.
      expect(await db.nearestAirports(newYork, 3)).toEqual([]);
      // Count larger than the database: returns everything within the max radius, sorted.
      expect(await db.nearestAirports(paloAlto, 10)).toHaveLength(4);
      expect(await db.nearestAirports(paloAlto, 0)).toEqual([]);
    });
  });

  describe('FTS5 escaping', () => {
    test('ftsMatchExpressionQuotesEveryToken', () => {
      expect(ftsMatchExpression('KPAO')).toBe('"KPAO"*');
      expect(ftsMatchExpression('KPAO-1')).toBe('"KPAO"* "1"*');
      expect(ftsMatchExpression('"Palo Alto"')).toBe('"Palo"* "Alto"*');
      expect(ftsMatchExpression('  san  carlos ')).toBe('"san"* "carlos"*');
      expect(ftsMatchExpression('')).toBeNull();
      expect(ftsMatchExpression('   ')).toBeNull();
      expect(ftsMatchExpression('"')).toBeNull();
      expect(ftsMatchExpression('-')).toBeNull();
      expect(ftsMatchExpression('(*) OR NOT')).toBe('"OR"* "NOT"*');
    });

    test('searchDoesNotThrowOnQuotesDashesOrEmptyInput', async () => {
      const db = makeDatabase({ airports: bayArea });

      expect(await db.searchAirports('', 10)).toEqual([]);
      expect(await db.searchAirports('"', 10)).toEqual([]);
      expect(await db.searchAirports('-', 10)).toEqual([]);
      expect(await db.searchAirports('KPAO-1', 10)).toEqual([]); // no airport matches "1"
      expect((await db.searchAirports('"KPAO"', 10)).map((a) => a.icao)).toEqual(['KPAO']);
      expect((await db.searchAirports('san-carlos', 10)).map((a) => a.icao)).toEqual(['KSQL']);
    });

    test('searchMatchesPrefixOfIdentifierNameAndFAAID', async () => {
      const db = makeDatabase({ airports: bayArea });

      expect((await db.searchAirports('kpa', 10)).map((a) => a.icao)).toEqual(['KPAO']);
      expect((await db.searchAirports('palo', 10)).map((a) => a.icao)).toEqual(['KPAO']);
      expect((await db.searchAirports('SFO', 10)).map((a) => a.icao)).toEqual(['KSFO']);
      expect(await db.searchAirports('san', 10)).toHaveLength(3);
      expect(await db.searchAirports('san', 2)).toHaveLength(2);
    });
  });

  describe('bundled database refresh', () => {
    const writeBundled = (contents: string, dir: string, name = 'bundled.sqlite'): string => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, contents, 'utf8');
      return file;
    };

    test('installCopiesWhenMissingAndKeepsInstalledCopyForSameVersion', async () => {
      const dir = makeTempDir();
      const install = path.join(dir, 'install');
      const files = nodeInstallFiles(writeBundled('bundled-v1', dir), install);

      await installBundledDatabase(files, '1');
      const installed = path.join(install, INSTALLED_FILE_NAME);
      expect(fs.readFileSync(installed, 'utf8')).toBe('bundled-v1');
      const marker = path.join(install, VERSION_MARKER_FILE_NAME);
      expect(fs.readFileSync(marker, 'utf8')).toBe(await installFingerprint(files, '1'));

      // Simulate local state (e.g. a cache written by the app) in the installed copy.
      fs.writeFileSync(installed, 'installed-local-state', 'utf8');
      // Same version and same bundled size: must not recopy.
      await installBundledDatabase(files, '1');
      expect(fs.readFileSync(installed, 'utf8')).toBe('installed-local-state');
    });

    test('installRecopiesOnVersionChangeAndRemovesSidecars', async () => {
      const dir = makeTempDir();
      const install = path.join(dir, 'install');
      await installBundledDatabase(nodeInstallFiles(writeBundled('bundled-v1', dir), install), '1');
      const installed = path.join(install, INSTALLED_FILE_NAME);

      // Stale WAL/SHM sidecars from the previous copy must not survive a refresh.
      const wal = installed + '-wal';
      const shm = installed + '-shm';
      fs.writeFileSync(wal, 'wal', 'utf8');
      fs.writeFileSync(shm, 'shm', 'utf8');

      const filesV2 = nodeInstallFiles(writeBundled('bundled-v2', dir, 'bundled2.sqlite'), install);
      await installBundledDatabase(filesV2, '2');
      expect(fs.readFileSync(installed, 'utf8')).toBe('bundled-v2');
      expect(fs.existsSync(wal)).toBe(false);
      expect(fs.existsSync(shm)).toBe(false);
      const marker = path.join(install, VERSION_MARKER_FILE_NAME);
      expect(fs.readFileSync(marker, 'utf8')).toBe(await installFingerprint(filesV2, '2'));
    });

    test('installRecopiesWhenBundledSizeChangesWithSameVersion', async () => {
      const dir = makeTempDir();
      const install = path.join(dir, 'install');
      await installBundledDatabase(nodeInstallFiles(writeBundled('bundled-v1', dir), install), '1');

      // Importer regenerated the file (different size) but nobody bumped the version constant.
      const regenerated = writeBundled('bundled-v1-regenerated', dir, 'regenerated.sqlite');
      await installBundledDatabase(nodeInstallFiles(regenerated, install), '1');
      expect(fs.readFileSync(path.join(install, INSTALLED_FILE_NAME), 'utf8')).toBe('bundled-v1-regenerated');
    });

    test('installThrowsDatabaseCorruptedWhenBundledFileIsMissing', async () => {
      const dir = makeTempDir();
      const files = nodeInstallFiles(path.join(dir, 'missing.sqlite'), dir);
      const failure = await installBundledDatabase(files, '1').catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(AppFailure);
      expect((failure as AppFailure).error.kind).toBe('databaseCorrupted');
    });

    test('initInstallsRealSQLiteAndOpensIt', async () => {
      const dir = makeTempDir();
      const bundled = path.join(dir, 'bundled.sqlite');
      writeDatabaseFile(bundled, { airports: bayArea });

      const install = path.join(dir, 'install');
      const handle = await openAviationDatabaseFile(nodeInstallPlatform(bundled, install), 'test');
      const db = createAviationDatabase(handle);
      expect((await db.airport('KPAO'))?.name).toBe('Palo Alto');
      expect((await db.nearestAirports({ lat: 37.46, lon: -122.11 }, 1)).map((a) => a.icao)).toEqual(['KPAO']);
      expect(fs.existsSync(path.join(install, VERSION_MARKER_FILE_NAME))).toBe(true);
      await handle.close();
    });
  });
});
