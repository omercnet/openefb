import * as ExpoAudio from 'expo-audio';
import type { RecorderState, RecordingStatus } from 'expo-audio';
import { AppState } from 'react-native';

import {
  ExpoCaptureDriver,
  createAudioRecorder,
  failureFromStatusUpdate,
  interruptionFromStatus,
  recordingOptions,
  stagingFileName,
  type CaptureSignals,
} from './audioRecorder';
import { AppFailure, type AppError } from '../domain/errors';
import type { InterruptionGapReason } from '../domain/ports/audioRecorder';

type StatusListener = (update: RecordingStatus) => void;

interface MockRecorder {
  state: RecorderState;
  uri: string | null;
  listener: StatusListener | null;
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  pause: jest.Mock;
  stop: jest.Mock;
  release: jest.Mock;
  getStatus: jest.Mock;
  addListener: jest.Mock;
  removed: boolean;
}

const mockRecorders: MockRecorder[] = [];

function mockMakeRecorder(): MockRecorder {
  const r: MockRecorder = {
    state: {
      canRecord: true,
      isRecording: false,
      durationMillis: 0,
      fileSize: 0,
      mediaServicesDidReset: false,
      url: null,
    },
    uri: 'file:///docs/ExpoAudio/flight-F1.m4a',
    listener: null,
    removed: false,
    prepareToRecordAsync: jest.fn(() => Promise.resolve()),
    record: jest.fn(() => {
      r.state = { ...r.state, isRecording: true };
    }),
    pause: jest.fn(() => {
      r.state = { ...r.state, isRecording: false };
    }),
    stop: jest.fn(() => {
      r.state = { ...r.state, isRecording: false };
      return Promise.resolve();
    }),
    release: jest.fn(),
    getStatus: jest.fn(() => r.state),
    addListener: jest.fn((_event: string, listener: StatusListener) => {
      r.listener = listener;
      return {
        remove: () => {
          r.removed = true;
        },
      };
    }),
  };
  return r;
}

jest.mock('expo-audio', () => ({
  AudioModule: {
    AudioRecorder: jest.fn(() => {
      const r = mockMakeRecorder();
      mockRecorders.push(r);
      return r;
    }),
  },
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
}));

const mockMoves: { from: string; to: string; options: unknown }[] = [];
const mockCreated: { uri: string; options: unknown }[] = [];
let mockMoveError: unknown = null;

jest.mock('expo-file-system', () => ({
  File: jest.fn((uri: string) => ({
    uri,
    parentDirectory: {
      create: (options: unknown) => mockCreated.push({ uri: uri.slice(0, uri.lastIndexOf('/')), options }),
    },
    move: (dest: { uri: string }, options: unknown) => {
      if (mockMoveError !== null) return Promise.reject(mockMoveError);
      mockMoves.push({ from: uri, to: dest.uri, options });
      return Promise.resolve();
    },
  })),
}));

const audio = jest.mocked(ExpoAudio);
const OUT = 'file:///support/efb-212/recordings/F1.m4a';
const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as const;
const denied = { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as const;

let appStateListener: ((state: string) => void) | null = null;
const appStateRemove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockRecorders.length = 0;
  mockMoves.length = 0;
  mockCreated.length = 0;
  mockMoveError = null;
  appStateListener = null;
  audio.getRecordingPermissionsAsync.mockResolvedValue(granted as never);
  audio.requestRecordingPermissionsAsync.mockResolvedValue(granted as never);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: appStateRemove };
  });
});

afterEach(() => jest.useRealTimers());

function status(overrides: Partial<RecordingStatus> = {}): RecordingStatus {
  return { id: 'r', isFinished: false, hasError: false, error: null, url: null, ...overrides };
}

/** Lets queued session work (promise chains) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function started() {
  const recorder = createAudioRecorder({ pollMs: 100 });
  const gaps: InterruptionGapReason[] = [];
  const errors: AppError[] = [];
  recorder.setOnInterruptionGap((reason) => gaps.push(reason));
  recorder.setOnRecordingError((error) => errors.push(error));
  return { recorder, gaps, errors };
}

describe('recordingOptions', () => {
  it('maps the Swift profiles to mono AAC .m4a with metering, staged in documents', () => {
    expect(recordingOptions('standard', 'f1')).toEqual({
      extension: '.m4a',
      sampleRate: 16_000,
      numberOfChannels: 1,
      bitRate: 32_000,
      isMeteringEnabled: true,
      directory: 'document',
      fileName: 'flight-F1',
      ios: { outputFormat: 'aac ', audioQuality: 0x40 },
      android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
      web: {},
    });
    expect(recordingOptions('high', 'f1')).toMatchObject({ sampleRate: 22_050, bitRate: 64_000 });
  });

  it('stages under an upper-case flight name without path separators', () => {
    expect(stagingFileName('ab-cd')).toBe('flight-AB-CD');
  });
});

describe('interruptionFromStatus', () => {
  it('capture stopping without an app pause is an interruption', () => {
    expect(interruptionFromStatus(true, false, false)).toEqual({ type: 'began' });
  });
  it('capture stopping after an app pause is not', () => {
    expect(interruptionFromStatus(true, false, true)).toBeNull();
  });
  it('capture coming back ends it', () => {
    expect(interruptionFromStatus(false, true, false)).toEqual({ type: 'ended', shouldResume: true });
  });
  it('no change is nothing', () => {
    expect(interruptionFromStatus(true, true, false)).toBeNull();
    expect(interruptionFromStatus(false, false, false)).toBeNull();
  });
});

describe('failureFromStatusUpdate', () => {
  it('errors, media-service resets and unrequested finishes are failures', () => {
    expect(failureFromStatusUpdate(status({ hasError: true, error: 'disk full' }), false)?.message).toBe('disk full');
    expect(failureFromStatusUpdate(status({ hasError: true }), false)?.message).toBe('audio recording error');
    expect(failureFromStatusUpdate(status({ mediaServicesDidReset: true }), false)?.message).toBe(
      'media services were reset',
    );
    expect(failureFromStatusUpdate(status({ isFinished: true }), false)?.message).toBe(
      'audio recording finished unexpectedly',
    );
  });
  it('nothing is a failure while the app is stopping, or for a plain update', () => {
    expect(failureFromStatusUpdate(status({ hasError: true, isFinished: true }), true)).toBeNull();
    expect(failureFromStatusUpdate(status(), false)).toBeNull();
  });
});

describe('createAudioRecorder on expo-audio', () => {
  it('asks for permission, configures the session, prepares and records', async () => {
    audio.getRecordingPermissionsAsync.mockResolvedValue({
      ...granted,
      granted: false,
      status: 'undetermined',
    } as never);
    const { recorder } = started();
    await recorder.start('f1', 'standard', OUT);
    expect(audio.requestRecordingPermissionsAsync).toHaveBeenCalled();
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      allowsBackgroundRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
    expect(mockCreated).toEqual([
      { uri: 'file:///support/efb-212/recordings', options: { intermediates: true, idempotent: true } },
    ]);
    const [r] = mockRecorders;
    expect(r.prepareToRecordAsync).toHaveBeenCalledWith(recordingOptions('standard', 'f1'));
    expect(r.record).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(true);
  });

  it('denied permission is microphonePermissionDenied and creates no recorder', async () => {
    audio.getRecordingPermissionsAsync.mockResolvedValue(denied as never);
    const { recorder } = started();
    const failure = (await recorder.start('f1', 'standard', OUT).catch((e: unknown) => e)) as AppFailure;
    expect(failure.error).toEqual({ kind: 'microphonePermissionDenied' });
    expect(audio.requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRecorders).toHaveLength(0);
  });

  it('a recorder that cannot record is noAudioInput and is released', async () => {
    const { recorder } = started();
    jest.mocked(audio.AudioModule.AudioRecorder).mockImplementationOnce(() => {
      const r = mockMakeRecorder();
      r.state = { ...r.state, canRecord: false };
      mockRecorders.push(r);
      return r as never;
    });
    const failure = (await recorder.start('f1', 'standard', OUT).catch((e: unknown) => e)) as AppFailure;
    expect(failure.error.kind).toBe('audioSessionFailed');
    expect(mockRecorders[0].release).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);
  });

  it('stop finalises, mockMoves the staged file to the output URI and releases everything', async () => {
    const { recorder } = started();
    await recorder.start('f1', 'standard', OUT);
    const [r] = mockRecorders;
    await expect(recorder.stop()).resolves.toBe(OUT);
    expect(r.stop).toHaveBeenCalled();
    expect(r.release).toHaveBeenCalled();
    expect(r.removed).toBe(true);
    expect(appStateRemove).toHaveBeenCalled();
    expect(mockMoves).toEqual([
      { from: 'file:///docs/ExpoAudio/flight-F1.m4a', to: OUT, options: { overwrite: true } },
    ]);
    expect(audio.setAudioModeAsync).toHaveBeenLastCalledWith({
      allowsRecording: false,
      allowsBackgroundRecording: false,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a failed move returns the staging URI so the audio is not lost', async () => {
    const { recorder } = started();
    await recorder.start('f1', 'standard', OUT);
    mockMoveError = new Error('EXDEV');
    await expect(recorder.stop()).resolves.toBe('file:///docs/ExpoAudio/flight-F1.m4a');
  });

  it('polls the meter into audioLevel', async () => {
    const { recorder } = started();
    await recorder.start('f1', 'standard', OUT);
    mockRecorders[0].state = { ...mockRecorders[0].state, metering: -31 };
    jest.advanceTimersByTime(100);
    expect(recorder.audioLevel()).toBe(-31);
  });

  it('a system pause becomes a phoneCall gap and its return a resume, without a native pause', async () => {
    const { recorder, gaps } = started();
    await recorder.start('f1', 'standard', OUT);
    const [r] = mockRecorders;
    r.state = { ...r.state, isRecording: false }; // iOS paused it for a call
    jest.advanceTimersByTime(100);
    await flush();
    expect(gaps).toEqual([{ kind: 'phoneCall' }]);
    expect(r.pause).not.toHaveBeenCalled(); // keeps expo's own resume-on-shouldResume armed
    r.state = { ...r.state, isRecording: true }; // the call ended with shouldResume
    jest.advanceTimersByTime(100);
    await flush();
    expect(r.record).toHaveBeenCalledTimes(1);
    expect(gaps).toHaveLength(1);
  });

  it('foregrounding restarts capture the system never resumed', async () => {
    const { recorder } = started();
    await recorder.start('f1', 'standard', OUT);
    const [r] = mockRecorders;
    r.state = { ...r.state, isRecording: false };
    jest.advanceTimersByTime(100);
    await flush();
    appStateListener?.('active');
    await flush();
    expect(r.record).toHaveBeenCalledTimes(2);
    expect(audio.setIsAudioActiveAsync).toHaveBeenLastCalledWith(true);
  });

  it('an app pause is not an interruption', async () => {
    const { recorder, gaps } = started();
    await recorder.start('f1', 'standard', OUT);
    await recorder.pause();
    jest.advanceTimersByTime(300);
    await flush();
    expect(mockRecorders[0].pause).toHaveBeenCalled();
    expect(gaps).toEqual([]);
    await recorder.resume();
    expect(mockRecorders[0].record).toHaveBeenCalledTimes(2);
  });

  it('an error event stops the recording, reports recordingFailed and keeps the partial file', async () => {
    const { recorder, errors } = started();
    await recorder.start('f1', 'standard', OUT);
    mockRecorders[0].listener?.(status({ hasError: true, isFinished: true, error: 'disk full' }));
    await flush();
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('recordingFailed');
    expect(recorder.isRecording()).toBe(false);
    await expect(recorder.stop()).resolves.toBe(OUT);
    await expect(recorder.stop()).resolves.toBeNull();
  });

  it('the finish event caused by stop is not a failure', async () => {
    const { recorder, errors } = started();
    await recorder.start('f1', 'standard', OUT);
    const [r] = mockRecorders;
    r.stop.mockImplementation(() => {
      r.listener?.(status({ isFinished: true }));
      return Promise.resolve();
    });
    await recorder.stop();
    await flush();
    expect(errors).toEqual([]);
  });

  it('audioDisabled never touches expo-audio', async () => {
    const recorder = createAudioRecorder({ audioDisabled: true });
    await expect(recorder.start('f1', 'standard', OUT)).rejects.toBeInstanceOf(AppFailure);
    expect(audio.getRecordingPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('ExpoCaptureDriver without a session', () => {
  it('end with nothing begun returns null; ticks without signals are ignored', async () => {
    const driver = new ExpoCaptureDriver();
    await expect(driver.end()).resolves.toBeNull();
    const signals: CaptureSignals = {
      handleLevel: jest.fn(),
      handleInterruption: jest.fn(() => Promise.resolve()),
      handleWriteFailure: jest.fn(() => Promise.resolve()),
      handleDidBecomeActive: jest.fn(() => Promise.resolve()),
    };
    driver.attach(signals);
    await driver.pause();
    await driver.resume();
    expect(signals.handleLevel).not.toHaveBeenCalled();
  });
});
