// FlightDetailView (efb-212/Views/Flights/FlightDetailView.swift): a recorded flight: its info, the recording data, the track replay,
// the CVFR debrief (Israel flights; it does not need the AI) and the AI debrief. The AI debrief section is not shown on Android (owner
// decision Q8) nor where the app has no debrief engine. What each section shows is decided in domain/debrief/flightDetail.ts.
// Navigation is the shell's (I1): the screen reports where the user wants to go.
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useStore } from 'zustand';
import type { FlightRecord } from '../../data/models';
import {
  aiDebriefState,
  flightDetailSections,
  flightInfo,
  recordingStats,
  replaySection,
  type AiDebriefState,
} from '../../domain/debrief/flightDetail';
import { Airplane, Chevron, InfoCircle, WarningTriangle } from '../Icons';
import { FormType } from '../form/formStyle';
import { NavBar } from '../form/Form';
import { Pressy, useTheme } from '../Primitives';
import type { FlightDetailStore } from '../state/flightDetailStore';
import type { RecordingViewStore } from '../state/recordingStore';
import { Radius } from '../tokens';
import { withAlpha } from './alpha';
import { CVFRDebriefContent } from './CVFRDebriefContent';
import { Brain, BrainHead, CurvePath, PlayCircle, Sparkles, Waveform } from './icons';

/** Dynamic Type accessibility sizes start at about 1.6x: the route then stacks instead of running across. */
const ACCESSIBILITY_FONT_SCALE = 1.6;

export type FlightDetailFlight = Pick<
  FlightRecord,
  | 'id'
  | 'startDate'
  | 'departureICAO'
  | 'arrivalICAO'
  | 'departureName'
  | 'arrivalName'
  | 'durationSeconds'
  | 'notes'
  | 'trackPointCount'
  | 'transcriptSegmentCount'
  | 'audioQuality'
  | 'hasDebrief'
>;

export interface FlightDetailNavigation {
  onBack?: () => void;
  /** Push the replay of this flight. */
  onOpenReplay: () => void;
  /** Push the AI debrief of this flight. */
  onOpenDebrief: () => void;
  /** The app's page in the system Settings (Apple Intelligence is switched on there). */
  onOpenSettings: () => void;
}

function Heading({ icon, title }: { icon: ReactNode; title: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {icon}
      </View>
      <Text accessibilityRole="header" style={[FormType.headline, { color: t.primaryText }]}>
        {title}
      </Text>
    </View>
  );
}

function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.rule }} />;
}

/** LabeledContent: the label at the leading edge, the value at the trailing edge in the secondary colour. */
function LabeledContent({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
    >
      <Text style={[FormType.body, { color: t.primaryText }]}>{label}</Text>
      <Text style={[FormType.body, { flexShrink: 1, textAlign: 'right', color: t.secondaryText }]}>{value}</Text>
    </View>
  );
}

function Airport({ caption, code, name }: { caption: string; code: string; name: string | null }) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={`${caption}, ${code}${name ? `, ${name}` : ''}`}>
      <Text style={[FormType.caption, { color: t.secondaryText }]}>{caption}</Text>
      <Text style={[FormType.title2, { fontWeight: '700', color: t.primaryText }]}>{code}</Text>
      {name !== null ? <Text style={[FormType.caption, { color: t.secondaryText }]}>{name}</Text> : null}
    </View>
  );
}

function InfoSection({ flight }: { flight: FlightDetailFlight }) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= ACCESSIBILITY_FONT_SCALE;
  const info = flightInfo(flight);
  return (
    <View style={{ gap: 12 }} testID="flight-info">
      <Heading icon={<Airplane color={t.primaryText} />} title="Flight Info" />
      <LabeledContent label="Date" value={info.date} />
      <View
        style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: 8 }}
      >
        <Airport caption="From" code={info.from.code} name={info.from.name} />
        <View accessibilityElementsHidden importantForAccessibility="no" style={{ paddingHorizontal: 8 }}>
          <Chevron color={t.secondaryText} dir={stacked ? 'down' : 'right'} />
        </View>
        <Airport caption="To" code={info.to.code} name={info.to.name} />
      </View>
      <LabeledContent label="Duration" value={info.duration} />
      {info.warning !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <WarningTriangle color={t.caution} bang={t.paper} />
          <Text style={[FormType.subheadline, { flex: 1, color: t.caution }]}>{info.warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

function StatsSection({ flight }: { flight: FlightDetailFlight }) {
  const t = useTheme();
  return (
    <View style={{ gap: 12 }} testID="flight-stats">
      <Heading icon={<Waveform color={t.primaryText} />} title="Recording Data" />
      {recordingStats(flight).map(([label, value]) => (
        <LabeledContent key={label} label={label} value={value} />
      ))}
    </View>
  );
}

/** A tinted button row that goes somewhere: the icon, a bold title, and a chevron. */
function LinkRow({
  icon,
  title,
  tint,
  onPress,
  testID,
}: {
  icon: ReactNode;
  title: string;
  tint: string;
  onPress: () => void;
  testID: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 16,
        borderRadius: Radius.m,
        backgroundColor: tint,
      }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no">
        {icon}
      </View>
      <Text style={[FormType.body, { flex: 1, fontWeight: '700', color: t.primaryText }]}>{title}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no">
        <Chevron color={t.secondaryText} dir="right" />
      </View>
    </Pressy>
  );
}

function ReplaySectionView({
  flight,
  recording,
  onOpenReplay,
}: {
  flight: FlightDetailFlight;
  recording: RecordingViewStore;
  onOpenReplay: () => void;
}) {
  const t = useTheme();
  const status = useStore(recording, (s) => s.status);
  const section = replaySection(status, flight.trackPointCount);
  return (
    <View style={{ gap: 12 }} testID="flight-replay">
      <Heading icon={<PlayCircle color={t.primaryText} />} title="Track Replay" />
      {section.kind === 'available' ? (
        <LinkRow
          icon={<PlayCircle color={t.primaryText} size={22} />}
          title="Replay Flight"
          tint={withAlpha(t.caution, 0.1)}
          onPress={onOpenReplay}
          testID="flight-open-replay"
        />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {section.kind === 'noTrack' ? (
            <CurvePath color={t.secondaryText} size={16} />
          ) : (
            <WarningTriangle color={t.secondaryText} bang={t.paper} />
          )}
          <Text style={[FormType.subheadline, { flex: 1, color: t.secondaryText }]}>{section.text}</Text>
        </View>
      )}
    </View>
  );
}

function Unavailable({
  reason,
  canOpenSettings,
  onOpenSettings,
}: {
  reason: string;
  canOpenSettings: boolean;
  onOpenSettings: () => void;
}) {
  const t = useTheme();
  const centered = { textAlign: 'center' as const, color: t.secondaryText };
  return (
    <View style={{ alignItems: 'center', gap: 12, padding: 16, borderRadius: Radius.m, backgroundColor: t.fill }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Sparkles color={t.secondaryText} size={34} />
      </View>
      <Text style={[FormType.headline, { color: t.primaryText }]}>Debrief needs Apple Intelligence.</Text>
      <Text style={[FormType.subheadline, centered]}>{reason}</Text>
      <Text style={[FormType.subheadline, centered]}>Track, transcript and logbook still work.</Text>
      {canOpenSettings ? (
        <Pressy
          accessibilityLabel="Open Settings"
          onPress={onOpenSettings}
          testID="flight-open-settings"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[FormType.body, { color: t.accent }]}>Open Settings</Text>
        </Pressy>
      ) : null}
    </View>
  );
}

function AiDebriefSection({
  state,
  onOpenDebrief,
  onOpenSettings,
}: {
  state: AiDebriefState;
  onOpenDebrief: () => void;
  onOpenSettings: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 12 }} testID="flight-ai-debrief">
      <Heading icon={<BrainHead color={t.primaryText} />} title="AI Debrief" />
      {state.kind === 'checking' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={t.secondaryText} />
          <Text style={[FormType.subheadline, { color: t.secondaryText }]}>Checking AI availability...</Text>
        </View>
      ) : null}
      {state.kind === 'unavailable' ? (
        <Unavailable reason={state.reason} canOpenSettings={state.canOpenSettings} onOpenSettings={onOpenSettings} />
      ) : null}
      {state.kind === 'ineligible' ? (
        <View testID="debrief-ineligible" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <InfoCircle color={t.secondaryText} />
          <Text style={[FormType.subheadline, { flex: 1, color: t.secondaryText }]}>{state.reason}</Text>
        </View>
      ) : null}
      {state.kind === 'noDatabase' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <WarningTriangle color={t.secondaryText} bang={t.paper} />
          <Text style={[FormType.body, { flex: 1, color: t.secondaryText }]}>
            Recording database could not be opened
          </Text>
        </View>
      ) : null}
      {state.kind === 'open' ? (
        <LinkRow
          icon={
            state.hasDebrief ? <Brain color={t.primaryText} size={22} /> : <Sparkles color={t.primaryText} size={22} />
          }
          title={state.title}
          tint={state.hasDebrief ? t.infoFill : t.fill}
          onPress={onOpenDebrief}
          testID="flight-open-debrief"
        />
      ) : null}
    </View>
  );
}

export interface FlightDetailScreenProps {
  flight: FlightDetailFlight;
  store: FlightDetailStore;
  /** Replay is off while a recording runs. */
  recording: RecordingViewStore;
  /** appState.getOrCreateRecordingDatabase() != nil: the AI debrief reads and saves through it. */
  databaseOpened: boolean;
  navigation: FlightDetailNavigation;
  /** Platform.OS; a prop so the preview can show Android. */
  platform?: string;
}

export function FlightDetailScreen({
  flight,
  store,
  recording,
  databaseOpened,
  navigation,
  platform = Platform.OS,
}: FlightDetailScreenProps) {
  const t = useTheme();
  const cvfr = useStore(store, (s) => s.cvfr);
  const availability = useStore(store, (s) => s.availability);
  const hasEngine = useStore(store, (s) => s.hasEngine);

  // onAppear and .task: ask the model, prewarm it, load the CVFR debrief; onDisappear: free the model.
  useEffect(() => {
    void store.getState().appear();
    return () => store.getState().disappear();
  }, [store]);

  const sections = flightDetailSections({ platform, hasCvfr: cvfr !== null, hasDebriefEngine: hasEngine });
  const ai = aiDebriefState(availability, {
    hasDebrief: flight.hasDebrief,
    durationSeconds: flight.durationSeconds,
    transcriptSegmentCount: flight.transcriptSegmentCount,
    databaseOpened,
  });
  const view: Record<(typeof sections)[number], ReactNode> = {
    info: <InfoSection flight={flight} />,
    stats: <StatsSection flight={flight} />,
    replay: <ReplaySectionView flight={flight} recording={recording} onOpenReplay={navigation.onOpenReplay} />,
    cvfr: cvfr ? <CVFRDebriefContent debrief={cvfr} /> : null,
    aiDebrief: (
      <AiDebriefSection
        state={ai}
        onOpenDebrief={navigation.onOpenDebrief}
        onOpenSettings={navigation.onOpenSettings}
      />
    ),
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }} testID="flight-detail-screen">
      <NavBar title="Flight Details" onBack={navigation.onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        {sections.map((section, index) => (
          <View key={section} style={{ gap: 20 }}>
            {index > 0 ? <Divider /> : null}
            {view[section]}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
