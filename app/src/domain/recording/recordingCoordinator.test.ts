// Ports of efb-212Tests/ServiceTests/RecordingCoordinatorTests.swift (11 cases), the coordinator cases of
// RecordingStopPathCharacterizationTests (5 of 8; 3 are TrackRecorder, ticket A1), the coordinator case of
// MapGPSRecordingFixesTests, and AutoStartTests.cancelCountdownResetsToIdle.
import { AppFailure } from '../errors';
import { RecordingCoordinator } from './recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  FakeTrackRecorder,
  MockAudioRecorder,
  MockTranscriptionService,
} from './testSupport';

function make(overrides: { audio?: MockAudioRecorder; transcription?: MockTranscriptionService } = {}) {
  const audio = overrides.audio ?? new MockAudioRecorder();
  const transcription = overrides.transcription ?? new MockTranscriptionService();
  const clock = new FakeClock();
  const tracker = new FakeTrackRecorder();
  let n = 0;
  const coordinator = new RecordingCoordinator({
    recordingStore: new FakeRecordingStore(),
    audioRecorder: audio,
    transcriptionService: transcription,
    makeTrackRecorder: () => tracker,
    audioFileURL: (id) => `/rec/${id}.m4a`,
    clock,
    newId: () => `flight-${++n}`,
  });
  return { coordinator, audio, transcription, clock, tracker };
}

describe('RecordingCoordinator Tests', () => {
  test('startRecordingTransitionsToRecording', async () => {
    const { coordinator } = make();
    await coordinator.startRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
  });

  test('stopRecordingReturnsToIdle', async () => {
    const { coordinator } = make();
    await coordinator.startRecording();
    const summary = await coordinator.stopRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(summary).not.toBeNull();
    expect(summary?.flightID).toBeDefined();
  });

  test('startCallsAudioAndTranscription', async () => {
    const { coordinator, audio, transcription } = make();
    await coordinator.startRecording();
    expect(audio.startRecordingCalled).toBe(true);
    expect(transcription.startTranscriptionCalled).toBe(true);
  });

  test('stopCallsAudioAndTranscription', async () => {
    const { coordinator, audio, transcription } = make();
    await coordinator.startRecording();
    await coordinator.stopRecording();
    expect(audio.stopRecordingCalled).toBe(true);
    expect(transcription.stopTranscriptionCalled).toBe(true);
  });

  test('stopRecordingWhenIdleReturnsNil', async () => {
    const { coordinator } = make();
    expect(await coordinator.stopRecording()).toBeNull();
  });

  test('startRecordingReturnsFlightID', async () => {
    const { coordinator } = make();
    const flightID = await coordinator.startRecording();
    expect(flightID).not.toBe('00000000-0000-0000-0000-000000000000');
    await coordinator.stopRecording();
  });

  test('syncPhaseAndLevelCopiesSubServiceStateIntoState', async () => {
    const { coordinator, audio } = make();
    await coordinator.startRecording();
    audio._audioLevel = -20;
    coordinator.syncPhaseAndLevel();
    expect(coordinator.state.audioLevel).toBe(-20);
    expect(coordinator.state.currentPhase).toBe('preflight');
    await coordinator.stopRecording();
  });

  test('syncLoopRunsWhileRecordingWithoutViewLayer', async () => {
    const { coordinator, audio, clock } = make();
    await coordinator.startRecording();
    audio._audioLevel = -30;
    // Nobody calls syncPhaseAndLevel(); the coordinator's own 1 Hz loop must do it.
    await clock.advance(1000);
    expect(coordinator.state.audioLevel).toBe(-30);
    await coordinator.stopRecording();
  });

  test('syncPhaseAndLevelIsNoOpWhenIdle', () => {
    const audio = new MockAudioRecorder();
    audio._audioLevel = -10;
    const { coordinator } = make({ audio });
    coordinator.syncPhaseAndLevel();
    expect(coordinator.state.audioLevel).toBe(-160);
  });

  test('startRecordingIsAllowedFromEndOfCountdown', async () => {
    const { coordinator } = make();
    coordinator.state.recordingStatus = { kind: 'countdown', remaining: 1 };
    await coordinator.startRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    await coordinator.stopRecording();
  });

  test('startRecordingRejectedWhileRecording', async () => {
    const { coordinator } = make();
    await coordinator.startRecording();
    await expect(coordinator.startRecording()).rejects.toBeInstanceOf(AppFailure);
    await coordinator.stopRecording();
  });
});

describe('Characterization: RecordingCoordinator stop path', () => {
  test('secondStopReturnsNilAndStaysIdle', async () => {
    const { coordinator, audio } = make();
    await coordinator.startRecording();
    const first = await coordinator.stopRecording();
    const second = await coordinator.stopRecording();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(audio.stopRecordingCallCount).toBe(1);
  });

  test('stopSummaryCarriesAudioURLFlightIDAndEmptyTrack', async () => {
    const audio = new MockAudioRecorder();
    audio.stopRecordingURL = '/tmp/char-stop.m4a';
    const { coordinator } = make({ audio });
    const flightID = await coordinator.startRecording();
    const summary = await coordinator.stopRecording();
    expect(summary?.flightID).toBe(flightID);
    expect(summary?.audioFileURL).toBe('/tmp/char-stop.m4a');
    expect(summary?.trackPointCount).toBe(0);
    expect(summary?.phases).toEqual([]);
    expect(summary?.transcriptSegmentCount).toBe(0);
    expect(summary!.endDate).toBeGreaterThanOrEqual(summary!.startDate);
  });

  test('audioStartFailureIsSwallowedAndRecordingContinues', async () => {
    const audio = new MockAudioRecorder();
    audio.startRecordingError = new Error('injected');
    const transcription = new MockTranscriptionService();
    const { coordinator } = make({ audio, transcription });
    const flightID = await coordinator.startRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(coordinator.state.lastError).toBeNull();
    expect(transcription.startTranscriptionCalled).toBe(true);
    const summary = await coordinator.stopRecording();
    expect(summary?.flightID).toBe(flightID);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
  });

  test('transcriptionStartFailureIsSwallowedAndStopStillStopsIt', async () => {
    const transcription = new MockTranscriptionService();
    transcription.startTranscriptionError = new Error('injected');
    const { coordinator } = make({ transcription });
    const flightID = await coordinator.startRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(coordinator.state.lastError).toBeNull();
    const summary = await coordinator.stopRecording();
    expect(summary?.flightID).toBe(flightID);
    expect(transcription.stopTranscriptionCallCount).toBe(1);
  });

  test('stopDuringCountdownReturnsNilAndLeavesCountdownRunning', async () => {
    const { coordinator, audio } = make();
    coordinator.state.recordingStatus = { kind: 'countdown', remaining: 2 };
    coordinator.state.countdownRemaining = 2;
    const summary = await coordinator.stopRecording();
    expect(summary).toBeNull();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'countdown', remaining: 2 });
    expect(coordinator.state.countdownRemaining).toBe(2);
    expect(audio.stopRecordingCalled).toBe(false);
  });
});

describe('startRecording rollback', () => {
  // Not in Swift: startTracking cannot throw there; JS collaborators can reject.
  test('startTracking rejection rolls state back and rethrows', async () => {
    const { coordinator, tracker } = make();
    const boom = new Error('tracker failed');
    tracker.startTracking = async () => {
      throw boom;
    };
    await expect(coordinator.startRecording()).rejects.toBe(boom);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(await coordinator.stopRecording()).toBeNull();
    tracker.startTracking = async () => {};
    await coordinator.startRecording();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    await coordinator.stopRecording();
  });
});

describe('startRecording rollback (session and cleanup)', () => {
  test('a failed startup stops the tracker it started', async () => {
    const { coordinator, tracker } = make();
    let stopped = 0;
    tracker.startTracking = async () => {
      throw new Error('boom');
    };
    tracker.stopTracking = async () => {
      stopped += 1;
      return { trackPointCount: 0, phaseMarkers: [] };
    };
    await expect(coordinator.startRecording()).rejects.toThrow('boom');
    expect(stopped).toBe(1);
  });

  function makeWithTrackers(trackers: FakeTrackRecorder[]) {
    let i = 0;
    return new RecordingCoordinator({
      recordingStore: new FakeRecordingStore(),
      audioRecorder: new MockAudioRecorder(),
      transcriptionService: new MockTranscriptionService(),
      makeTrackRecorder: () => trackers[i++]!,
      audioFileURL: (id) => `/rec/${id}.m4a`,
      clock: new FakeClock(),
    });
  }

  test('a stale failed startup does not clear or stop a newer recording', async () => {
    const t1 = new FakeTrackRecorder();
    const t2 = new FakeTrackRecorder();
    let rejectFirst!: (e: Error) => void;
    t1.startTracking = () => new Promise<void>((_, reject) => (rejectFirst = reject));
    let t2Stops = 0;
    t2.stopTracking = async () => {
      t2Stops += 1;
      return { trackPointCount: 0, phaseMarkers: [] };
    };
    const coordinator = makeWithTrackers([t1, t2]);
    const firstResult = coordinator.startRecording().catch((e: Error) => e);
    await Promise.resolve();
    await coordinator.stopRecording();
    await coordinator.startRecording();
    rejectFirst(new Error('late'));
    expect(await firstResult).toBeInstanceOf(Error);
    expect(t2Stops).toBe(0);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(await coordinator.stopRecording()).not.toBeNull();
  });

  test('a canceled startup that later succeeds does not start more services', async () => {
    const t1 = new FakeTrackRecorder();
    let resolveFirst!: () => void;
    t1.startTracking = () => new Promise<void>((resolve) => (resolveFirst = resolve));
    const audio = new MockAudioRecorder();
    const coordinator = new RecordingCoordinator({
      recordingStore: new FakeRecordingStore(),
      audioRecorder: audio,
      transcriptionService: new MockTranscriptionService(),
      makeTrackRecorder: () => t1,
      audioFileURL: (id) => `/rec/${id}.m4a`,
      clock: new FakeClock(),
    });
    const first = coordinator.startRecording().catch((e: Error) => e);
    await Promise.resolve();
    await coordinator.stopRecording();
    resolveFirst();
    expect(await first).toBeInstanceOf(Error);
    expect(audio.startRecordingCalled).toBe(false);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
  });

  test('a synchronously throwing tracker cleanup does not replace the startup error', async () => {
    const { coordinator, tracker } = make();
    tracker.startTracking = async () => {
      throw new Error('start failed');
    };
    tracker.stopTracking = () => {
      throw new Error('cleanup failed');
    };
    await expect(coordinator.startRecording()).rejects.toThrow('start failed');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
  });
});

describe('startRecording rollback (factory)', () => {
  test('makeTrackRecorder throwing rolls state back', async () => {
    const coordinator = new RecordingCoordinator({
      recordingStore: new FakeRecordingStore(),
      audioRecorder: new MockAudioRecorder(),
      transcriptionService: new MockTranscriptionService(),
      makeTrackRecorder: () => {
        throw new Error('no tracker');
      },
      audioFileURL: (id) => `/rec/${id}.m4a`,
      clock: new FakeClock(),
    });
    await expect(coordinator.startRecording()).rejects.toThrow('no tracker');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(await coordinator.stopRecording()).toBeNull();
  });
});

describe('AutoStart (coordinator)', () => {
  test('cancelCountdownResetsToIdle', () => {
    const { coordinator } = make();
    coordinator.state.recordingStatus = { kind: 'countdown', remaining: 2 };
    coordinator.state.countdownRemaining = 2;
    coordinator.cancelCountdown();
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(coordinator.state.countdownRemaining).toBe(0);
  });

  test('coordinatorSuppressesAfterManualStopAndFreshCoordinatorDoesNot', async () => {
    const { coordinator } = make();
    await coordinator.startRecording();
    expect(coordinator.isAutoStartSuppressed).toBe(false);
    await coordinator.stopRecording();
    expect(coordinator.isAutoStartSuppressed).toBe(true);
    expect(coordinator.updateAutoStartGate(97, 15)).toBe(false);
    expect(coordinator.updateAutoStartGate(3, 15)).toBe(true);
    expect(coordinator.isAutoStartSuppressed).toBe(false);
    expect(make().coordinator.isAutoStartSuppressed).toBe(false);
  });

  // Not in Swift (the monitor loop was untested there): drives the loop with the fake clock.
  test('monitorArmsCountdownThenStartsRecording', async () => {
    const { coordinator, clock } = make();
    let speed = 0;
    coordinator.startAutoStartMonitoring({
      groundSpeedKts: () => speed,
      autoStartSpeedThresholdKts: () => 15,
      isAutoStartEnabled: () => true,
    });
    await clock.advance(500);
    speed = 20;
    await clock.advance(1500); // above threshold from 1.0 s: countdown begins
    expect(coordinator.state.recordingStatus.kind).toBe('countdown');
    await clock.advance(3000);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    coordinator.stopAutoStartMonitoring();
  });
});
