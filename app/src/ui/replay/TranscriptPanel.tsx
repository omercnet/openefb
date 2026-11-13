// TranscriptPanelView (efb-212/Views/Flights/TranscriptPanelView.swift): the flight's transcript beside the replay map, the
// segment being played highlighted and scrolled to the centre as the position moves.
import { useEffect, useRef } from 'react';
import { ScrollView, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { capitalized, formatReplayTime, transcriptCountText } from '../../domain/replay/replayView';
import { FormType } from '../form/formStyle';
import { useTheme } from '../Primitives';
import type { TranscriptLine } from '../state/replayStore';
import { Radius } from '../tokens';
import { TextBubble } from './icons';

/** Dynamic Type accessibility sizes start at about 1.6x: the timestamp then sits above the text instead of beside it. */
const ACCESSIBILITY_FONT_SCALE = 1.6;

function SegmentRow({
  line,
  active,
  onLayout,
}: {
  line: TranscriptLine;
  active: boolean;
  onLayout: (y: number, height: number) => void;
}) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= ACCESSIBILITY_FONT_SCALE;
  const time = formatReplayTime(line.audioStartTime);
  const phase = capitalized(line.flightPhase);
  return (
    <View
      accessible
      accessibilityLabel={`${time}, ${line.text}, ${phase}`}
      accessibilityState={{ selected: active }}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
      style={{
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'flex-start',
        gap: stacked ? 4 : 8,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: Radius.s,
        backgroundColor: active ? t.infoFill : 'transparent',
      }}
    >
      <Text
        style={[
          FormType.footnote,
          {
            fontVariant: ['tabular-nums'],
            color: t.secondaryText,
            minWidth: 48,
            textAlign: stacked ? 'left' : 'right',
          },
        ]}
      >
        {time}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[
            FormType.caption,
            { fontWeight: active ? '700' : '400', color: active ? t.primaryText : t.secondaryText },
          ]}
        >
          {line.text}
        </Text>
        <Text style={[FormType.caption, { color: t.secondaryText }]}>{phase}</Text>
      </View>
    </View>
  );
}

export function TranscriptPanel({
  segments,
  activeIndex,
}: {
  segments: readonly TranscriptLine[];
  activeIndex: number | null;
}) {
  const t = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const viewport = useRef(0);
  const rows = useRef<{ y: number; height: number }[]>([]);

  const active = useRef(activeIndex);

  // Keeps the active segment in the middle of the panel. It runs when the active segment changes and again when a measurement
  // arrives for it (a panel that mounts with an active segment is laid out after its first effect).
  const centerActive = () => {
    const row = active.current === null ? undefined : rows.current[active.current];
    if (row && viewport.current > 0)
      scroll.current?.scrollTo({ y: Math.max(0, row.y + row.height / 2 - viewport.current / 2), animated: true });
  };
  useEffect(() => {
    active.current = activeIndex;
    centerActive();
  }, [activeIndex]);

  return (
    <View testID="transcript-panel" style={{ flex: 1, backgroundColor: t.paper }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8 }}>
        <TextBubble color={t.secondaryText} size={14} />
        <Text accessibilityRole="header" style={[FormType.caption, { fontWeight: '700', color: t.secondaryText }]}>
          Transcript
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[FormType.caption, { color: t.secondaryText }]}>{transcriptCountText(segments.length)}</Text>
      </View>
      <View style={{ height: 1, backgroundColor: t.rule }} />
      {segments.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
          <TextBubble color={t.rule} size={22} />
          <Text style={[FormType.subheadline, { color: t.secondaryText }]}>No transcript available</Text>
        </View>
      ) : (
        <ScrollView
          ref={scroll}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.height;
            centerActive();
          }}
          contentContainerStyle={{ gap: 2, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          {segments.map((line, index) => (
            <SegmentRow
              key={index}
              line={line}
              active={index === activeIndex}
              onLayout={(y, height) => {
                rows.current[index] = { y, height };
                if (index === active.current) centerActive();
              }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
