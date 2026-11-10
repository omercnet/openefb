// AudioRecorder on expo-audio. AVAudioRecorder (iOS) / MediaRecorder (Android) write AAC .m4a; the shared session
// logic is domain/audioRecorderSession.ts. Differences from the Swift AVAudioEngine recorder: docs/port-notes/A2.md.
//
// expo-audio gives JS no interruption or route-change events. On iOS it pauses recorders when an interruption begins
// and resumes them when it ends with shouldResume; Android pauses on audio-focus loss. This adapter polls the recorder
// status and treats an unrequested stop of capture as "interruption began" and its return as "ended", which keeps the
// Swift gap marker and the foreground resume fallback. Headphone-disconnect gaps are not detectable and are dropped.
import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioRecorder as ExpoRecorder,
  type RecorderState,
  type RecordingOptions,
  type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';

import { AudioRecorderSession, type AudioCaptureDriver, type InterruptionSignal } from '../domain/audioRecorderSession';
import { AppFailure } from '../domain/errors';
import {
  AUDIO_QUALITY,
  noAudioInputFailure,
  type AudioQualityProfile,
  type AudioRecorder,
} from '../domain/ports/audioRecorder';

// AudioModule is the native module object, not an ES namespace; a local binding keeps import/namespace from
// resolving its members against the module's exports.
const nativeAudio = AudioModule;

/** Status poll period. Swift updated the level per 4096-frame tap buffer (about 85 ms); the UI samples at 1 Hz. */
export const STATUS_POLL_MS = 250;

/**
 * expo-audio records into `<Documents>/ExpoAudio/<name>.m4a` (iOS) or `<files>/Audio/<name>.m4a` (Android) and cannot
 * target an arbitrary path, so the file is staged there and moved to the output URI on stop. After a crash the audio is
 * still at the staging name; crash recovery must look there too.
 */
export function stagingFileName(flightId: string): string {
  return `flight-${flightId.toUpperCase()}`;
}

/** Recording options for a Swift quality profile: mono AAC in .m4a at the profile rate and bit rate, metered. */
export function recordingOptions(profile: AudioQualityProfile, flightId: string): RecordingOptions {
  const { sampleRate, bitRate } = AUDIO_QUALITY[profile];
  return {
    extension: '.m4a',
    sampleRate,
    numberOfChannels: 1,
    bitRate,
    isMeteringEnabled: true,
    directory: 'document',
    fileName: stagingFileName(flightId),
    // 'aac ' is IOSOutputFormat.MPEG4AAC (kAudioFormatMPEG4AAC); 0x40 is AudioQuality.MEDIUM. Literals keep the enums,
    // which load the native module, out of this pure function.
    ios: { outputFormat: 'aac ', audioQuality: 0x40 },
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
    web: {},
  };
}

/**
 * Interruption inferred from two consecutive native "is capturing" readings. Capture stopping without the app having
 * paused it means the system took the session; capture coming back means it gave it back (iOS only auto-resumes when
 * the interruption ended with shouldResume).
 */
export function interruptionFromStatus(
  wasCapturing: boolean,
  isCapturing: boolean,
  pausedByApp: boolean,
): InterruptionSignal | null {
  if (wasCapturing && !isCapturing && !pausedByApp) return { type: 'began' };
  if (!wasCapturing && isCapturing) return { type: 'ended', shouldResume: true };
  return null;
}

/** The failure carried by a status event, or null. Any finish the app did not ask for ends the recording. */
export function failureFromStatusUpdate(update: RecordingStatus, stopping: boolean): Error | null {
  if (stopping) return null;
  if (update.hasError) return new Error(update.error ?? 'audio recording error');
  if (update.mediaServicesDidReset) return new Error('media services were reset');
  if (update.isFinished) return new Error('audio recording finished unexpectedly');
  return null;
}

/** The session operations the platform signals feed. */
export interface CaptureSignals {
  handleLevel(dbfs: number | null | undefined): void;
  handleInterruption(signal: InterruptionSignal): Promise<void>;
  handleWriteFailure(cause: unknown): Promise<void>;
  handleDidBecomeActive(): Promise<void>;
}

export interface ExpoCaptureDriverOptions {
  pollMs?: number;
  log?: (message: string, error?: unknown) => void;
}

export class ExpoCaptureDriver implements AudioCaptureDriver {
  private recorder: ExpoRecorder | null = null;
  private outputUri: string | null = null;
  private capturing = false;
  private pausedByApp = false;
  private stopping = false;
  private signals: CaptureSignals | null = null;
  private poll: ReturnType<typeof setInterval> | undefined;
  private statusSub: { remove(): void } | null = null;
  private appStateSub: NativeEventSubscription | null = null;

  constructor(private readonly options: ExpoCaptureDriverOptions = {}) {}

  attach(signals: CaptureSignals): void {
    this.signals = signals;
  }

  async activateSession(): Promise<void> {
    let permission = await getRecordingPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new AppFailure({ kind: 'microphonePermissionDenied' });
    // iOS: playAndRecord + mixWithOthers + defaultToSpeaker + allowBluetoothHFP (Swift also had A2DP and mode
    // voiceChat). Android: allowsBackgroundRecording runs the microphone foreground service.
    await setAudioModeAsync({
      allowsRecording: true,
      allowsBackgroundRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
    await setIsAudioActiveAsync(true);
  }

  async deactivateSession(): Promise<void> {
    // Not setIsAudioActiveAsync(false): on iOS that also blocks later playback until re-enabled.
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
  }

  prepareOutput(outputUri: string): Promise<void> {
    new File(outputUri).parentDirectory.create({ intermediates: true, idempotent: true });
    return Promise.resolve();
  }

  async begin(flightId: string, profile: AudioQualityProfile, outputUri: string): Promise<void> {
    const recorder = new nativeAudio.AudioRecorder({});
    try {
      await recorder.prepareToRecordAsync(recordingOptions(profile, flightId));
      if (!recorder.getStatus().canRecord) throw noAudioInputFailure();
      recorder.record();
    } catch (error) {
      recorder.release();
      throw error;
    }
    this.recorder = recorder;
    this.outputUri = outputUri;
    this.capturing = true;
    this.pausedByApp = false;
    this.stopping = false;
    this.statusSub = recorder.addListener('recordingStatusUpdate', (update) => this.onStatusUpdate(update));
    this.appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void this.signals?.handleDidBecomeActive();
    });
    this.poll = setInterval(() => this.tick(), this.options.pollMs ?? STATUS_POLL_MS);
  }

  async end(): Promise<string | null> {
    const recorder = this.recorder;
    const outputUri = this.outputUri;
    this.stopping = true;
    this.unsubscribe();
    this.recorder = null;
    this.outputUri = null;
    this.capturing = false;
    if (!recorder) return null;
    let staged: string | null = null;
    try {
      await recorder.stop();
      staged = recorder.uri;
    } finally {
      recorder.release();
    }
    if (!staged || !outputUri || staged === outputUri) return staged;
    try {
      await new File(staged).move(new File(outputUri), { overwrite: true });
      return null;
    } catch (error) {
      this.options.log?.('audio move to output failed; left in staging', error);
      return staged;
    }
  }

  pause(): Promise<void> {
    const recorder = this.recorder;
    // Already stopped by the system: leave it, so expo-audio's own resume on interruption end still applies.
    if (recorder && recorder.getStatus().isRecording) {
      this.pausedByApp = true;
      recorder.pause();
      this.capturing = false;
    }
    return Promise.resolve();
  }

  async resume(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    await setIsAudioActiveAsync(true);
    if (!recorder.getStatus().isRecording) recorder.record();
    this.pausedByApp = false;
    this.capturing = true;
  }

  private tick(): void {
    const recorder = this.recorder;
    if (!recorder || !this.signals) return;
    let status: RecorderState;
    try {
      status = recorder.getStatus();
    } catch (error) {
      this.options.log?.('audio status read failed', error);
      return;
    }
    this.signals.handleLevel(status.metering);
    const signal = interruptionFromStatus(this.capturing, status.isRecording, this.pausedByApp);
    this.capturing = status.isRecording;
    if (signal) void this.signals.handleInterruption(signal);
  }

  private onStatusUpdate(update: RecordingStatus): void {
    const failure = failureFromStatusUpdate(update, this.stopping);
    if (failure) void this.signals?.handleWriteFailure(failure);
  }

  private unsubscribe(): void {
    clearInterval(this.poll);
    this.poll = undefined;
    this.statusSub?.remove();
    this.statusSub = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
  }
}

export interface CreateAudioRecorderOptions extends ExpoCaptureDriverOptions {
  /** Swift DEBUG `-OpenEFBNoAudio`: record flights without the microphone (CI simulators). */
  audioDisabled?: boolean;
}

export function createAudioRecorder(options: CreateAudioRecorderOptions = {}): AudioRecorder {
  const driver = new ExpoCaptureDriver(options);
  const session = new AudioRecorderSession(driver, { audioDisabled: options.audioDisabled, log: options.log });
  driver.attach(session);
  return session;
}
