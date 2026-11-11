// The controls over the replay map (efb-212/Views/Flights/ReplayView.swift replayControlsOverlay): play and pause, the speed
// picker and the re-centre button at the top left; the GS, ALT and HDG readouts and the transcript toggle at the top right;
// the muted-audio note, the current transcript line while the panel is closed, and the scrub bar at the bottom.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import {
  REPLAY_SPEEDS,
  audioMutedText,
  collapsedTranscriptSegment,
  readouts,
  speedText,
} from '../../domain/replay/replayView';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import type { ReplayViewStore } from '../state/replayStore';
import { Radius } from '../tokens';
import { Checkmark, LocationFill, PauseFill, PlayFill, SidebarTrailing, SpeakerSlashFill, TextBubble } from './icons';
import { materialFill, overlayText } from './overlay';
import { TimelineScrubBar } from './TimelineScrubBar';

const monospaced = { fontVariant: ['tabular-nums' as const] };

function RoundButton({
  label,
  onPress,
  children,
  testID,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  testID: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.accent,
      }}
    >
      {children}
    </Pressy>
  );
}

function SpeedPicker({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const speed = useStore(store, (s) => s.speed);
  return (
    <View
      testID="replay-speed-picker"
      style={{
        position: 'absolute',
        top: 62,
        left: 64,
        minWidth: 120,
        paddingVertical: 8,
        borderRadius: Radius.m,
        backgroundColor: t.activeCell,
        shadowColor: '#000000',
        shadowOpacity: 0.25,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 8,
      }}
    >
      {REPLAY_SPEEDS.map((value) => (
        <Pressy
          key={value}
          accessibilityLabel={`${value} times speed`}
          accessibilityState={{ selected: value === speed }}
          onPress={() => store.getState().selectSpeed(value)}
          testID={`replay-speed-${value}`}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16 }}
        >
          <Text {...overlayText} style={[FormType.body, monospaced, { color: t.primaryText }]}>
            {speedText(value)}
          </Text>
          {value === speed ? <Checkmark color={t.primaryText} /> : null}
        </Pressy>
      ))}
    </View>
  );
}

function PlaybackControls({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const isPlaying = useStore(store, (s) => s.isPlaying);
  const speed = useStore(store, (s) => s.speed);
  const autoFollow = useStore(store, (s) => s.autoFollow);
  const showSpeedPicker = useStore(store, (s) => s.showSpeedPicker);
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 8,
          borderRadius: Radius.l,
          backgroundColor: materialFill(t),
        }}
      >
        <RoundButton
          label={isPlaying ? 'Pause' : 'Play'}
          onPress={() => store.getState().togglePlayPause()}
          testID="replay-play"
        >
          {isPlaying ? <PauseFill color={t.onAccent} /> : <PlayFill color={t.onAccent} />}
        </RoundButton>
        <Pressy
          accessibilityLabel="Playback speed"
          accessibilityValue={{ text: `${Math.trunc(speed)} times` }}
          onPress={() => store.getState().toggleSpeedPicker()}
          testID="replay-speed"
          style={{
            minWidth: 44,
            minHeight: 44,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          <Text {...overlayText} style={[FormType.subheadline, monospaced, { fontWeight: '700', color: '#FFFFFF' }]}>
            {speedText(speed)}
          </Text>
        </Pressy>
        {autoFollow ? null : (
          <RoundButton label="Re-center map" onPress={() => store.getState().recenter()} testID="replay-recenter">
            <LocationFill color={t.onAccent} />
          </RoundButton>
        )}
      </View>
      {showSpeedPicker ? <SpeedPicker store={store} /> : null}
    </View>
  );
}

function Readouts({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const speed = useStore(store, (s) => s.groundSpeed);
  const altitude = useStore(store, (s) => s.altitude);
  const heading = useStore(store, (s) => s.heading);
  const values = readouts({ speed, altitude, heading });
  const cell = (label: string, name: string, value: { text: string; spoken: string }) => (
    <View
      key={label}
      accessible
      accessibilityLabel={name}
      accessibilityValue={{ text: value.spoken }}
      style={{ alignItems: 'center', gap: 2 }}
    >
      <Text {...overlayText} style={[FormType.caption, { color: t.secondaryText }]}>
        {label}
      </Text>
      <Text {...overlayText} style={[FormType.subheadline, monospaced, { fontWeight: '700', color: t.primaryText }]}>
        {value.text}
      </Text>
    </View>
  );
  return (
    <View
      testID="replay-readouts"
      style={{
        flexDirection: 'row',
        gap: 16,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: Radius.s,
        backgroundColor: materialFill(t),
      }}
    >
      {cell('GS', 'Ground speed', values.groundSpeed)}
      {cell('ALT', 'Altitude', values.altitude)}
      {cell('HDG', 'Heading', values.heading)}
    </View>
  );
}

function TranscriptToggle({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const expanded = useStore(store, (s) => s.isTranscriptPanelExpanded);
  return (
    <Pressy
      accessibilityLabel={expanded ? 'Hide transcript' : 'Show transcript'}
      onPress={() => store.getState().toggleTranscriptPanel()}
      testID="replay-transcript-toggle"
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Radius.s,
        backgroundColor: materialFill(t),
      }}
    >
      {expanded ? <SidebarTrailing color={t.primaryText} /> : <TextBubble color={t.primaryText} />}
    </Pressy>
  );
}

export function ReplayControls({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const audioMuted = useStore(store, (s) => s.audioMuted);
  const speed = useStore(store, (s) => s.speed);
  const showSpeedPicker = useStore(store, (s) => s.showSpeedPicker);
  const expanded = useStore(store, (s) => s.isTranscriptPanelExpanded);
  const index = useStore(store, (s) => s.transcriptIndex);
  const segments = useStore(store, (s) => s.segments);
  const card = collapsedTranscriptSegment(expanded, index, segments);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {showSpeedPicker ? (
        // A tap anywhere else closes the picker, as it does for a SwiftUI popover.
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={StyleSheet.absoluteFill}
          onPress={() => store.getState().toggleSpeedPicker()}
        />
      ) : null}
      <View
        pointerEvents="box-none"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingTop: 8,
          paddingHorizontal: 16,
        }}
      >
        <PlaybackControls store={store} />
        <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: 8 }}>
          <Readouts store={store} />
          <TranscriptToggle store={store} />
        </View>
      </View>
      <View pointerEvents="none" style={{ flex: 1 }} />
      {audioMuted ? (
        <View
          testID="replay-audio-muted"
          style={{
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginBottom: 4,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 14,
            backgroundColor: materialFill(t),
          }}
        >
          <SpeakerSlashFill color={t.secondaryText} />
          <Text {...overlayText} style={[FormType.caption, { color: t.secondaryText }]}>
            {audioMutedText(speed)}
          </Text>
        </View>
      ) : null}
      {card ? (
        <View
          testID="replay-transcript-card"
          accessible
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: 16,
            marginBottom: 4,
            padding: 10,
            borderRadius: Radius.m,
            backgroundColor: materialFill(t),
          }}
        >
          <TextBubble color={t.secondaryText} size={14} filled />
          <Text {...overlayText} numberOfLines={2} style={[FormType.caption, { flex: 1, color: t.primaryText }]}>
            {card.text}
          </Text>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TimelineScrubBar store={store} />
      </View>
    </View>
  );
}
