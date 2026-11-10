// The platform-free part of Services/Recording/AudioRecorder.swift: recording state, partial-file handoff after a
// write failure, and interruption / route-change / foreground handling. The platform half (session category, encoder,
// file moves, signal detection) is an AudioCaptureDriver; adapters/audioRecorder.ts supplies the expo-audio one.
import { AppFailure } from './errors';
import {
  SILENCE_DBFS,
  noAudioInputFailure,
  type AudioQualityProfile,
  type AudioRecorder,
  type InterruptionGapListener,
  type RecordingErrorListener,
} from './ports/audioRecorder';

export interface AudioCaptureDriver {
  /** Swift configureAudioSession: category, preferred rate, activation. */
  activateSession(profile: AudioQualityProfile): Promise<void>;
  /** setActive(false, notifyOthersOnDeactivation). Errors are ignored by the caller. */
  deactivateSession(): Promise<void>;
  /** Creates the directory the output file goes into. */
  prepareOutput(outputUri: string): Promise<void>;
  /** Starts capture towards outputUri. Rejects with noAudioInputFailure() when there is no input. */
  begin(flightId: string, profile: AudioQualityProfile, outputUri: string): Promise<void>;
  /**
   * Stops capture and finalises the file at the outputUri given to begin(). Resolves to the URI the file actually
   * ended up at when that differs (e.g. a failed move left it in staging), else null. Swift returned the output URL.
   */
  end(): Promise<string | null>;
  pause(): Promise<void>;
  /** Reactivates the session and restarts capture. */
  resume(): Promise<void>;
}

export type InterruptionSignal = { type: 'began' } | { type: 'ended'; shouldResume: boolean };

export interface AudioRecorderSessionOptions {
  /** Swift DEBUG `-OpenEFBNoAudio`: CI scenarios record without the microphone. start() throws noAudioInput. */
  audioDisabled?: boolean;
  /** Reports swallowed failures (Swift logged them). */
  log?: (message: string, error?: unknown) => void;
}

/**
 * AudioRecorder over a driver. Operations run one at a time in call order, like the Swift actor. Platform signals
 * (interruption, route change, foreground, write failure, meter) are ignored unless recording, as the Swift observers
 * existed only between start and stop.
 */
export class AudioRecorderSession implements AudioRecorder {
  private recording = false;
  private pausedByInterruption = false;
  private level = SILENCE_DBFS;
  private outputUri: string | null = null;
  private partialUri: string | null = null;
  private gapListener: InterruptionGapListener | null = null;
  private errorListener: RecordingErrorListener | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly driver: AudioCaptureDriver,
    private readonly options: AudioRecorderSessionOptions = {},
  ) {}

  isRecording(): boolean {
    return this.recording;
  }

  audioLevel(): number {
    return this.level;
  }

  /** True between an interruption that paused capture and the resume that ended it. */
  isPausedByInterruption(): boolean {
    return this.pausedByInterruption;
  }

  setOnInterruptionGap(listener: InterruptionGapListener | null): void {
    this.gapListener = listener;
  }

  setOnRecordingError(listener: RecordingErrorListener | null): void {
    this.errorListener = listener;
  }

  start(flightId: string, profile: AudioQualityProfile, outputUri: string): Promise<void> {
    return this.serial(async () => {
      if (this.options.audioDisabled) throw noAudioInputFailure();
      try {
        await this.driver.prepareOutput(outputUri);
        await this.driver.activateSession(profile);
        await this.driver.begin(flightId, profile, outputUri);
      } catch (error) {
        throw error instanceof AppFailure ? error : new AppFailure({ kind: 'audioSessionFailed', cause: error });
      }
      this.outputUri = outputUri;
      this.partialUri = null;
      this.recording = true;
    });
  }

  stop(): Promise<string | null> {
    return this.serial(async () => {
      if (!this.recording) {
        const partial = this.partialUri;
        this.partialUri = null;
        return partial;
      }
      this.recording = false;
      this.pausedByInterruption = false;
      const uri = await this.endCapture();
      this.outputUri = null;
      await this.deactivate();
      return uri;
    });
  }

  pause(): Promise<void> {
    return this.serial(() => this.pauseNow());
  }

  resume(): Promise<void> {
    return this.serial(() => this.resumeNow());
  }

  /** Swift handleWriteFailure: stop, keep the partial file for the next stop(), report recordingFailed. */
  handleWriteFailure(cause: unknown): Promise<void> {
    return this.serial(async () => {
      if (!this.recording) return;
      this.recording = false;
      this.pausedByInterruption = false;
      this.partialUri = await this.endCapture();
      this.outputUri = null;
      await this.deactivate();
      this.errorListener?.({ kind: 'recordingFailed', cause });
    });
  }

  /** Swift handleInterruption: began pauses and reports a phoneCall gap; ended resumes only with shouldResume. */
  handleInterruption(signal: InterruptionSignal): Promise<void> {
    return this.serial(async () => {
      if (!this.recording) return;
      if (signal.type === 'began') {
        await this.pauseNow();
        this.pausedByInterruption = true;
        this.gapListener?.({ kind: 'phoneCall' });
      } else if (signal.shouldResume) {
        await this.tryResume();
      }
    });
  }

  /** Swift handleRouteChange: losing the old device (headphones unplugged) reports a gap; capture continues. */
  handleRouteChange(reason: { oldDeviceUnavailable: boolean }): Promise<void> {
    return this.serial(() => {
      if (this.recording && reason.oldDeviceUnavailable) this.gapListener?.({ kind: 'headphoneDisconnect' });
      return Promise.resolve();
    });
  }

  /** Swift handleDidBecomeActive: the interruption-ended signal is not guaranteed, so retry on foreground. */
  handleDidBecomeActive(): Promise<void> {
    return this.serial(async () => {
      if (this.recording && this.pausedByInterruption) await this.tryResume();
    });
  }

  /** A meter reading in dBFS. Ignored when not recording or not a finite number. */
  handleLevel(dbfs: number | null | undefined): void {
    if (!this.recording || typeof dbfs !== 'number' || !Number.isFinite(dbfs)) return;
    this.level = Math.min(0, Math.max(SILENCE_DBFS, dbfs));
  }

  private async pauseNow(): Promise<void> {
    if (!this.recording) return;
    await this.driver.pause();
  }

  private async resumeNow(): Promise<void> {
    if (!this.recording) return;
    await this.driver.resume();
    this.pausedByInterruption = false;
  }

  private async tryResume(): Promise<void> {
    try {
      await this.resumeNow();
    } catch (error) {
      this.options.log?.('audio resume failed', error); // Swift: try? resumeRecording()
    }
  }

  private async endCapture(): Promise<string | null> {
    try {
      return (await this.driver.end()) ?? this.outputUri;
    } catch (error) {
      this.options.log?.('audio finalise failed', error);
      return this.outputUri;
    }
  }

  private async deactivate(): Promise<void> {
    try {
      await this.driver.deactivateSession();
    } catch (error) {
      this.options.log?.('audio session deactivate failed', error); // Swift: try? setActive(false)
    }
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
