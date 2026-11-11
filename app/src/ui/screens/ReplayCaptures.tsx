// The replay screen as the fidelity captures and the web preview mount them (routes kanaf-dev://replay and replayfast; iOS
// -KanafScreen): the real screen over a replay engine and a recording store on fakes, no navigation (I1). The web preview adds
// buttons for what a native capture does not show: a recording that starts under the screen, and a track that cannot be read.
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { FormType } from '../form/formStyle';
import { Pressy, ThemeContext, useTheme } from '../Primitives';
import { ReplayScreen } from '../replay/ReplayScreen';
import { Day } from '../tokens';
import {
  CAPTURE_FLIGHT,
  captureReplayLab,
  enterReplayScene,
  setReadError,
  type ReplayLab,
  type ReplayScene,
} from './captureReplayFixtures';

/** Web preview only. */
function PreviewBar({ lab }: { lab: ReplayLab }) {
  const t = useTheme();
  const recording = useStore(lab.recording.store, (s) => s.status.kind !== 'idle');
  const [readError, setReadErrorShown] = useState(false);
  const button = (title: string, onPress: () => void) => (
    <Pressy
      key={title}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: t.infoFill }}
    >
      <Text style={[FormType.subheadline, { color: t.accent }]}>{title}</Text>
    </Pressy>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, backgroundColor: t.paperSecondary }}>
      {button(recording ? 'End the recording' : 'Start a recording', () => {
        const store = lab.recording.store.getState();
        void (recording ? store.confirmStop() : store.startRecording());
      })}
      {button(readError ? 'Track read error: on' : 'Track read error: off', () => {
        setReadError(lab, !readError);
        setReadErrorShown(!readError);
      })}
      {button('Load the flight again', () => void lab.store.getState().loadFlight(CAPTURE_FLIGHT))}
    </View>
  );
}

function ReplayLabScreen({ scene }: { scene: ReplayScene }) {
  const [lab] = useState(captureReplayLab);
  // The screen loads the flight when it mounts; the scene is entered once that has finished.
  useEffect(() => {
    let entered = false;
    const enter = () => {
      if (entered) return true;
      const { isLoading, loadError } = lab.store.getState();
      if (isLoading || loadError !== null) return false;
      entered = true; // set first: entering the scene changes the store, which calls this again
      enterReplayScene(lab, scene);
      return true;
    };
    if (enter()) return;
    const unsubscribe = lab.store.subscribe(() => {
      if (enter()) unsubscribe();
    });
    return unsubscribe;
  }, [lab, scene]);
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={Day}>
        <View style={{ flex: 1 }}>
          <ReplayScreen
            flight={CAPTURE_FLIGHT}
            store={lab.store}
            recording={lab.recording.store}
            onBack={() => undefined}
          />
          {Platform.OS === 'web' ? <PreviewBar lab={lab} /> : null}
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

/** kanaf-dev://replay: the replay paused at the turn at Afula, the transcript panel open. */
export const ReplayCapture = () => <ReplayLabScreen scene="replay" />;

/** kanaf-dev://replayfast: 4x with the audio muted, the panel closed, the map panned away. */
export const ReplayFastCapture = () => <ReplayLabScreen scene="fast" />;
