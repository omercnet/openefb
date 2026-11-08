// Read-only access to the app's bundled aviation.sqlite (same file the SwiftUI app ships), native only.
// Queries mirror efb-212/Data/AviationDatabase.swift. Coordinates in degrees, elevation in feet MSL.
import { importDatabaseFromAssetAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'aviation.sqlite';
let opening: Promise<SQLiteDatabase> | null = null;

/** Copies the bundled asset into the SQLite directory on first use (kept afterwards), then opens it once. */
export function openAviationDb(): Promise<SQLiteDatabase> {
  opening ??= importDatabaseFromAssetAsync(DB_NAME, { assetId: require('../../assets/aviation.sqlite') })
    .then(() => openDatabaseAsync(DB_NAME));
  return opening;
}

export type AirportDot = { icao: string; name: string; latitude: number; longitude: number };

/** Public airports whose R-tree box intersects [west, south, east, north] (AviationDatabase.airports(in:)). */
export const AIRPORTS_IN_BOX_SQL = `
  SELECT a.icao, a.name, a.latitude, a.longitude FROM airports a
  INNER JOIN airports_rtree r ON a.rowid = r.rowid
  WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
    AND a.type = 'airport' AND a.ownership = 'public'`;

export function airportsInBox(db: SQLiteDatabase, [west, south, east, north]: [number, number, number, number]) {
  return db.getAllAsync<AirportDot>(AIRPORTS_IN_BOX_SQL, [north, south, east, west]);
}
