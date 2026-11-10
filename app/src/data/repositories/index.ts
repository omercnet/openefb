// One repository per SwiftData model. All take a Db; nothing here knows which adapter backs it.
import type { Db } from '../db';
import { newUserSettings, type Factory } from '../defaults';
import type {
  AircraftProfile,
  FlightPlanRecord,
  FlightRecord,
  LogbookEntry,
  PilotProfile,
  UserSettings,
} from '../models';
import { f, makeRepository, type Field, type Repository } from './table';

const aircraftFields: Field[] = [
  f('nNumber', 'n_number'),
  f('aircraftType', 'aircraft_type'),
  f('fuelCapacityGallons', 'fuel_capacity_gallons', 'num'),
  f('fuelBurnGPH', 'fuel_burn_gph', 'num'),
  f('cruiseSpeedKts', 'cruise_speed_kts', 'num'),
  f('icaoTypeDesignator', 'icao_type_designator'),
  f('personsOnBoard', 'persons_on_board', 'num'),
  f('vSpeeds', 'v_speeds_data', 'vSpeeds'),
  f('isActive', 'is_active', 'bool'),
  f('annualDue', 'annual_due', 'num'),
  f('transponderDue', 'transponder_due', 'num'),
  f('createdAt', 'created_at', 'num'),
];
const pilotFields: Field[] = [
  f('name', 'name'),
  f('certificateNumber', 'certificate_number'),
  f('phone', 'phone'),
  f('email', 'email'),
  f('certificateType', 'certificate_type'),
  f('medicalClass', 'medical_class'),
  f('medicalExpiry', 'medical_expiry', 'num'),
  f('flightReviewDate', 'flight_review_date', 'num'),
  f('totalHours', 'total_hours', 'num'),
  f('isActive', 'is_active', 'bool'),
  f('nightLandingEntries', 'night_landing_entries_data', 'nightLandings'),
  f('createdAt', 'created_at', 'num'),
];
const planFields: Field[] = [
  f('name', 'name'),
  f('departureICAO', 'departure_icao'),
  f('departureName', 'departure_name'),
  f('departureLatitude', 'departure_latitude', 'num'),
  f('departureLongitude', 'departure_longitude', 'num'),
  f('destinationICAO', 'destination_icao'),
  f('destinationName', 'destination_name'),
  f('destinationLatitude', 'destination_latitude', 'num'),
  f('destinationLongitude', 'destination_longitude', 'num'),
  f('cruiseAltitude', 'cruise_altitude', 'num'),
  f('cruiseSpeedKts', 'cruise_speed_kts', 'num'),
  f('fuelBurnGPH', 'fuel_burn_gph', 'num'),
  f('totalDistanceNM', 'total_distance_nm', 'num'),
  f('estimatedTimeSeconds', 'estimated_time_seconds', 'num'),
  f('estimatedFuelGallons', 'estimated_fuel_gallons', 'num'),
  f('notes', 'notes'),
  f('lastUsedAt', 'last_used_at', 'num'),
  f('createdAt', 'created_at', 'num'),
];
const flightFields: Field[] = [
  f('startDate', 'start_date', 'num'),
  f('endDate', 'end_date', 'num'),
  f('departureICAO', 'departure_icao'),
  f('arrivalICAO', 'arrival_icao'),
  f('departureName', 'departure_name'),
  f('arrivalName', 'arrival_name'),
  f('durationSeconds', 'duration_seconds', 'num'),
  f('audioFileURL', 'audio_file_url'),
  f('audioQuality', 'audio_quality'),
  f('trackPointCount', 'track_point_count', 'num'),
  f('transcriptSegmentCount', 'transcript_segment_count', 'num'),
  f('aircraftProfileID', 'aircraft_profile_id'),
  f('pilotProfileID', 'pilot_profile_id'),
  f('hasDebrief', 'has_debrief', 'bool'),
  f('notes', 'notes'),
  f('createdAt', 'created_at', 'num'),
];
const logbookFields: Field[] = [
  f('flightID', 'flight_id'),
  f('date', 'date', 'num'),
  f('departureICAO', 'departure_icao'),
  f('departureName', 'departure_name'),
  f('arrivalICAO', 'arrival_icao'),
  f('arrivalName', 'arrival_name'),
  f('route', 'route'),
  f('durationSeconds', 'duration_seconds', 'num'),
  f('aircraftProfileID', 'aircraft_profile_id'),
  f('aircraftType', 'aircraft_type'),
  f('pilotProfileID', 'pilot_profile_id'),
  f('nightLandingCount', 'night_landing_count', 'num'),
  f('dayLandingCount', 'day_landing_count', 'num'),
  f('notes', 'notes'),
  f('isConfirmed', 'is_confirmed', 'bool'),
  f('hasDebrief', 'has_debrief', 'bool'),
  f('createdAt', 'created_at', 'num'),
];

export const aircraftRepository = (db: Db): Repository<AircraftProfile> =>
  makeRepository(db, 'aircraft_profile', aircraftFields, 'created_at, rowid');
export const pilotRepository = (db: Db): Repository<PilotProfile> =>
  makeRepository(db, 'pilot_profile', pilotFields, 'created_at, rowid');
export const flightPlanRepository = (db: Db): Repository<FlightPlanRecord> =>
  makeRepository(db, 'flight_plan_record', planFields, 'last_used_at DESC, rowid');
export const flightRecordRepository = (db: Db): Repository<FlightRecord> =>
  makeRepository(db, 'flight_record', flightFields, 'start_date DESC, rowid');

export interface LogbookRepository extends Repository<LogbookEntry> {
  /** Entries recorded from one flight, newest first. */
  byFlightId(flightID: string): Promise<LogbookEntry[]>;
}
export function logbookRepository(db: Db): LogbookRepository {
  const base = makeRepository<LogbookEntry>(db, 'logbook_entry', logbookFields, 'date DESC, rowid');
  return { ...base, byFlightId: async (flightID) => (await base.list()).filter((e) => e.flightID === flightID) };
}

const settingsColumns = [
  'default_map_mode',
  'sectional_opacity',
  'weather_refresh_interval',
  'active_aircraft_id',
  'active_pilot_id',
  'last_flight_plan_id',
  'region_raw',
  'created_at',
] as const;
const settingsKeys = [
  'defaultMapMode',
  'sectionalOpacity',
  'weatherRefreshInterval',
  'activeAircraftID',
  'activePilotID',
  'lastFlightPlanID',
  'regionRaw',
  'createdAt',
] as const;

export interface SettingsRepository {
  /** The single settings row, or null before first launch has created it. */
  get(): Promise<UserSettings | null>;
  /** The settings row, inserting one with the model defaults first when none exists (the app only ever keeps one). */
  getOrCreate(factory?: Factory): Promise<UserSettings>;
  update(patch: Partial<Omit<UserSettings, 'id'>>): Promise<UserSettings>;
}

export function settingsRepository(db: Db): SettingsRepository {
  const repo: SettingsRepository = {
    async get() {
      const row = await db.get(`SELECT id, ${settingsColumns.join(', ')} FROM user_settings ORDER BY id LIMIT 1`);
      if (!row) return null;
      const rec: Record<string, unknown> = { id: row.id };
      settingsKeys.forEach((k, i) => (rec[k] = row[settingsColumns[i]]));
      return rec as unknown as UserSettings;
    },
    async getOrCreate(factory = {}) {
      const existing = await repo.get();
      if (existing) return existing;
      const s = newUserSettings(factory);
      await db.run(
        `INSERT INTO user_settings (${settingsColumns.join(', ')}) VALUES (${settingsColumns.map(() => '?').join(', ')})`,
        settingsKeys.map((k) => s[k]),
      );
      return (await repo.get()) as UserSettings;
    },
    async update(patch) {
      const current = await repo.getOrCreate();
      const src = patch as Record<string, unknown>;
      const idx = settingsKeys.map((k, i) => i).filter((i) => src[settingsKeys[i]] !== undefined);
      if (idx.length > 0) {
        await db.run(
          `UPDATE user_settings SET ${idx.map((i) => `${settingsColumns[i]} = ?`).join(', ')} WHERE id = ?`,
          [...idx.map((i) => src[settingsKeys[i]] as string | number | null), current.id],
        );
      }
      return (await repo.get()) as UserSettings;
    },
  };
  return repo;
}
