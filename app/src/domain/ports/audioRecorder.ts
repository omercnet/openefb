// Port for cockpit audio capture. Replaces Services/Recording/AudioRecorder.swift and AudioRecorderProtocol
// (Core/Protocols.swift). One AAC .m4a file per flight; the Swift recorder never segments, so neither does this port.
// Live PCM streaming to transcription (Swift onBufferAvailable) is not part of the port: A3 captures its own audio.
import { AppFailure, type AppError } from '../errors';

/** Swift AudioQualityProfile raw values (FlightRecord.audioQuality stores these strings). */
export type AudioQualityProfile = 'standard' | 'high';

export interface AudioQualitySpec {
  /** Hz */
  sampleRate: number;
  /** bits per second, AAC */
  bitRate: number;
  estimatedMBPerHour: number;
}

/** Swift AudioQualityProfile.sampleRate / bitRate / estimatedMBPerHour (user decision D-01, Standard default). */
export const AUDIO_QUALITY: Readonly<Record<AudioQualityProfile, AudioQualitySpec>> = {
  standard: { sampleRate: 16_000, bitRate: 32_000, estimatedMBPerHour: 14 },
  high: { sampleRate: 22_050, bitRate: 64_000, estimatedMBPerHour: 28 },
};

export const DEFAULT_AUDIO_QUALITY: AudioQualityProfile = 'standard';

/** dBFS silence floor: the level before the first buffer and when the meter reads nothing. */
export const SILENCE_DBFS = -160;

/** Swift InterruptionGapReason. */
export type InterruptionGapReason =
  { kind: 'phoneCall' } | { kind: 'siri' } | { kind: 'headphoneDisconnect' } | { kind: 'other'; detail: string };

/**
 * Transcript text RecordingCoordinator inserts for a gap: Swift `"[INTERRUPTION: \(reason)]"`, whose enum
 * interpolation prints `phoneCall` or `other("detail")`. Kept byte-identical so imported and new rows match.
 */
export function interruptionGapText(reason: InterruptionGapReason): string {
  const described = reason.kind === 'other' ? `other(${JSON.stringify(reason.detail)})` : reason.kind;
  return `[INTERRUPTION: ${described}]`;
}

/** Swift AudioRecorderError.noAudioInput description. */
export const NO_AUDIO_INPUT_MESSAGE = 'No microphone found. The flight records without cockpit audio.';

/** The failure start() throws when there is no microphone or audio is disabled (Swift audioSessionFailed(noAudioInput)). */
export function noAudioInputFailure(): AppFailure {
  return new AppFailure({ kind: 'audioSessionFailed', cause: new Error(NO_AUDIO_INPUT_MESSAGE) });
}

/** Recordings directory relative to Application Support (RecordingCoordinator.audioFileURL). */
export const RECORDINGS_DIR = 'efb-212/recordings';

/** `<UUID>.m4a`; Swift used UUID.uuidString, which is upper case. */
export function audioFileName(flightId: string): string {
  return `${flightId.toUpperCase()}.m4a`;
}

/**
 * Path relative to Application Support, the form FlightRecord.audioFileURL stores
 * (FlightPersistenceService.relativeToApplicationSupport) and ReplayViewModel resolves.
 */
export function audioRelativePath(flightId: string): string {
  return `${RECORDINGS_DIR}/${audioFileName(flightId)}`;
}

/** Absolute file URI for a flight's audio, given the Application Support directory URI. */
export function audioFileUri(appSupportUri: string, flightId: string): string {
  return `${appSupportUri.replace(/\/+$/, '')}/${audioRelativePath(flightId)}`;
}

export type InterruptionGapListener = (reason: InterruptionGapReason) => void;
export type RecordingErrorListener = (error: AppError) => void;

export interface AudioRecorder {
  /**
   * Starts capture into outputUri (an .m4a file URI; the parent directory is created). Throws AppFailure:
   * audioSessionFailed (no input, session or file error) or microphonePermissionDenied. Callers continue without
   * audio on failure, as RecordingCoordinator did.
   */
  start(flightId: string, profile: AudioQualityProfile, outputUri: string): Promise<void>;
  /**
   * Stops and finalises the file, returning its URI. When not recording, returns the URI of a partial file kept after
   * a mid-recording failure, once, else null.
   */
  stop(): Promise<string | null>;
  /** Pauses capture; isRecording() stays true (Swift semantics). No-op when not recording. */
  pause(): Promise<void>;
  /** Resumes after pause. No-op when not recording; rejects when the session cannot restart. */
  resume(): Promise<void>;
  isRecording(): boolean;
  /** Latest input level in dBFS, SILENCE_DBFS before any reading. */
  audioLevel(): number;
  /** Called when an interruption opens a gap in the audio. */
  setOnInterruptionGap(listener: InterruptionGapListener | null): void;
  /** Called after an unrecoverable mid-recording failure; the recorder has already stopped itself. */
  setOnRecordingError(listener: RecordingErrorListener | null): void;
}

/** Test double replacing efb-212Tests/Mocks/MockAudioRecorder.swift: tracks calls, configurable results. */
export class FakeAudioRecorder implements AudioRecorder {
  startCalls: { flightId: string; profile: AudioQualityProfile; outputUri: string }[] = [];
  stopCallCount = 0;
  pauseCallCount = 0;
  resumeCallCount = 0;
  /** When set, start() rejects with this. */
  startError: unknown = null;
  /** What stop() returns. */
  stopUri: string | null = 'file:///tmp/test.m4a';
  recording = false;
  level = SILENCE_DBFS;
  private gapListener: InterruptionGapListener | null = null;
  private errorListener: RecordingErrorListener | null = null;

  start(flightId: string, profile: AudioQualityProfile, outputUri: string): Promise<void> {
    this.startCalls.push({ flightId, profile, outputUri });
    if (this.startError !== null) return Promise.reject(this.startError);
    this.recording = true;
    return Promise.resolve();
  }

  stop(): Promise<string | null> {
    this.stopCallCount += 1;
    this.recording = false;
    return Promise.resolve(this.stopUri);
  }

  pause(): Promise<void> {
    this.pauseCallCount += 1;
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.resumeCallCount += 1;
    return Promise.resolve();
  }

  isRecording(): boolean {
    return this.recording;
  }

  audioLevel(): number {
    return this.level;
  }

  setOnInterruptionGap(listener: InterruptionGapListener | null): void {
    this.gapListener = listener;
  }

  setOnRecordingError(listener: RecordingErrorListener | null): void {
    this.errorListener = listener;
  }

  /** Simulates an interruption gap reported by the platform. */
  emitInterruptionGap(reason: InterruptionGapReason): void {
    this.gapListener?.(reason);
  }

  /** Simulates a mid-recording failure: stops, then reports. */
  emitRecordingError(error: AppError): void {
    this.recording = false;
    this.errorListener?.(error);
  }
}
