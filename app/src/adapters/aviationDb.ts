// Read-only access to the app's bundled aviation.sqlite (same file the SwiftUI app ships), native only.
// Platform half of src/data/aviation: copy-on-first-launch, asset file access and the expo-sqlite connection. The
// repository and the versioning rules live in src/data/aviation and are tested there on Node's sqlite.
import { Asset } from 'expo-asset';
import { Directory, File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import {
  BUNDLED_DATA_VERSION,
  INSTALLED_FILE_NAME,
  VERSION_MARKER_FILE_NAME,
  ISRAEL_BUNDLED_DATA_VERSION,
  ISRAEL_INSTALLED_FILE_NAME,
  ISRAEL_VERSION_MARKER_FILE_NAME,
  createAviationDatabase,
  createIsraelAviationDatabase,
  openAviationDatabaseFile,
  openIsraelDatabaseFile,
  type AviationDatabase,
  type AviationDbHandle,
  type AviationInstallFiles,
  type AviationInstallPlatform,
  type IsraelAviationDatabase,
} from '../data/aviation';
import type { Db, SqlParams, SqlRow } from '../data/db';

export const DB_NAME = INSTALLED_FILE_NAME;

/** Metro needs a literal require to bundle the asset, so the lint rule is switched off for this one line. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundledAssetModule: number = require('../../assets/aviation.sqlite');

/** A bundled database asset and where it is installed (both names live in expo-sqlite's default directory). */
interface AssetSpec {
  /** The Metro asset module id (the result of `require('.../x.sqlite')`). */
  assetModule: number;
  fileName: string;
  markerName: string;
}

const AVIATION: AssetSpec = {
  assetModule: bundledAssetModule,
  fileName: INSTALLED_FILE_NAME,
  markerName: VERSION_MARKER_FILE_NAME,
};

/** The bundled asset as a local file (Metro serves it from the app bundle on release builds, downloads it in dev). */
async function bundledFile(spec: AssetSpec): Promise<File | null> {
  const asset = Asset.fromModule(spec.assetModule);
  await asset.downloadAsync();
  return asset.localUri === null ? null : new File(asset.localUri);
}

const installedFile = (spec: AssetSpec, suffix = ''): File =>
  new File(defaultDatabaseDirectory, spec.fileName + suffix);
const markerFile = (spec: AssetSpec): File => new File(defaultDatabaseDirectory, spec.markerName);

/** AviationInstallFiles over expo-file-system: the install directory is expo-sqlite's default database directory. */
function expoInstallFiles(spec: AssetSpec): AviationInstallFiles {
  return {
    async bundledSize() {
      const file = await bundledFile(spec);
      return file !== null && file.exists ? file.size : null;
    },
    async bundledSha256() {
      const file = await bundledFile(spec);
      if (file === null) throw new Error(`bundled ${spec.fileName} is missing`);
      return file.digest('SHA-256');
    },
    async installedExists() {
      return installedFile(spec).exists;
    },
    async readMarker() {
      const marker = markerFile(spec);
      return marker.exists ? await marker.text() : null;
    },
    async removeInstalled() {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = installedFile(spec, suffix);
        if (file.exists) file.delete();
      }
    },
    async copyBundledToInstalled() {
      const source = await bundledFile(spec);
      if (source === null) throw new Error(`bundled ${spec.fileName} is missing`);
      // The SQLite directory can be absent on a clean install (before any database was opened).
      new Directory(defaultDatabaseDirectory).create({ intermediates: true, idempotent: true });
      await source.copy(installedFile(spec));
    },
    async writeMarker(text) {
      const marker = markerFile(spec);
      if (!marker.exists) marker.create({ intermediates: true });
      await marker.write(text);
    },
  };
}

type Bindable = string | number | null | Uint8Array;
const bind = (params: SqlParams | undefined): Bindable[] => (params === undefined ? [] : [...params]);

/** What the Db methods need from an expo-sqlite connection or exclusive-transaction handle. */
interface ExpoQueryable {
  getAllAsync<T>(sql: string, params: Bindable[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: Bindable[]): Promise<T | null>;
  runAsync(sql: string, params: Bindable[]): Promise<{ changes: number; lastInsertRowId: number }>;
}

function queryDb(target: ExpoQueryable, transaction: Db['transaction']): Db {
  return {
    all: <T extends SqlRow>(sql: string, params?: SqlParams) => target.getAllAsync<T>(sql, bind(params)),
    get: <T extends SqlRow>(sql: string, params?: SqlParams) => target.getFirstAsync<T>(sql, bind(params)),
    async run(sql, params) {
      const result = await target.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    transaction,
  };
}

/** The Db interface over an open expo-sqlite connection. Nested transactions are not supported (read-only data). */
function wrapExpoSqlite(sqlite: SQLiteDatabase): AviationDbHandle {
  const nested: Db['transaction'] = () => Promise.reject(new Error('nested transactions are not supported'));
  const db: AviationDbHandle = {
    ...queryDb(sqlite, async <T>(fn: (tx: Db) => Promise<T>) => {
      let value: T | undefined;
      // The exclusive transaction runs on its own connection: fn must use the handle it is given.
      await sqlite.withExclusiveTransactionAsync(async (txn) => {
        value = await fn(queryDb(txn, nested));
      });
      return value as T;
    }),
    async close() {
      await sqlite.closeAsync();
    },
  };
  return db;
}

let opening: Promise<{ sqlite: SQLiteDatabase; handle: AviationDbHandle }> | null = null;

const platform = (spec: AssetSpec, onOpen: (sqlite: SQLiteDatabase) => void): AviationInstallPlatform => ({
  files: expoInstallFiles(spec),
  async openInstalled() {
    const sqlite = await openDatabaseAsync(spec.fileName);
    try {
      await sqlite.execAsync('PRAGMA journal_mode = WAL');
    } catch (error) {
      // Not closing would leave this connection open while the retry deletes and re-copies the file.
      await sqlite.closeAsync().catch(() => undefined);
      throw error;
    }
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
      platform(AVIATION, (opened) => {
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

const israelOpenings = new Map<number, Promise<IsraelAviationDatabase>>();

/**
 * The Israel aviation repository over the installed israel-aviation.sqlite. The caller passes the Metro asset module
 * (`require('../../assets/israel-aviation.sqlite')`, copied there from efb-212/Resources as aviation.sqlite is) so this
 * adapter does not force the asset on builds that do not ship it. Throws AppFailure regionDataUnavailable when the
 * asset is missing and databaseCorrupted when it cannot be read or has an unsupported schema.
 */
export function openIsraelDatabase(assetModule: number): Promise<IsraelAviationDatabase> {
  const spec: AssetSpec = {
    assetModule,
    fileName: ISRAEL_INSTALLED_FILE_NAME,
    markerName: ISRAEL_VERSION_MARKER_FILE_NAME,
  };
  const cached = israelOpenings.get(assetModule);
  if (cached !== undefined) return cached;
  const opening = openIsraelDatabaseFile(
    platform(spec, () => undefined),
    ISRAEL_BUNDLED_DATA_VERSION,
  )
    .then((handle) => createIsraelAviationDatabase(handle))
    .catch((error: unknown) => {
      israelOpenings.delete(assetModule); // let the next caller retry
      throw error;
    });
  israelOpenings.set(assetModule, opening);
  return opening;
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
