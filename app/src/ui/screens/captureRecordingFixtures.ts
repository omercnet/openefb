// Deterministic fakes for the fidelity captures of the recording controls (kanaf-dev://recording, recordingstopped,
// recordingstop) and the web preview: a real RecordingCoordinator on the L4 fakes, with a clock that stands still so the
// screenshots do not drift. Real wiring (GPS, audio, the database) is the shell's.
import { FakeMicrophonePermission } from '../../domain/ports/microphonePermission';
import type { FlightPersistenceResult } from '../../domain/recording/flightPersistence';
import { RecordingCoordinator } from '../../domain/recording/recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  FakeTrackRecorder,
  MockAudioRecorder,
  MockTranscriptionService,
} from '../../domain/recording/testSupport';
import { createRecordingStore, type RecordingViewStore } from '../state/recordingStore';

export type RecordingScene = 'recording' | 'stopped' | 'stopDialog';

export interface RecordingLab {
  store: RecordingViewStore;
  coordinator: RecordingCoordinator;
  microphone: FakeMicrophonePermission;
  /** What persisting the next stopped recording answers. */
  persistResult: { current: FlightPersistenceResult };
}

export function captureRecordingLab(): RecordingLab {
  let flights = 0;
  const coordinator = new RecordingCoordinator({
    recordingStore: new FakeRecordingStore(),
    audioRecorder: new MockAudioRecorder(),
    transcriptionService: new MockTranscriptionService(),
    makeTrackRecorder: () => new FakeTrackRecorder(),
    audioFileURL: (id) => `/capture/${id}.m4a`,
    clock: new FakeClock(),
    newId: () => `capture-flight-${++flights}`,
  });
  const microphone = new FakeMicrophonePermission('granted');
  const persistResult = { current: 'saved' as FlightPersistenceResult };
  const store = createRecordingStore({
    coordinator,
    microphone,
    persistence: { persist: () => Promise.resolve(persistResult.current) },
    activeProfileIds: () => ({ aircraftProfileID: null, pilotProfileID: null }),
    activeRouteLegs: () => [],
    saveRouteLegs: () => Promise.resolve(),
  });
  return { store, coordinator, microphone, persistResult };
}

/** The permission as the pilot flips it in the system Settings (the preview's stand-in for leaving the app and coming back). */
export function toggleMicrophone(lab: RecordingLab): void {
  lab.microphone.current = lab.microphone.current === 'denied' ? 'granted' : 'denied';
  void lab.store.getState().refreshMicrophone();
}

/** Whether the next stopped recording has GPS track points (kept) or none (discarded). */
export function setNextStopKeepsFlight(lab: RecordingLab, keeps: boolean): void {
  lab.persistResult.current = keeps ? 'saved' : 'discardedEmpty';
}

/** A failure in the middle of a recording, as the audio recorder reports it. */
export function reportAudioFailure(lab: RecordingLab): void {
  lab.coordinator.state.set({
    lastError: { kind: 'recordingFailed', cause: new Error('The audio file could not be written.') },
  });
}

/** Brings the lab to what a capture shows. */
export async function enterScene(lab: RecordingLab, scene: RecordingScene): Promise<void> {
  const { store, microphone, persistResult } = lab;
  switch (scene) {
    case 'recording':
      // Recording with the microphone off, and the audio failing under it: both amber notices.
      microphone.current = 'denied';
      await store.getState().startRecording();
      reportAudioFailure(lab);
      return;
    case 'stopped':
      // The same recording after the stop: no GPS fix was ever recorded, so the flight was not kept, and the failure
      // (now red, because recording has stopped) is still there.
      persistResult.current = 'discardedEmpty';
      await store.getState().startRecording();
      reportAudioFailure(lab);
      await store.getState().confirmStop();
      return;
    case 'stopDialog':
      await store.getState().startRecording();
      store.getState().requestStop();
      return;
  }
}
