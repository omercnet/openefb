// The compact map layout (efb-212/Views/Map/MapContainerView.swift compactLayout + compactChartArea): iPhone, iPad Split
// View, and any width while the flight log is hidden. Header and warnings on top, the NEXT rail beside the chart while
// the flight log is shown, the NOW cell at full width while the instruments are shown, then the footer. Any other column
// (airport, nearest, layers, search) covers only the area above the NOW cell: the chart stays mounted under it, NOW and
// the footer stay visible.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { FlightLogFooter } from './flightLog/FlightLogFooter';
import { FlightLogHeader } from './flightLog/FlightLogHeader';
import { FlightLogNotices } from './flightLog/FlightLogNotices';
import { FlightLogNowCell } from './flightLog/FlightLogNow';
import { FlightLogRail } from './flightLog/FlightLogStrip';
import { useFlightLog } from './flightLog/hooks';
import { ColumnRule, ThemeContext } from './Primitives';
import { useAppStore } from './state/appStore';
import { panels } from './state/panels';
import { STRIP_COLUMNS, useStripChrome, type StripScreen } from './StripColumn';
import { ThemedStatusBar } from './SystemBars';
import { useKeyboardVisible } from './useKeyboardVisible';

/** Hidden from VoiceOver and TalkBack while an opened column covers it. */
const covered = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

export function CompactMapLayout({
  screen,
  width,
  compact,
  chart,
}: {
  screen?: StripScreen;
  /** Window width (points): the footer runs across it. */
  width: number;
  /** The window is compact (not only the flight log hidden): the record control shows its glyph only. */
  compact: boolean;
  chart: ReactNode;
}) {
  const { theme, ready, top, bottom } = useStripChrome(screen);
  const column = useAppStore((s) => s.stripColumn);
  const showsFlightLog = panels.useData((s) => s.showsFlightLog);
  const { data, showsInstruments } = useFlightLog();
  const keyboardVisible = useKeyboardVisible();
  const Column = STRIP_COLUMNS[column];
  const columnOpen = ready && column !== 'log';
  return (
    <ThemeContext.Provider value={theme}>
      <ThemedStatusBar theme={theme} />
      {/* Like SwiftUI, the layout shrinks above the software keyboard (Search types into it), so the footer stays visible. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: theme.paper }}
        testID="compact-map-layout"
      >
        {/* The header band runs up under the status bar. */}
        <View style={{ height: top, backgroundColor: theme.paperSecondary }} />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }} {...(columnOpen ? covered : null)}>
            {ready ? (
              <>
                {/* With the instruments hidden, Clear moves from the NOW cell to the header. */}
                <FlightLogHeader
                  compact={compact}
                  showsNextTime={!showsFlightLog}
                  onClear={showsInstruments ? undefined : data.actions.clear}
                />
                <ColumnRule />
                <FlightLogNotices />
              </>
            ) : null}
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {ready && showsFlightLog ? (
                <>
                  <FlightLogRail />
                  <View style={{ width: 1, backgroundColor: theme.rule }} />
                </>
              ) : null}
              <View style={{ flex: 1 }}>{chart}</View>
            </View>
          </View>
          {columnOpen ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper }]} testID="compact-column">
              <Column />
            </View>
          ) : null}
        </View>
        {ready && showsInstruments ? (
          <View style={{ backgroundColor: theme.paper }}>
            <ColumnRule />
            <FlightLogNowCell compact />
          </View>
        ) : null}
        {ready ? (
          <FlightLogFooter compact width={width} bottomInset={keyboardVisible ? 0 : bottom} />
        ) : (
          <View style={{ height: keyboardVisible ? 0 : bottom }} />
        )}
      </KeyboardAvoidingView>
    </ThemeContext.Provider>
  );
}
