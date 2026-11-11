// Coming back from the system Settings (where the pilot turned the microphone on) re-reads the permission, so the "Microphone
// is off" notice goes by itself. Swift re-read it on every 0.5 s poll; the store reads on demand and the app state says when.
import type { AppStateStatus } from 'react-native';
import { FakeMicrophonePermission } from '../../domain/ports/microphonePermission';
import { RecordingCoordinator } from '../../domain/recording/recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  FakeTrackRecorder,
  flush,
  MockAudioRecorder,
  MockTranscriptionService,
} from '../../domain/recording/testSupport';
import { createRecordingStore } from './recordingStore';
import { refreshMicrophoneOnForeground, type AppStateEvents } from './refreshMicrophoneOnForeground';

class FakeAppState implements AppStateEvents {
  handlers = new Set<(state: AppStateStatus) => void>();
  removed = 0;
  addEventListener(_type: 'change', handler: (state: AppStateStatus) => void) {
    this.handlers.add(handler);
    return { remove: () => ((this.removed += 1), this.handlers.delete(handler)) };
  }
  emit(state: AppStateStatus) {
    this.handlers.forEach((handler) => handler(state));
  }
}

async function recordingWithMicrophone(microphone: FakeMicrophonePermission) {
  const coordinator = new RecordingCoordinator({
    recordingStore: new FakeRecordingStore(),
    audioRecorder: new MockAudioRecorder(),
    transcriptionService: new MockTranscriptionService(),
    makeTrackRecorder: () => new FakeTrackRecorder(),
    audioFileURL: (id) => `/rec/${id}.m4a`,
    clock: new FakeClock(),
    newId: () => 'flight-1',
  });
  const store = createRecordingStore({
    coordinator,
    microphone,
    persistence: { persist: async () => 'saved' },
    activeProfileIds: () => ({ aircraftProfileID: null, pilotProfileID: null }),
    activeRouteLegs: () => [],
    saveRouteLegs: async () => undefined,
  });
  await store.getState().startRecording();
  return store;
}

describe('refreshMicrophoneOnForeground', () => {
  it('re-reads the permission when the app comes back to the foreground, so the notice goes', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const store = await recordingWithMicrophone(microphone);
    const appState = new FakeAppState();
    refreshMicrophoneOnForeground(store, appState);
    expect(store.getState().microphoneDenied).toBe(true);

    microphone.current = 'granted'; // turned on in Settings
    appState.emit('active');
    await flush();
    expect(store.getState().microphoneDenied).toBe(false);
  });

  it.each<AppStateStatus>(['background', 'inactive'])('does not read it when the app goes to %s', async (state) => {
    const microphone = new FakeMicrophonePermission('denied');
    const store = await recordingWithMicrophone(microphone);
    const appState = new FakeAppState();
    refreshMicrophoneOnForeground(store, appState);

    microphone.current = 'granted';
    appState.emit(state);
    await flush();
    expect(store.getState().microphoneDenied).toBe(true);
  });

  it('stops listening when removed', async () => {
    const microphone = new FakeMicrophonePermission('denied');
    const store = await recordingWithMicrophone(microphone);
    const appState = new FakeAppState();
    const stop = refreshMicrophoneOnForeground(store, appState);
    stop();
    expect(appState.removed).toBe(1);
    expect(appState.handlers.size).toBe(0);

    microphone.current = 'granted';
    appState.emit('active');
    await flush();
    expect(store.getState().microphoneDenied).toBe(true);
  });
});
