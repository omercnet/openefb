import { createStore, type StoreApi } from 'zustand';
import type { RouteLeg } from '../../data/recording';
import type { AppError } from '../../domain/errors';
import type { MicrophonePermission } from '../../domain/ports/microphonePermission';
import type { FlightPersistenceResult, FlightPersistenceService } from '../../domain/recording/flightPersistence';
import { pressAction, shouldShowDiscardedNotice } from '../../domain/recording/recordingNotices';
import {
  RecordingError,
  type RecordingCoordinator,
  type RecordingErrorCode,
  type RecordingStatus,
} from '../../domain/recording/recordingCoordinator';
import type { FlightPhaseType } from '../../domain/recording/types';

// View model of the recording controls (ViewModels/RecordingViewModel.swift). It mirrors the coordinator's observable state
// (Swift polled it every 0.5 s; the coordinator notifies, so the store follows it) and drives start, stop and the countdown.
// The record button itself (flight log strip, U3), the notices and the stop dialog (ui/recording) bind to it. Other screens
// read it too, in place of the AppState fields the Swift view model copied the state into.

export interface RecordingViewDeps {
  coordinator: Pick<RecordingCoordinator, 'state' | 'startRecording' | 'stopRecording' | 'cancelCountdown'>;
  microphone: MicrophonePermission;
  /** Creates the FlightRecord and the draft logbook entry when a recording stops. */
  persistence: Pick<FlightPersistenceService, 'persist'>;
  /** AppState.activeAircraftProfileID and activePilotProfileID, read when the recording stops. */
  activeProfileIds(): { aircraftProfileID: string | null; pilotProfileID: string | null };
  /** The legs of the activated plan (AppState.activeRoute.legs); empty without one. */
  activeRouteLegs(): readonly RouteLeg[];
  /** RecordingDatabase.saveRouteLegs: the plan stored with the flight so the debrief can compare against it. */
  saveRouteLegs(legs: readonly RouteLeg[], flightId: string): Promise<void>;
}

/** started: a clean start. problem: it started with the microphone off or failed (the shell gives the warning haptic). busy: ignored. */
export type StartOutcome = 'started' | 'problem' | 'busy';
export type PressOutcome = StartOutcome | 'stopRequested' | 'countdownCancelled' | 'ignored';

export interface RecordingViewState {
  status: RecordingStatus;
  /** Seconds. */
  elapsedTime: number;
  currentPhase: FlightPhaseType;
  /** dBFS. */
  audioLevel: number;
  countdownRemaining: number;
  /** The flight a manual start began (AppState.activeFlightRecordID); an auto-started recording does not set it, as in Swift. */
  activeFlightId: string | null;
  showStopConfirmation: boolean;
  /** A failed start, or a failure in the middle of a recording (shown once); dismissible. */
  lastError: AppError | null;
  /** The last stopped recording had no track points and was not saved. Shown until dismissed. */
  showDiscardedNotice: boolean;
  /** Microphone access is off while a recording runs: the GPS track still records. */
  microphoneDenied: boolean;
  /** What happened to the last stopped recording. */
  lastPersistenceResult: FlightPersistenceResult | null;
  /** A start or a stop is running; a second one is refused (JS-only: a double tap). */
  busy: 'starting' | 'stopping' | null;

  startRecording(): Promise<StartOutcome>;
  /** What a tap on the record button does in the current state. */
  press(): Promise<PressOutcome>;
  requestStop(): void;
  cancelStop(): void;
  /** Stops, then stores the flight and its draft logbook entry (or discards a recording with no track). */
  confirmStop(): Promise<void>;
  cancelCountdown(): void;
  dismissError(): void;
  dismissDiscardedNotice(): void;
  /** Reads the microphone permission again (the app came back from Settings). */
  refreshMicrophone(): Promise<void>;
  /** "Open Settings" on the microphone notice. */
  openMicrophoneSettings(): Promise<void>;
  /** Stops following the coordinator. */
  dispose(): void;
}

export type RecordingViewStore = StoreApi<RecordingViewState>;

const recordingFailure = (code: RecordingErrorCode): AppError => ({
  kind: 'recordingFailed',
  cause: new RecordingError(code),
});

export function createRecordingStore(deps: RecordingViewDeps): RecordingViewStore {
  const source = deps.coordinator.state;
  let micToken = 0;
  let unsubscribe = () => {};

  const store = createStore<RecordingViewState>()((set, get) => {
    /** The plan is stored with the flight; a failure is ignored (Swift `try?`): the debrief then matches the track to the network. */
    const saveActiveRouteLegs = async (flightId: string): Promise<void> => {
      try {
        const legs = deps.activeRouteLegs();
        if (legs.length > 0) await deps.saveRouteLegs(legs, flightId);
      } catch {
        // see above
      }
    };

    /** Runs a start or a stop alone: refuses a second while one runs, and always clears the flag. */
    const exclusive = async <T>(kind: 'starting' | 'stopping', busy: T, run: () => Promise<T>): Promise<T> => {
      if (get().busy !== null) return busy;
      set({ busy: kind });
      try {
        return await run();
      } finally {
        set({ busy: null });
      }
    };

    /** The start that is running, so a stop confirmed meanwhile waits for it instead of being dropped. */
    let starting: Promise<unknown> | null = null;

    const startRecording = () => {
      const alone = get().busy === null;
      const run = exclusive<StartOutcome>('starting', 'busy', async () => {
        set({ lastError: null, showDiscardedNotice: false });
        let denied = false;
        try {
          // Ask once (system prompt); afterwards the answer comes from Settings.
          let status = await deps.microphone.status();
          if (status === 'undetermined') status = await deps.microphone.request();
          denied = status !== 'granted'; // an unresolved answer is the microphone being off too
        } catch (error) {
          set({ lastError: { kind: 'audioSessionFailed', cause: error } }); // the recording still starts
        }
        set({ microphoneDenied: denied });
        try {
          const flightId = await deps.coordinator.startRecording();
          set({ activeFlightId: flightId });
          await saveActiveRouteLegs(flightId);
        } catch (error) {
          // Swift recomputes the flag from the live status: a refused start while another recording runs keeps its notice.
          set({
            lastError: { kind: 'recordingFailed', cause: error },
            microphoneDenied: denied && get().status.kind === 'recording',
          });
          return 'problem';
        }
        return get().microphoneDenied || get().lastError !== null ? 'problem' : 'started';
      });
      // Only the call that actually began keeps the slot: a refused second call must not hide the real start.
      if (alone) starting = run.catch(() => undefined).finally(() => (starting = null));
      return run;
    };

    const confirmStop = async (): Promise<void> => {
      set({ showStopConfirmation: false });
      // A stop confirmed while the recording is still starting waits for the start to finish, then stops it.
      if (get().busy === 'starting' && starting !== null) await starting.catch(() => undefined);
      await exclusive<void>('stopping', undefined, async () => {
        let summary;
        try {
          summary = await deps.coordinator.stopRecording();
        } catch (error) {
          set({ lastError: { kind: 'recordingFailed', cause: error } });
          return;
        }
        if (summary !== null) await saveActiveRouteLegs(summary.flightID);
        set({ activeFlightId: null });
        if (summary === null) return;

        let result: FlightPersistenceResult;
        try {
          const { aircraftProfileID, pilotProfileID } = deps.activeProfileIds();
          result = await deps.persistence.persist(summary, aircraftProfileID, pilotProfileID);
        } catch {
          result = 'saveFailed'; // the recording data is untouched, so launch-time recovery rebuilds the flight
        }
        set({ lastPersistenceResult: result, showDiscardedNotice: shouldShowDiscardedNotice(result) });
        // A kept-but-damaged flight and an unsaved one must reach the pilot, not just the log.
        if (result === 'savedTrackUnreadable') set({ lastError: recordingFailure('trackUnreadable') });
        else if (result === 'saveFailed') set({ lastError: recordingFailure('flightNotSaved') });
      });
    };

    return {
      status: source.recordingStatus,
      elapsedTime: source.elapsedTime,
      currentPhase: source.currentPhase,
      audioLevel: source.audioLevel,
      countdownRemaining: source.countdownRemaining,
      activeFlightId: null,
      showStopConfirmation: false,
      lastError: null,
      showDiscardedNotice: false,
      microphoneDenied: false,
      lastPersistenceResult: null,
      busy: null,

      startRecording,

      async press() {
        switch (pressAction(get().status)) {
          case 'start':
            return startRecording();
          case 'requestStop':
            get().requestStop();
            return 'stopRequested';
          case 'cancelCountdown':
            get().cancelCountdown();
            return 'countdownCancelled';
          case 'none':
            return 'ignored';
        }
      },

      requestStop: () => set({ showStopConfirmation: true }),
      cancelStop: () => set({ showStopConfirmation: false }),
      confirmStop,
      cancelCountdown: () => deps.coordinator.cancelCountdown(),
      dismissError: () => set({ lastError: null }),
      dismissDiscardedNotice: () => set({ showDiscardedNotice: false }),

      async refreshMicrophone() {
        const token = ++micToken;
        if (get().status.kind !== 'recording') {
          set({ microphoneDenied: false });
          return;
        }
        try {
          const status = await deps.microphone.status();
          if (token === micToken && get().status.kind === 'recording') set({ microphoneDenied: status !== 'granted' });
        } catch {
          // Keeps what was shown; the next check (coming back from Settings) tries again.
        }
      },

      async openMicrophoneSettings() {
        try {
          await deps.microphone.openSettings();
        } catch {
          // Swift `openURL` does not report a Settings page that cannot be opened either.
        }
      },

      dispose: () => unsubscribe(),
    };
  });

  /** Copies the coordinator's state in. A failure it reports in the middle of a recording is shown once and cleared. */
  const sync = () => {
    const previous = store.getState().status.kind;
    const reported = source.lastError;
    const status = source.recordingStatus;
    if (status.kind !== previous) micToken += 1; // a permission answer still on its way belongs to the earlier state
    store.setState({
      status,
      elapsedTime: source.elapsedTime,
      currentPhase: source.currentPhase,
      audioLevel: source.audioLevel,
      countdownRemaining: source.countdownRemaining,
      ...(reported === null ? null : { lastError: reported }),
      // The microphone notice and the stop question are for a running recording only.
      ...(status.kind === 'recording' ? null : { microphoneDenied: false, showStopConfirmation: false }),
      // The coordinator went idle on its own (a stop from elsewhere): that flight is over.
      ...(status.kind === 'idle' && store.getState().busy !== 'starting' ? { activeFlightId: null } : null),
    });
    if (reported !== null) source.set({ lastError: null });
    // A recording the store did not start (the auto-start countdown ran out): read the permission now.
    if (status.kind === 'recording' && previous !== 'recording' && store.getState().busy !== 'starting') {
      void store.getState().refreshMicrophone();
    }
  };
  unsubscribe = source.subscribe(sync);
  return store;
}
