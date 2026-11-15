// The text decisions of the Israel CVFR chart tap sheet (Views/Map/IsraelChartSheets.swift). The values themselves
// (altitudes "2500/3500 ft", limits "3000 ft MSL", kind and type text, closures) are built in the domain by
// domain/map/israel/chartDetails.ts (Services/IsraelChartDetails.swift) and arrive in the selection as published text;
// this file holds only what the SwiftUI views add on top: fixed strings, which optional lines show, the grid rows, the
// closure styling and what VoiceOver reads for a combined element. No units or clock: Swift formats nothing here.
import type {
  IsraelAirspaceDetail,
  IsraelChartSelection,
  IsraelPointDetail,
  IsraelRouteAltitudeRow,
} from '../../../domain/map/israel';

/** The accessibilityIdentifier of the Swift sheet; the root testID here. */
export const SHEET_TEST_ID = 'israel-chart-sheet';
export const DONE_TITLE = 'Done';
/** SectionHeader above the point's rows. */
export const ROUTE_SEGMENTS_HEADER = 'ROUTE SEGMENTS (ALTITUDE FT MSL, PUBLISHED)';
/** Shown instead of the rows when no segment starts or ends at the point. */
export const NO_SEGMENTS_TEXT = 'No CVFR route segment ends here.';
/** Grid labels of the airspace detail, in Swift's order. */
export const AIRSPACE_LABELS = {
  ceiling: 'Ceiling',
  floor: 'Floor',
  authority: 'Authority',
  rawText: 'Chart text',
} as const;

/**
 * What the sheet body shows. An aerodrome selection is never presented as a chart sheet (the map opens the airport sheet
 * instead), so it maps to `null`: Swift's `EmptyView()`.
 */
export type IsraelChartSheetContent =
  { kind: 'point'; detail: IsraelPointDetail } | { kind: 'airspaces'; details: IsraelAirspaceDetail[] };

export function sheetContent(selection: IsraelChartSelection): IsraelChartSheetContent | null {
  switch (selection.kind) {
    case 'point':
      return { kind: 'point', detail: selection.detail };
    case 'airspaces':
      return { kind: 'airspaces', details: selection.details };
    case 'aerodrome':
      return null;
  }
}

/** "GALIM → DAROM": the direction of one row (U+2192, as Swift). */
export const segmentTitle = (row: IsraelRouteAltitudeRow): string => `${row.from} \u2192 ${row.to}`;

/**
 * Red octagon (full closure) or amber triangle (partial, check NOTAM). Swift tests `!= .partial && != .check`, so a row
 * with closure text but no severity counts as full.
 */
export const closureIsFull = (row: IsraelRouteAltitudeRow): boolean =>
  row.closureSeverity !== 'partial' && row.closureSeverity !== 'check';

/** The closure line and its notes, or null when no drawn closure covers the segment. */
export function closureLines(row: IsraelRouteAltitudeRow): { text: string; full: boolean; notes: string[] } | null {
  if (row.closure === null) return null;
  return { text: row.closure, full: closureIsFull(row), notes: row.closureNotes };
}

/** A row is one combined accessibility element: direction, altitude, route type, then the closure and its notes. */
export function rowAccessibilityLabel(row: IsraelRouteAltitudeRow): string {
  const closure = closureLines(row);
  return [segmentTitle(row), row.altitude, row.routeType, ...(closure ? [closure.text, ...closure.notes] : [])].join(
    ', ',
  );
}

/** The English name line under the airspace title, unless it repeats the title (P, R and D areas without a code). */
export const airspaceSubtitle = (detail: IsraelAirspaceDetail): string | null =>
  detail.nameEnglish !== null && detail.nameEnglish !== detail.title ? detail.nameEnglish : null;

export interface AirspaceGridRow {
  key: keyof typeof AIRSPACE_LABELS;
  label: string;
  value: string;
  /** Ceiling and floor are semibold; authority and chart text are regular. */
  emphasis: boolean;
}

/** Ceiling, Floor, then Authority and Chart text when the layer has them. */
export function airspaceGridRows(detail: IsraelAirspaceDetail): AirspaceGridRow[] {
  const rows: AirspaceGridRow[] = [
    { key: 'ceiling', label: AIRSPACE_LABELS.ceiling, value: detail.ceiling, emphasis: true },
    { key: 'floor', label: AIRSPACE_LABELS.floor, value: detail.floor, emphasis: true },
  ];
  if (detail.authority !== null) {
    rows.push({ key: 'authority', label: AIRSPACE_LABELS.authority, value: detail.authority, emphasis: false });
  }
  if (detail.rawText !== null) {
    rows.push({ key: 'rawText', label: AIRSPACE_LABELS.rawText, value: detail.rawText, emphasis: false });
  }
  return rows;
}

/** Each airspace is one combined accessibility element: every line it shows, in order. */
export function airspaceAccessibilityLabel(detail: IsraelAirspaceDetail): string {
  const subtitle = airspaceSubtitle(detail);
  return [
    detail.title,
    ...(subtitle === null ? [] : [subtitle]),
    ...(detail.nameHebrew === null ? [] : [detail.nameHebrew]),
    detail.typeText,
    ...airspaceGridRows(detail).flatMap((row) => [row.label, row.value]),
    ...(detail.referenceNote === null ? [] : [detail.referenceNote]),
  ].join(', ');
}

/** Overlapping airspaces are separated by a divider; none after the last one (Swift compares ids with the last). */
export const showsDividerAfter = (details: readonly IsraelAirspaceDetail[], index: number): boolean =>
  details[index] !== undefined && details[index].id !== details[details.length - 1]?.id;
