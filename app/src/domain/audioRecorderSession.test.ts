import { AudioRecorderSession, type AudioCaptureDriver } from './audioRecorderSession';
import { AppFailure, type AppError } from './errors';
import {
  NO_AUDIO_INPUT_MESSAGE,
  SILENCE_DBFS,
  noAudioInputFailure,
  type InterruptionGapReason,
} from './ports/audioRecorder';

const OUT = 'file:///support/efb-212/recordings/F1.m4a';

type Call = string;

class FakeDriver implements AudioCaptureDriver {
  calls: Call[] = [];
  beginError: unknown = null;
  resumeError: unknown = null;
  endResult: string | null = null;
  endError: unknown = null;
  deactivateError: unknown = null;
  /** When set, begin() waits for this before resolving. */
  beginGate: Promise<void> | null = null;

  activateSession(profile: string): Promise<void> {
    this.calls.push(`activate:${profile}`);
    return Promise.resolve();
  }
  deactivateSession(): Promise<void> {
    this.calls.push('deactivate');
    return this.deactivateError === null ? Promise.resolve() : Promise.reject(this.deactivateError);
  }
  prepareOutput(uri: string): Promise<void> {
    this.calls.push(`prepare:${uri}`);
    return Promise.resolve();
  }
  async begin(flightId: string, profile: string, uri: string): Promise<void> {
    this.calls.push(`begin:${flightId}:${profile}:${uri}`);
    if (this.beginGate) await this.beginGate;
    if (this.beginError !== null) throw this.beginError;
  }
  end(): Promise<string | null> {
    this.calls.push('end');
    return this.endError === null ? Promise.resolve(this.endResult) : Promise.reject(this.endError);
  }
  pause(): Promise<void> {
    this.calls.push('pause');
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.calls.push('resume');
    return this.resumeError === null ? Promise.resolve() : Promise.reject(this.resumeError);
  }
}

function setup(options: { audioDisabled?: boolean } = {}) {
  const driver = new FakeDriver();
  const logged: string[] = [];
  const session = new AudioRecorderSession(driver, { ...options, log: (message) => logged.push(message) });
  const gaps: InterruptionGapReason[] = [];
  const errors: AppError[] = [];
  session.setOnInterruptionGap((reason) => gaps.push(reason));
  session.setOnRecordingError((error) => errors.push(error));
  return { driver, session, gaps, errors, logged };
}

async function recording(options: { audioDisabled?: boolean } = {}) {
  const ctx = setup(options);
  await ctx.session.start('F1', 'standard', OUT);
  ctx.driver.calls = [];
  return ctx;
}

// Ported from efb-212Tests/ServiceTests/AudioRecorderTests.swift (state cases).
describe('AudioRecorderSession initial state (AudioRecorderTests.swift)', () => {
  it('initialStateNotRecording', () => expect(setup().session.isRecording()).toBe(false));
  it('initialAudioLevelIsSilence', () => expect(setup().session.audioLevel()).toBe(-160));

  it('writeFailureWhenIdleIsNoOp', async () => {
    const { session, driver, errors } = setup();
    await session.handleWriteFailure(new Error('ENOSPC'));
    expect(errors).toEqual([]);
    expect(session.isRecording()).toBe(false);
    await expect(session.stop()).resolves.toBeNull();
    expect(driver.calls).toEqual([]);
  });
});

describe('start / stop', () => {
  it('creates the directory, configures the session, then begins capture', async () => {
    const { session, driver } = setup();
    await session.start('F1', 'high', OUT);
    expect(driver.calls).toEqual([`prepare:${OUT}`, 'activate:high', `begin:F1:high:${OUT}`]);
    expect(session.isRecording()).toBe(true);
  });

  it('stop ends capture, deactivates and returns the output URI', async () => {
    const { session, driver } = await recording();
    await expect(session.stop()).resolves.toBe(OUT);
    expect(driver.calls).toEqual(['end', 'deactivate']);
    expect(session.isRecording()).toBe(false);
  });

  it('stop returns where the driver actually left the file when that differs', async () => {
    const { session, driver } = await recording();
    driver.endResult = 'file:///docs/ExpoAudio/flight-F1.m4a';
    await expect(session.stop()).resolves.toBe('file:///docs/ExpoAudio/flight-F1.m4a');
  });

  it('stop still returns the output URI when finalising or deactivating fails, and logs', async () => {
    const { session, driver, logged } = await recording();
    driver.endError = new Error('stop failed');
    driver.deactivateError = new Error('busy');
    await expect(session.stop()).resolves.toBe(OUT);
    expect(logged).toEqual(['audio finalise failed', 'audio session deactivate failed']);
  });

  it('a second stop returns null', async () => {
    const { session } = await recording();
    await session.stop();
    await expect(session.stop()).resolves.toBeNull();
  });

  it('keeps the level after stop (Swift never reset it)', async () => {
    const { session } = await recording();
    session.handleLevel(-20);
    await session.stop();
    expect(session.audioLevel()).toBe(-20);
  });

  it('noAudioInput from the driver propagates unchanged and leaves the session idle', async () => {
    const { session, driver } = setup();
    driver.beginError = noAudioInputFailure();
    await expect(session.start('F1', 'standard', OUT)).rejects.toBe(driver.beginError);
    expect(session.isRecording()).toBe(false);
  });

  it('wraps other start errors as audioSessionFailed', async () => {
    const { session, driver } = setup();
    const cause = new Error('category refused');
    driver.beginError = cause;
    const failure = (await session.start('F1', 'standard', OUT).catch((e: unknown) => e)) as AppFailure;
    expect(failure).toBeInstanceOf(AppFailure);
    expect(failure.error).toEqual({ kind: 'audioSessionFailed', cause });
  });

  it('audioDisabled (-OpenEFBNoAudio) throws noAudioInput without touching the platform', async () => {
    const { session, driver } = setup({ audioDisabled: true });
    const failure = (await session.start('F1', 'standard', OUT).catch((e: unknown) => e)) as AppFailure;
    expect(failure.error.kind).toBe('audioSessionFailed');
    expect((failure.cause as Error).message).toBe(NO_AUDIO_INPUT_MESSAGE);
    expect(driver.calls).toEqual([]);
  });

  it('runs operations in call order: a stop issued during start waits for it', async () => {
    const { session, driver } = setup();
    const gate = Promise.withResolvers<void>();
    driver.beginGate = gate.promise;
    const started = session.start('F1', 'standard', OUT);
    const stopped = session.stop();
    gate.resolve();
    await started;
    await expect(stopped).resolves.toBe(OUT);
    expect(driver.calls.slice(-2)).toEqual(['end', 'deactivate']);
  });

  it('a failed operation does not block the next one', async () => {
    const { session, driver } = setup();
    driver.beginError = new Error('x');
    await expect(session.start('F1', 'standard', OUT)).rejects.toBeInstanceOf(AppFailure);
    driver.beginError = null;
    await session.start('F1', 'standard', OUT);
    expect(session.isRecording()).toBe(true);
  });
});

describe('pause / resume', () => {
  it('pause keeps isRecording true; resume restarts capture', async () => {
    const { session, driver } = await recording();
    await session.pause();
    expect(session.isRecording()).toBe(true);
    await session.resume();
    expect(driver.calls).toEqual(['pause', 'resume']);
  });

  it('are no-ops when not recording', async () => {
    const { session, driver } = setup();
    await session.pause();
    await session.resume();
    expect(driver.calls).toEqual([]);
  });

  it('resume propagates a restart failure', async () => {
    const { session, driver } = await recording();
    driver.resumeError = new Error('session busy');
    await expect(session.resume()).rejects.toThrow('session busy');
  });
});

describe('write failure (Swift handleWriteFailure)', () => {
  it('stops, reports recordingFailed once, and hands the partial file to the next stop once', async () => {
    const { session, driver, errors } = await recording();
    const cause = new Error('ENOSPC');
    await session.handleWriteFailure(cause);
    await session.handleWriteFailure(new Error('again'));
    expect(errors).toEqual([{ kind: 'recordingFailed', cause }]);
    expect(driver.calls).toEqual(['end', 'deactivate']);
    expect(session.isRecording()).toBe(false);
    await expect(session.stop()).resolves.toBe(OUT);
    await expect(session.stop()).resolves.toBeNull();
  });

  it('a new start clears an unclaimed partial file', async () => {
    const { session } = await recording();
    await session.handleWriteFailure(new Error('ENOSPC'));
    await session.start('F2', 'standard', 'file:///f2.m4a');
    await expect(session.stop()).resolves.toBe('file:///f2.m4a');
    await expect(session.stop()).resolves.toBeNull();
  });
});

describe('interruptions (Swift handleInterruption / handleRouteChange / handleDidBecomeActive)', () => {
  it('began pauses and reports a phoneCall gap', async () => {
    const { session, driver, gaps } = await recording();
    await session.handleInterruption({ type: 'began' });
    expect(driver.calls).toEqual(['pause']);
    expect(gaps).toEqual([{ kind: 'phoneCall' }]);
    expect(session.isPausedByInterruption()).toBe(true);
    expect(session.isRecording()).toBe(true);
  });

  it('ended with shouldResume resumes', async () => {
    const { session, driver } = await recording();
    await session.handleInterruption({ type: 'began' });
    await session.handleInterruption({ type: 'ended', shouldResume: true });
    expect(driver.calls).toEqual(['pause', 'resume']);
    expect(session.isPausedByInterruption()).toBe(false);
  });

  it('ended without shouldResume stays paused until the app becomes active', async () => {
    const { session, driver } = await recording();
    await session.handleInterruption({ type: 'began' });
    await session.handleInterruption({ type: 'ended', shouldResume: false });
    expect(driver.calls).toEqual(['pause']);
    await session.handleDidBecomeActive();
    expect(driver.calls).toEqual(['pause', 'resume']);
    expect(session.isPausedByInterruption()).toBe(false);
  });

  it('becoming active without an interruption does nothing', async () => {
    const { session, driver } = await recording();
    await session.handleDidBecomeActive();
    expect(driver.calls).toEqual([]);
  });

  it('a failed resume is swallowed and logged; the next foreground retries', async () => {
    const { session, driver, logged } = await recording();
    await session.handleInterruption({ type: 'began' });
    driver.resumeError = new Error('call still active');
    await session.handleInterruption({ type: 'ended', shouldResume: true });
    expect(logged).toEqual(['audio resume failed']);
    expect(session.isPausedByInterruption()).toBe(true);
    driver.resumeError = null;
    await session.handleDidBecomeActive();
    expect(session.isPausedByInterruption()).toBe(false);
  });

  it('losing the old route reports a headphoneDisconnect gap without pausing', async () => {
    const { session, driver, gaps } = await recording();
    await session.handleRouteChange({ oldDeviceUnavailable: false });
    await session.handleRouteChange({ oldDeviceUnavailable: true });
    expect(gaps).toEqual([{ kind: 'headphoneDisconnect' }]);
    expect(driver.calls).toEqual([]);
  });

  it('stop clears the interrupted state', async () => {
    const { session } = await recording();
    await session.handleInterruption({ type: 'began' });
    await session.stop();
    expect(session.isPausedByInterruption()).toBe(false);
  });

  it('signals are ignored when not recording (Swift observers lived between start and stop)', async () => {
    const { session, driver, gaps } = setup();
    await session.handleInterruption({ type: 'began' });
    await session.handleRouteChange({ oldDeviceUnavailable: true });
    await session.handleDidBecomeActive();
    session.handleLevel(-10);
    expect(gaps).toEqual([]);
    expect(driver.calls).toEqual([]);
    expect(session.audioLevel()).toBe(SILENCE_DBFS);
  });
});

describe('level', () => {
  it('records finite dBFS readings, clamped to [-160, 0], and ignores missing ones', async () => {
    const { session } = await recording();
    session.handleLevel(-42.5);
    expect(session.audioLevel()).toBe(-42.5);
    session.handleLevel(undefined);
    session.handleLevel(Number.NaN);
    expect(session.audioLevel()).toBe(-42.5);
    session.handleLevel(-Infinity);
    expect(session.audioLevel()).toBe(-42.5);
    session.handleLevel(-300);
    expect(session.audioLevel()).toBe(-160);
    session.handleLevel(3);
    expect(session.audioLevel()).toBe(0);
  });
});

describe('AudioRecorderSession start guards', () => {
  it('a failed begin deactivates the audio session again', async () => {
    const { driver, session } = setup();
    driver.beginError = new Error('no input');
    await expect(session.start('F1', 'standard', OUT)).rejects.toBeDefined();
    expect(driver.calls).toContain('deactivate');
    expect(session.isRecording()).toBe(false);
  });

  it('start while already recording does not begin a second capture', async () => {
    const { driver, session } = await recording();
    await session.start('F2', 'standard', OUT);
    expect(driver.calls).toEqual([]);
    expect(session.isRecording()).toBe(true);
  });
});
