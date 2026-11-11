// Strip rows of the log stack (efb-212/Views/Log/LogStackRows.swift and the row builders of LogStackView.swift): section
// headers, the Next, Now, Flown and Totals rows. Amber is caution and always carries a triangle glyph and words.
import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { FlightRecord, LogbookEntry } from '../../data/models';
import { WarningTriangle } from '../Icons';
import { Pressy, SectionLabel, useTheme } from '../Primitives';
import { Space, StripMetrics, Type } from '../tokens';
import { BookClosedGlyph, CheckmarkGlyph, PlusGlyph, SignatureGlyph } from './LogIcons';
import { flightRowTexts, manualEntryRowTexts, type NowTexts, type TotalsTexts } from './logic';

/** Plain-list geometry measured on reference/ipad-log.png (points). */
export const LogMetrics = {
  /** Row insets: leading / trailing content edge and the separator ends. */
  inset: 20,
  /** Vertical padding of a row around its 60 pt (StripMetrics.cell) content. */
  rowPadding: 15,
  /** Section header: space above the label, below it. */
  headerTop: 32,
  headerBottom: 10,
} as const;

/** Uppercase strip label heading a log section, with an optional trailing control (LogSectionHeader). */
export function LogSectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: LogMetrics.headerTop,
        paddingBottom: LogMetrics.headerBottom,
        paddingHorizontal: LogMetrics.inset,
        backgroundColor: t.paper,
      }}
    >
      <SectionLabel title={title} />
      {trailing}
    </View>
  );
}

/**
 * logStripRow(): a strip at least one in-flight tap target tall on the active cell, with a rule hairline below it from
 * `separatorInset` to the trailing inset.
 */
export function LogStripRow({
  children,
  separatorInset = LogMetrics.inset,
  style,
}: {
  children: ReactNode;
  separatorInset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.activeCell,
          paddingHorizontal: LogMetrics.inset,
          paddingVertical: LogMetrics.rowPadding,
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          position: 'absolute',
          left: separatorInset,
          right: LogMetrics.inset,
          bottom: 0,
          height: 1,
          backgroundColor: t.rule,
        }}
      />
    </View>
  );
}

/** frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading): content centred vertically. */
const cellStyle: ViewStyle = { minHeight: StripMetrics.cell, justifyContent: 'center' };
/** HStack(alignment: .firstTextBaseline, spacing: Space.m). */
const baselineRow: ViewStyle = { flexDirection: 'row', alignItems: 'baseline', gap: Space.m };

/** Icon + text, like a SwiftUI Label. */
function GlyphLabel({ glyph, text, color, font }: { glyph: ReactNode; text: string; color: string; font: object }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {glyph}
      <Text style={[font, { color }]}>{text}</Text>
    </View>
  );
}

/** Amber caution marker: triangle glyph plus words (LogCautionMarker). */
export function LogCautionMarker({ text }: { text: string }) {
  const t = useTheme();
  return (
    <GlyphLabel
      glyph={<WarningTriangle color={t.caution} bang={t.activeCell} />}
      text={text}
      color={t.caution}
      font={Type.dataEmphasis}
    />
  );
}

/** Draft waiting for a signature: a neutral to-do, not a caution (LogDraftMarker). */
export function LogDraftMarker() {
  const t = useTheme();
  return (
    <GlyphLabel glyph={<SignatureGlyph color={t.ink} />} text="Draft, sign" color={t.ink} font={Type.dataEmphasis} />
  );
}

/** Signed entry, opened read-only (LogSignedEntryMarker). */
export function LogSignedEntryMarker() {
  const t = useTheme();
  return <GlyphLabel glyph={<BookClosedGlyph color={t.ink} />} text="Logbook" color={t.ink} font={Type.dataEmphasis} />;
}

// MARK: - Next

/** The active plan's route, opening the planner. */
export function ActivePlanRow({ text, spoken, onPress }: { text: string; spoken: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <LogStripRow>
      <Pressy
        onPress={onPress}
        accessibilityLabel={`Active plan, ${spoken}`}
        accessibilityHint="Opens the flight planner"
        testID="log-active-plan"
        style={[cellStyle, { gap: Space.xs }]}
      >
        <SectionLabel title="Active plan" />
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={[Type.rowIdent, { color: t.route }]}>
          {text}
        </Text>
      </Pressy>
    </LogStripRow>
  );
}

/** "+ Plan a flight": the separator starts under the title, past the glyph. */
export function PlanFlightRow({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <LogStripRow separatorInset={60}>
      <Pressy
        onPress={onPress}
        accessibilityLabel="Plan a flight"
        accessibilityHint="Opens the flight planner and saved plans"
        testID="log-plan-flight"
        style={[cellStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' }]}
      >
        <View style={{ marginLeft: -3, marginRight: 13 }}>
          <PlusGlyph color={t.ink} size={30} stroke={3.8} />
        </View>
        <Text style={[Type.rowIdent, { color: t.ink }]}>Plan a flight</Text>
      </Pressy>
    </LogStripRow>
  );
}

// MARK: - Now

/** The flight in progress: route (or "Flight") in the route colour, REC time, next waypoint and ETE. */
export function NowRow({ now, eteStale, onPress }: { now: NowTexts; eteStale: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <LogStripRow>
      <Pressy
        onPress={onPress}
        accessibilityLabel={now.accessibilityLabel}
        accessibilityHint="Returns to the map"
        testID="log-now-row"
        style={[cellStyle, { gap: Space.xs }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={[Type.rowIdent, { color: t.route, flexShrink: 1 }]}
          >
            {now.routeText}
          </Text>
          <View style={{ flex: 1 }} />
          {now.recordingText ? <Text style={[Type.dataEmphasis, { color: t.ink }]}>{now.recordingText}</Text> : null}
        </View>
        {now.nextText ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
            <Text style={[Type.dataEmphasis, { color: t.ink }]}>{now.nextText}</Text>
            <View style={{ flex: 1 }} />
            <Text style={[Type.rowTime, { color: eteStale ? t.inkSecondary : t.ink }]}>{now.eteText}</Text>
          </View>
        ) : null}
      </Pressy>
    </LogStripRow>
  );
}

// MARK: - Flown

/** The "+" in the Flown header: a 60 pt target. */
export function AddEntryButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      accessibilityLabel="Add logbook entry"
      testID="log-add-entry"
      style={{ width: StripMetrics.cell, height: StripMetrics.cell, alignItems: 'center', justifyContent: 'center' }}
    >
      <PlusGlyph color={t.ink} size={14} stroke={1.5} />
    </Pressy>
  );
}

/** Nothing flown or logged yet. */
export function FlownEmptyRow() {
  const t = useTheme();
  return (
    <LogStripRow>
      <View accessible style={[cellStyle, { gap: Space.xs }]} testID="log-flown-empty">
        <Text style={[Type.rowIdent, { color: t.ink }]}>No flights yet</Text>
        <Text style={[Type.data, { color: t.inkSecondary }]}>
          Recordings from the map appear here. Plan a flight above, or add a logbook entry with +.
        </Text>
      </View>
    </LogStripRow>
  );
}

/** Swipe actions on an unsigned entry, offered as an accessibility action ("Delete draft" / "Delete"). */
const deleteActions = (label: string, entry: LogbookEntry | null, onDelete: (id: string) => void) =>
  entry && !entry.isConfirmed
    ? {
        accessibilityActions: [{ name: 'delete', label }],
        onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
          if (e.nativeEvent.actionName === 'delete') onDelete(entry.id);
        },
      }
    : {};

/**
 * A recorded flight (FlownFlightRow): date, route idents, block time, health caution and its logbook entry: a Sign
 * button while the entry is an unsigned draft, a read-only Logbook button once signed.
 */
export function FlownFlightRow({
  flight,
  entry,
  onOpen,
  onOpenEntry,
  onDeleteEntry,
}: {
  flight: FlightRecord;
  entry: LogbookEntry | null;
  onOpen: () => void;
  onOpenEntry: (entryId: string) => void;
  onDeleteEntry: (entryId: string) => void;
}) {
  const t = useTheme();
  const texts = flightRowTexts(flight, entry);
  return (
    <LogStripRow>
      <View style={{ gap: Space.xs }}>
        <Pressy
          onPress={onOpen}
          accessibilityLabel={texts.accessibilityLabel}
          accessibilityHint="Opens flight details, debrief and replay"
          testID="log-flight-row"
          style={cellStyle}
          {...deleteActions('Delete draft', entry, onDeleteEntry)}
        >
          <View style={baselineRow}>
            <View style={{ flexShrink: 1, gap: Space.xs }}>
              <Text style={[Type.data, { color: t.inkSecondary }]}>{texts.dateText}</Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={[Type.rowIdent, { color: t.ink }]}
              >
                {texts.routeText}
              </Text>
              {texts.warning ? <LogCautionMarker text={texts.warning} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: Space.s }} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={[Type.rowTime, { color: t.ink }]}
            >
              {texts.blockTime}
            </Text>
          </View>
        </Pressy>
        {entry && texts.action && texts.actionLabel && texts.actionTestID ? (
          <Pressy
            onPress={() => onOpenEntry(entry.id)}
            accessibilityLabel={texts.actionLabel}
            testID={texts.actionTestID}
            style={[cellStyle, { alignSelf: 'flex-start' }]}
          >
            {texts.action === 'sign' ? <LogDraftMarker /> : <LogSignedEntryMarker />}
          </Pressy>
        ) : null}
      </View>
    </LogStripRow>
  );
}

/** A logbook entry with no recorded flight (FlownEntryRow): manual, or its recording was deleted. */
export function FlownEntryRow({
  entry,
  onOpen,
  onDelete,
}: {
  entry: LogbookEntry;
  onOpen: () => void;
  onDelete: (entryId: string) => void;
}) {
  const t = useTheme();
  const texts = manualEntryRowTexts(entry);
  return (
    <LogStripRow>
      <Pressy
        onPress={onOpen}
        accessibilityLabel={texts.accessibilityLabel}
        accessibilityHint={texts.accessibilityHint}
        testID="log-entry-row"
        style={cellStyle}
        {...deleteActions('Delete', entry, onDelete)}
      >
        <View style={baselineRow}>
          <View style={{ flexShrink: 1, gap: Space.xs }}>
            <Text style={[Type.data, { color: t.inkSecondary }]}>{texts.dateText}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={[Type.rowIdent, { color: t.ink }]}
            >
              {texts.routeText}
            </Text>
            {texts.signed ? (
              <GlyphLabel
                glyph={<CheckmarkGlyph color={t.inkSecondary} />}
                text="Signed"
                color={t.inkSecondary}
                font={Type.data}
              />
            ) : (
              <LogDraftMarker />
            )}
          </View>
          <View style={{ flex: 1, minWidth: Space.s }} />
          <View style={{ alignItems: 'flex-end', gap: Space.xs }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={[Type.rowTime, { color: t.ink }]}
            >
              {texts.duration}
            </Text>
            <Text style={[Type.data, { color: t.inkSecondary }]}>{texts.aircraftText}</Text>
          </View>
        </View>
      </Pressy>
    </LogStripRow>
  );
}

// MARK: - Totals

/**
 * Logbook totals on one line, the draft count pushed to the trailing edge; on a narrow screen the parts wrap (the
 * Swift ViewThatFits falls back to a vertical stack).
 */
export function TotalsRow({ totals }: { totals: TotalsTexts }) {
  const t = useTheme();
  const text = [Type.dataEmphasis, { color: t.ink }];
  return (
    <LogStripRow>
      <View
        accessible
        accessibilityLabel={totals.accessibilityLabel}
        testID="log-totals"
        style={[
          cellStyle,
          {
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            alignContent: 'center',
            justifyContent: 'flex-start',
            columnGap: Space.l,
            rowGap: Space.xs,
          },
        ]}
      >
        <Text style={text}>{totals.flightsText}</Text>
        <Text style={text}>{totals.timeText}</Text>
        {totals.draftsText ? <Text style={[text, { marginLeft: 'auto' }]}>{totals.draftsText}</Text> : null}
      </View>
    </LogStripRow>
  );
}
