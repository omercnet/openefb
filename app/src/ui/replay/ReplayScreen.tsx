// ReplayView (efb-212/Views/Flights/ReplayView.swift): the full-screen track replay. The map with its controls over it on the
// left, the transcript panel on the right (300 pt, closable), the scrub bar at the bottom; or, instead, a note that a recording is
// running, the loading state, or the error with Retry. Navigation is the shell's (I1): it presents this and handles Back.
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { replayPane, replayTitle } from '../../domain/replay/replayView';
import { BorderedButton } from '../components/BorderedButton';
import { NavBar } from '../form/Form';
import { FormType } from '../form/formStyle';
import { WarningTriangle } from '../Icons';
import { useTheme } from '../Primitives';
import type { RecordingViewStore } from '../state/recordingStore';
import type { ReplayFlight, ReplayViewStore } from '../state/replayStore';
import { RecordCircle } from './icons';
import { ReplayControls } from './ReplayControls';
import { ReplayMap } from './ReplayMap';
import { TranscriptPanel } from './TranscriptPanel';

/** The transcript panel's width. */
const PANEL_WIDTH = 300;

export interface ReplayScreenProps {
  flight: ReplayFlight & { departureICAO: string | null; arrivalICAO: string | null };
  store: ReplayViewStore;
  /** Replay waits for a running recording to end. */
  recording: RecordingViewStore;
  onBack?: () => void;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>{children}</View>
  );
}

function RecordingActive() {
  const t = useTheme();
  return (
    <Notice>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <RecordCircle color={t.warning} />
      </View>
      <Text style={[FormType.headline, { color: t.primaryText, textAlign: 'center' }]}>End the recording first</Text>
      <Text style={[FormType.subheadline, { color: t.secondaryText, textAlign: 'center' }]}>
        A recording is running. End it from the Map tab, then replay.
      </Text>
    </Notice>
  );
}

function Loading() {
  const t = useTheme();
  return (
    <Notice>
      <ActivityIndicator size="large" color={t.secondaryText} />
      <Text style={[FormType.subheadline, { color: t.secondaryText }]}>Loading flight data...</Text>
    </Notice>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTheme();
  return (
    <Notice>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WarningTriangle color={t.caution} bang={t.paper} />
      </View>
      <Text style={[FormType.headline, { color: t.primaryText }]}>Flight not loaded</Text>
      <Text style={[FormType.subheadline, { color: t.secondaryText, textAlign: 'center' }]}>{message}</Text>
      <BorderedButton title="Retry" onPress={onRetry} testID="replay-retry" />
    </Notice>
  );
}

export function ReplayScreen({ flight, store, recording, onBack }: ReplayScreenProps) {
  const t = useTheme();
  const status = useStore(recording, (s) => s.status);
  const isLoading = useStore(store, (s) => s.isLoading);
  const loadError = useStore(store, (s) => s.loadError);
  const expanded = useStore(store, (s) => s.isTranscriptPanelExpanded);
  const segments = useStore(store, (s) => s.segments);
  const transcriptIndex = useStore(store, (s) => s.transcriptIndex);

  // onAppear loads the flight when no recording is running (and does not try again when one ends: Swift's quirk, kept);
  // onDisappear stops the timer and the audio.
  useEffect(() => {
    if (recording.getState().status.kind === 'idle') void store.getState().loadFlight(flight);
    return () => store.getState().cleanup();
  }, [store, recording, flight]);

  const pane = replayPane(status, isLoading, loadError);
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }} testID="replay-screen">
      <NavBar title={replayTitle(flight.departureICAO, flight.arrivalICAO)} onBack={onBack} />
      {pane === 'recordingActive' ? <RecordingActive /> : null}
      {pane === 'loading' ? <Loading /> : null}
      {pane === 'error' ? (
        <LoadError message={loadError ?? ''} onRetry={() => void store.getState().loadFlight(flight)} />
      ) : null}
      {pane === 'content' ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* The controls are scoped to the map, so they never sit over the transcript panel. */}
          <View style={{ flex: 1 }}>
            <ReplayMap store={store} />
            <ReplayControls store={store} />
          </View>
          {expanded ? (
            <View style={{ width: PANEL_WIDTH }}>
              <TranscriptPanel segments={segments} activeIndex={transcriptIndex} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
