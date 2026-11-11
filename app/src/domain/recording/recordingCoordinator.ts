// Port of efb-212/Services/Recording/RecordingCoordinator.swift.
// Central recording orchestrator: owns the track recorder, audio recorder and transcription service,
// exposes observable state, runs auto-start monitoring, the countdown and the 1 Hz sync loop.
//
// Differences from Swift (see app/docs/port-notes/L4.md): collaborators and the clock are injected,
// the audio file path comes from an injected function, telemetry/logging are omitted, and the
// @MainActor State object is a plain object with subscribe().

import { AppFailure, type AppError } from '../errors';
import { AutoStartGate } from './autoStartGate';
import {
  systemClock,
  type AudioQualityProfile,
  type AudioRecorderLike,
  type AutoStartInputs,
  type Clock,
  type RecordingStore,
  type TrackRecorderLike,
  type TranscriptionServiceLike,
} from './collaborators';
import { randomUUID, type FlightPhaseType, type PhaseMarker } from './types';

export type RecordingStatus =
  | { kind: 'idle' }
  | { kind: 'countdown'; remaining: number }
  | { kind: 'recording' }
  | { kind: 'paused' }
  | { kind: 'stopping' };

export const idleStatus: RecordingStatus = { kind: 'idle' };
export const recordingStatus: RecordingStatus = { kind: 'recording' };

export type RecordingErrorCode =
  | 'alreadyRecording'
  | 'invalidState'
  | 'notRecording'
  | 'trackWriteFailed'
  | 'trackStreamFailed'
  | 'trackUnreadable'
  | 'flightNotSaved';

export const recordingErrorMessages: Record<RecordingErrorCode, string> = {
  alreadyRecording: 'A recording is already running.',
  invalidState: 'The recording cannot do that in its current state.',
  notRecording: 'No recording is running.',
  trackWriteFailed: "The GPS track could not be saved. Some of this flight's track is missing.",
  trackStreamFailed: "GPS tracking stopped. The rest of this flight's track will not be recorded.",
  trackUnreadable: "This flight's track could not be read. The flight and its audio were kept and marked in History.",
  flightNotSaved:
    'This flight could not be saved to History. Its recording was kept and is recovered when you reopen the app.',
};

export class RecordingError extends Error {
  constructor(readonly code: RecordingErrorCode) {
    super(recordingErrorMessages[code]);
    this.name = 'RecordingError';
  }
}

export interface FlightRecordingSummary {
  flightID: string;
  startDate: number;
  endDate: number;
  trackPointCount: number;
  transcriptSegmentCount: number;
  departureICAO: string | null;
  arrivalICAO: string | null;
  phases: PhaseMarker[];
  audioFileURL: string | null;
}

/** Observable state the UI binds to. */
export class RecordingState {
  recordingStatus: RecordingStatus = idleStatus;
  elapsedTime = 0; // seconds
  currentPhase: FlightPhaseType = 'preflight';
  audioLevel = -160; // dBFS
  countdownRemaining = 0;
  /** Mid-recording failure (e.g. audio write error). */
  lastError: AppError | null = null;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply a batch of changes and notify subscribers once. */
  set(patch: Partial<Omit<RecordingState, 'subscribe' | 'set'>>): void {
    Object.assign(this, patch);
    this.listeners.forEach((l) => l());
  }
}

export interface RecordingCoordinatorDeps {
  recordingStore: RecordingStore;
  audioRecorder: AudioRecorderLike;
  transcriptionService: TranscriptionServiceLike;
  /** Creates the track recorder for one flight (A1 adapter). */
  makeTrackRecorder(flightID: string): TrackRecorderLike;
  /** Where the flight's audio file goes (platform path logic lives in the adapter). */
  audioFileURL(flightID: string): string;
  clock?: Clock;
  newId?: () => string;
}

interface Cancellable {
  cancelled: boolean;
}

export class RecordingCoordinator {
  readonly state = new RecordingState();

  private readonly store: RecordingStore;
  private readonly audio: AudioRecorderLike;
  private readonly transcription: TranscriptionServiceLike;
  private readonly makeTrackRecorder: (flightID: string) => TrackRecorderLike;
  private readonly audioFileURL: (flightID: string) => string;
  private readonly clock: Clock;
  private readonly newId: () => string;

  private trackRecorder: TrackRecorderLike | null = null;
  private timerTask: Cancellable | null = null;
  private autoStartTask: Cancellable | null = null;
  private autoStopTask: Cancellable | null = null;
  private currentFlightID: string | null = null;
  private startSession: symbol | null = null;
  private autoStartGate = new AutoStartGate();
  private recordingStartDate: number | null = null;

  constructor(deps: RecordingCoordinatorDeps) {
    this.store = deps.recordingStore;
    this.audio = deps.audioRecorder;
    this.transcription = deps.transcriptionService;
    this.makeTrackRecorder = deps.makeTrackRecorder;
    this.audioFileURL = deps.audioFileURL;
    this.clock = deps.clock ?? systemClock;
    this.newId = deps.newId ?? randomUUID;
  }

  // MARK: Core lifecycle

  /** Start a new flight recording. Returns the flight id. */
  async startRecording(profile: AudioQualityProfile = 'standard'): Promise<string> {
    // Allowed from idle or from the tail of an auto-start countdown (whatever the remaining count is).
    const current = this.state.recordingStatus;
    if (current.kind !== 'idle' && current.kind !== 'countdown') {
      throw new AppFailure({
        kind: 'recordingFailed',
        cause: new RecordingError(current.kind === 'recording' ? 'alreadyRecording' : 'invalidState'),
      });
    }

    const flightID = this.newId();
    const session = Symbol('startRecording');
    this.startSession = session;
    this.currentFlightID = flightID;
    this.recordingStartDate = this.clock.now();

    this.state.set({
      recordingStatus: recordingStatus,
      elapsedTime: 0,
      currentPhase: 'preflight',
      audioLevel: -160,
      lastError: null,
    });

    let startingTracker: TrackRecorderLike | null = null;
    try {
      startingTracker = this.makeTrackRecorder(flightID);
      this.trackRecorder = startingTracker;
      startingTracker.setFailureHandlers({
        onWriteFailure: () => this.handleTrackFailure('trackWriteFailed'),
        onStreamFailure: () => this.handleTrackFailure('trackStreamFailed'),
      });
      await startingTracker.startTracking();
    } catch (error) {
      // JS-only guard (Swift's tracker calls do not throw). Best-effort release of whatever the tracker acquired.
      await bestEffort(() => startingTracker?.stopTracking());
      // Only roll back our own start: a stop or a newer start may have replaced the session while startup was pending.
      if (this.startSession === session) {
        this.startSession = null;
        this.trackRecorder = null;
        this.currentFlightID = null;
        this.recordingStartDate = null;
        this.state.set({ recordingStatus: idleStatus });
      }
      throw error;
    }
    const tracker = startingTracker;
    if (this.startSession !== session) {
      // Stopped (or replaced) while the tracker was starting: release it and do not start more services.
      await bestEffort(() => tracker.stopTracking());
      throw new AppFailure({ kind: 'recordingFailed', cause: new RecordingError('invalidState') });
    }

    const audioURL = this.audioFileURL(flightID);

    this.audio.setOnInterruptionGap?.((reason) => {
      void this.store
        .insertTranscript({
          flightID,
          text: `[INTERRUPTION: ${reason}]`,
          confidence: 1.0,
          audioStartTime: 0,
          audioEndTime: 0,
          flightPhase: tracker.currentPhase,
        })
        .catch(() => undefined); // Swift: try? (failure ignored)
    });
    this.audio.setOnRecordingError?.((error) => {
      void this.handleAudioFailure(error);
    });

    // Must be wired before startTranscription: the service reads the provider at start.
    this.transcription.setCurrentPhaseProvider?.(() => tracker.currentPhase);

    try {
      await this.audio.startRecording(flightID, profile, audioURL);
    } catch {
      // Continue without audio: the GPS track is still valuable.
    }

    try {
      await this.transcription.startTranscription(flightID);
    } catch {
      // Continue without transcription.
    }

    if (this.startSession !== session) {
      // Stopped while audio or transcription were starting. If nothing newer took over, release what just started.
      await bestEffort(() => tracker.stopTracking());
      if (this.startSession === null) {
        await bestEffort(() => this.audio.stopRecording());
        await bestEffort(() => this.transcription.stopTranscription());
      }
      throw new AppFailure({ kind: 'recordingFailed', cause: new RecordingError('invalidState') });
    }

    this.startTimer();
    return flightID;
  }

  /** Stop the current recording and return a summary, or null when nothing was started. */
  async stopRecording(): Promise<FlightRecordingSummary | null> {
    const flightID = this.currentFlightID;
    const startDate = this.recordingStartDate;
    if (flightID === null || startDate === null) return null;

    this.startSession = null;
    this.state.set({ recordingStatus: { kind: 'stopping' } });

    if (this.timerTask) this.timerTask.cancelled = true;
    this.timerTask = null;

    // A manual stop must not re-arm auto-start while the aircraft is still moving.
    this.autoStartGate.manualStop();

    if (this.autoStopTask) this.autoStopTask.cancelled = true;
    this.autoStopTask = null;

    const audioURL = await this.audio.stopRecording();
    await this.transcription.stopTranscription();

    let trackSummary: { trackPointCount: number; phaseMarkers: PhaseMarker[] } | null = null;
    if (this.trackRecorder) {
      trackSummary = await this.trackRecorder.stopTracking();
    }
    this.trackRecorder = null;

    const endDate = this.clock.now();

    let transcriptCount = 0;
    try {
      transcriptCount = await this.store.transcriptSegmentCount(flightID);
    } catch {
      transcriptCount = 0; // Swift: try? ... ?? 0
    }

    const summary: FlightRecordingSummary = {
      flightID,
      startDate,
      endDate,
      trackPointCount: trackSummary?.trackPointCount ?? 0,
      transcriptSegmentCount: transcriptCount,
      departureICAO: null, // resolved by the caller via nearest airport
      arrivalICAO: null,
      phases: trackSummary?.phaseMarkers ?? [],
      audioFileURL: audioURL,
    };

    this.currentFlightID = null;
    this.recordingStartDate = null;
    this.state.set({ recordingStatus: idleStatus, elapsedTime: 0 });
    return summary;
  }

  // MARK: Auto-start monitoring

  /**
   * Poll ground speed every 500 ms. When speed stays above the threshold for >= 1 s (and the post-stop
   * gate is open), begin the 3 second countdown; cancel it if the condition lapses.
   */
  startAutoStartMonitoring(inputs: AutoStartInputs): void {
    if (this.autoStartTask) this.autoStartTask.cancelled = true;
    const task: Cancellable = { cancelled: false };
    this.autoStartTask = task;

    void (async () => {
      let speedAboveThresholdSince: number | null = null;
      let countdownStarted = false;

      while (!task.cancelled) {
        await this.clock.sleep(500);
        if (task.cancelled) break;

        const status = this.state.recordingStatus;
        const idleOrZeroCountdown = status.kind === 'idle' || (status.kind === 'countdown' && status.remaining === 0);
        if (!idleOrZeroCountdown) {
          if (status.kind === 'recording') {
            speedAboveThresholdSince = null;
            countdownStarted = false;
          }
          continue;
        }

        const speed = inputs.groundSpeedKts();
        const threshold = inputs.autoStartSpeedThresholdKts();
        if (!inputs.isAutoStartEnabled()) {
          speedAboveThresholdSince = null;
          countdownStarted = false;
          continue;
        }

        const allowed = this.updateAutoStartGate(speed, threshold);
        if (speed > threshold && allowed) {
          if (speedAboveThresholdSince === null) speedAboveThresholdSince = this.clock.now();
          const elapsedSeconds = (this.clock.now() - speedAboveThresholdSince) / 1000;
          if (elapsedSeconds >= 1.0 && !countdownStarted) {
            countdownStarted = true;
            await this.startCountdown();
          }
        } else {
          if (countdownStarted) {
            this.cancelCountdown();
            countdownStarted = false;
          }
          speedAboveThresholdSince = null;
        }
      }
    })();
  }

  stopAutoStartMonitoring(): void {
    if (this.autoStartTask) this.autoStartTask.cancelled = true;
    this.autoStartTask = null;
  }

  /** Feed ground speed (knots) to the post-stop gate. False while auto-start is held off. */
  updateAutoStartGate(speed: number, threshold: number): boolean {
    return this.autoStartGate.update(speed, threshold);
  }

  /** True while a manual stop is holding auto-start off. */
  get isAutoStartSuppressed(): boolean {
    return this.autoStartGate.isSuppressed;
  }

  cancelCountdown(): void {
    this.state.set({ recordingStatus: idleStatus, countdownRemaining: 0 });
  }

  // MARK: State sync

  /** Copy the live flight phase and audio level from the sub-services into state. No-op when idle. */
  syncPhaseAndLevel(): void {
    const tracker = this.trackRecorder;
    if (!tracker) return;
    this.state.set({ currentPhase: tracker.currentPhase, audioLevel: this.audio.audioLevel });
  }

  // MARK: Private helpers

  /** Audio stopped itself mid-recording: keep the track, stop transcription, surface the error. */
  private async handleAudioFailure(error: unknown): Promise<void> {
    // Surface the error first so a failing stopTranscription cannot hide it.
    this.state.set({ lastError: asAppError(error), audioLevel: -160 });
    try {
      await this.transcription.stopTranscription();
    } catch {
      // The audio error is already surfaced; nothing more to do.
    }
  }

  /** The track recorder lost points or its stream. Recording continues but the pilot must know. */
  private handleTrackFailure(code: RecordingErrorCode): void {
    this.state.set({ lastError: { kind: 'recordingFailed', cause: new RecordingError(code) } });
  }

  private async startCountdown(): Promise<void> {
    for (let remaining = 3; remaining >= 1; remaining--) {
      this.state.set({ recordingStatus: { kind: 'countdown', remaining }, countdownRemaining: remaining });
      await this.clock.sleep(1000);
      if (this.state.recordingStatus.kind === 'idle') return; // cancelled during countdown
    }

    try {
      await this.startRecording();
    } catch {
      this.state.set({ recordingStatus: idleStatus });
    }
  }

  /** 1 Hz loop: elapsed time plus phase/audio-level sync. Cancelled by stopRecording(). */
  private startTimer(): void {
    if (this.timerTask) this.timerTask.cancelled = true;
    const task: Cancellable = { cancelled: false };
    this.timerTask = task;

    void (async () => {
      while (!task.cancelled) {
        await this.clock.sleep(1000);
        if (task.cancelled) break;
        const startDate = this.recordingStartDate;
        if (startDate === null) break;
        this.state.set({ elapsedTime: (this.clock.now() - startDate) / 1000 });
        this.syncPhaseAndLevel();
      }
    })();
  }
}

function asAppError(error: unknown): AppError {
  if (error instanceof AppFailure) return error.error;
  if (typeof error === 'object' && error !== null && 'kind' in error) return error as AppError;
  return { kind: 'recordingFailed', cause: error };
}

/** Runs cleanup that may throw synchronously or reject; never lets it replace the caller's error. */
async function bestEffort(fn: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await fn();
  } catch {
    // ignored on purpose
  }
}
