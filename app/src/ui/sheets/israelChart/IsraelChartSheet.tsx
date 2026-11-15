// Israel CVFR chart tap sheet (IL-3), port of Views/Map/IsraelChartSheets.swift: a reporting point (code, names, kind,
// and every route segment that starts or ends there, one row per direction with its published altitude, route type and
// any drawn closure) or the airspaces under the finger (title, names, type, ceiling, floor, authority, chart text, and
// the inferred-reference warning). The content of the sheet only: the caller presents it (Swift: MapContainerView's
// `.sheet(item:)` over `mapService.israelChart.selection`, medium and large detents) and clears the selection on close.
//
// Props:
// - `selection`: the tapped chart feature exactly as the domain builds it (`IsraelChartSelection` from
//   domain/map/israel/chartDetails: `israelSelectionFromFeature` for a point symbol, `israelAirspaceSelection` for the
//   fill features under the tap). `{ kind: 'point', detail }` shows the reporting point; `{ kind: 'airspaces', details }`
//   shows each airspace, already ordered P/R/D first, separated by dividers. `{ kind: 'aerodrome' }` is never presented
//   (the map opens the airport sheet instead) and renders an empty body, as Swift's `EmptyView()`.
// - `onClose`: the Done button (Swift `dismiss()`); the caller sets the selection to null.
// No units or clock props: every value arrives as published text (feet as CAAI publishes them, closure times already
// formatted by domain/map/israel/closures), and the Swift sheets format nothing themselves.
import { Fragment } from 'react';
import { ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import type {
  IsraelAirspaceDetail,
  IsraelChartSelection,
  IsraelPointDetail,
  IsraelRouteAltitudeRow,
} from '../../../domain/map/israel';
import { OctagonWarning, WarningTriangle } from '../../Icons';
import { Pressy, useTheme } from '../../Primitives';
import { Space, Type, lineHeight, type Theme } from '../../tokens';
import {
  DONE_TITLE,
  NO_SEGMENTS_TEXT,
  ROUTE_SEGMENTS_HEADER,
  SHEET_TEST_ID,
  airspaceAccessibilityLabel,
  airspaceGridRows,
  airspaceSubtitle,
  closureLines,
  rowAccessibilityLabel,
  segmentTitle,
  sheetContent,
  showsDividerAfter,
} from './logic';

export interface IsraelChartSheetProps {
  /** The tapped reporting point or airspaces (see the header comment). */
  selection: IsraelChartSelection;
  /** Done: dismiss the sheet. */
  onClose: () => void;
}

/** SF text roles the SwiftUI sheet uses (SF line height 1.193 em). */
const sf = (fontSize: number, extra?: TextStyle): TextStyle => ({
  fontSize,
  lineHeight: lineHeight(fontSize, 1.193),
  ...extra,
});
const SF = {
  largeTitleBold: sf(34, { fontWeight: '700' }),
  title2Bold: sf(22, { fontWeight: '700' }),
  title3: sf(20),
  body: sf(17),
  bodySemibold: sf(17, { fontWeight: '600' }),
  subheadline: sf(15),
};
/** `.monospaced()`: the app's monospace face (IBM Plex Mono; SemiBold stands in for bold). */
const mono = (fontSize: number): TextStyle => ({
  fontFamily: 'Kanaf-IBMPlexMono-SemiBold',
  fontSize,
  lineHeight: lineHeight(fontSize, 1.3),
});
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
/** TypeRole.caption.weight(.semibold). */
const captionSemibold: TextStyle = { ...Type.caption, fontFamily: 'Kanaf-ArchivoRoman-SemiBold' };
/** Hebrew names are laid out right to left (Swift `.environment(\.layoutDirection, .rightToLeft)`). */
const rtl: TextStyle = { writingDirection: 'rtl' };

/** Sheet background (systemBackground, elevated at night) and Divider (separator). */
const sheetColors = (t: Theme) =>
  t.night
    ? { background: '#1C1C1E', separator: 'rgba(84,84,88,0.6)' }
    : { background: '#FFFFFF', separator: 'rgba(60,60,67,0.29)' };

export function IsraelChartSheet({ selection, onClose }: IsraelChartSheetProps) {
  const t = useTheme();
  const colors = sheetColors(t);
  const content = sheetContent(selection);
  return (
    <View testID={SHEET_TEST_ID} style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: Space.s,
          paddingTop: Space.s,
        }}
      >
        <Pressy
          testID="israel-chart-done"
          accessibilityLabel={DONE_TITLE}
          onPress={onClose}
          style={{
            minWidth: 44,
            minHeight: 44,
            paddingHorizontal: Space.s,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={[SF.bodySemibold, { color: t.accentText }]}>{DONE_TITLE}</Text>
        </Pressy>
      </View>
      <ScrollView contentContainerStyle={{ padding: Space.l, gap: Space.l }}>
        {content?.kind === 'point' ? <PointDetail detail={content.detail} /> : null}
        {content?.kind === 'airspaces'
          ? content.details.map((detail, index) => (
              <Fragment key={detail.id}>
                <AirspaceDetail detail={detail} />
                {showsDividerAfter(content.details, index) ? (
                  <View
                    testID="israel-chart-divider"
                    style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }}
                  />
                ) : null}
              </Fragment>
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function PointDetail({ detail }: { detail: IsraelPointDetail }) {
  const t = useTheme();
  return (
    <View testID="israel-chart-point" style={{ gap: Space.m }}>
      <View style={{ gap: Space.xs }}>
        <Text testID="israel-chart-point-code" style={[mono(34), { color: t.primaryText }]}>
          {detail.code}
        </Text>
        {detail.nameEnglish !== null ? (
          <Text testID="israel-chart-point-name" style={[SF.title3, { color: t.primaryText }]}>
            {detail.nameEnglish}
          </Text>
        ) : null}
        {detail.nameHebrew !== null ? (
          <Text testID="israel-chart-point-hebrew" style={[SF.title3, rtl, { color: t.secondaryText }]}>
            {detail.nameHebrew}
          </Text>
        ) : null}
        <Text style={[Type.caption, { color: t.secondaryText }]}>{detail.kindText}</Text>
      </View>
      {detail.rows.length === 0 ? (
        <Text testID="israel-chart-no-segments" style={[SF.subheadline, { color: t.secondaryText }]}>
          {NO_SEGMENTS_TEXT}
        </Text>
      ) : (
        <>
          <Text accessibilityRole="header" style={[Type.sectionHeader, { color: t.secondaryText }]}>
            {ROUTE_SEGMENTS_HEADER}
          </Text>
          <View style={{ gap: Space.s }}>
            {detail.rows.map((row) => (
              <SegmentRow key={`${row.segmentID}-${row.from}-${row.to}`} row={row} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function SegmentRow({ row }: { row: IsraelRouteAltitudeRow }) {
  const t = useTheme();
  const closure = closureLines(row);
  const bang = t.night ? '#000000' : '#FFFFFF';
  return (
    <View
      testID="israel-chart-segment"
      accessible
      accessibilityLabel={rowAccessibilityLabel(row)}
      style={{ gap: 2, minHeight: 44, justifyContent: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
        <Text style={[mono(17), { flex: 1, color: t.primaryText }]}>{segmentTitle(row)}</Text>
        <Text style={[SF.bodySemibold, tabular, { color: t.primaryText }]}>{row.altitude}</Text>
      </View>
      <Text style={[Type.caption, { color: t.secondaryText }]}>{row.routeType}</Text>
      {closure !== null ? (
        <>
          <View
            testID={closure.full ? 'israel-chart-closure-full' : 'israel-chart-closure-partial'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}
          >
            {closure.full ? (
              <OctagonWarning color={t.warning} bang={bang} size={14} />
            ) : (
              <WarningTriangle color={t.caution} bang={bang} />
            )}
            <Text style={[captionSemibold, { flexShrink: 1, color: closure.full ? t.warning : t.caution }]}>
              {closure.text}
            </Text>
          </View>
          {closure.notes.map((note) => (
            <Text key={note} style={[Type.caption, { color: t.secondaryText }]}>
              {note}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

function AirspaceDetail({ detail }: { detail: IsraelAirspaceDetail }) {
  const t = useTheme();
  const subtitle = airspaceSubtitle(detail);
  const bang = t.night ? '#000000' : '#FFFFFF';
  return (
    <View
      testID="israel-chart-airspace"
      accessible
      accessibilityLabel={airspaceAccessibilityLabel(detail)}
      style={{ gap: Space.s }}
    >
      <Text style={[SF.title2Bold, { color: t.primaryText }]}>{detail.title}</Text>
      {subtitle !== null ? (
        <Text testID="israel-chart-airspace-name" style={[SF.body, { color: t.primaryText }]}>
          {subtitle}
        </Text>
      ) : null}
      {detail.nameHebrew !== null ? (
        <Text testID="israel-chart-airspace-hebrew" style={[SF.body, rtl, { color: t.secondaryText }]}>
          {detail.nameHebrew}
        </Text>
      ) : null}
      <Text style={[SF.subheadline, { color: t.secondaryText }]}>{detail.typeText}</Text>
      {/* Grid: the label column sizes to its widest label, values align after it (horizontalSpacing .l). */}
      <View style={{ flexDirection: 'row', gap: Space.l }}>
        <View style={{ gap: Space.xs }}>
          {airspaceGridRows(detail).map((row) => (
            <Text key={row.key} style={[SF.body, { color: t.secondaryText }]}>
              {row.label}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, gap: Space.xs }}>
          {airspaceGridRows(detail).map((row) => (
            <Text
              key={row.key}
              testID={`israel-chart-airspace-${row.key}`}
              style={[
                row.emphasis ? SF.bodySemibold : SF.body,
                row.key === 'rawText' ? tabular : null,
                { color: t.primaryText },
              ]}
            >
              {row.value}
            </Text>
          ))}
        </View>
      </View>
      {detail.referenceNote !== null ? (
        <View
          testID="israel-chart-reference-note"
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs, paddingTop: Space.xs }}
        >
          <WarningTriangle color={t.caution} bang={bang} />
          <Text style={[Type.caption, { flex: 1, color: t.caution }]}>{detail.referenceNote}</Text>
        </View>
      ) : null}
    </View>
  );
}
