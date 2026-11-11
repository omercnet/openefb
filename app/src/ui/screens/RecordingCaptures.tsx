// The recording controls as the fidelity captures and the web preview mount them (routes kanaf-dev://recording,
// recordingstopped, recordingstop; iOS -KanafScreen). A real view model over a coordinator on fakes, no navigation: the shell
// (I1) mounts the notices and the stop dialog under the flight log's record button (U3) over the real recording services.
import { useFonts } from 'expo-font';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import { RecordingNotices } from '../recording/RecordingNotices';
import { StopRecordingDialog } from '../recording/StopRecordingDialog';
import { FontFiles, Space } from '../tokens';
import { StripFrame } from './CaptureScreens';
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

function RecordingLabScreen({ scene }: { scene: RecordingScene }) {
  // The scene is entered while the lab is made (a StrictMode double call builds and drops a whole lab, so it cannot run twice on one).
  const [lab] = useState(() => {
    const made = captureRecordingLab();
    void enterScene(made, scene);
    return made;
  });
  // The notices' captions are in the bundled face, which the strip registers before it shows any text.
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  if (!fontsLoaded && fontError == null) return <StripFrame>{null}</StripFrame>;
  return (
    <StripFrame>
      <RecordingNotices store={lab.store} />
      <StopRecordingDialog store={lab.store} />
      {Platform.OS === 'web' ? <PreviewControls lab={lab} /> : null}
    </StripFrame>
  );
}

/** kanaf-dev://recording: recording with the microphone off and the audio failing (both amber). */
export const RecordingCapture = () => <RecordingLabScreen scene="recording" />;

/** kanaf-dev://recordingstopped: after the stop, a recording that was not saved, and the failure (now red). */
export const RecordingStoppedCapture = () => <RecordingLabScreen scene="stopped" />;

/** kanaf-dev://recordingstop: the "End recording?" confirmation. */
export const RecordingStopCapture = () => <RecordingLabScreen scene="stopDialog" />;
