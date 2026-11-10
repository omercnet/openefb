// Schema v1: one table per SwiftData model in SchemaV1 (efb-212/Data/Models). Columns are the Swift property names in
// snake_case, dates are epoch ms integers, UUIDs are text, enums stay strings, booleans are 0/1.
// Kept as a TS string (not a .sql file) so Metro and Jest load it with no asset plumbing.
export const migration001Initial = `
CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY,
  default_map_mode TEXT NOT NULL DEFAULT 'northUp',
  sectional_opacity REAL NOT NULL DEFAULT 0.7,
  weather_refresh_interval REAL NOT NULL DEFAULT 900,
  active_aircraft_id TEXT,
  active_pilot_id TEXT,
  last_flight_plan_id TEXT,
  region_raw TEXT NOT NULL DEFAULT 'israel',
  created_at INTEGER NOT NULL
);
CREATE TABLE aircraft_profile (
  id TEXT PRIMARY KEY,
  n_number TEXT NOT NULL DEFAULT '',
  aircraft_type TEXT NOT NULL DEFAULT '',
  fuel_capacity_gallons REAL,
  fuel_burn_gph REAL,
  cruise_speed_kts REAL,
  icao_type_designator TEXT,
  persons_on_board INTEGER,
  v_speeds_data TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  annual_due INTEGER,
  transponder_due INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE pilot_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  certificate_number TEXT,
  phone TEXT,
  email TEXT,
  certificate_type TEXT,
  medical_class TEXT,
  medical_expiry INTEGER,
  flight_review_date INTEGER,
  total_hours REAL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  night_landing_entries_data TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE flight_plan_record (
  id TEXT PRIMARY KEY,
  name TEXT,
  departure_icao TEXT NOT NULL DEFAULT '',
  departure_name TEXT NOT NULL DEFAULT '',
  departure_latitude REAL NOT NULL DEFAULT 0,
  departure_longitude REAL NOT NULL DEFAULT 0,
  destination_icao TEXT NOT NULL DEFAULT '',
  destination_name TEXT NOT NULL DEFAULT '',
  destination_latitude REAL NOT NULL DEFAULT 0,
  destination_longitude REAL NOT NULL DEFAULT 0,
  cruise_altitude INTEGER NOT NULL DEFAULT 3000,
  cruise_speed_kts REAL NOT NULL DEFAULT 100,
  fuel_burn_gph REAL,
  total_distance_nm REAL NOT NULL DEFAULT 0,
  estimated_time_seconds REAL NOT NULL DEFAULT 0,
  estimated_fuel_gallons REAL,
  notes TEXT,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE flight_record (
  id TEXT PRIMARY KEY,
  start_date INTEGER NOT NULL,
  end_date INTEGER,
  departure_icao TEXT,
  arrival_icao TEXT,
  departure_name TEXT,
  arrival_name TEXT,
  duration_seconds REAL NOT NULL DEFAULT 0,
  audio_file_url TEXT,
  audio_quality TEXT NOT NULL DEFAULT 'standard',
  track_point_count INTEGER NOT NULL DEFAULT 0,
  transcript_segment_count INTEGER NOT NULL DEFAULT 0,
  aircraft_profile_id TEXT,
  pilot_profile_id TEXT,
  has_debrief INTEGER NOT NULL DEFAULT 0 CHECK (has_debrief IN (0, 1)),
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE logbook_entry (
  id TEXT PRIMARY KEY,
  flight_id TEXT,
  date INTEGER NOT NULL,
  departure_icao TEXT,
  departure_name TEXT,
  arrival_icao TEXT,
  arrival_name TEXT,
  route TEXT,
  duration_seconds REAL NOT NULL DEFAULT 0,
  aircraft_profile_id TEXT,
  aircraft_type TEXT,
  pilot_profile_id TEXT,
  night_landing_count INTEGER NOT NULL DEFAULT 0,
  day_landing_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_confirmed IN (0, 1)),
  has_debrief INTEGER NOT NULL DEFAULT 0 CHECK (has_debrief IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX logbook_entry_flight_id ON logbook_entry (flight_id);
CREATE INDEX logbook_entry_date ON logbook_entry (date);
`;
