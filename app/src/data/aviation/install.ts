// Installing the bundled aviation.sqlite into app storage on first launch and refreshing it when the bundle changes.
// Port of the install half of Data/AviationDatabase.swift. File access is the AviationInstallFiles interface
// (implemented over expo-file-system in src/adapters/aviationDb.ts, over node:fs in tests).
import { AppFailure } from '../../domain/errors';
import type { Db } from '../db';

/** Version of the bundled aviation.sqlite. Bump whenever tools/nasr-importer regenerates the file; the fingerprint
 * also includes the file's size and SHA-256, so a regenerated file with a forgotten bump is still re-copied. */
export const BUNDLED_DATA_VERSION = 'nasr-2026-10-29';

/** Name of the installed database file and its version marker (both in the install directory). */
export const INSTALLED_FILE_NAME = 'aviation.sqlite';
export const VERSION_MARKER_FILE_NAME = 'aviation.sqlite.version';

/** The platform piece: the bundled asset and the install directory. Paths are the implementation's business. */
export interface AviationInstallFiles {
  /** Size in bytes of the bundled file, or null when it does not exist. */
  bundledSize(): Promise<number | null>;
  /** Lower-case hex SHA-256 of the bundled file's contents (native digest on device, so no JS hashing at launch). */
  bundledSha256(): Promise<string>;
  installedExists(): Promise<boolean>;
  /** Text of the version marker, or null when there is none. */
  readMarker(): Promise<string | null>;
  /** Deletes the installed database and its -wal and -shm sidecars; missing files are fine. */
  removeInstalled(): Promise<void>;
  /** Creates the install directory if needed and copies the bundled file over the installed path. */
  copyBundledToInstalled(): Promise<void>;
  writeMarker(text: string): Promise<void>;
}

/** An open connection to the installed file; close is for tests and for the retry after a damaged copy. */
export interface AviationDbHandle extends Db {
  close(): Promise<void>;
}

export interface AviationInstallPlatform {
  files: AviationInstallFiles;
  /** Opens the installed file (WAL mode on platforms that support it). */
  openInstalled(): Promise<AviationDbHandle>;
}

/**
 * "<dataVersion>|<bundled size in bytes>|<SHA-256 of the bundled file, hex>". Catches a regenerated bundle of identical
 * size. Throws databaseCorrupted when the bundled file does not exist.
 */
export async function installFingerprint(files: AviationInstallFiles, dataVersion: string): Promise<string> {
  const size = await files.bundledSize();
  if (size === null) throw new AppFailure({ kind: 'databaseCorrupted' });
  const digest = await files.bundledSha256();
  return `${dataVersion}|${size}|${digest}`;
}

/**
 * Copies the bundled database into the install directory when it is missing, its fingerprint differs from the installed
 * marker, or `force` is set. Removes the old file and its sidecars first so a stale write-ahead log can never be applied
 * to the fresh file. Returns whether it copied. Throws databaseCorrupted when the bundled file does not exist.
 */
export async function installBundledDatabase(
  files: AviationInstallFiles,
  dataVersion: string,
  force = false,
): Promise<boolean> {
  const fingerprint = await installFingerprint(files, dataVersion);
  const upToDate = (await files.installedExists()) && (await files.readMarker()) === fingerprint;
  if (upToDate && !force) return false;
  await files.removeInstalled();
  await files.copyBundledToInstalled();
  await files.writeMarker(fingerprint);
  return true;
}

/** Opens the installed file and verifies it is a usable aviation database: quick_check "ok" and an `airports` table. */
async function openValidated(platform: AviationInstallPlatform): Promise<AviationDbHandle> {
  const handle = await platform.openInstalled();
  try {
    const check = await handle.get('PRAGMA quick_check');
    const result = check === null ? undefined : Object.values(check)[0];
    if (result !== 'ok') throw new Error(`quick_check: ${String(result ?? 'no result')}`);
    const table = await handle.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'airports'");
    if (table === null) throw new Error('missing airports table');
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Installs the bundled database (first launch or changed bundle) and opens it. A damaged installed copy (it cannot be
 * opened or fails quick_check) is discarded and re-installed from the bundle once before giving up with
 * databaseMigrationFailed. A missing bundle is databaseCorrupted.
 */
export async function openAviationDatabaseFile(
  platform: AviationInstallPlatform,
  dataVersion: string = BUNDLED_DATA_VERSION,
): Promise<AviationDbHandle> {
  await installBundledDatabase(platform.files, dataVersion);
  try {
    return await openValidated(platform);
  } catch {
    // Damaged installed copy: wipe it (and its marker) and re-copy from the bundle.
    await installBundledDatabase(platform.files, dataVersion, true);
    try {
      return await openValidated(platform);
    } catch (cause) {
      throw new AppFailure({ kind: 'databaseMigrationFailed', cause });
    }
  }
}
