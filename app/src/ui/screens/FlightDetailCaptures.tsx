// The flight detail, CVFR and AI debrief screens as the fidelity captures and the web preview mount them (routes kanaf-dev://
// flightdetail, cvfr, debrief; iOS -KanafScreen). The real screens over fakes, in the leading strip column where the log stack
// presents them, no navigation (I1). The AI debrief is not shown on Android (owner decision Q8): there the flight detail has no such
// section and the debrief route is not captured. The web preview adds buttons for what a native capture does not show.
import { useFonts } from 'expo-font';
import { useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { sampleCvfrDebrief } from '../../domain/debrief/cvfrFixture';
import type { DebriefAvailability } from '../../domain/ports/debriefEngine';
import { CVFRDebriefContent } from '../flights/CVFRDebriefContent';
import { DebriefScreen } from '../flights/DebriefScreen';
import { FlightDetailScreen } from '../flights/FlightDetailScreen';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import { FontFiles } from '../tokens';
import { StripFrame } from './CaptureScreens';
import {
  CAPTURE_DETAIL_FLIGHT,
  CAPTURE_SHORT_FLIGHT,
  captureDebriefLab,
  captureDetailLab,
  setAvailability,
  type DetailLab,
} from './captureDebriefFixtures';

const noNavigation = {
  onOpenReplay: () => undefined,
  onOpenDebrief: () => undefined,
  onOpenSettings: () => undefined,
};

const AVAILABILITIES: { title: string; availability: DebriefAvailability }[] = [
  { title: 'Model: available', availability: { kind: 'available' } },
  {
    title: 'Model: not enabled',
    availability: { kind: 'unavailable', reason: 'Apple Intelligence is not enabled. Turn it on in Settings.' },
  },
  {
    title: 'Model: not eligible',
    availability: { kind: 'unavailable', reason: 'This device is not eligible for Apple Intelligence.' },
  },
  { title: 'Model: checking', availability: { kind: 'unknown' } },
];

function PreviewButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={title}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: t.infoFill }}
    >
      <Text style={[FormType.subheadline, { color: t.accent }]}>{title}</Text>
    </Pressy>
  );
}

/** Web preview only: what the platform says, the platform itself, a recording, a flight too short for a debrief. */
function DetailPreviewBar({
  lab,
  platform,
  onPlatform,
  short,
  onShort,
}: {
  lab: DetailLab;
  platform: string;
  onPlatform: () => void;
  short: boolean;
  onShort: () => void;
}) {
  const t = useTheme();
  const recording = useStore(lab.recording.store, (s) => s.status.kind !== 'idle');
  const [model, setModel] = useState(0);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, backgroundColor: t.paperSecondary }}>
      <PreviewButton title={`Platform: ${platform}`} onPress={onPlatform} />
      <PreviewButton
        title={AVAILABILITIES[model]!.title}
        onPress={() => {
          const next = (model + 1) % AVAILABILITIES.length;
          setModel(next);
          setAvailability(lab, AVAILABILITIES[next]!.availability);
        }}
      />
      <PreviewButton title={short ? 'Flight: 48 s, no transcript' : 'Flight: 15 min'} onPress={onShort} />
      <PreviewButton
        title={recording ? 'End the recording' : 'Start a recording'}
        onPress={() => {
          const store = lab.recording.store.getState();
          void (recording ? store.confirmStop() : store.startRecording());
        }}
      />
    </View>
  );
}

/** The StripFrame once the bundled faces are registered (the strip does this before it shows any text). */
function WithFonts({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts(FontFiles);
  return <StripFrame>{loaded || error != null ? children : null}</StripFrame>;
}

function FlightDetailLabScreen() {
  const [lab] = useState(() => captureDetailLab());
  const [platform, setPlatform] = useState(Platform.OS);
  const [short, setShort] = useState(false);
  return (
    <WithFonts>
      <FlightDetailScreen
        flight={short ? CAPTURE_SHORT_FLIGHT : CAPTURE_DETAIL_FLIGHT}
        store={lab.store}
        recording={lab.recording.store}
        databaseOpened
        platform={platform}
        navigation={noNavigation}
      />
      {Platform.OS === 'web' ? (
        <DetailPreviewBar
          lab={lab}
          platform={platform}
          onPlatform={() => setPlatform(platform === 'android' ? 'ios' : 'android')}
          short={short}
          onShort={() => setShort(!short)}
        />
      ) : null}
    </WithFonts>
  );
}

/** kanaf-dev://flightdetail: the flight detail of a Haifa to Megiddo flight, with its CVFR debrief and the AI debrief (iOS). */
export const FlightDetailCapture = () => <FlightDetailLabScreen />;

/** kanaf-dev://cvfr: the CVFR section alone, the unrolled flight and its tables. */
export function CvfrCapture() {
  const t = useTheme();
  const [debrief] = useState(() => sampleCvfrDebrief());
  return (
    <WithFonts>
      <ScrollView style={{ flex: 1, backgroundColor: t.paper }} contentContainerStyle={{ padding: 16 }}>
        <CVFRDebriefContent debrief={debrief} />
      </ScrollView>
    </WithFonts>
  );
}

/** kanaf-dev://debrief: the finished AI debrief. Regenerate streams a new one in the web preview. */
export function DebriefCapture() {
  const [lab] = useState(captureDebriefLab);
  if (Platform.OS === 'android') return null; // Q8: no AI debrief on Android, even by a deep link
  return (
    <WithFonts>
      <DebriefScreen store={lab.store} onBack={() => undefined} />
    </WithFonts>
  );
}
