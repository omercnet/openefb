// The recording coordinator's TrackRecorderLike over the TrackRecorder (fixes -> track points and phase markers) on a
// location source. One adapter per flight, made by `makeTrackRecorder(flightID)`.
import type { RecordingDatabase } from '../../data/recording';
import type { PhaseMarker as StoredMarker, TrackPoint as StoredPoint } from '../../data/recording/records';
import type { LocationSource } from '../ports/location';
import type { TrackRecorderLike } from './collaborators';
import { FlightPhaseDetector } from './flightPhaseDetector';
import {
  TrackRecorder,
  type FlightPhase,
  type PhaseDetector,
  type PhaseMarker,
  type TrackPoint,
  type TrackStore,
  type VerticalSpeedEstimator as VerticalSpeedSource,
} from './trackRecorder';
import { VerticalSpeedEstimator } from './verticalSpeedEstimator';

export interface TrackRecorderAdapterDeps {
  /** The recording database (its rows carry `flightID` and `timestamp`; the recorder's carry `flightId` and `timestampMs`). */
  store: Pick<RecordingDatabase, 'insertTrackPoint' | 'insertPhaseMarker' | 'updatePhaseMarkerEnd'>;
  source: LocationSource;
  newId?: () => string;
}

const storedMarker = (m: PhaseMarker): StoredMarker => ({
  id: m.id,
  flightID: m.flightId,
  phase: m.phase,
  startTimestamp: m.startTimestampMs,
  endTimestamp: m.endTimestampMs,
  latitude: m.latitude,
  longitude: m.longitude,
});

const storedPoint = (p: TrackPoint): StoredPoint => ({
  id: p.id,
  flightID: p.flightId,
  timestamp: p.timestampMs,
  latitude: p.latitude,
  longitude: p.longitude,
  altitudeFeet: p.altitudeFeet,
  groundSpeedKnots: p.groundSpeedKnots,
  verticalSpeedFPM: p.verticalSpeedFpm,
  courseDegrees: p.courseDegrees,
});

const recorderMarker = (m: StoredMarker): PhaseMarker => ({
  id: m.id,
  flightId: m.flightID,
  phase: m.phase as FlightPhase,
  startTimestampMs: m.startTimestamp,
  endTimestampMs: m.endTimestamp,
  latitude: m.latitude,
  longitude: m.longitude,
});

/** The phase detector speaks the recording database's row shapes; the recorder speaks its own. */
const phaseDetectorOver = (detector: FlightPhaseDetector): PhaseDetector => ({
  process: (point, hasAltitude) => detector.process(storedPoint(point), hasAltitude) as FlightPhase,
  get phaseMarkers() {
    return detector.phaseMarkers.map(recorderMarker);
  },
});

const verticalSpeedOver = (estimator: VerticalSpeedEstimator): VerticalSpeedSource => ({
  update: (altitudeFeet, timestampMs, accuracy) => estimator.update(altitudeFeet, timestampMs, accuracy),
  get verticalSpeedFpm() {
    return estimator.verticalSpeedFPM;
  },
});

/** The recorder's store calls on the recording database's row shapes. */
export const trackStoreOver = (db: TrackRecorderAdapterDeps['store']): TrackStore => ({
  insertTrackPoint: (p) => db.insertTrackPoint(storedPoint(p)),
  insertPhaseMarker: (m) => db.insertPhaseMarker(storedMarker(m)),
  updatePhaseMarkerEnd: (id, end) => db.updatePhaseMarkerEnd(id, end),
});

export function createTrackRecorderFactory(deps: TrackRecorderAdapterDeps): (flightID: string) => TrackRecorderLike {
  return (flightId) => {
    let writeFailed: (error: unknown) => void = () => undefined;
    let streamFailed: (error: unknown) => void = () => undefined;
    const recorder = new TrackRecorder({
      store: trackStoreOver(deps.store),
      flightId,
      phaseDetector: phaseDetectorOver(new FlightPhaseDetector(deps.newId)),
      verticalSpeedEstimator: verticalSpeedOver(new VerticalSpeedEstimator()),
      newId: deps.newId ?? (() => globalThis.crypto.randomUUID()),
      onWriteFailure: (error) => writeFailed(error),
      onStreamFailure: (error) => streamFailed(error),
    });
    return {
      get currentPhase() {
        return recorder.currentPhase;
      },
      setFailureHandlers(handlers) {
        writeFailed = handlers.onWriteFailure;
        streamFailed = handlers.onStreamFailure;
      },
      async startTracking() {
        recorder.start(deps.source);
      },
      async stopTracking() {
        const summary = await recorder.stop();
        return { trackPointCount: summary.trackPointCount, phaseMarkers: summary.phaseMarkers.map(storedMarker) };
      },
    };
  };
}
