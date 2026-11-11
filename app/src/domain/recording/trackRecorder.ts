// GPS track capture. Port of Services/Recording/TrackRecorder.swift: converts each fix to aviation units, estimates
// vertical speed, stores a track point, advances the phase detector and closes phase markers. The detector,
// estimator (L4) and store (D4) are injected; their TS ports land with those tickets and plug in through the
// interfaces below (see docs/port-notes/A1.md).
import type { LocationFix, LocationSource, LocationSubscription } from '../ports/location';
import { altitudeFeet, speedKnots, trackDegrees } from '../location/ownship';

/** FlightPhaseType raw values (Core/Types.swift). */
export type FlightPhase =
  'preflight' | 'taxi' | 'takeoff' | 'departure' | 'cruise' | 'approach' | 'landing' | 'postflight';

/** TrackPointRecord (Data/RecordingDatabase.swift). Times are epoch ms. */
export interface TrackPoint {
  id: string;
  flightId: string;
  timestampMs: number;
  /** Degrees. */
  latitude: number;
  longitude: number;
  /** Feet MSL. */
  altitudeFeet: number;
  /** Knots. */
  groundSpeedKnots: number;
  /** Feet per minute. */
  verticalSpeedFpm: number;
  /** Degrees true. */
  courseDegrees: number;
}

/** PhaseMarkerRecord. endTimestampMs is null while the phase is open. */
export interface PhaseMarker {
  id: string;
  flightId: string;
  phase: FlightPhase;
  startTimestampMs: number;
  endTimestampMs: number | null;
  latitude: number;
  longitude: number;
}

/** The RecordingDatabase calls TrackRecorder makes. Rejections are write failures. */
export interface TrackStore {
  insertTrackPoint(point: TrackPoint): Promise<void>;
  insertPhaseMarker(marker: PhaseMarker): Promise<void>;
  updatePhaseMarkerEnd(id: string, endTimestampMs: number): Promise<void>;
}

/** FlightPhaseDetector surface. process closes the previous marker in memory when the phase changes. */
export interface PhaseDetector {
  process(point: TrackPoint, hasAltitude: boolean): FlightPhase;
  readonly phaseMarkers: readonly PhaseMarker[];
}

/** VerticalSpeedEstimator surface. update ignores fixes with negative vertical accuracy. */
export interface VerticalSpeedEstimator {
  update(altitudeFeet: number, timestampMs: number, verticalAccuracyM: number): number;
  readonly verticalSpeedFpm: number;
}

export interface TrackRecorderSummary {
  /** Points actually stored. */
  trackPointCount: number;
  /** Points that could not be written. */
  failedWriteCount: number;
  /** The location stream failed while tracking. */
  streamFailed: boolean;
  phaseMarkers: PhaseMarker[];
  currentPhase: FlightPhase;
}

export interface TrackRecorderDeps {
  store: TrackStore;
  flightId: string;
  phaseDetector: PhaseDetector;
  verticalSpeedEstimator: VerticalSpeedEstimator;
  /** Track point ids. Swift used UUID(). */
  newId: () => string;
  /** Called on each phase transition with the new phase and its marker. */
  onPhaseChange?: (phase: FlightPhase, marker: PhaseMarker) => void;
  /** Called once, on the first track point that could not be written. */
  onWriteFailure?: (error: unknown) => void;
  /** Called when the location stream fails while tracking (the track stops growing). */
  onStreamFailure?: (error: Error) => void;
}

export class TrackRecorder {
  private trackPoints = 0;
  private failedWrites = 0;
  private streamFailedFlag = false;
  private lastFixTimestampMs: number | null = null;
  private phase: FlightPhase = 'preflight';
  private subscription: LocationSubscription | null = null;
  /** Fixes are ingested one at a time in arrival order (the Swift actor serialised them). */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TrackRecorderDeps) {}

  get currentPhase(): FlightPhase {
    return this.phase;
  }

  get trackPointCount(): number {
    return this.trackPoints;
  }

  /** Last smoothed vertical speed in feet per minute. */
  get verticalSpeedFpm(): number {
    return this.deps.verticalSpeedEstimator.verticalSpeedFpm;
  }

  /** Starts background-capable airborne updates. Updates without a fix are skipped. */
  start(source: LocationSource): void {
    if (this.subscription) return;
    this.subscription = source.subscribe(
      { activity: 'airborne', background: true },
      {
        onUpdate: (u) => {
          if (u.fix) this.enqueue(u.fix).catch(() => undefined);
        },
        onError: (error) => {
          if (!this.subscription) return;
          this.subscription = null;
          this.streamFailedFlag = true;
          this.deps.onStreamFailure?.(error);
        },
      },
    );
  }

  /**
   * Stops updates, waits for queued fixes, and returns the summary. The still-open final marker is closed at the
   * last fix, in the store and in the summary.
   */
  async stop(): Promise<TrackRecorderSummary> {
    this.subscription?.stop();
    this.subscription = null;
    await this.queue;
    const markers = this.deps.phaseDetector.phaseMarkers.map((m) => ({ ...m }));
    const last = markers[markers.length - 1];
    if (last && last.endTimestampMs === null && this.lastFixTimestampMs !== null) {
      await this.deps.store.updatePhaseMarkerEnd(last.id, this.lastFixTimestampMs).catch(() => undefined);
      last.endTimestampMs = this.lastFixTimestampMs;
    }
    return {
      trackPointCount: this.trackPoints,
      failedWriteCount: this.failedWrites,
      streamFailed: this.streamFailedFlag,
      phaseMarkers: markers,
      currentPhase: this.phase,
    };
  }

  /** Queue a fix behind those already queued. Resolves when it has been ingested. */
  enqueue(fix: LocationFix): Promise<void> {
    const result = this.queue.then(() => this.ingest(fix));
    this.queue = result.catch(() => undefined); // one failed fix must not stall the fixes behind it
    return result;
  }

  /** Process one fix: convert, estimate VSI, store the point, advance the phase detector. */
  private async ingest(fix: LocationFix): Promise<void> {
    const { store, phaseDetector } = this.deps;
    const altitude = altitudeFeet(fix);
    const vsi = this.deps.verticalSpeedEstimator.update(altitude, fix.timestampMs, fix.verticalAccuracyM);
    const point: TrackPoint = {
      id: this.deps.newId(),
      flightId: this.deps.flightId,
      timestampMs: fix.timestampMs,
      latitude: fix.lat,
      longitude: fix.lon,
      altitudeFeet: altitude,
      groundSpeedKnots: speedKnots(fix),
      verticalSpeedFpm: vsi,
      courseDegrees: trackDegrees(fix),
    };

    // Append-only. Only stored points are counted: the summary must not report a track that was never written.
    try {
      await store.insertTrackPoint(point);
      this.trackPoints += 1;
    } catch (error) {
      this.failedWrites += 1;
      if (this.failedWrites === 1) this.deps.onWriteFailure?.(error); // later failures only add to the count
    }
    this.lastFixTimestampMs = fix.timestampMs;

    const previous = this.phase;
    // Negative vertical accuracy: no altitude (Wi-Fi-only fix); phase detection falls back to speed.
    this.phase = phaseDetector.process(point, fix.verticalAccuracyM >= 0);
    const markers = phaseDetector.phaseMarkers;
    const newest = markers[markers.length - 1];
    if (this.phase !== previous && newest) {
      await store.insertPhaseMarker(newest).catch(() => undefined);
      // The detector closed the previous marker in memory at this fix; store that end time.
      const closed = markers[markers.length - 2];
      if (closed && closed.endTimestampMs !== null) {
        await store.updatePhaseMarkerEnd(closed.id, closed.endTimestampMs).catch(() => undefined);
      }
      this.deps.onPhaseChange?.(this.phase, newest);
    }
  }
}
