// TimelineScrubBar (efb-212/Views/Flights/TimelineScrubBar.swift): the replay position slider with the flight phase markers as
// ticks at their fractions, and the elapsed and remaining times. Scrubbing moves the map, the audio and the transcript together
// (the engine's position is the one source of truth). React Native has no slider in core, so the track is a pan responder.
import { useMemo, useState } from 'react';
import { PanResponder, Text, View, type LayoutChangeEvent } from 'react-native';
import { useStore } from 'zustand';
import {
  formatReplayTime,
  phaseAbbreviation,
  remainingText,
  scrubRange,
  spokenReplayTime,
} from '../../domain/replay/replayView';
import { FormType } from '../form/formStyle';
import { useTheme } from '../Primitives';
import type { ReplayViewStore } from '../state/replayStore';
import { Radius } from '../tokens';
import { materialFill, overlayText } from './overlay';

const THUMB = 28;
const HIT_HEIGHT = 44;
const TICK_LABEL_WIDTH = 40;
/** VoiceOver and TalkBack adjust a slider by a tenth of its range. */
const ADJUST_STEP = 0.1;

export function TimelineScrubBar({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const position = useStore(store, (s) => s.position);
  const total = useStore(store, (s) => s.totalDuration);
  const markers = useStore(store, (s) => s.phaseMarkers);
  const [width, setWidth] = useState(0);
  const range = scrubRange(total);
  const fraction = Math.min(Math.max(position / range, 0), 1);

  const pan = useMemo(() => {
    const seekAt = (x: number) => width > 0 && store.getState().seekTo(Math.min(Math.max(x / width, 0), 1) * range);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => void seekAt(e.nativeEvent.locationX),
      onPanResponderMove: (e) => void seekAt(e.nativeEvent.locationX),
    });
  }, [store, width, range]);

  const secondary = t.secondaryText;
  const time = { ...FormType.caption, fontVariant: ['tabular-nums' as const], color: secondary };
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: materialFill(t),
        borderRadius: Radius.m,
        gap: 4,
      }}
    >
      <View
        {...pan.panHandlers}
        testID="replay-scrub"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Replay position"
        accessibilityValue={{ text: `${spokenReplayTime(position)} elapsed of ${spokenReplayTime(total)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? ADJUST_STEP : -ADJUST_STEP;
          store.getState().seekTo(position + step * range);
        }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: HIT_HEIGHT, justifyContent: 'center' }}
      >
        <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: t.rule }}>
          <View style={{ width: `${fraction * 100}%`, height: 4, borderRadius: 2, backgroundColor: t.caution }} />
        </View>
        {/* The markers are decorative: the position is exposed through the slider value. */}
        {markers.map((marker, index) => (
          <View
            key={index}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              top: HIT_HEIGHT / 2 - 14,
              left: marker.fraction * width - TICK_LABEL_WIDTH / 2,
              width: TICK_LABEL_WIDTH,
              alignItems: 'center',
              gap: 1,
            }}
          >
            <View style={{ width: 2, height: 12, backgroundColor: t.secondaryText, opacity: 0.6 }} />
            <Text {...overlayText} style={[FormType.caption, { color: secondary }]}>
              {phaseAbbreviation(marker.phase)}
            </Text>
          </View>
        ))}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: fraction * width - THUMB / 2,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: '#FFFFFF',
            borderWidth: 0.5,
            borderColor: 'rgba(0,0,0,0.12)',
            shadowColor: '#000000',
            shadowOpacity: 0.25,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            elevation: 3,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text {...overlayText} style={time}>
          {formatReplayTime(position)}
        </Text>
        <Text {...overlayText} style={time}>
          {remainingText(position, total)}
        </Text>
      </View>
    </View>
  );
}
