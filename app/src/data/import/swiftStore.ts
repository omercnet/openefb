// Step 1 of the importer (plan section 4): copy the six SwiftData models from the Swift default.store into kanaf.sqlite.
// The source Db is opened read-only by the caller and is never written. Rows are inserted with OR IGNORE, so a re-run
// adds nothing and never overwrites edits made in the new app. Rows that cannot be read are skipped and reported.
import type { Db, SqlRow, SqlValue } from '../db';
import { blobToText, coreDataToEpochMs, normalizeUuidText, uuidFromBlob } from './coreData';

export type ColumnKind = 'text' | 'num' | 'bool' | 'date' | 'uuidBlob' | 'uuidText' | 'json';
interface Col {
  /** Target column in kanaf.sqlite. */
  to: string;
  /** Source column in the SwiftData store. */
  from: string;
  kind: ColumnKind;
}
interface Entity {
  /** Core Data entity name (Z_PRIMARYKEY.Z_NAME). */
  entity: string;
  sourceTable: string;
  targetTable: string;
  cols: Col[];
}

const c = (to: string, from: string, kind: ColumnKind = 'text'): Col => ({ to, from, kind });

/** Column map per model: target column, source column, how to decode. Table-driven; no model-specific code below. */
export const ENTITIES: readonly Entity[] = [
  {
    entity: 'AircraftProfile',
    sourceTable: 'ZAIRCRAFTPROFILE',
    targetTable: 'aircraft_profile',
    cols: [
      c('id', 'ZID', 'uuidBlob'),
      c('n_number', 'ZNNUMBER'),
      c('aircraft_type', 'ZAIRCRAFTTYPE'),
      c('fuel_capacity_gallons', 'ZFUELCAPACITYGALLONS', 'num'),
      c('fuel_burn_gph', 'ZFUELBURNGPH', 'num'),
      c('cruise_speed_kts', 'ZCRUISESPEEDKTS', 'num'),
      c('icao_type_designator', 'ZICAOTYPEDESIGNATOR'),
      c('persons_on_board', 'ZPERSONSONBOARD', 'num'),
      c('v_speeds_data', 'ZVSPEEDSDATA', 'json'),
      c('is_active', 'ZISACTIVE', 'bool'),
      c('annual_due', 'ZANNUALDUE', 'date'),
      c('transponder_due', 'ZTRANSPONDERDUE', 'date'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
  {
    entity: 'PilotProfile',
    sourceTable: 'ZPILOTPROFILE',
    targetTable: 'pilot_profile',
    cols: [
      c('id', 'ZID', 'uuidBlob'),
      c('name', 'ZNAME'),
      c('certificate_number', 'ZCERTIFICATENUMBER'),
      c('phone', 'ZPHONE'),
      c('email', 'ZEMAIL'),
      c('certificate_type', 'ZCERTIFICATETYPE'),
      c('medical_class', 'ZMEDICALCLASS'),
      c('medical_expiry', 'ZMEDICALEXPIRY', 'date'),
      c('flight_review_date', 'ZFLIGHTREVIEWDATE', 'date'),
      c('total_hours', 'ZTOTALHOURS', 'num'),
      c('is_active', 'ZISACTIVE', 'bool'),
      c('night_landing_entries_data', 'ZNIGHTLANDINGENTRIESDATA', 'json'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
  {
    entity: 'FlightPlanRecord',
    sourceTable: 'ZFLIGHTPLANRECORD',
    targetTable: 'flight_plan_record',
    cols: [
      c('id', 'ZID', 'uuidBlob'),
      c('name', 'ZNAME'),
      c('departure_icao', 'ZDEPARTUREICAO'),
      c('departure_name', 'ZDEPARTURENAME'),
      c('departure_latitude', 'ZDEPARTURELATITUDE', 'num'),
      c('departure_longitude', 'ZDEPARTURELONGITUDE', 'num'),
      c('destination_icao', 'ZDESTINATIONICAO'),
      c('destination_name', 'ZDESTINATIONNAME'),
      c('destination_latitude', 'ZDESTINATIONLATITUDE', 'num'),
      c('destination_longitude', 'ZDESTINATIONLONGITUDE', 'num'),
      c('cruise_altitude', 'ZCRUISEALTITUDE', 'num'),
      c('cruise_speed_kts', 'ZCRUISESPEEDKTS', 'num'),
      c('fuel_burn_gph', 'ZFUELBURNGPH', 'num'),
      c('total_distance_nm', 'ZTOTALDISTANCENM', 'num'),
      c('estimated_time_seconds', 'ZESTIMATEDTIMESECONDS', 'num'),
      c('estimated_fuel_gallons', 'ZESTIMATEDFUELGALLONS', 'num'),
      c('notes', 'ZNOTES'),
      c('last_used_at', 'ZLASTUSEDAT', 'date'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
  {
    entity: 'FlightRecord',
    sourceTable: 'ZFLIGHTRECORD',
    targetTable: 'flight_record',
    cols: [
      c('id', 'ZID', 'uuidBlob'),
      c('start_date', 'ZSTARTDATE', 'date'),
      c('end_date', 'ZENDDATE', 'date'),
      c('departure_icao', 'ZDEPARTUREICAO'),
      c('arrival_icao', 'ZARRIVALICAO'),
      c('departure_name', 'ZDEPARTURENAME'),
      c('arrival_name', 'ZARRIVALNAME'),
      c('duration_seconds', 'ZDURATIONSECONDS', 'num'),
      c('audio_file_url', 'ZAUDIOFILEURL'),
      c('audio_quality', 'ZAUDIOQUALITY'),
      c('track_point_count', 'ZTRACKPOINTCOUNT', 'num'),
      c('transcript_segment_count', 'ZTRANSCRIPTSEGMENTCOUNT', 'num'),
      c('aircraft_profile_id', 'ZAIRCRAFTPROFILEID', 'uuidText'),
      c('pilot_profile_id', 'ZPILOTPROFILEID', 'uuidText'),
      c('has_debrief', 'ZHASDEBRIEF', 'bool'),
      c('notes', 'ZNOTES'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
  {
    entity: 'LogbookEntry',
    sourceTable: 'ZLOGBOOKENTRY',
    targetTable: 'logbook_entry',
    cols: [
      c('id', 'ZID', 'uuidBlob'),
      c('flight_id', 'ZFLIGHTID', 'uuidBlob'),
      c('date', 'ZDATE', 'date'),
      c('departure_icao', 'ZDEPARTUREICAO'),
      c('departure_name', 'ZDEPARTURENAME'),
      c('arrival_icao', 'ZARRIVALICAO'),
      c('arrival_name', 'ZARRIVALNAME'),
      c('route', 'ZROUTE'),
      c('duration_seconds', 'ZDURATIONSECONDS', 'num'),
      c('aircraft_profile_id', 'ZAIRCRAFTPROFILEID', 'uuidText'),
      c('aircraft_type', 'ZAIRCRAFTTYPE'),
      c('pilot_profile_id', 'ZPILOTPROFILEID', 'uuidText'),
      c('night_landing_count', 'ZNIGHTLANDINGCOUNT', 'num'),
      c('day_landing_count', 'ZDAYLANDINGCOUNT', 'num'),
      c('notes', 'ZNOTES'),
      c('is_confirmed', 'ZISCONFIRMED', 'bool'),
      c('has_debrief', 'ZHASDEBRIEF', 'bool'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
  {
    entity: 'UserSettings',
    sourceTable: 'ZUSERSETTINGS',
    targetTable: 'user_settings',
    cols: [
      c('default_map_mode', 'ZDEFAULTMAPMODE'),
      c('sectional_opacity', 'ZSECTIONALOPACITY', 'num'),
      c('weather_refresh_interval', 'ZWEATHERREFRESHINTERVAL', 'num'),
      c('active_aircraft_id', 'ZACTIVEAIRCRAFTID', 'uuidText'),
      c('active_pilot_id', 'ZACTIVEPILOTID', 'uuidText'),
      c('last_flight_plan_id', 'ZLASTFLIGHTPLANID', 'uuidText'),
      c('region_raw', 'ZREGIONRAW'),
      c('created_at', 'ZCREATEDAT', 'date'),
    ],
  },
];

/** Target columns that are NOT NULL with no default: a NULL in the store (never written by Swift) becomes 0. */
const REQUIRED_DATES = new Set(['created_at', 'start_date', 'date', 'last_used_at']);

export class UnsupportedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedStoreError';
  }
}

export interface SkippedRow {
  table: string;
  reason: string;
}
export interface SwiftStoreResult {
  /** Rows inserted per target table (already-present rows are not counted). */
  imported: Record<string, number>;
  /** Rows present in the source per Swift table. */
  found: Record<string, number>;
  skipped: SkippedRow[];
}

/**
 * Checks the source is a SwiftData store this importer understands: Core Data's Z_PRIMARYKEY lists only known entities
 * (a newer schema adds some) and every table and column of the column map exists. Throws UnsupportedStoreError otherwise.
 */
export async function verifySwiftStore(source: Db): Promise<void> {
  let entities: string[];
  try {
    entities = (await source.all<{ Z_NAME: string }>('SELECT Z_NAME FROM Z_PRIMARYKEY')).map((r) => String(r.Z_NAME));
  } catch {
    throw new UnsupportedStoreError('not a SwiftData store (no Z_PRIMARYKEY table)');
  }
  const known = new Set(ENTITIES.map((e) => e.entity));
  // Core Data bookkeeping entities (CHANGE, TRANSACTION, TRANSACTIONSTRING) are numbered 16001+ and are ignored.
  const unknown = entities.filter((n) => !known.has(n) && !/^(CHANGE|TRANSACTION|TRANSACTIONSTRING)$/.test(n));
  if (unknown.length > 0)
    throw new UnsupportedStoreError(`store has models this app does not know: ${unknown.join(', ')}`);
  for (const e of ENTITIES) {
    const cols = new Set(
      (await source.all<{ name: string }>(`PRAGMA table_info(${e.sourceTable})`)).map((r) => String(r.name)),
    );
    if (cols.size === 0) throw new UnsupportedStoreError(`store has no table ${e.sourceTable}`);
    const missing = e.cols.filter((col) => !cols.has(col.from)).map((col) => col.from);
    if (missing.length > 0) throw new UnsupportedStoreError(`${e.sourceTable} lacks columns: ${missing.join(', ')}`);
  }
}

function decode(kind: ColumnKind, v: SqlValue | undefined): { value: SqlValue; ok: boolean } {
  if (v === null || v === undefined) return { value: null, ok: true };
  switch (kind) {
    case 'text':
      return { value: typeof v === 'string' ? v : String(v), ok: true };
    case 'num':
      return typeof v === 'number' ? { value: v, ok: true } : { value: null, ok: false };
    case 'bool':
      return { value: v ? 1 : 0, ok: true };
    case 'date': {
      const ms = coreDataToEpochMs(v);
      return { value: ms, ok: ms !== null };
    }
    case 'uuidBlob': {
      const id = uuidFromBlob(v);
      return { value: id, ok: id !== null };
    }
    case 'uuidText':
      return { value: normalizeUuidText(v), ok: true };
    case 'json': {
      const text = blobToText(v);
      if (text === null) return { value: null, ok: false };
      try {
        JSON.parse(text);
      } catch {
        return { value: null, ok: false };
      }
      return { value: text, ok: true };
    }
  }
}

/** Core Data's JSON for Codable Dates is seconds since 2001 (the default Date strategy); ours is epoch ms. */
function jsonDatesToEpochMs(column: string, text: string): string {
  if (column !== 'night_landing_entries_data') return text;
  const entries = JSON.parse(text) as { date?: unknown; count?: unknown }[];
  if (!Array.isArray(entries)) return text;
  return JSON.stringify(entries.map((e) => ({ date: coreDataToEpochMs(e.date) ?? e.date, count: e.count })));
}

/**
 * Copies every model. Runs as one transaction on the target, so a failure leaves nothing behind. UserSettings is only
 * imported when the target has no settings row yet (the app keeps exactly one).
 */
export async function importSwiftStore(source: Db, target: Db): Promise<SwiftStoreResult> {
  await verifySwiftStore(source);
  const result: SwiftStoreResult = { imported: {}, found: {}, skipped: [] };
  await target.transaction(async (tx) => {
    for (const e of ENTITIES) {
      const rows = await source.all<SqlRow>(`SELECT * FROM ${e.sourceTable} ORDER BY Z_PK`);
      result.found[e.sourceTable] = rows.length;
      result.imported[e.targetTable] = 0;
      const isSettings = e.targetTable === 'user_settings';
      if (isSettings && (await tx.get('SELECT 1 AS x FROM user_settings LIMIT 1'))) continue;
      for (const row of rows) {
        if (isSettings && result.imported[e.targetTable] >= 1) {
          result.skipped.push({ table: e.sourceTable, reason: 'extra settings row ignored (the app keeps one)' });
          continue;
        }
        const names: string[] = [];
        const values: SqlValue[] = [];
        const dropped: string[] = [];
        for (const col of e.cols) {
          const d = decode(col.kind, row[col.from]);
          let value = d.value;
          if (col.to === 'id' && value === null) break;
          if (!d.ok) dropped.push(col.from);
          if (col.kind === 'json' && typeof value === 'string') value = jsonDatesToEpochMs(col.to, value);
          if (value === null && REQUIRED_DATES.has(col.to)) value = 0;
          // A NULL is left out of the INSERT so NOT NULL columns take their Swift default.
          if (value === null) continue;
          names.push(col.to);
          values.push(value);
        }
        if (!names.includes('id') && e.cols.some((col) => col.to === 'id')) {
          result.skipped.push({ table: e.sourceTable, reason: 'ZID unreadable; row skipped' });
          continue;
        }
        if (dropped.length > 0) {
          result.skipped.push({ table: e.sourceTable, reason: `${dropped.join(', ')} unreadable; value dropped` });
        }
        const res = await tx.run(
          `INSERT OR IGNORE INTO ${e.targetTable} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
          values,
        );
        result.imported[e.targetTable] += res.changes;
      }
    }
  });
  return result;
}
