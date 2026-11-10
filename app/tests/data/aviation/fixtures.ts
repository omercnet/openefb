// Synthetic aviation database carrying the bundled schema (airports, runways, frequencies, navaids, airspaces, R-trees,
// FTS5). Mirrors AviationDatabaseTests.makeDatabase and AviationDatabaseRobustnessTests.makeDatabasePool.
import { DatabaseSync } from 'node:sqlite';
import { createAviationDatabase } from '../../../src/data/aviation';
import { wrapNodeSqlite } from './nodeFiles';

export interface AirportRow {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  faaID?: string | null;
  type?: string;
  ownership?: string;
  fuelTypes?: string | null;
  hasBeacon?: number;
}
export interface RunwayRow {
  airport: string;
  id: string;
  length: number;
  surface?: string;
  lighting?: string;
}
export interface FrequencyRow {
  airport: string;
  id: string;
  type: string;
  name: string;
  frequency: number;
}
export interface NavaidRow {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  elevation?: number | null;
}
export interface AirspaceRow {
  id: string;
  name: string;
  classification: string;
  floor?: number;
  ceiling?: number;
  center?: { lat: number; lon: number } | null;
  radiusNM?: number | null;
  coordinatesJSON?: string | null;
  box: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export interface FixtureRows {
  airports?: AirportRow[];
  runways?: RunwayRow[];
  frequencies?: FrequencyRow[];
  navaids?: NavaidRow[];
  airspaces?: AirspaceRow[];
}

const SCHEMA = `
  CREATE TABLE airports (
    icao TEXT PRIMARY KEY, faa_id TEXT, name TEXT NOT NULL,
    latitude REAL NOT NULL, longitude REAL NOT NULL,
    elevation REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'airport', ownership TEXT NOT NULL DEFAULT 'public',
    ctaf_frequency REAL, unicom_frequency REAL, artcc_id TEXT, fss_id TEXT,
    magnetic_variation REAL, pattern_altitude INTEGER,
    fuel_types TEXT DEFAULT '[]', has_beacon_light INTEGER DEFAULT 0
  );
  CREATE TABLE runways (
    id TEXT NOT NULL, airport_icao TEXT NOT NULL,
    length INTEGER NOT NULL, width INTEGER NOT NULL,
    surface TEXT NOT NULL DEFAULT 'asphalt', lighting TEXT NOT NULL DEFAULT 'none',
    base_end_id TEXT NOT NULL, reciprocal_end_id TEXT NOT NULL,
    base_end_latitude REAL NOT NULL DEFAULT 0, base_end_longitude REAL NOT NULL DEFAULT 0,
    reciprocal_end_latitude REAL NOT NULL DEFAULT 0, reciprocal_end_longitude REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE frequencies (
    id TEXT NOT NULL, airport_icao TEXT NOT NULL,
    type TEXT NOT NULL, name TEXT NOT NULL, frequency REAL NOT NULL
  );
  CREATE TABLE navaids (
    id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'vor', name TEXT NOT NULL,
    latitude REAL NOT NULL, longitude REAL NOT NULL,
    frequency REAL NOT NULL DEFAULT 0, elevation REAL, magnetic_variation REAL
  );
  CREATE TABLE airspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL,
    floor_altitude INTEGER NOT NULL DEFAULT 0, ceiling_altitude INTEGER NOT NULL DEFAULT 18000,
    center_latitude REAL, center_longitude REAL, radius_nm REAL, coordinates TEXT,
    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL
  );
  CREATE VIRTUAL TABLE airports_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
  CREATE VIRTUAL TABLE navaids_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
  CREATE VIRTUAL TABLE airspaces_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
  CREATE VIRTUAL TABLE airports_fts USING fts5(icao, name, faa_id, content=airports, content_rowid=rowid);
`;

/** Creates the schema and rows in an open node:sqlite database. */
export function populate(sqlite: DatabaseSync, rows: FixtureRows): void {
  sqlite.exec(SCHEMA);
  const rowId = (r: { lastInsertRowid: number | bigint }): number => Number(r.lastInsertRowid);
  for (const a of rows.airports ?? []) {
    const r = sqlite
      .prepare(
        `INSERT INTO airports (icao, faa_id, name, latitude, longitude, type, ownership, fuel_types, has_beacon_light)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.icao,
        a.faaID ?? null,
        a.name,
        a.lat,
        a.lon,
        a.type ?? 'airport',
        a.ownership ?? 'public',
        a.fuelTypes === undefined ? '[]' : a.fuelTypes,
        a.hasBeacon ?? 0,
      );
    sqlite.prepare('INSERT INTO airports_rtree VALUES (?, ?, ?, ?, ?)').run(rowId(r), a.lat, a.lat, a.lon, a.lon);
  }
  for (const r of rows.runways ?? []) {
    sqlite
      .prepare(
        `INSERT INTO runways (id, airport_icao, length, width, surface, lighting, base_end_id, reciprocal_end_id)
         VALUES (?, ?, ?, 75, ?, ?, '13', '31')`,
      )
      .run(r.id, r.airport, r.length, r.surface ?? 'asphalt', r.lighting ?? 'fullTime');
  }
  for (const f of rows.frequencies ?? []) {
    sqlite
      .prepare('INSERT INTO frequencies (id, airport_icao, type, name, frequency) VALUES (?, ?, ?, ?, ?)')
      .run(f.id, f.airport, f.type, f.name, f.frequency);
  }
  for (const n of rows.navaids ?? []) {
    const r = sqlite
      .prepare(
        'INSERT INTO navaids (id, type, name, latitude, longitude, frequency, elevation) VALUES (?, ?, ?, ?, ?, 113.0, ?)',
      )
      .run(n.id, n.type, n.name, n.lat, n.lon, n.elevation ?? null);
    sqlite.prepare('INSERT INTO navaids_rtree VALUES (?, ?, ?, ?, ?)').run(rowId(r), n.lat, n.lat, n.lon, n.lon);
  }
  for (const s of rows.airspaces ?? []) {
    const r = sqlite
      .prepare(
        `INSERT INTO airspaces (id, name, class, floor_altitude, ceiling_altitude,
           center_latitude, center_longitude, radius_nm, coordinates, min_lat, max_lat, min_lon, max_lon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id,
        s.name,
        s.classification,
        s.floor ?? 0,
        s.ceiling ?? 4000,
        s.center?.lat ?? null,
        s.center?.lon ?? null,
        s.radiusNM ?? null,
        s.coordinatesJSON ?? null,
        s.box.minLat,
        s.box.maxLat,
        s.box.minLon,
        s.box.maxLon,
      );
    sqlite
      .prepare('INSERT INTO airspaces_rtree VALUES (?, ?, ?, ?, ?)')
      .run(rowId(r), s.box.minLat, s.box.maxLat, s.box.minLon, s.box.maxLon);
  }
  sqlite.exec("INSERT INTO airports_fts(airports_fts) VALUES ('rebuild')");
}

/** In-memory AviationDatabase over the synthetic schema. */
export function makeDatabase(rows: FixtureRows = {}) {
  const sqlite = new DatabaseSync(':memory:');
  populate(sqlite, rows);
  return createAviationDatabase(wrapNodeSqlite(sqlite));
}

/** Writes a checkpointed on-disk database file with the synthetic schema, closed before returning. */
export function writeDatabaseFile(file: string, rows: FixtureRows): void {
  const sqlite = new DatabaseSync(file);
  populate(sqlite, rows);
  sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  sqlite.close();
}
