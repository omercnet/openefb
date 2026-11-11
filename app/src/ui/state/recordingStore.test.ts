// Behaviour of the recording controls' view model (ViewModels/RecordingViewModel.swift), over a real RecordingCoordinator
// with the L4 fakes. Swift has no test of the view model beyond problem severity and the discarded notice (ported in
// domain/recording/recordingNotices.test.ts); the cases follow the Swift source, and the guards are JS-only (see U8.md).
import { problemDetail, problemSeverity } from '../../domain/recording/recordingNotices';
import type { FlightPersistenceResult } from '../../domain/recording/flightPersistence';
import { RecordingCoordinator, RecordingError } from '../../domain/recording/recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  FakeTrackRecorder,
  flush,
  MockAudioRecorder,
  MockTranscriptionService,
} from '../../domain/recording/testSupport';
import { FakeMicrophonePermission, type MicrophonePermission } from '../../domain/ports/microphonePermission';
import { createRecordingStore, type RecordingViewDeps, type RecordingViewStore } from './recordingStore';

const legs = [
  { from: 'LLHZ', to: 'LLNV' },
  { from: 'LLNV', to: 'LLIB' },
];

interface Setup {
  coordinator: RecordingCoordinator;
  clock: FakeClock;
  audio: MockAudioRecorder;
  tracker: FakeTrackRecorder;
  persist: jest.Mock;
  saveRouteLegs: jest.Mock;
  microphone: MicrophonePermission;
  deps: RecordingViewDeps;
  store: RecordingViewStore;
}

function setup(
  over: { microphone?: MicrophonePermission; routeLegs?: typeof legs; persistResult?: FlightPersistenceResult } = {},
): Setup {
  const clock = new FakeClock();
  const audio = new MockAudioRecorder();
  const tracker = new FakeTrackRecorder();
  let n = 0;
  const coordinator = new RecordingCoordinator({
    recordingStore: new FakeRecordingStore(),
    audioRecorder: audio,
    transcriptionService: new MockTranscriptionService(),
    makeTrackRecorder: () => tracker,
    audioFileURL: (id) => `/rec/${id}.m4a`,
    clock,
    newId: () => `flight-${++n}`,
  });
  const persist = jest.fn(async () => over.persistResult ?? ('saved' as FlightPersistenceResult));
  const saveRouteLegs = jest.fn(async () => undefined);
  const microphone = over.microphone ?? new FakeMicrophonePermission('granted');
  const deps: RecordingViewDeps = {
    coordinator,
    microphone,
    persistence: { persist },
    activeProfileIds: () => ({ aircraftProfileID: 'aircraft-1', pilotProfileID: 'pilot-1' }),
    activeRouteLegs: () => over.routeLegs ?? [],
    saveRouteLegs,
  };
  return {
    coordinator,
    clock,
    audio,
    tracker,
    persist,
    saveRouteLegs,
    microphone,
    deps,
    store: createRecordingStore(deps),
  };
}

describe('following the coordinator', () => {
  it('starts from the coordinator state', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({
      status: { kind: 'idle' },
      elapsedTime: 0,
      currentPhase: 'preflight',
      audioLevel: -160,
      countdownRemaining: 0,
      activeFlightId: null,
      showStopConfirmation: false,
      lastError: null,
      showDiscardedNotice: false,
      microphoneDenied: false,
      lastPersistenceResult: null,
      busy: null,
    });
  });

  it('follows a running recording: status, elapsed time, phase and audio level', async () => {
    const { store, clock, tracker, audio } = setup();
    await store.getState().startRecording();
    expect(store.getState().status).toEqual({ kind: 'recording' });

    tracker.currentPhase = 'cruise';
    audio._audioLevel = -30;
    await clock.advance(5000);

    expect(store.getState()).toMatchObject({ elapsedTime: 5, currentPhase: 'cruise', audioLevel: -30 });
  });

  it('follows an auto-start countdown it did not start', async () => {
    const { store, coordinator } = setup();
    coordinator.state.set({ recordingStatus: { kind: 'countdown', remaining: 2 }, countdownRemaining: 2 });
    expect(store.getState()).toMatchObject({ status: { kind: 'countdown', remaining: 2 }, countdownRemaining: 2 });
  });

  it('stops following after dispose', async () => {
    const { store, coordinator } = setup();
    store.getState().dispose();
    await coordinator.startRecording();
    expect(store.getState().status).toEqual({ kind: 'idle' });
  });
});

describe('startRecording', () => {
  it('starts the coordinator and remembers the flight', async () => {
    const { store, coordinator } = setup();
    expect(await store.getState().startRecording()).toBe('started');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(store.getState()).toMatchObject({ activeFlightId: 'flight-1', lastError: null, busy: null });
  });

  it('stores the active plan legs with the flight, and nothing when there is no plan', async () => {
    const withPlan = setup({ routeLegs: legs });
    await withPlan.store.getState().startRecording();
    expect(withPlan.saveRouteLegs).toHaveBeenCalledWith(legs, 'flight-1');

    const noPlan = setup();
    await noPlan.store.getState().startRecording();
    expect(noPlan.saveRouteLegs).not.toHaveBeenCalled();
  });

  it('a plan that cannot be stored does not stop the recording (Swift try?; the debrief matches the track to the network)', async () => {
    const { store, saveRouteLegs, coordinator } = setup({ routeLegs: legs });
    saveRouteLegs.mockRejectedValueOnce(new Error('disk full'));
    expect(await store.getState().startRecording()).toBe('started');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(store.getState().lastError).toBeNull();
  });

  it('asks for the microphone once when it was never decided, then shows the notice if refused', async () => {
    const microphone = new FakeMicrophonePermission('undetermined', 'denied');
    const { store } = setup({ microphone });
    expect(await store.getState().startRecording()).toBe('problem');
    expect(microphone.requestCalls).toBe(1);
    expect(store.getState()).toMatchObject({ microphoneDenied: true, status: { kind: 'recording' }, lastError: null });
  });

  it('a microphone that is granted when asked starts clean', async () => {
    const microphone = new FakeMicrophonePermission('undetermined', 'granted');
    const { store } = setup({ microphone });
    expect(await store.getState().startRecording()).toBe('started');
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it('does not ask again when the answer is already known; a denied microphone shows the notice and still records', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const { store, coordinator } = setup({ microphone });
    expect(await store.getState().startRecording()).toBe('problem');
    expect(microphone.requestCalls).toBe(0);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(store.getState().microphoneDenied).toBe(true);
  });

  it('a permission check that fails is shown as an audio problem, and the recording still starts', async () => {
    const microphone = new FakeMicrophonePermission('granted');
    microphone.failure = new Error('permission module missing');
    const { store, coordinator } = setup({ microphone });
    expect(await store.getState().startRecording()).toBe('problem');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(store.getState().lastError).toMatchObject({ kind: 'audioSessionFailed' });
    expect(problemDetail(store.getState().lastError!)).toBe('permission module missing');
  });

  it('a start the coordinator refuses shows the error the way Swift wraps it, and does not claim the flight', async () => {
    const { store, coordinator } = setup();
    await coordinator.startRecording(); // something else is already recording
    expect(await store.getState().startRecording()).toBe('problem');
    const { lastError, activeFlightId } = store.getState();
    expect(lastError).toMatchObject({ kind: 'recordingFailed' });
    expect(problemDetail(lastError!)).toBe('Recording failed: A recording is already running.');
    expect(activeFlightId).toBeNull();
    expect(store.getState().busy).toBeNull();
  });

  it('a start that fails leaves no microphone notice: nothing is recording', async () => {
    const { store, coordinator } = setup({ microphone: new FakeMicrophonePermission('denied') });
    jest.spyOn(coordinator, 'startRecording').mockRejectedValueOnce(new RecordingError('trackStreamFailed'));
    expect(await store.getState().startRecording()).toBe('problem');
    expect(store.getState()).toMatchObject({ status: { kind: 'idle' }, microphoneDenied: false });
    expect(store.getState().lastError).toMatchObject({ kind: 'recordingFailed' });
  });

  it('a refused start does not hide the microphone notice of the recording that is running without audio', async () => {
    // Swift recomputes the flag from the live status on every tick: recording and denied is a notice, whoever started it.
    const { store, coordinator } = setup({ microphone: new FakeMicrophonePermission('denied') });
    await coordinator.startRecording();
    await flush();
    expect(await store.getState().startRecording()).toBe('problem');
    expect(store.getState().microphoneDenied).toBe(true);
  });

  it('a new start clears the previous problem and the not-saved notice', async () => {
    const { store, coordinator } = setup({ persistResult: 'discardedEmpty' });
    await store.getState().startRecording();
    coordinator.state.set({ lastError: { kind: 'recordingFailed', cause: new RecordingError('trackWriteFailed') } });
    await store.getState().confirmStop();
    expect(store.getState().showDiscardedNotice).toBe(true);
    expect(store.getState().lastError).not.toBeNull(); // stays until dismissed or the next start

    await store.getState().startRecording();
    expect(store.getState()).toMatchObject({ showDiscardedNotice: false, lastError: null });
  });

  it('a second tap while the first start is still asking for the microphone is ignored', async () => {
    const gate = Promise.withResolvers<void>();
    const request = jest.fn(async () => {
      await gate.promise;
      return 'granted' as const;
    });
    const microphone: MicrophonePermission = {
      status: () => Promise.resolve('undetermined'),
      request,
      openSettings: () => Promise.resolve(),
    };
    const { store, coordinator } = setup({ microphone });
    const first = store.getState().startRecording();
    expect(await store.getState().startRecording()).toBe('busy');
    gate.resolve();
    expect(await first).toBe('started');
    expect(request).toHaveBeenCalledTimes(1);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
  });
});

describe('press (the record button)', () => {
  it('starts from idle', async () => {
    const { store } = setup();
    expect(await store.getState().press()).toBe('started');
    expect(store.getState().status).toEqual({ kind: 'recording' });
  });

  it('reports a problem when the start had one (the shell gives the warning haptic)', async () => {
    const { store } = setup({ microphone: new FakeMicrophonePermission('denied') });
    expect(await store.getState().press()).toBe('problem');
  });

  it('asks for confirmation while recording, without stopping', async () => {
    const { store, coordinator } = setup();
    await store.getState().startRecording();
    expect(await store.getState().press()).toBe('stopRequested');
    expect(store.getState().showStopConfirmation).toBe(true);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
  });

  it('cancels a countdown', async () => {
    const { store, coordinator } = setup();
    coordinator.state.set({ recordingStatus: { kind: 'countdown', remaining: 2 }, countdownRemaining: 2 });
    expect(await store.getState().press()).toBe('countdownCancelled');
    expect(store.getState()).toMatchObject({ status: { kind: 'idle' }, countdownRemaining: 0 });
  });

  it.each([[{ kind: 'paused' as const }], [{ kind: 'stopping' as const }]])('does nothing while %j', async (status) => {
    const { store, coordinator } = setup();
    coordinator.state.set({ recordingStatus: status });
    expect(await store.getState().press()).toBe('ignored');
    expect(store.getState().showStopConfirmation).toBe(false);
  });
});

describe('the stop confirmation', () => {
  it('opens on request and closes on cancel, leaving the recording running', async () => {
    const { store, coordinator } = setup();
    await store.getState().startRecording();
    store.getState().requestStop();
    expect(store.getState().showStopConfirmation).toBe(true);
    store.getState().cancelStop();
    expect(store.getState().showStopConfirmation).toBe(false);
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
  });

  it('closes by itself when the recording ends some other way (JS-only guard: a stale dialog would stop nothing)', async () => {
    const { store, coordinator } = setup();
    await store.getState().startRecording();
    store.getState().requestStop();
    await coordinator.stopRecording();
    expect(store.getState().showStopConfirmation).toBe(false);
  });
});

describe('confirmStop', () => {
  it('stops, persists with the active aircraft and pilot, and reports the result', async () => {
    const { store, persist, coordinator } = setup();
    await store.getState().startRecording();
    store.getState().requestStop();
    await store.getState().confirmStop();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ flightID: 'flight-1' }), 'aircraft-1', 'pilot-1');
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    expect(store.getState()).toMatchObject({
      status: { kind: 'idle' },
      activeFlightId: null,
      showStopConfirmation: false,
      lastPersistenceResult: 'saved',
      showDiscardedNotice: false,
      lastError: null,
      busy: null,
    });
  });

  it('a recording with no track is not saved and the pilot is told', async () => {
    const { store } = setup({ persistResult: 'discardedEmpty' });
    await store.getState().startRecording();
    await store.getState().confirmStop();
    expect(store.getState()).toMatchObject({
      lastPersistenceResult: 'discardedEmpty',
      showDiscardedNotice: true,
      lastError: null,
    });
  });

  it('a kept track that cannot be read is an error, not a notice', async () => {
    const { store } = setup({ persistResult: 'savedTrackUnreadable' });
    await store.getState().startRecording();
    await store.getState().confirmStop();
    const { lastError, showDiscardedNotice } = store.getState();
    expect(lastError).toMatchObject({ kind: 'recordingFailed' });
    expect(problemDetail(lastError!)).toBe(
      "This flight's track could not be read. The flight and its audio were kept and marked in History.",
    );
    expect(showDiscardedNotice).toBe(false);
  });

  it('a flight that could not be saved is an error', async () => {
    const { store } = setup({ persistResult: 'saveFailed' });
    await store.getState().startRecording();
    await store.getState().confirmStop();
    expect(problemDetail(store.getState().lastError!)).toBe(
      'This flight could not be saved to History. Its recording was kept and is recovered when you reopen the app.',
    );
  });

  it('a persistence call that rejects reads as not saved, and says so', async () => {
    const { store, persist } = setup();
    persist.mockRejectedValueOnce(new Error('database locked'));
    await store.getState().startRecording();
    await store.getState().confirmStop();
    expect(store.getState().lastPersistenceResult).toBe('saveFailed');
    expect(store.getState().lastError).toMatchObject({ kind: 'recordingFailed' });
    expect(store.getState().busy).toBeNull();
  });

  it('stores the plan legs with the stopped flight too (a plan activated after the recording started)', async () => {
    let active: typeof legs = [];
    const s = setup();
    const store = createRecordingStore({ ...s.deps, activeRouteLegs: () => active });
    await store.getState().startRecording();
    expect(s.saveRouteLegs).not.toHaveBeenCalled();
    active = legs;
    await store.getState().confirmStop();
    expect(s.saveRouteLegs).toHaveBeenCalledWith(legs, 'flight-1');
  });

  it('a plan that cannot be stored does not stop the flight from being saved', async () => {
    const { store, persist, saveRouteLegs } = setup({ routeLegs: legs });
    await store.getState().startRecording();
    saveRouteLegs.mockRejectedValue(new Error('disk full'));
    await store.getState().confirmStop();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(store.getState().lastPersistenceResult).toBe('saved');
  });

  it('with nothing recording there is nothing to persist', async () => {
    const { store, persist } = setup();
    await store.getState().confirmStop();
    expect(persist).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ lastPersistenceResult: null, lastError: null, busy: null });
  });

  it('a stop that fails is shown and does not leave the store stuck: the next stop works', async () => {
    const { store, coordinator, persist } = setup();
    await store.getState().startRecording();
    jest.spyOn(coordinator, 'stopRecording').mockRejectedValueOnce(new Error('audio could not be finalised'));
    await store.getState().confirmStop();
    expect(problemDetail(store.getState().lastError!)).toBe('audio could not be finalised');
    expect(store.getState().busy).toBeNull();
    expect(persist).not.toHaveBeenCalled();

    await store.getState().confirmStop();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(store.getState().lastPersistenceResult).toBe('saved');
  });

  it('two confirmations started together persist the flight once', async () => {
    const { store, persist } = setup();
    await store.getState().startRecording();
    await Promise.all([store.getState().confirmStop(), store.getState().confirmStop()]);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('a start is refused while a stop is running', async () => {
    const gate = Promise.withResolvers<void>();
    const s = setup();
    s.persist.mockImplementation(async () => {
      await gate.promise;
      return 'saved';
    });
    await s.store.getState().startRecording();
    const stop = s.store.getState().confirmStop();
    await flush();
    expect(await s.store.getState().startRecording()).toBe('busy');
    gate.resolve();
    await stop;
    expect(s.store.getState().busy).toBeNull();
  });
});

describe('problems the coordinator reports', () => {
  const failure = { kind: 'recordingFailed' as const, cause: new RecordingError('trackWriteFailed') };

  it('a failure in the middle of a recording is shown once, and cleared from the coordinator so it is not shown again', async () => {
    const { store, coordinator } = setup();
    await store.getState().startRecording();
    coordinator.state.set({ lastError: failure });
    expect(store.getState().lastError).toBe(failure);
    expect(coordinator.state.lastError).toBeNull();
  });

  it('is caution while the recording runs and warning once it has stopped (severity follows the live status)', async () => {
    const { store, coordinator } = setup();
    await store.getState().startRecording();
    coordinator.state.set({ lastError: failure });
    expect(problemSeverity(store.getState().status)).toBe('caution');
    await store.getState().confirmStop();
    expect(problemSeverity(store.getState().status)).toBe('warning');
    expect(store.getState().lastError).toBe(failure); // still there until dismissed
  });

  it('can be dismissed, and so can the not-saved notice', async () => {
    const { store } = setup({ persistResult: 'discardedEmpty' });
    await store.getState().startRecording();
    await store.getState().confirmStop();
    store.getState().dismissDiscardedNotice();
    expect(store.getState().showDiscardedNotice).toBe(false);

    store.getState().dismissError();
    expect(store.getState().lastError).toBeNull();
  });
});

describe('the microphone notice', () => {
  it('shows while recording when the permission is taken away in Settings, and goes when it is given back', async () => {
    const microphone = new FakeMicrophonePermission('granted');
    const { store } = setup({ microphone });
    await store.getState().startRecording();
    microphone.current = 'denied';
    await store.getState().refreshMicrophone();
    expect(store.getState().microphoneDenied).toBe(true);
    microphone.current = 'granted';
    await store.getState().refreshMicrophone();
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it('is only for a running recording: it goes when the recording stops, whatever the permission is', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const { store } = setup({ microphone });
    await store.getState().startRecording();
    expect(store.getState().microphoneDenied).toBe(true);
    await store.getState().confirmStop();
    expect(store.getState().microphoneDenied).toBe(false);
    await store.getState().refreshMicrophone();
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it('is read when a recording starts without the store (the auto-start countdown ran out)', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const { store, coordinator } = setup({ microphone });
    await coordinator.startRecording();
    await flush();
    expect(store.getState().microphoneDenied).toBe(true);
  });

  it('a late answer does not overwrite a newer one', async () => {
    const first = Promise.withResolvers<'denied'>();
    let calls = 0;
    const microphone: MicrophonePermission = {
      status: () =>
        ++calls === 1 ? Promise.resolve('granted') : calls === 2 ? first.promise : Promise.resolve('granted'),
      request: () => Promise.resolve('granted'),
      openSettings: () => Promise.resolve(),
    };
    const { store } = setup({ microphone });
    await store.getState().startRecording(); // call 1: granted
    const slow = store.getState().refreshMicrophone(); // call 2: waits
    await store.getState().refreshMicrophone(); // call 3: granted, newer
    first.resolve('denied');
    await slow;
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it('an answer still on its way from the previous recording does not apply to the next one', async () => {
    const stale = Promise.withResolvers<'denied'>();
    let calls = 0;
    const microphone: MicrophonePermission = {
      // 1: first start, 2: the refresh that will be late, 3: second start
      status: () => (++calls === 2 ? stale.promise : Promise.resolve('granted')),
      request: () => Promise.resolve('granted'),
      openSettings: () => Promise.resolve(),
    };
    const { store } = setup({ microphone });
    await store.getState().startRecording();
    const late = store.getState().refreshMicrophone();
    await store.getState().confirmStop();
    await store.getState().startRecording(); // recording again, the microphone is on
    stale.resolve('denied');
    await late;
    expect(store.getState().status).toEqual({ kind: 'recording' });
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it('a check that fails keeps what was shown (the next one retries)', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const { store } = setup({ microphone });
    await store.getState().startRecording();
    microphone.failure = new Error('native module missing');
    await store.getState().refreshMicrophone();
    expect(store.getState().microphoneDenied).toBe(true);
  });
});

describe('openMicrophoneSettings', () => {
  it('opens the app page in the system Settings through the permission port', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const { store } = setup({ microphone });
    await store.getState().openMicrophoneSettings();
    expect(microphone.openSettingsCalls).toBe(1);
  });

  it('a Settings page that cannot be opened is ignored, as Swift openURL does not report it either', async () => {
    const microphone: MicrophonePermission = {
      status: () => Promise.resolve('denied'),
      request: () => Promise.resolve('denied'),
      openSettings: () => Promise.reject(new Error('no Settings app')),
    };
    const { store } = setup({ microphone });
    await store.getState().startRecording();
    await expect(store.getState().openMicrophoneSettings()).resolves.toBeUndefined();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().microphoneDenied).toBe(true);
  });
});
