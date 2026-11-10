// Opening the bundled israel-aviation.sqlite. Swift opened the file in place from the app bundle (read-only, nothing to
// install). expo-sqlite can only open databases in its own directory, so the file is copied there with the same
// versioned install as aviation.sqlite (install.ts); the schema check is the Swift one.
import { AppFailure } from '../../domain/errors';
import { installBundledDatabase, type AviationDbHandle, type AviationInstallPlatform } from './install';
import { SUPPORTED_SCHEMA_VERSION } from './israelDatabase';

/** Version label of the bundled israel-aviation.sqlite; the fingerprint also covers its size and SHA-256. */
export const ISRAEL_BUNDLED_DATA_VERSION = 'caai-2026-10-25';
/** File names in the install directory. */
export const ISRAEL_INSTALLED_FILE_NAME = 'israel-aviation.sqlite';
export const ISRAEL_VERSION_MARKER_FILE_NAME = 'israel-aviation.sqlite.version';

/** The display name of the region the data covers, as in Region.israel.displayName. */
const REGION_NAME = 'Israel';

/**
 * Installs (when missing or changed) and opens the Israel database. Throws AppFailure `regionDataUnavailable` when the
 * bundled file is missing and `databaseCorrupted` when it cannot be read or its schema version is not supported.
 */
export async function openIsraelDatabaseFile(
  platform: AviationInstallPlatform,
  dataVersion: string = ISRAEL_BUNDLED_DATA_VERSION,
): Promise<AviationDbHandle> {
  if ((await platform.files.bundledSize()) === null) {
    throw new AppFailure({ kind: 'regionDataUnavailable', region: REGION_NAME });
  }
  let handle: AviationDbHandle | null = null;
  try {
    await installBundledDatabase(platform.files, dataVersion);
    handle = await platform.openInstalled();
    const row = await handle.get("SELECT value FROM metadata WHERE key = 'schema_version'");
    if (row?.value !== String(SUPPORTED_SCHEMA_VERSION)) throw new AppFailure({ kind: 'databaseCorrupted' });
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error instanceof AppFailure ? error : new AppFailure({ kind: 'databaseCorrupted' });
  }
}
