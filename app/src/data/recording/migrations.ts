// Recording database schema: the GRDB migrations of efb-212/Data/RecordingDatabase.swift, kept 1:1 (same identifiers,
// same table and column names, same `grdb_migrations` bookkeeping table). Time columns hold Unix seconds as REAL, the
// numeric shape GRDB reads; the repository converts to and from epoch ms. Ids are lower-case UUID text.
import type { Db } from '../db';

export interface RecordingMigration {
  identifier: string;
  statements: readonly string[];
}

export const RECORDING_MIGRATIONS: readonly RecordingMigration[] = [
  {
    identifier: 'v1',
    statements: [
      `CREATE TABLE IF NOT EXISTS track_points (
        id TEXT PRIMARY KEY,
        flightID TEXT NOT NULL,
        timestamp REAL NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitudeFeet REAL NOT NULL,
        groundSpeedKnots REAL NOT NULL,
        verticalSpeedFPM REAL NOT NULL,
        courseDegrees REAL NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_track_points_flight ON track_points(flightID)',
      `CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        flightID TEXT NOT NULL,
        timestamp REAL NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        audioStartTime REAL NOT NULL,
        audioEndTime REAL NOT NULL,
        flightPhase TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_transcript_segments_flight ON transcript_segments(flightID)',
      `CREATE TABLE IF NOT EXISTS phase_markers (
        id TEXT PRIMARY KEY,
        flightID TEXT NOT NULL,
        phase TEXT NOT NULL,
        startTimestamp REAL NOT NULL,
        endTimestamp REAL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_phase_markers_flight ON phase_markers(flightID)',
    ],
  },
  {
    identifier: 'v2_debrief',
    statements: [
      `CREATE TABLE IF NOT EXISTS debrief_results (
        id TEXT PRIMARY KEY,
        flightID TEXT NOT NULL,
        narrativeSummary TEXT NOT NULL,
        phaseObservationsJSON TEXT NOT NULL,
        improvementsJSON TEXT NOT NULL,
        overallRating INTEGER NOT NULL,
        generatedAt REAL NOT NULL,
        promptTokensEstimate INTEGER,
        responseTokensEstimate INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS idx_debrief_results_flight ON debrief_results(flightID)',
    ],
  },
  {
    // Confidence becomes nullable; the old -1 "unknown" sentinel becomes NULL. A table rebuild, as in Swift.
    identifier: 'v3_nullable_transcript_confidence',
    statements: [
      `CREATE TABLE transcript_segments_new (
        id TEXT PRIMARY KEY,
        flightID TEXT NOT NULL,
        timestamp REAL NOT NULL,
        text TEXT NOT NULL,
        confidence REAL,
        audioStartTime REAL NOT NULL,
        audioEndTime REAL NOT NULL,
        flightPhase TEXT NOT NULL
      )`,
      `INSERT INTO transcript_segments_new
        (id, flightID, timestamp, text, confidence, audioStartTime, audioEndTime, flightPhase)
       SELECT id, flightID, timestamp, text,
              CASE WHEN confidence < 0 THEN NULL ELSE confidence END,
              audioStartTime, audioEndTime, flightPhase
       FROM transcript_segments`,
      'DROP TABLE transcript_segments',
      'ALTER TABLE transcript_segments_new RENAME TO transcript_segments',
      'CREATE INDEX IF NOT EXISTS idx_transcript_segments_flight ON transcript_segments(flightID)',
    ],
  },
  {
    identifier: 'v4_flight_route_legs',
    statements: [
      `CREATE TABLE IF NOT EXISTS flight_route_legs (
        flightID TEXT NOT NULL,
        seq INTEGER NOT NULL,
        fromCode TEXT NOT NULL,
        toCode TEXT NOT NULL,
        PRIMARY KEY (flightID, seq)
      )`,
    ],
  },
  {
    // Numeric debrief dates written before this migration were seconds since 2001; shift them to Unix seconds.
    identifier: 'v5_debrief_generatedAt_epoch',
    statements: [
      `UPDATE debrief_results
       SET generatedAt = generatedAt + 978307200
       WHERE typeof(generatedAt) IN ('real', 'integer')`,
    ],
  },
];

/**
 * DatabaseMigrator.migrate: applies each registered migration not yet listed in grdb_migrations, in order, each in its
 * own transaction together with its bookkeeping row. Reopening a migrated database changes nothing.
 */
export async function migrateRecording(
  db: Db,
  migrations: readonly RecordingMigration[] = RECORDING_MIGRATIONS,
): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
  const applied = new Set(
    (await db.all<{ identifier: string }>('SELECT identifier FROM grdb_migrations')).map((r) => r.identifier),
  );
  for (const m of migrations) {
    if (applied.has(m.identifier)) continue;
    await db.transaction(async (tx) => {
      for (const sql of m.statements) await tx.run(sql);
      await tx.run('INSERT INTO grdb_migrations (identifier) VALUES (?)', [m.identifier]);
    });
  }
}
