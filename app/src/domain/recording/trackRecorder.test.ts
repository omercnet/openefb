// Ported from efb-212Tests/CharacterizationTests/RecordingStopPathCharacterizationTests.swift (the 3 TrackRecorder
// cases) and ServiceTests/TrackRecorderTests.swift (trackPointsCarryEstimatedVerticalSpeed). The Swift tests used
// the real FlightPhaseDetector, VerticalSpeedEstimator and a GRDB file; those are L4/D4 ports, so a scripted detector,
// a differencing estimator and an in-memory store stand in. Phase thresholds of the real detector stay with L4.
import { FakeLocationSource, makeFix, type LocationFix } from '../ports/location';
import { METERS_PER_FOOT, KNOTS_PER_MPS } from '../location/ownship';
import {
  TrackRecorder,
  type FlightPhase,
  type PhaseDetector,
  type PhaseMarker,
  type TrackPoint,
  type TrackRecorderDeps,
  type TrackStore,
  type VerticalSpeedEstimator,
} from './trackRecorder';

const t0 = 1_700_000_000_000; // epoch ms

/** Synthetic fix. Speed in knots, altitude in feet MSL. */
function fix(second: number, speedKt: number, altitudeFt: number, verticalAccuracyM = 3): LocationFix {
  return makeFix({
    lat: 37.46,
    lon: -122.12,
    altitudeM: altitudeFt * METERS_PER_FOOT,
    verticalAccuracyM,
    courseDeg: 270,
    speedMps: speedKt / KNOTS_PER_MPS,
    timestampMs: t0 + second * 1000,
  });
}

class MemoryTrackStore implements TrackStore {
  points: TrackPoint[] = [];
  markers: PhaseMarker[] = [];
  failPoints = false;

  insertTrackPoint(point: TrackPoint): Promise<void> {
    if (this.failPoints) return Promise.reject(new Error('no such table: track_points'));
    this.points.push(point);
    return Promise.resolve();
  }

  insertPhaseMarker(marker: PhaseMarker): Promise<void> {
    this.markers.push({ ...marker });
    return Promise.resolve();
  }

  updatePhaseMarkerEnd(id: string, endTimestampMs: number): Promise<void> {
    const m = this.markers.find((x) => x.id === id);
    if (m) m.endTimestampMs = endTimestampMs;
    return Promise.resolve();
  }
}

/** Taxi below 30 kt, takeoff below 60 kt, departure above. Closes the previous marker at the transition fix. */
class ScriptedPhaseDetector implements PhaseDetector {
  phaseMarkers: PhaseMarker[] = [];
  private phase: FlightPhase = 'preflight';

  process(point: TrackPoint): FlightPhase {
    const s = point.groundSpeedKnots;
    const next: FlightPhase = s < 30 ? 'taxi' : s < 60 ? 'takeoff' : 'departure';
    if (next !== this.phase) {
      const open = this.phaseMarkers[this.phaseMarkers.length - 1];
      if (open) open.endTimestampMs = point.timestampMs;
      this.phaseMarkers.push({
        id: `m${this.phaseMarkers.length}`,
        flightId: point.flightId,
        phase: next,
        startTimestampMs: point.timestampMs,
        endTimestampMs: null,
        latitude: point.latitude,
        longitude: point.longitude,
      });
      this.phase = next;
    }
    return this.phase;
  }
}

/** Unsmoothed differencing with the estimator's contract: negative vertical accuracy and dt <= 0 hold the value. */
class DifferencingEstimator implements VerticalSpeedEstimator {
  verticalSpeedFpm = 0;
  private last: { ft: number; ms: number } | null = null;

  update(altitudeFeet: number, timestampMs: number, verticalAccuracyM: number): number {
    if (verticalAccuracyM < 0) return this.verticalSpeedFpm;
    if (this.last && timestampMs > this.last.ms) {
      this.verticalSpeedFpm = ((altitudeFeet - this.last.ft) / ((timestampMs - this.last.ms) / 1000)) * 60;
    }
    if (!this.last || timestampMs > this.last.ms) this.last = { ft: altitudeFeet, ms: timestampMs };
    return this.verticalSpeedFpm;
  }
}

function makeRecorder(overrides: Partial<TrackRecorderDeps> = {}) {
  const store = new MemoryTrackStore();
  let n = 0;
  const recorder = new TrackRecorder({
    store,
    flightId: 'flight-1',
    phaseDetector: new ScriptedPhaseDetector(),
    verticalSpeedEstimator: new DifferencingEstimator(),
    newId: () => `p${n++}`,
    ...overrides,
  });
  return { store, recorder };
}

/** Taxi 40 s at 10 kt, roll to 50 kt, then climb at 600 fpm accelerating to 70 kt (the Swift profile). */
async function flyTaxiToDeparture(recorder: TrackRecorder): Promise<number> {
  let second = 0;
  for (let i = 0; i < 40; i++) await recorder.enqueue(fix(second++, 10, 100));
  for (let i = 0; i < 15; i++) await recorder.enqueue(fix(second++, 10 + (i + 1) * (40 / 15), 100));
  let altitude = 100;
  for (let k = 0; k < 90; k++) {
    altitude += 10;
    await recorder.enqueue(fix(second++, Math.min(70, 50 + k), altitude));
  }
  return second;
}

describe('TrackRecorder stop path (characterization)', () => {
  it('every phase marker row is closed in the store after stop', async () => {
    const { store, recorder } = makeRecorder();
    await flyTaxiToDeparture(recorder);
    const summary = await recorder.stop();
    const rows = store.markers;

    expect(rows.map((r) => r.phase)).toEqual(expect.arrayContaining(['taxi', 'takeoff']));
    expect(rows.map((r) => r.id)).toEqual(summary.phaseMarkers.map((m) => m.id)); // one row per in-memory marker
    // efb-df8: every stored marker has an end time; the last one closes at the last fix.
    expect(rows.every((r) => r.endTimestampMs !== null)).toBe(true);
    expect(summary.phaseMarkers.every((m) => m.endTimestampMs !== null)).toBe(true);
    expect(rows[rows.length - 1].endTimestampMs).toBe(store.points[store.points.length - 1].timestampMs);
    // Each marker ends where the next begins, so phase durations are real.
    for (let i = 0; i + 1 < rows.length; i++) expect(rows[i].endTimestampMs).toBe(rows[i + 1].startTimestampMs);
    expect(rows.some((r) => (r.endTimestampMs ?? r.startTimestampMs) > r.startTimestampMs)).toBe(true);
  });

  it('failed track writes are not counted and are reported once', async () => {
    const onWriteFailure = jest.fn();
    const { store, recorder } = makeRecorder({ onWriteFailure });
    store.failPoints = true;
    for (let s = 0; s < 10; s++) await recorder.enqueue(fix(s, 10, 100));
    const summary = await recorder.stop();
    // efb-5ql: every insert failed, so the summary reports no stored points, and says why.
    expect(recorder.trackPointCount).toBe(0);
    expect(summary.trackPointCount).toBe(0);
    expect(summary.failedWriteCount).toBe(10);
    expect(onWriteFailure).toHaveBeenCalledTimes(1);
  });

  it('stored track points are counted when writes succeed', async () => {
    const { store, recorder } = makeRecorder();
    for (let s = 0; s < 5; s++) await recorder.enqueue(fix(s, 10, 100));
    const summary = await recorder.stop();
    expect(summary.trackPointCount).toBe(5);
    expect(summary.failedWriteCount).toBe(0);
    expect(summary.streamFailed).toBe(false);
    expect(store.points).toHaveLength(5);
  });
});

describe('TrackRecorder', () => {
  it('track points carry the estimated vertical speed', async () => {
    const { store, recorder } = makeRecorder();
    for (let i = 0; i < 20; i++) await recorder.enqueue(fix(i, 80, 1000 + i * 5));
    expect(store.points).toHaveLength(20);
    // 5 ft/s = 300 fpm; the first point has no prior fix and stays at 0.
    expect(store.points[0].verticalSpeedFpm).toBe(0);
    expect(Math.abs(store.points[19].verticalSpeedFpm - 300)).toBeLessThan(10);
  });

  // New in TS.
  it('converts units into the stored point and passes hasAltitude from vertical accuracy', async () => {
    const process = jest.fn((): FlightPhase => 'taxi');
    const { store, recorder } = makeRecorder({ phaseDetector: { process, phaseMarkers: [] } });
    await recorder.enqueue(fix(0, 10, 1000, -1));
    expect(store.points[0]).toMatchObject({
      id: 'p0',
      flightId: 'flight-1',
      timestampMs: t0,
      latitude: 37.46,
      longitude: -122.12,
      groundSpeedKnots: expect.closeTo(10, 6),
      altitudeFeet: expect.closeTo(1000, 6),
      courseDegrees: 270,
    });
    expect(process).toHaveBeenCalledWith(store.points[0], false);
  });

  it('subscribes for background airborne updates, serialises fixes, and skips position-less updates', async () => {
    const source = new FakeLocationSource();
    const phases: FlightPhase[] = [];
    const { store, recorder } = makeRecorder({ onPhaseChange: (p) => phases.push(p) });
    recorder.start(source);
    expect(source.requests).toEqual([{ activity: 'airborne', background: true }]);
    source.emitFix(fix(0, 10, 100));
    source.emit({ fix: null, stationary: true });
    source.emitFix(fix(1, 40, 100));
    const summary = await recorder.stop();
    expect(store.points.map((p) => p.timestampMs)).toEqual([t0, t0 + 1000]);
    expect(phases).toEqual(['taxi', 'takeoff']);
    expect(summary.currentPhase).toBe('takeoff');
    expect(source.subscriberCount).toBe(0);
  });

  it('a stream failure while tracking is flagged in the summary and reported', async () => {
    const source = new FakeLocationSource();
    const onStreamFailure = jest.fn();
    const { recorder } = makeRecorder({ onStreamFailure });
    recorder.start(source);
    source.fail(new Error('denied'));
    const summary = await recorder.stop();
    expect(summary.streamFailed).toBe(true);
    expect(onStreamFailure).toHaveBeenCalledWith(new Error('denied'));
  });

  it('stop with no fixes leaves the summary empty and does not touch the store', async () => {
    const { store, recorder } = makeRecorder();
    const summary = await recorder.stop();
    expect(summary).toEqual({
      trackPointCount: 0,
      failedWriteCount: 0,
      streamFailed: false,
      phaseMarkers: [],
      currentPhase: 'preflight',
    });
    expect(store.markers).toEqual([]);
  });
});
