// ContentView.checkRemoteConfig: at launch, whenever the app becomes active, and when a recording ends (a check skipped
// while recording is retried then). The store itself limits it to once an hour and never fetches while recording.
import type { StoreApi } from 'zustand';
import type { FlightLogData } from '../flightLog/store';

export interface RemoteConfigChecks {
  store: { refreshIfDue(recordingActive: boolean): Promise<void> };
  flightLog: StoreApi<FlightLogData>;
  appActive: { subscribe(listener: (isActive: boolean) => void): () => void };
}

const isRecording = (state: FlightLogData): boolean =>
  state.recording !== null && state.recording.status.kind !== 'idle';

export function startRemoteConfigChecks({ store, flightLog, appActive }: RemoteConfigChecks): () => void {
  const check = () => {
    store.refreshIfDue(isRecording(flightLog.getState())).catch(() => undefined);
  };
  check();
  const stopActive = appActive.subscribe((isActive) => {
    if (isActive) check();
  });
  const stopRecording = flightLog.subscribe((state, previous) => {
    if (isRecording(previous) && !isRecording(state)) check();
  });
  return () => {
    stopActive();
    stopRecording();
  };
}
