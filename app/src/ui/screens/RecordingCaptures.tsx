// The recording controls as the fidelity captures and the web preview mount them (routes kanaf-dev://recording,
// recordingstopped, recordingstop; iOS -KanafScreen). A real view model over a coordinator on fakes, no navigation: the shell
// (I1) mounts the notices in the strip (FlightLogNotices) and the stop dialog over the real recording services; here the lab store is provided.
import { useLayoutEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { dayFixture } from '../flightLog/fixtures';
import { flightLog } from '../flightLog/store';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import { StopRecordingDialog } from '../recording/StopRecordingDialog';
import { RecordingStoreContext } from '../recording/RecordingStoreContext';
import { Space } from '../tokens';
import { MapScreen } from './MapScreen';
import {
  captureRecordingLab,
  enterScene,
  reportAudioFailure,
  setNextStopKeepsFlight,
  toggleMicrophone,
  type RecordingLab,
  type RecordingScene,
} from './captureRecordingFixtures';

/** Web preview only: buttons that drive the view model the way the record button and the services do. */
function PreviewControls({ lab }: { lab: RecordingLab }) {
  const t = useTheme();
  const recording = useStore(lab.store, (s) => s.status.kind === 'recording');
  const [keepsFlight, setKeepsFlight] = useState(true);
  const control = (title: string, onPress: () => void) => (
    <Pressy
      key={title}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.m, backgroundColor: t.infoFill }}
    >
      <Text style={[FormType.body, { color: t.accent }]}>{title}</Text>
    </Pressy>
  );
  return (
    <View style={{ padding: Space.m, gap: Space.s }}>
      <Text style={[FormType.footnote, { color: t.secondaryText }]}>Preview controls (web only)</Text>
      {control(recording ? 'Press the record button (stop)' : 'Press the record button (start)', () => {
        setNextStopKeepsFlight(lab, keepsFlight);
        void lab.store.getState().press();
      })}
      {control(keepsFlight ? 'Next stop: has GPS track' : 'Next stop: no GPS track', () =>
        setKeepsFlight(!keepsFlight),
      )}
      {control('Audio fails mid-recording', () => reportAudioFailure(lab))}
      {control('Microphone off / on in Settings', () => toggleMicrophone(lab))}
    </View>
  );
}

/** What the record button shows per scene (the references': 6 s into the recording, 3 s into the stop dialog). */
const ELAPSED: Record<RecordingScene, number> = { recording: 6, stopped: 0, stopDialog: 3 };

/** The flight log slice with the record button following the lab's view model, as I1's shell feeds it from the real one. */
function useLabFlightLog(lab: RecordingLab, scene: RecordingScene) {
  const [flightLogStore] = useState(() => flightLog.make(dayFixture));
  const status = useStore(lab.store, (s) => s.status);
  const audioLevel = useStore(lab.store, (s) => s.audioLevel);
  const microphoneDenied = useStore(lab.store, (s) => s.microphoneDenied);
  useLayoutEffect(() => {
    flightLogStore.setState({
      recording: { status, elapsedSeconds: ELAPSED[scene], levelDBFS: audioLevel, microphoneDenied },
      actions: { ...dayFixture.actions, record: () => void lab.store.getState().press() },
    });
  }, [flightLogStore, lab, scene, status, audioLevel, microphoneDenied]);
  return flightLogStore;
}

/**
 * The map screen the references show: the strip with the notices under its header (FlightLogNotices stacks them from the
 * recording store) beside the chart, and the "End recording?" dialog over it.
 */
function RecordingLabScreen({ scene }: { scene: RecordingScene }) {
  // The scene is entered while the lab is made (a StrictMode double call builds and drops a whole lab, so it cannot run twice on one).
  const [lab] = useState(() => {
    const made = captureRecordingLab();
    void enterScene(made, scene);
    return made;
  });
  const flightLogStore = useLabFlightLog(lab, scene);
  return (
    <RecordingStoreContext.Provider value={lab.store}>
      <flightLog.Provider store={flightLogStore}>
        <MapScreen screen="map" />
        <StopRecordingDialog store={lab.store} />
        {Platform.OS === 'web' ? (
          <View style={{ position: 'absolute', right: 0, bottom: 0, width: 400 }}>
            <PreviewControls lab={lab} />
          </View>
        ) : null}
      </flightLog.Provider>
    </RecordingStoreContext.Provider>
  );
}

/** kanaf-dev://recording: recording with the microphone off and the audio failing (both amber). */
export const RecordingCapture = () => <RecordingLabScreen scene="recording" />;

/** kanaf-dev://recordingstopped: after the stop, a recording that was not saved, and the failure (now red). */
export const RecordingStoppedCapture = () => <RecordingLabScreen scene="stopped" />;

/** kanaf-dev://recordingstop: the "End recording?" confirmation. */
export const RecordingStopCapture = () => <RecordingLabScreen scene="stopDialog" />;
