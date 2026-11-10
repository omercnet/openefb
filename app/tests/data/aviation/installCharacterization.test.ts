// Port of efb-212Tests/CharacterizationTests/AviationDatabaseInstallCharacterizationTests.swift: installing and opening
// the bundled aviation.sqlite when the installed copy is damaged or the bundle changes without changing size, and what
// dataCycle() returns for missing or malformed metadata rows.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  INSTALLED_FILE_NAME,
  VERSION_MARKER_FILE_NAME,
  createAviationDatabase,
  installBundledDatabase,
  installFingerprint,
  openAviationDatabaseFile,
} from '../../../src/data/aviation';
import { AppFailure } from '../../../src/domain/errors';
import { writeDatabaseFile } from './fixtures';
import { makeTempDir, nodeInstallFiles, nodeInstallPlatform, wrapNodeSqlite } from './nodeFiles';

/** 4 KiB of bytes that are not an SQLite header. */
const garbage = Buffer.alloc(4096, 0x47);

const makeBundledDatabase = (file: string, kpaoName: string): void =>
  writeDatabaseFile(file, { airports: [{ icao: 'KPAO', name: kpaoName, faaID: 'PAO', lat: 37.4611, lon: -122.115 }] });

/** Pre-populates `install` with a garbage aviation.sqlite and the given marker text. */
function installGarbage(install: string, marker: string): string {
  fs.mkdirSync(install, { recursive: true });
  const installed = path.join(install, INSTALLED_FILE_NAME);
  fs.writeFileSync(installed, garbage);
  fs.writeFileSync(path.join(install, VERSION_MARKER_FILE_NAME), marker, 'utf8');
  return installed;
}

/** AviationDatabase over a database whose only table is `metadata` (null rows: no table). */
function makeMetadataDatabase(rows: [string, string][] | null) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE placeholder (id INTEGER)');
  if (rows !== null) {
    sqlite.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
    for (const [key, value] of rows) sqlite.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(key, value);
  }
  return createAviationDatabase(wrapNodeSqlite(sqlite));
}

describe('AviationDatabase Install Characterization', () => {
  describe('damaged installed copy', () => {
    test('garbageInstalledCopyWithMatchingMarkerIsReplacedFromTheBundleAndOpens', async () => {
      const dir = makeTempDir();
      const bundled = path.join(dir, 'bundled.sqlite');
      makeBundledDatabase(bundled, 'Palo Alto');
      const install = path.join(dir, 'install');
      const fingerprint = await installFingerprint(nodeInstallFiles(bundled, install), 'v1');
      const installed = installGarbage(install, fingerprint);

      // efb-91u: the marker matches but the file is not a database; open validates, discards the damaged copy and
      // re-installs from the intact bundle.
      const handle = await openAviationDatabaseFile(nodeInstallPlatform(bundled, install), 'v1');
      expect((await createAviationDatabase(handle).airport('KPAO'))?.name).toBe('Palo Alto');
      expect(fs.readFileSync(installed).equals(garbage)).toBe(false);
      expect(fs.readFileSync(path.join(install, VERSION_MARKER_FILE_NAME), 'utf8')).toBe(fingerprint);
      await handle.close();
    });

    test('corruptBundleAndCorruptInstallThrowsMigrationFailed', async () => {
      const dir = makeTempDir();
      const bundled = path.join(dir, 'bundled.sqlite');
      fs.writeFileSync(bundled, garbage);
      const install = path.join(dir, 'install');

      const failure = await openAviationDatabaseFile(nodeInstallPlatform(bundled, install), 'v1').catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(AppFailure);
      expect((failure as AppFailure).error.kind).toBe('databaseMigrationFailed');
    });

    test('garbageInstalledCopyWithStaleMarkerIsReplacedFromTheBundleAndOpens', async () => {
      const dir = makeTempDir();
      const bundled = path.join(dir, 'bundled.sqlite');
      makeBundledDatabase(bundled, 'Palo Alto');
      const install = path.join(dir, 'install');
      installGarbage(install, 'v0|1');

      const handle = await openAviationDatabaseFile(nodeInstallPlatform(bundled, install), 'v1');
      expect((await createAviationDatabase(handle).airport('KPAO'))?.name).toBe('Palo Alto');
      const marker = fs.readFileSync(path.join(install, VERSION_MARKER_FILE_NAME), 'utf8');
      const expected = await installFingerprint(nodeInstallFiles(bundled, install), 'v1');
      expect(marker).toBe(expected);
      expect(expected.startsWith('v1|')).toBe(true);
      await handle.close();
    });
  });

  describe('same-size regeneration', () => {
    test('regeneratedBundleWithSameSizeAndVersionReplacesTheInstalledCopy', async () => {
      const dir = makeTempDir();
      const v1 = path.join(dir, 'bundled-v1.sqlite');
      const v2 = path.join(dir, 'bundled-v2.sqlite');
      makeBundledDatabase(v1, 'Palo Alto');
      makeBundledDatabase(v2, 'Palo Altx'); // same length, different data
      const v1Bytes = fs.readFileSync(v1);
      const v2Bytes = fs.readFileSync(v2);
      expect(v1Bytes.length).toBe(v2Bytes.length);
      expect(v1Bytes.equals(v2Bytes)).toBe(false);

      const install = path.join(dir, 'install');
      await installBundledDatabase(nodeInstallFiles(v1, install), 'nasr-same');
      await installBundledDatabase(nodeInstallFiles(v2, install), 'nasr-same');

      // efb-0xs: the fingerprint includes a content hash, so the regenerated bundle is installed.
      expect(fs.readFileSync(path.join(install, INSTALLED_FILE_NAME)).equals(v2Bytes)).toBe(true);
      const handle = await openAviationDatabaseFile(nodeInstallPlatform(v2, install), 'nasr-same');
      expect((await createAviationDatabase(handle).airport('KPAO'))?.name).toBe('Palo Altx');
      await handle.close();
    });
  });

  describe('dataCycle', () => {
    const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

    test('dataCycleIsNilWithoutAMetadataTable', async () => {
      expect(await makeMetadataDatabase(null).dataCycle()).toBeNull();
    });

    test('dataCycleParsesYYYYMMDDAsUTCMidnight', async () => {
      const db = makeMetadataDatabase([
        ['nasr_effective', '2026-10-29'],
        ['nasr_expires', '2026-11-26'],
        ['source', 'TEST NASR'],
      ]);
      const cycle = await db.dataCycle();
      expect(cycle?.source).toBe('TEST NASR');
      expect(cycle?.effectiveMs).toBe(utc(2026, 10, 29));
      expect(cycle?.expiresMs).toBe(utc(2026, 11, 26));
    });

    test('dataCycleDefaultsSourceToFAANASR', async () => {
      const db = makeMetadataDatabase([
        ['nasr_effective', '2026-10-29'],
        ['nasr_expires', '2026-11-26'],
      ]);
      expect((await db.dataCycle())?.source).toBe('FAA NASR');
    });

    test('dataCycleIsNilWhenEffectiveIsNotADate', async () => {
      const db = makeMetadataDatabase([
        ['nasr_effective', 'not-a-date'],
        ['nasr_expires', '2026-11-26'],
      ]);
      expect(await db.dataCycle()).toBeNull();
    });

    test('dataCycleIsNilWhenExpiresIsMissing', async () => {
      expect(await makeMetadataDatabase([['nasr_effective', '2026-10-29']]).dataCycle()).toBeNull();
    });

    test('dataCycleDoesNotCheckThatExpiresFollowsEffective', async () => {
      const db = makeMetadataDatabase([
        ['nasr_effective', '2026-11-26'],
        ['nasr_expires', '2026-10-29'],
      ]);
      const cycle = await db.dataCycle();
      expect(cycle).not.toBeNull();
      expect((cycle?.expiresMs ?? 0) < (cycle?.effectiveMs ?? 0)).toBe(true);
    });
  });
});
