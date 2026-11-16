// Connects the recording services to the strip (Swift: MapContainerView copies RecordingViewModel into AppState and the
// strip's record control calls it; startAutoStartMonitoring runs once the services exist).
import type { StoreApi } from 'zustand';
import type { Haptics } from '../../adapters/haptics';
import type { FlightLogData } from '../flightLog/store';
import { refreshMicrophoneOnForeground, type AppStateEvents } from '../state/refreshMicrophoneOnForeground';
import type { RecordingRuntime } from './recordingRuntime';

const silent = { warning: () => undefined, success: () => undefined };

/** AppState.autoStartSpeedThresholdKts and isAutoStartEnabled defaults. */
export const AUTO_START_SPEED_KTS = 15;

export function bindRecording(
  runtime: Pick<RecordingRuntime, 'store' | 'coordinator'>,
  flightLog: StoreApi<FlightLogData>,
  appState: AppStateEvents,
  haptics: Pick<Haptics, 'warning' | 'success'> = silent,
): () => void {
  const { store, coordinator } = runtime;
  const project = () => {
    const s = store.getState();
    flightLog.setState({
      recordingUnavailable: false,
      recording: {
        status: s.status,
        elapsedSeconds: s.elapsedTime,
        levelDBFS: s.audioLevel,
        microphoneDenied: s.microphoneDenied,
      },
    });
  };
  project();
  flightLog.setState({
    actions: {
      ...flightLog.getState().actions,
      // Swift RecordButton: a start with the microphone off or an error warns, a clean start confirms.
      record: () =>
        void store
          .getState()
          .press()
          .then((outcome) => {
            if (outcome === 'problem') haptics.warning();
            else if (outcome === 'started') haptics.success();
          }),
    },
  });
  const stopFollowing = store.subscribe(project);
  const stopMicrophone = refreshMicrophoneOnForeground(store, appState);
  coordinator.startAutoStartMonitoring({
    groundSpeedKts: () => flightLog.getState().groundSpeed,
    autoStartSpeedThresholdKts: () => AUTO_START_SPEED_KTS,
    isAutoStartEnabled: () => true,
  });
  return () => {
    coordinator.stopAutoStartMonitoring();
    stopMicrophone();
    stopFollowing();
  };
}

/** The recording database could not be opened: the strip says so and hides the record control (Swift recordingUnavailable). */
export function markRecordingUnavailable(flightLog: StoreApi<FlightLogData>): void {
  flightLog.setState({ recording: null, recordingUnavailable: true });
}
