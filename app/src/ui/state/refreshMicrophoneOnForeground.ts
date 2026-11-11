import type { AppStateStatus } from 'react-native';
import type { RecordingViewStore } from './recordingStore';

/** The part of react-native's AppState used here (a fake in the tests). */
export interface AppStateEvents {
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): { remove(): void };
}

/**
 * Reads the microphone permission again whenever the app comes back to the foreground: the pilot may have turned it on in the
 * system Settings, and the "Microphone is off" notice goes by itself. Swift re-read it on every 0.5 s poll. Returns the unsubscribe.
 */
export function refreshMicrophoneOnForeground(store: RecordingViewStore, appState: AppStateEvents): () => void {
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'active') void store.getState().refreshMicrophone();
  });
  return () => subscription.remove();
}
