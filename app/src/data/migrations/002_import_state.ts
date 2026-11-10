// Schema v2: tables the Swift-data importer needs. app_preferences holds the UserDefaults values that have no column in
// user_settings (JSON text per key); migration_state records each import step so a re-run resumes and never repeats.
export const migration002ImportState = `
CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE migration_state (
  step TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  detail TEXT,
  updated_at INTEGER NOT NULL
);
`;
