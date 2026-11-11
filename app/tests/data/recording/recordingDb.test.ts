// Ports of CharacterizationTests/RecordingDatabaseChainMigrationCharacterizationTests (5),
// DataTests/RecordingDatabaseMigrationTests (3) and the database cases of ServiceTests/DebriefSchemaTests (3), plus
// repository cases for the rest of RecordingDatabase. Swift builds old databases with GRDB; here the same SQL runs on the
// Db before opening. Swift Dates are epoch ms in the API and Unix seconds in the columns.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../../src/data/db';
import {
  migrateRecording,
  newDebriefRecord,
  newPhaseMarker,
  newTrackPoint,
  newTranscriptSegment,
  openRecordingDatabase,
  RECORDING_MIGRATIONS,
  type PhaseMarker,
  type TrackPoint,
} from '../../../src/data/recording';
import { openNodeSqliteDb } from '../../support/nodeSqliteDb';

const ALL_MIGRATIONS = [
  'v1',
  'v2_debrief',
  'v3_nullable_transcript_confidence',
  'v4_flight_route_legs',
  'v5_debrief_generatedAt_epoch',
];
const flightID = '11111111-2222-4333-8444-555555555555';
const T0 = 1_700_000_000_000; // whole seconds

const trackPoints: TrackPoint[] = [0, 1, 2, 3].map((i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  flightID,
  timestamp: T0 + i * 1000,
  latitude: 37.4611 + i * 0.001,
  longitude: -122.115 - i * 0.001,
  altitudeFeet: 100 + i * 10,
  groundSpeedKnots: 60 + i,
  verticalSpeedFPM: i * 150,
  courseDegrees: 310 + i,
}));
const phaseMarkers: PhaseMarker[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    flightID,
    phase: 'taxi',
    startTimestamp: T0,
    endTimestamp: T0 + 2000,
    latitude: 37.4611,
    longitude: -122.115,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    flightID,
    phase: 'takeoff',
    startTimestamp: T0 + 2000,
    endTimestamp: null,
    latitude: 37.4631,
    longitude: -122.117,
  },
];

/** makeV1Database: the schema and rows of a recording.sqlite written by the first Swift release. */
async function makeV1Database(db: Db): Promise<void> {
  await db.run('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
  await db.run("INSERT INTO grdb_migrations VALUES ('v1')");
  await db.run(`CREATE TABLE track_points (
    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
    latitude REAL NOT NULL, longitude REAL NOT NULL, altitudeFeet REAL NOT NULL,
    groundSpeedKnots REAL NOT NULL, verticalSpeedFPM REAL NOT NULL, courseDegrees REAL NOT NULL)`);
  await db.run('CREATE INDEX idx_track_points_flight ON track_points(flightID)');
  await db.run(`CREATE TABLE transcript_segments (
    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
    text TEXT NOT NULL, confidence REAL NOT NULL,
    audioStartTime REAL NOT NULL, audioEndTime REAL NOT NULL, flightPhase TEXT NOT NULL)`);
  await db.run('CREATE INDEX idx_transcript_segments_flight ON transcript_segments(flightID)');
  await db.run(`CREATE TABLE phase_markers (
    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, phase TEXT NOT NULL,
    startTimestamp REAL NOT NULL, endTimestamp REAL,
    latitude REAL NOT NULL, longitude REAL NOT NULL)`);
  await db.run('CREATE INDEX idx_phase_markers_flight ON phase_markers(flightID)');
  for (const p of trackPoints) {
    await db.run('INSERT INTO track_points VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      p.id,
      p.flightID,
      p.timestamp / 1000,
      p.latitude,
      p.longitude,
      p.altitudeFeet,
      p.groundSpeedKnots,
      p.verticalSpeedFPM,
      p.courseDegrees,
    ]);
  }
  for (const m of phaseMarkers) {
    await db.run('INSERT INTO phase_markers VALUES (?, ?, ?, ?, ?, ?, ?)', [
      m.id,
      m.flightID,
      m.phase,
      m.startTimestamp / 1000,
      m.endTimestamp === null ? null : m.endTimestamp / 1000,
      m.latitude,
      m.longitude,
    ]);
  }
  for (const [i, confidence] of [0.85, -1.0].entries()) {
    await db.run('INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      `b000000${i}-0000-4000-8000-000000000000`,
      flightID,
      T0 / 1000 + i,
      `segment ${i}`,
      confidence,
      i,
      i + 1,
      'taxi',
    ]);
  }
}

const rawRows = (db: Db, table: string) => db.all(`SELECT * FROM ${table} ORDER BY id`);
const names = async (db: Db, type: string) =>
  new Set((await db.all<{ name: string }>('SELECT name FROM sqlite_master WHERE type = ?', [type])).map((r) => r.name));
const applied = async (db: Db) =>
  (await db.all<{ identifier: string }>('SELECT identifier FROM grdb_migrations ORDER BY identifier')).map(
    (r) => r.identifier,
  );
const counts = async (db: Db) => {
  const out: Record<string, number> = {};
  for (const t of ['track_points', 'transcript_segments', 'phase_markers', 'debrief_results', 'flight_route_legs']) {
    out[t] = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
  }
  return out;
};
const expectSuperset = (actual: Set<string>, expected: string[]) => {
  for (const e of expected) expect(actual.has(e)).toBe(true);
};

describe('Characterization: RecordingDatabase v1 -> current chain migration', () => {
  it('v1DatabaseMigratesToCurrentWithoutChangingFlightData', async () => {
    const pool = openNodeSqliteDb();
    await makeV1Database(pool);
    const trackBefore = await rawRows(pool, 'track_points');
    const phasesBefore = await rawRows(pool, 'phase_markers');
    const db = await openRecordingDatabase(pool);
    expect(await applied(pool)).toEqual([...ALL_MIGRATIONS].sort());
    expectSuperset(await names(pool, 'table'), [
      'track_points',
      'transcript_segments',
      'phase_markers',
      'debrief_results',
      'flight_route_legs',
    ]);
    expect((await names(pool, 'table')).has('transcript_segments_new')).toBe(false);
    expectSuperset(await names(pool, 'index'), [
      'idx_track_points_flight',
      'idx_transcript_segments_flight',
      'idx_phase_markers_flight',
      'idx_debrief_results_flight',
    ]);
    expect(await rawRows(pool, 'track_points')).toEqual(trackBefore);
    expect(await rawRows(pool, 'phase_markers')).toEqual(phasesBefore);
    expect(await db.trackPoints(flightID)).toEqual(trackPoints);
    const markers = await db.phaseMarkers(flightID);
    expect(markers).toEqual(phaseMarkers);
    expect(markers[markers.length - 1].endTimestamp).toBeNull();
    const segments = await db.transcriptSegments(flightID);
    expect(segments.map((s) => s.text)).toEqual(['segment 0', 'segment 1']);
    expect(segments[0].confidence).toBe(0.85);
    expect(segments[segments.length - 1].confidence).toBeNull(); // was the -1 sentinel
  });

  it('migratedV1DatabaseStoresAndReadsDebriefs', async () => {
    const pool = openNodeSqliteDb();
    await makeV1Database(pool);
    const db = await openRecordingDatabase(pool);
    const generatedAt = (800_000_000 + 978_307_200) * 1000; // Date(timeIntervalSinceReferenceDate: 800_000_000)
    const record = newDebriefRecord({
      flightID,
      narrativeSummary: 'Stable climb-out.',
      phaseObservationsJSON: '[]',
      improvementsJSON: '["Trim earlier"]',
      overallRating: 4,
      generatedAt,
      promptTokensEstimate: 1200,
      responseTokensEstimate: 300,
    });
    await db.insertDebrief(record);
    expect(await db.debrief(flightID)).toEqual(record);
  });

  it('v5ShiftsLegacyNumericDebriefDatesFromTheReferenceEpochToUnix', async () => {
    const pool = openNodeSqliteDb();
    await makeV1Database(pool);
    await openRecordingDatabase(pool);
    const instant = (800_000_000 + 978_307_200) * 1000;
    await pool.run(
      "INSERT INTO debrief_results (id, flightID, narrativeSummary, phaseObservationsJSON, improvementsJSON, overallRating, generatedAt) VALUES (?, ?, 'old', '[]', '[]', 3, ?)",
      ['c0000000-0000-4000-8000-000000000000', flightID, 800_000_000.0],
    );
    await pool.run("DELETE FROM grdb_migrations WHERE identifier = 'v5_debrief_generatedAt_epoch'");
    const db = await openRecordingDatabase(pool);
    expect((await db.debrief(flightID))!.generatedAt).toBe(instant);
    const again = await openRecordingDatabase(pool);
    expect((await again.debrief(flightID))!.generatedAt).toBe(instant);
  });

  it('reopeningMigratedDatabaseIsNoOp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanaf-rec-'));
    try {
      const path = join(dir, 'recording.sqlite');
      const first = openNodeSqliteDb(path);
      await makeV1Database(first);
      await openRecordingDatabase(first);
      const countsAfterFirstOpen = await counts(first);
      const migrationsAfterFirstOpen = await applied(first);
      const trackAfterFirstOpen = await rawRows(first, 'track_points');
      const second = openNodeSqliteDb(path);
      await openRecordingDatabase(second);
      expect(countsAfterFirstOpen.track_points).toBe(trackPoints.length);
      expect(countsAfterFirstOpen.phase_markers).toBe(phaseMarkers.length);
      expect(countsAfterFirstOpen.transcript_segments).toBe(2);
      expect(await counts(second)).toEqual(countsAfterFirstOpen);
      expect(await applied(second)).toEqual(migrationsAfterFirstOpen);
      expect(await rawRows(second, 'track_points')).toEqual(trackAfterFirstOpen);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emptyFileGetsEveryTable', async () => {
    const pool = openNodeSqliteDb();
    await openRecordingDatabase(pool);
    expectSuperset(await names(pool, 'table'), [
      'track_points',
      'transcript_segments',
      'phase_markers',
      'debrief_results',
      'flight_route_legs',
      'grdb_migrations',
    ]);
    expect(await applied(pool)).toEqual([...ALL_MIGRATIONS].sort());
  });
});

describe('RecordingDatabase Migration Tests (v3 nullable confidence)', () => {
  async function makeLegacyPool(): Promise<Db> {
    const pool = openNodeSqliteDb();
    await pool.run('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
    await pool.run("INSERT INTO grdb_migrations VALUES ('v1'), ('v2_debrief')");
    await pool.run(`CREATE TABLE transcript_segments (
      id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
      text TEXT NOT NULL, confidence REAL NOT NULL,
      audioStartTime REAL NOT NULL, audioEndTime REAL NOT NULL, flightPhase TEXT NOT NULL)`);
    await pool.run('CREATE INDEX idx_transcript_segments_flight ON transcript_segments(flightID)');
    await pool.run(`CREATE TABLE track_points (
      id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL, altitudeFeet REAL NOT NULL,
      groundSpeedKnots REAL NOT NULL, verticalSpeedFPM REAL NOT NULL, courseDegrees REAL NOT NULL)`);
    await pool.run(`CREATE TABLE phase_markers (
      id TEXT PRIMARY KEY, flightID TEXT NOT NULL, phase TEXT NOT NULL,
      startTimestamp REAL NOT NULL, endTimestamp REAL,
      latitude REAL NOT NULL, longitude REAL NOT NULL)`);
    await pool.run(`CREATE TABLE debrief_results (
      id TEXT PRIMARY KEY, flightID TEXT NOT NULL, narrativeSummary TEXT NOT NULL,
      phaseObservationsJSON TEXT NOT NULL, improvementsJSON TEXT NOT NULL,
      overallRating INTEGER NOT NULL, generatedAt REAL NOT NULL,
      promptTokensEstimate INTEGER, responseTokensEstimate INTEGER)`);
    for (const [i, confidence] of [0.9, -1.0, 0.0].entries()) {
      await pool.run("INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, 0, 1, 'cruise')", [
        `d000000${i}-0000-4000-8000-000000000000`,
        flightID,
        i,
        `segment ${i}`,
        confidence,
      ]);
    }
    return pool;
  }

  it('unknownSentinelRowsBecomeNullAndRealValuesSurvive', async () => {
    const db = await openRecordingDatabase(await makeLegacyPool()); // runs v3 on the legacy schema
    const segments = await db.transcriptSegments(flightID);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.text)).toEqual(['segment 0', 'segment 1', 'segment 2']);
    expect(segments[0].confidence).toBe(0.9);
    expect(segments[1].confidence).toBeNull(); // was -1
    expect(segments[2].confidence).toBe(0.0); // a real zero stays a zero
  });

  it('migratedTableAcceptsNilAndKeepsFlightIndex', async () => {
    const pool = await makeLegacyPool();
    const db = await openRecordingDatabase(pool);
    await db.insertTranscript(
      newTranscriptSegment({
        flightID,
        timestamp: 10_000,
        text: 'unscored',
        confidence: null,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'cruise',
      }),
    );
    const stored = (await db.transcriptSegments(flightID)).pop();
    expect(stored?.text).toBe('unscored');
    expect(stored?.confidence).toBeNull();
    const indexes = (
      await pool.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transcript_segments'",
      )
    ).map((r) => r.name);
    expect(indexes).toContain('idx_transcript_segments_flight');
  });

  it('freshDatabaseStoresNilConfidence', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.insertTranscript(
      newTranscriptSegment({
        flightID,
        text: 'no score',
        confidence: null,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'taxi',
        now: () => 1000,
      }),
    );
    await db.insertTranscript(
      newTranscriptSegment({
        flightID,
        timestamp: 2000,
        text: 'scored',
        confidence: 0.7,
        audioStartTime: 1,
        audioEndTime: 2,
        flightPhase: 'taxi',
      }),
    );
    const segments = await db.transcriptSegments(flightID);
    expect(segments[0].confidence).toBeNull();
    expect(segments[segments.length - 1].confidence).toBe(0.7);
  });
});

describe('Debrief Schema Tests (database cases)', () => {
  const open = () => openRecordingDatabase(openNodeSqliteDb());
  it('debriefRecordRoundTrip', async () => {
    const db = await open();
    const record = newDebriefRecord({
      flightID,
      narrativeSummary: 'Test flight summary',
      phaseObservationsJSON: '[{"phase":"cruise","observations":["Good altitude"],"executedWell":true}]',
      improvementsJSON: '["Practice crosswind landings"]',
      overallRating: 4,
      promptTokensEstimate: 2500,
      responseTokensEstimate: 800,
    });
    await db.insertDebrief(record);
    const fetched = await db.debrief(flightID);
    expect(fetched).not.toBeNull();
    expect(fetched).toMatchObject({
      flightID,
      narrativeSummary: 'Test flight summary',
      overallRating: 4,
      promptTokensEstimate: 2500,
      responseTokensEstimate: 800,
    });
  });
  it('debriefRecordDelete', async () => {
    const db = await open();
    await db.insertDebrief(
      newDebriefRecord({
        flightID,
        narrativeSummary: 'Test',
        phaseObservationsJSON: '[]',
        improvementsJSON: '[]',
        overallRating: 3,
      }),
    );
    expect(await db.debrief(flightID)).not.toBeNull();
    await db.deleteDebrief(flightID);
    expect(await db.debrief(flightID)).toBeNull();
  });
  it('debriefRecordOverwrite', async () => {
    const pool = openNodeSqliteDb();
    const db = await openRecordingDatabase(pool);
    await db.insertDebrief(
      newDebriefRecord({
        flightID,
        narrativeSummary: 'First debrief',
        phaseObservationsJSON: '[]',
        improvementsJSON: '[]',
        overallRating: 3,
      }),
    );
    await db.insertDebrief(
      newDebriefRecord({
        flightID,
        narrativeSummary: 'Regenerated debrief',
        phaseObservationsJSON: '[]',
        improvementsJSON: '[]',
        overallRating: 4,
      }),
    );
    const fetched = await db.debrief(flightID);
    expect(fetched?.narrativeSummary).toBe('Regenerated debrief');
    expect(fetched?.overallRating).toBe(4);
    expect((await counts(pool)).debrief_results).toBe(1);
  });
});

describe('RecordingDatabase store', () => {
  const other = '99999999-8888-4777-8666-555555555555';

  it('enables WAL on a file database and keeps it on reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanaf-rec-'));
    try {
      const path = join(dir, 'recording.sqlite');
      await openRecordingDatabase(openNodeSqliteDb(path));
      const again = openNodeSqliteDb(path);
      await openRecordingDatabase(again);
      expect(await again.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores track points in timestamp order per flight, singly and in a batch', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.insertTrackPoint(trackPoints[2]);
    await db.insertTrackPoints([
      trackPoints[3],
      trackPoints[0],
      newTrackPoint({ ...trackPoints[1], id: 'x', flightID: other }),
    ]);
    expect((await db.trackPoints(flightID)).map((p) => p.timestamp)).toEqual([T0, T0 + 2000, T0 + 3000]);
    expect(await db.trackPoints(other)).toHaveLength(1);
    await db.insertTrackPoints([]);
  });

  it('a failing batch inserts nothing', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await expect(db.insertTrackPoints([trackPoints[0], trackPoints[0]])).rejects.toThrow();
    expect(await db.trackPoints(flightID)).toEqual([]);
  });

  it('keeps millisecond precision through the seconds column', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.insertTrackPoint({ ...trackPoints[0], timestamp: 1_700_000_000_123 });
    expect((await db.trackPoints(flightID))[0].timestamp).toBe(1_700_000_000_123);
  });

  it('phase markers: open end, update end, ordered by start', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.insertPhaseMarker(phaseMarkers[1]);
    await db.insertPhaseMarker(
      newPhaseMarker({ flightID, phase: 'taxi', startTimestamp: T0, latitude: 1, longitude: 2, id: 'm0' }),
    );
    expect((await db.phaseMarkers(flightID)).map((m) => m.phase)).toEqual(['taxi', 'takeoff']);
    await db.updatePhaseMarkerEnd(phaseMarkers[1].id, T0 + 9000);
    expect((await db.phaseMarkers(flightID))[1].endTimestamp).toBe(T0 + 9000);
  });

  it('route legs are replaced and kept in order', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.saveRouteLegs(
      [
        { from: 'KPAO', to: 'KSQL' },
        { from: 'KSQL', to: 'KHAF' },
      ],
      flightID,
    );
    expect(await db.routeLegs(flightID)).toEqual([
      { from: 'KPAO', to: 'KSQL' },
      { from: 'KSQL', to: 'KHAF' },
    ]);
    await db.saveRouteLegs([{ from: 'A', to: 'B' }], flightID);
    expect(await db.routeLegs(flightID)).toEqual([{ from: 'A', to: 'B' }]);
    expect(await db.routeLegs(other)).toEqual([]);
  });

  it('flightIDsWithRecordedData lists flights with a track point or a transcript segment, once each', async () => {
    const db = await openRecordingDatabase(openNodeSqliteDb());
    await db.insertTrackPoints(trackPoints);
    await db.insertTranscript(
      newTranscriptSegment({
        flightID,
        text: 't',
        confidence: 0.5,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'cruise',
      }),
    );
    await db.insertTranscript(
      newTranscriptSegment({
        flightID: other,
        text: 'audio only',
        confidence: null,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'cruise',
      }),
    );
    await db.insertPhaseMarker(newPhaseMarker({ flightID: 'markers-only', phase: 'taxi', latitude: 0, longitude: 0 }));
    expect((await db.flightIDsWithRecordedData()).sort()).toEqual([flightID, other].sort());
  });

  it('deleteFlightData removes every table for that flight and leaves others', async () => {
    const pool = openNodeSqliteDb();
    const db = await openRecordingDatabase(pool);
    for (const id of [flightID, other]) {
      await db.insertTrackPoint(
        newTrackPoint({
          flightID: id,
          latitude: 0,
          longitude: 0,
          altitudeFeet: 0,
          groundSpeedKnots: 0,
          verticalSpeedFPM: 0,
          courseDegrees: 0,
        }),
      );
      await db.insertTranscript(
        newTranscriptSegment({
          flightID: id,
          text: 't',
          confidence: 1,
          audioStartTime: 0,
          audioEndTime: 1,
          flightPhase: 'x',
        }),
      );
      await db.insertPhaseMarker(newPhaseMarker({ flightID: id, phase: 'p', latitude: 0, longitude: 0 }));
      await db.saveRouteLegs([{ from: 'A', to: 'B' }], id);
      await db.insertDebrief(
        newDebriefRecord({
          flightID: id,
          narrativeSummary: 's',
          phaseObservationsJSON: '[]',
          improvementsJSON: '[]',
          overallRating: 1,
        }),
      );
    }
    await db.deleteFlightData(flightID);
    expect(await counts(pool)).toEqual({
      track_points: 1,
      transcript_segments: 1,
      phase_markers: 1,
      debrief_results: 1,
      flight_route_legs: 1,
    });
    expect(await db.trackPoints(other)).toHaveLength(1);
  });

  it('records the migrations in order and refuses nothing on a second pass', async () => {
    const pool = openNodeSqliteDb();
    await migrateRecording(pool);
    await migrateRecording(pool);
    expect(RECORDING_MIGRATIONS.map((m) => m.identifier)).toEqual(ALL_MIGRATIONS);
    expect(await applied(pool)).toEqual([...ALL_MIGRATIONS].sort());
  });

  it('a failing migration rolls back whole and is not recorded', async () => {
    const pool = openNodeSqliteDb();
    await migrateRecording(pool);
    await expect(
      migrateRecording(pool, [
        ...RECORDING_MIGRATIONS,
        { identifier: 'v6_bad', statements: ['CREATE TABLE extra (x INTEGER)', 'CREATE TABLE extra (x INTEGER)'] },
      ]),
    ).rejects.toThrow();
    expect((await names(pool, 'table')).has('extra')).toBe(false);
    expect(await applied(pool)).not.toContain('v6_bad');
  });
});
