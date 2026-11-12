// FlightLogStrip (efb-212/Views/Log/FlightLogStrip.swift): the in-flight log beside the chart. Header, warnings and
// cautions, NEXT, NOW (pinned), FLOWN. The warnings and NEXT take their natural height and scroll only when the column
// is too short; FLOWN scrolls in whatever space is left. With the instruments hidden NOW is omitted and Clear moves to
// the header. iPhone and iPad Split View: the NEXT rows fold into the 104pt rail (FlightLogRail) and the NOW cell moves
// under the chart at full width (src/ui/CompactMapLayout.tsx). No animation on value changes (pilot SA).
import { useState, type ReactNode } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { ColumnRule, useTheme } from '../Primitives';
import { StripMetrics } from '../tokens';
import { FlightLogFlown } from './FlightLogFlown';
import { FlightLogHeader } from './FlightLogHeader';
import { FlightLogNext } from './FlightLogNext';
import { FlightLogNotices } from './FlightLogNotices';
import { FlightLogNow } from './FlightLogNow';
import { useFlightLog } from './hooks';

export function FlightLogStrip() {
  const t = useTheme();
  const { data, showsInstruments } = useFlightLog();
  return (
    <View accessibilityLabel="Flight log" style={{ flex: 1, backgroundColor: t.paper }}>
      <FlightLogHeader onClear={showsInstruments ? undefined : data.actions.clear} />
      <ColumnRule />
      <FitsOrScrolls>
        <FlightLogNotices />
        <FlightLogNext />
      </FitsOrScrolls>
      {showsInstruments ? (
        <View style={{ flexShrink: 0 }}>
          <FlightLogNow />
        </View>
      ) : null}
      {/* flexBasis 0: after NOW's fixed height, the region above gets the space before FLOWN (layoutPriority 1). */}
      <ScrollView style={{ flex: 1 }} testID="flight-log-flown">
        <FlightLogFlown />
      </ScrollView>
    </View>
  );
}

/** iPhone and iPad Split View: the NEXT rows in a 104pt rail beside the chart (Swift FlightLogRail). */
export function FlightLogRail() {
  const t = useTheme();
  return (
    <ScrollView
      accessibilityLabel="Flight log"
      testID="flight-log-rail"
      style={{ width: StripMetrics.railWidth, flexGrow: 0, backgroundColor: t.paper }}
    >
      <FlightLogNext compact />
    </ScrollView>
  );
}

/**
 * ViewThatFits(in: .vertical) { content; ScrollView { content } }: natural height while it fits, a scroll view once
 * the content is taller than the space it gets. (A scroll view throughout would also do, but on web it re-rasterises
 * the text it holds.)
 */
function FitsOrScrolls({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const onBox = (e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.height);
  const inner = (
    <View onLayout={(e) => setContent(e.nativeEvent.layout.height)} testID="flight-log-above-now-content">
      {children}
    </View>
  );
  const style = { flexGrow: 0, flexShrink: 1 };
  // An unmeasured box (0) is ignored: the content's layout event can arrive first.
  return box > 0 && content > box + 0.5 ? (
    <ScrollView style={style} onLayout={onBox} testID="flight-log-above-now">
      {inner}
    </ScrollView>
  ) : (
    <View style={style} onLayout={onBox} testID="flight-log-above-now">
      {inner}
    </View>
  );
}
