// Port of RecordingDatabase (efb-212/Data/RecordingDatabase.swift): the high-frequency store for track points,
// transcript segments, phase markers, debriefs and route legs, in its own `recording.sqlite` in WAL mode. Method names
// and semantics match the Swift ones; times are epoch ms in the API and Unix seconds in the columns.
import type { Db } from '../db';
import { migrateRecording } from './migrations';
import type { DebriefRecord, PhaseMarker, TrackPoint, TranscriptSegment } from './records';

const toSeconds = (ms: number): number => ms / 1000;
const fromSeconds = (s: number): number => Math.round(s * 1000);
const fromSecondsOrNull = (s: number | null): number | null => (s === null ? null : fromSeconds(s));

type Row = Record<string, string | number | null | Uint8Array>;

export interface RouteLeg {
  from: string;
  to: string;
}

export interface RecordingDatabase {
  insertTrackPoint(point: TrackPoint): Promise<void>;
  /** One transaction for a batch (the recorder flushes buffered fixes this way). */
  insertTrackPoints(points: readonly TrackPoint[]): Promise<void>;
  trackPoints(flightID: string): Promise<TrackPoint[]>;
  insertTranscript(segment: TranscriptSegment): Promise<void>;
  transcriptSegments(flightID: string): Promise<TranscriptSegment[]>;
  insertPhaseMarker(marker: PhaseMarker): Promise<void>;
  updatePhaseMarkerEnd(id: string, endTimestamp: number): Promise<void>;
  phaseMarkers(flightID: string): Promise<PhaseMarker[]>;
  /** Replaces any existing debrief for the flight. */
  insertDebrief(record: DebriefRecord): Promise<void>;
  debrief(flightID: string): Promise<DebriefRecord | null>;
  deleteDebrief(flightID: string): Promise<void>;
  /** Replaces the flight's legs, numbering them 0..n-1. */
  saveRouteLegs(legs: readonly RouteLeg[], flightID: string): Promise<void>;
  routeLegs(flightID: string): Promise<RouteLeg[]>;
  /** Flights with any track point or transcript segment: the crash-recovery scan. */
  flightIDsWithRecordedData(): Promise<string[]>;
  deleteFlightData(flightID: string): Promise<void>;
}

/** Enables WAL, runs the migrations and returns the store. Mirrors RecordingDatabase.init (prepareDatabase + migrate). */
export async function openRecordingDatabase(db: Db): Promise<RecordingDatabase> {
  // Returns the resulting mode ('wal' on a file, 'memory' for an in-memory database); a failure here is not fatal.
  await db.get('PRAGMA journal_mode = WAL');
  await migrateRecording(db);
  return makeRecordingDatabase(db);
}

export function makeRecordingDatabase(db: Db): RecordingDatabase {
  const trackFrom = (r: Row): TrackPoint => ({
    id: r.id as string,
    flightID: r.flightID as string,
    timestamp: fromSeconds(r.timestamp as number),
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    altitudeFeet: r.altitudeFeet as number,
    groundSpeedKnots: r.groundSpeedKnots as number,
    verticalSpeedFPM: r.verticalSpeedFPM as number,
    courseDegrees: r.courseDegrees as number,
  });
  const trackValues = (p: TrackPoint) => [
    p.id,
    p.flightID,
    toSeconds(p.timestamp),
    p.latitude,
    p.longitude,
    p.altitudeFeet,
    p.groundSpeedKnots,
    p.verticalSpeedFPM,
    p.courseDegrees,
  ];
  const TRACK_INSERT = 'INSERT INTO track_points VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

  return {
    async insertTrackPoint(point) {
      await db.run(TRACK_INSERT, trackValues(point));
    },
    async insertTrackPoints(points) {
      if (points.length === 0) return;
      await db.transaction(async (tx) => {
        for (const p of points) await tx.run(TRACK_INSERT, trackValues(p));
      });
    },
    async trackPoints(flightID) {
      const rows = await db.all('SELECT * FROM track_points WHERE flightID = ? ORDER BY timestamp', [flightID]);
      return rows.map(trackFrom);
    },
    async insertTranscript(s) {
      await db.run('INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        s.id,
        s.flightID,
        toSeconds(s.timestamp),
        s.text,
        s.confidence,
        s.audioStartTime,
        s.audioEndTime,
        s.flightPhase,
      ]);
    },
    async transcriptSegments(flightID) {
      const rows = await db.all('SELECT * FROM transcript_segments WHERE flightID = ? ORDER BY timestamp', [flightID]);
      return rows.map((r) => ({
        id: r.id as string,
        flightID: r.flightID as string,
        timestamp: fromSeconds(r.timestamp as number),
        text: r.text as string,
        confidence: r.confidence as number | null,
        audioStartTime: r.audioStartTime as number,
        audioEndTime: r.audioEndTime as number,
        flightPhase: r.flightPhase as string,
      }));
    },
    async insertPhaseMarker(m) {
      await db.run('INSERT INTO phase_markers VALUES (?, ?, ?, ?, ?, ?, ?)', [
        m.id,
        m.flightID,
        m.phase,
        toSeconds(m.startTimestamp),
        m.endTimestamp === null ? null : toSeconds(m.endTimestamp),
        m.latitude,
        m.longitude,
      ]);
    },
    async updatePhaseMarkerEnd(id, endTimestamp) {
      await db.run('UPDATE phase_markers SET endTimestamp = ? WHERE id = ?', [toSeconds(endTimestamp), id]);
    },
    async phaseMarkers(flightID) {
      const rows = await db.all('SELECT * FROM phase_markers WHERE flightID = ? ORDER BY startTimestamp', [flightID]);
      return rows.map((r) => ({
        id: r.id as string,
        flightID: r.flightID as string,
        phase: r.phase as string,
        startTimestamp: fromSeconds(r.startTimestamp as number),
        endTimestamp: fromSecondsOrNull(r.endTimestamp as number | null),
        latitude: r.latitude as number,
        longitude: r.longitude as number,
      }));
    },
    async insertDebrief(d) {
      await db.transaction(async (tx) => {
        await tx.run('DELETE FROM debrief_results WHERE flightID = ?', [d.flightID]);
        await tx.run(
          `INSERT INTO debrief_results
            (id, flightID, narrativeSummary, phaseObservationsJSON, improvementsJSON,
             overallRating, generatedAt, promptTokensEstimate, responseTokensEstimate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            d.id,
            d.flightID,
            d.narrativeSummary,
            d.phaseObservationsJSON,
            d.improvementsJSON,
            d.overallRating,
            toSeconds(d.generatedAt),
            d.promptTokensEstimate,
            d.responseTokensEstimate,
          ],
        );
      });
    },
    async debrief(flightID) {
      const r = await db.get('SELECT * FROM debrief_results WHERE flightID = ?', [flightID]);
      if (!r) return null;
      return {
        id: r.id as string,
        flightID: r.flightID as string,
        narrativeSummary: r.narrativeSummary as string,
        phaseObservationsJSON: r.phaseObservationsJSON as string,
        improvementsJSON: r.improvementsJSON as string,
        overallRating: r.overallRating as number,
        generatedAt: fromSeconds(r.generatedAt as number),
        promptTokensEstimate: r.promptTokensEstimate as number | null,
        responseTokensEstimate: r.responseTokensEstimate as number | null,
      };
    },
    async deleteDebrief(flightID) {
      await db.run('DELETE FROM debrief_results WHERE flightID = ?', [flightID]);
    },
    async saveRouteLegs(legs, flightID) {
      await db.transaction(async (tx) => {
        await tx.run('DELETE FROM flight_route_legs WHERE flightID = ?', [flightID]);
        for (const [seq, leg] of legs.entries()) {
          await tx.run('INSERT INTO flight_route_legs (flightID, seq, fromCode, toCode) VALUES (?, ?, ?, ?)', [
            flightID,
            seq,
            leg.from,
            leg.to,
          ]);
        }
      });
    },
    async routeLegs(flightID) {
      const rows = await db.all<{ fromCode: string; toCode: string }>(
        'SELECT fromCode, toCode FROM flight_route_legs WHERE flightID = ? ORDER BY seq',
        [flightID],
      );
      return rows.map((r) => ({ from: r.fromCode, to: r.toCode }));
    },
    async flightIDsWithRecordedData() {
      const rows = await db.all<{ flightID: string }>(
        'SELECT flightID FROM track_points UNION SELECT flightID FROM transcript_segments',
      );
      return rows.map((r) => r.flightID);
    },
    async deleteFlightData(flightID) {
      await db.transaction(async (tx) => {
        for (const table of [
          'track_points',
          'transcript_segments',
          'phase_markers',
          'flight_route_legs',
          'debrief_results',
        ]) {
          await tx.run(`DELETE FROM ${table} WHERE flightID = ?`, [flightID]);
        }
      });
    },
  };
}
