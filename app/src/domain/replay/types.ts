// Structural subsets of the recording records the replay engine reads (field names follow
// efb-212/Data/RecordingDatabase.swift). Compatible with the L4 recording types and the D ticket's records.
// Times are epoch ms except audioStartTime/audioEndTime, which are seconds from audio start.
// TODO(D): use the data-layer record types once they are on main.

export interface ReplayTrackPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitudeFeet: number;
  groundSpeedKnots: number;
  courseDegrees: number;
}

export interface ReplayTranscriptSegment {
  audioStartTime: number;
  audioEndTime: number;
}

export interface ReplayPhaseMarker {
  phase: string;
  startTimestamp: number;
}

/** What loadFlight reads from the recording store (RecordingDatabase in Swift). */
export interface ReplayStore {
  /** Must be sorted by ascending timestamp (Swift: .order(Column("timestamp"))); duration and interpolation rely on it. */
  trackPoints(flightID: string): Promise<ReplayTrackPoint[]>;
  transcriptSegments(flightID: string): Promise<ReplayTranscriptSegment[]>;
  phaseMarkers(flightID: string): Promise<ReplayPhaseMarker[]>;
}

/** The slice of AVAudioPlayer the engine drives; implemented by an audio adapter. */
export interface ReplayAudioPlayer {
  /** Seconds. */
  currentTime: number;
  rate: number;
  volume: number;
  readonly isPlaying: boolean;
  /** Optional: AVAudioPlayer.prepareToPlay equivalent. */
  prepare?(): void;
  play(): void;
  pause(): void;
  stop(): void;
}

/** Repeating timer; returns a cancel function. Production: setInterval. */
export interface TickScheduler {
  every(ms: number, callback: () => void): () => void;
}

export const intervalScheduler: TickScheduler = {
  every(ms, callback) {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  },
};

export interface PhaseMarkerFraction {
  phase: string;
  fraction: number;
}

export interface InterpolatedPosition {
  coordinate: { lat: number; lon: number };
  heading: number;
  altitude: number;
  speed: number;
}
