// Read-only access to the app's bundled aviation.sqlite (same file the SwiftUI app ships), native only.
// Platform half of src/data/aviation: copy-on-first-launch, asset file access and the expo-sqlite connection. The
// repository and the versioning rules live in src/data/aviation and are tested there on Node's sqlite.
import { Asset } from 'expo-asset';
import { File, FileMode } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import {
  BUNDLED_DATA_VERSION,
  INSTALLED_FILE_NAME,
  VERSION_MARKER_FILE_NAME,
  createAviationDatabase,
  openAviationDatabaseFile,
  type AviationDatabase,
  type AviationDbHandle,
  type AviationInstallFiles,
  type AviationInstallPlatform,
} from '../data/aviation';
import type { SqlParams, SqlRow } from '../data/db';

export const DB_NAME = INSTALLED_FILE_NAME;

/** Metro needs a literal require to bundle the asset, so the lint rule is switched off for this one line. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundledAssetModule: number = require('../../assets/aviation.sqlite');

/** The bundled asset as a local file (Metro serves it from the app bundle on release builds, downloads it in dev). */
async function bundledFile(): Promise<File | null> {
  const asset = Asset.fromModule(bundledAssetModule);
  await asset.downloadAsync();
  return asset.localUri === null ? null : new File(asset.localUri);
}

const installedFile = (suffix = ''): File => new File(defaultDatabaseDirectory, INSTALLED_FILE_NAME + suffix);
const markerFile = (): File => new File(defaultDatabaseDirectory, VERSION_MARKER_FILE_NAME);

/** AviationInstallFiles over expo-file-system: the install directory is expo-sqlite's default database directory. */
export function expoInstallFiles(): AviationInstallFiles {
  return {
    async bundledSize() {
      const file = await bundledFile();
      return file !== null && file.exists ? file.size : null;
    },
    async readBundled(offset, length) {
      const file = await bundledFile();
      if (file === null) return new Uint8Array(0);
      const handle = file.open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return await handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
    async installedExists() {
      return installedFile().exists;
    },
    async readMarker() {
      const marker = markerFile();
      return marker.exists ? await marker.text() : null;
    },
    async removeInstalled() {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = installedFile(suffix);
        if (file.exists) file.delete();
      }
    },
    async copyBundledToInstalled() {
      const source = await bundledFile();
      if (source === null) throw new Error('bundled aviation.sqlite is missing');
      await source.copy(installedFile());
    },
    async writeMarker(text) {
      const marker = markerFile();
      if (!marker.exists) marker.create();
      await marker.write(text);
    },
  };
}

type Bindable = string | number | null | Uint8Array;
const bind = (params: SqlParams | undefined): Bindable[] => (params === undefined ? [] : [...params]);

/** The Db interface over an open expo-sqlite connection. Nested transactions are not supported (read-only data). */
function wrapExpoSqlite(sqlite: SQLiteDatabase): AviationDbHandle {
  const db: AviationDbHandle = {
    async all<T extends SqlRow>(sql: string, params?: SqlParams) {
      return sqlite.getAllAsync<T>(sql, bind(params));
    },
    async get<T extends SqlRow>(sql: string, params?: SqlParams) {
      return sqlite.getFirstAsync<T>(sql, bind(params));
    },
    async run(sql, params) {
      const result = await sqlite.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    async transaction(fn) {
      let value: Awaited<ReturnType<typeof fn>>;
      await sqlite.withExclusiveTransactionAsync(async () => {
        value = await fn(db);
      });
      // withExclusiveTransactionAsync only returns after fn resolved; a rejection propagated above.
      return value!;
    },
    async close() {
      await sqlite.closeAsync();
    },
  };
  return db;
}

let opening: Promise<{ sqlite: SQLiteDatabase; handle: AviationDbHandle }> | null = null;

const platform = (onOpen: (sqlite: SQLiteDatabase) => void): AviationInstallPlatform => ({
  files: expoInstallFiles(),
  async openInstalled() {
    const sqlite = await openDatabaseAsync(DB_NAME);
    await sqlite.execAsync('PRAGMA journal_mode = WAL');
    onOpen(sqlite);
    return wrapExpoSqlite(sqlite);
  },
});

/**
 * Installs the bundled asset into the SQLite directory on first launch (and again when the data version, size or
 * SHA-256 of the bundle changes, or the installed copy is damaged), then opens it once. Throws AppFailure
 * databaseCorrupted when the asset is missing and databaseMigrationFailed when neither copy opens.
 */
function open(): Promise<{ sqlite: SQLiteDatabase; handle: AviationDbHandle }> {
  opening ??= (async () => {
    let sqlite: SQLiteDatabase | undefined;
    const handle = await openAviationDatabaseFile(
      platform((opened) => {
        sqlite = opened;
      }),
      BUNDLED_DATA_VERSION,
    );
    return { sqlite: sqlite as SQLiteDatabase, handle };
  })().catch((error: unknown) => {
    opening = null; // let the next caller retry
    throw error;
  });
  return opening;
}

/** The raw expo-sqlite connection, for callers that run their own SQL (the map layer). */
export async function openAviationDb(): Promise<SQLiteDatabase> {
  return (await open()).sqlite;
}

/** The aviation repository (airports, airspaces, navaids, search) over the installed database. */
export async function openAviationDatabase(): Promise<AviationDatabase> {
  return createAviationDatabase((await open()).handle);
}

export type AirportDot = { icao: string; name: string; latitude: number; longitude: number };

/** Public airports whose R-tree box intersects [west, south, east, north] (AviationDatabase.airports(in:)). */
export const AIRPORTS_IN_BOX_SQL = `
  SELECT a.icao, a.name, a.latitude, a.longitude FROM airports a
  INNER JOIN airports_rtree r ON a.rowid = r.rowid
  WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
    AND a.type = 'airport' AND a.ownership = 'public'`;

/** Public airports whose R-tree box intersects [west, south, east, north] (degrees). */
export function airportsInBox(db: SQLiteDatabase, [west, south, east, north]: [number, number, number, number]) {
  return db.getAllAsync<AirportDot>(AIRPORTS_IN_BOX_SQL, [north, south, east, west]);
}
