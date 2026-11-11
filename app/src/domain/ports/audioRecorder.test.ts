import {
  AUDIO_QUALITY,
  DEFAULT_AUDIO_QUALITY,
  FakeAudioRecorder,
  NO_AUDIO_INPUT_MESSAGE,
  RECORDINGS_DIR,
  SILENCE_DBFS,
  audioFileName,
  audioFileUri,
  audioRelativePath,
  interruptionGapText,
  noAudioInputFailure,
  type AudioRecorder,
} from './audioRecorder';

// Ported from efb-212Tests/ServiceTests/AudioRecorderTests.swift (profile and directory cases).
describe('AudioQualityProfile (AudioRecorderTests.swift)', () => {
  it('standardProfileSampleRate', () => expect(AUDIO_QUALITY.standard.sampleRate).toBe(16_000));
  it('standardProfileBitRate', () => expect(AUDIO_QUALITY.standard.bitRate).toBe(32_000));
  it('standardProfileEstimatedSize', () => expect(AUDIO_QUALITY.standard.estimatedMBPerHour).toBe(14));
  it('highProfileSampleRate', () => expect(AUDIO_QUALITY.high.sampleRate).toBe(22_050));
  it('highProfileBitRate', () => expect(AUDIO_QUALITY.high.bitRate).toBe(64_000));
  it('highProfileEstimatedSize', () => expect(AUDIO_QUALITY.high.estimatedMBPerHour).toBe(28));

  it('defaults to standard (RecordingCoordinator.startRecording profile default)', () => {
    expect(DEFAULT_AUDIO_QUALITY).toBe('standard');
  });
});

describe('recordings path (RecordingCoordinator.audioFileURL)', () => {
  it('recordingsDirectoryIsInAppSupport: efb-212/recordings under Application Support', () => {
    expect(RECORDINGS_DIR).toBe('efb-212/recordings');
  });

  it('names the file after the upper-case flight UUID, as UUID.uuidString did', () => {
    expect(audioFileName('3f2c9a1e-0b6d-4c7e-9a51-2d0f8e6b7c41')).toBe('3F2C9A1E-0B6D-4C7E-9A51-2D0F8E6B7C41.m4a');
    expect(audioRelativePath('abc')).toBe('efb-212/recordings/ABC.m4a');
  });

  it('joins the Application Support URI without doubling slashes', () => {
    expect(audioFileUri('file:///data/Library/Application Support/', 'abc')).toBe(
      'file:///data/Library/Application Support/efb-212/recordings/ABC.m4a',
    );
  });
});

describe('interruptionGapText (Swift "[INTERRUPTION: \\(reason)]")', () => {
  it('prints the case name', () => {
    expect(interruptionGapText({ kind: 'phoneCall' })).toBe('[INTERRUPTION: phoneCall]');
    expect(interruptionGapText({ kind: 'siri' })).toBe('[INTERRUPTION: siri]');
    expect(interruptionGapText({ kind: 'headphoneDisconnect' })).toBe('[INTERRUPTION: headphoneDisconnect]');
  });

  it('prints an associated value quoted', () => {
    expect(interruptionGapText({ kind: 'other', detail: 'alarm' })).toBe('[INTERRUPTION: other("alarm")]');
  });
});

describe('noAudioInputFailure', () => {
  it('is audioSessionFailed with the Swift noAudioInput description', () => {
    const failure = noAudioInputFailure();
    expect(failure.error.kind).toBe('audioSessionFailed');
    expect((failure.cause as Error).message).toBe(NO_AUDIO_INPUT_MESSAGE);
  });
});

describe('FakeAudioRecorder (replaces Mocks/MockAudioRecorder.swift)', () => {
  it('conformsToAudioRecorderProtocol and starts idle at the silence floor', () => {
    const recorder: AudioRecorder = new FakeAudioRecorder();
    expect(recorder.isRecording()).toBe(false);
    expect(recorder.audioLevel()).toBe(SILENCE_DBFS);
  });

  it('tracks calls and returns the configured stop URI', async () => {
    const fake = new FakeAudioRecorder();
    await fake.start('f1', 'high', 'file:///out.m4a');
    expect(fake.isRecording()).toBe(true);
    await fake.pause();
    await fake.resume();
    await expect(fake.stop()).resolves.toBe('file:///tmp/test.m4a');
    expect(fake.startCalls).toEqual([{ flightId: 'f1', profile: 'high', outputUri: 'file:///out.m4a' }]);
    expect([fake.stopCallCount, fake.pauseCallCount, fake.resumeCallCount]).toEqual([1, 1, 1]);
    expect(fake.isRecording()).toBe(false);
  });

  it('rejects start with the configured error and stays idle', async () => {
    const fake = new FakeAudioRecorder();
    fake.startError = noAudioInputFailure();
    await expect(fake.start('f1', 'standard', 'file:///out.m4a')).rejects.toBe(fake.startError);
    expect(fake.isRecording()).toBe(false);
  });

  it('delivers simulated gaps and errors to the listeners', async () => {
    const fake = new FakeAudioRecorder();
    const gaps: string[] = [];
    const errors: string[] = [];
    fake.setOnInterruptionGap((reason) => gaps.push(reason.kind));
    fake.setOnRecordingError((error) => errors.push(error.kind));
    await fake.start('f1', 'standard', 'file:///out.m4a');
    fake.emitInterruptionGap({ kind: 'siri' });
    fake.emitRecordingError({ kind: 'recordingFailed', cause: null });
    expect(gaps).toEqual(['siri']);
    expect(errors).toEqual(['recordingFailed']);
    expect(fake.isRecording()).toBe(false);
  });
});
