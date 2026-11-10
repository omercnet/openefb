// Collaborator shapes the RecordingCoordinator needs. They mirror the Swift protocols
// (AudioRecorderProtocol, TranscriptionServiceProtocol), TrackRecorder, and the parts of RecordingDatabase the
// coordinator calls. Platform adapters (A1 track recorder, A2 audio, A3 transcription, D recording store) implement
// them; tests use fakes. Times are epoch ms.
// TODO(adapters): the ports agent may move or rename these under src/domain/ports; the coordinator only needs the shapes.

import type { FlightPhaseType, PhaseMarker } from './types';

export type AudioQualityProfile = 'standard' | 'high';

export interface AudioRecorderLike {
  startRecording(flightID: string, profile: AudioQualityProfile, outputURL: string): Promise<void>;
  /** Returns the audio file location, or null when nothing was recorded. */
  stopRecording(): Promise<string | null>;
  /** dBFS, -160 is the silence floor. */
  readonly audioLevel: number;
  /** Real recorder only: called when audio is interrupted (phone call, route change). */
  setOnInterruptionGap?(handler: (reason: string) => void): void;
  /** Real recorder only: called when audio stops itself mid-recording (e.g. disk full). */
  setOnRecordingError?(handler: (error: unknown) => void): void;
}

export interface TranscriptionServiceLike {
  startTranscription(flightID: string): Promise<void>;
  stopTranscription(): Promise<void>;
  /** Real service only: tags transcript segments with the live phase. */
  setCurrentPhaseProvider?(provider: () => FlightPhaseType): void;
}

export interface TrackRecorderSummary {
  trackPointCount: number;
  phaseMarkers: PhaseMarker[];
}

export interface TrackRecorderLike {
  readonly currentPhase: FlightPhaseType;
  setFailureHandlers(handlers: { onWriteFailure(error: unknown): void; onStreamFailure(error: unknown): void }): void;
  startTracking(): Promise<void>;
  stopTracking(): Promise<TrackRecorderSummary>;
}

export interface TranscriptSegmentInsert {
  flightID: string;
  text: string;
  confidence: number;
  audioStartTime: number;
  audioEndTime: number;
  flightPhase: FlightPhaseType;
}

export interface RecordingStore {
  transcriptSegmentCount(flightID: string): Promise<number>;
  insertTranscript(segment: TranscriptSegmentInsert): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** What the auto-start monitor reads from app state, polled every 500 ms. */
export interface AutoStartInputs {
  groundSpeedKts(): number;
  autoStartSpeedThresholdKts(): number;
  isAutoStartEnabled(): boolean;
}
