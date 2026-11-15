// Port of efb-212/Views/Map/WindsAloftSection.swift: FD winds and temperatures aloft from the nearest forecast station,
// with a 6/12/24-hour forecast picker. Decisions live in ./windsAloftLogic.ts.
//
// Props (the Swift view's `@State forecast`, `@State state: LoadState` and its `load()` task, lifted so the airport
// column store feeds it):
// - `airport`           the selected airport (ICAO and position; the service picks the station nearest to it).
// - `forecast`          the selected period (6, 12 or 24 h). Swift defaults to 6 h: DEFAULT_FORECAST.
// - `onSelectForecast`  the segmented picker changed period; the owner stores it and loads that period.
// - `loading`           a fetch is in flight. Swift sets `.loading` on every load, so the spinner replaces the report.
// - `error`             the last fetch's message (`error.localizedDescription`), or null. Shown with Retry.
// - `report`            the last loaded report for `forecast` (WindsAloftService.fetchWindsAloft), or null.
// - `now`               epoch ms the FOR USE window is judged at (badge and the "Outside ..." notice; Swift: `Date()`).
// - `onRetry`           `load()` for the current airport and period (the failure's Retry button).
// - `onLoad`            optional `.task(id: "\(icao)-\(forecast)")`: called on mount and whenever the ICAO or the period
//                       changes, so the owner fetches.
import { useEffect } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import type { WindsAloftForecast, WindsAloftReport } from '../../../../services/windsAloft';
import { DataAgeBadge } from '../../../components/Components';
import { useTheme } from '../../../Primitives';
import { Space, Type } from '../../../tokens';
import { SegmentRow } from '../../layers/controls';
import { CautionLabel, FailureBlock, LoadingRow, SystemHeader } from './parts';
import type { SectionAirport } from './pirepLogic';
import {
  FORECAST_OPTIONS,
  FORECAST_PICKER_LABEL,
  GRID_HEADINGS,
  GRID_HEADING_SPOKEN,
  OUTSIDE_FOR_USE_TEXT,
  WINDS_SECTION_TITLE,
  blankLevelNote,
  gridRows,
  periodText,
  showsOutsideForUse,
  stationLine,
  stationSpoken,
  windsBody,
  windsFreshness,
  windsTaskKey,
} from './windsAloftLogic';

export interface WindsAloftSectionProps {
  airport: SectionAirport;
  forecast: WindsAloftForecast;
  onSelectForecast: (forecast: WindsAloftForecast) => void;
  loading: boolean;
  error: string | null;
  report: WindsAloftReport | null;
  now: number;
  onRetry: () => void;
  onLoad?: (airport: SectionAirport, forecast: WindsAloftForecast) => void;
}

/** Width of the DIR, SPD and TEMP columns (Swift's Grid sizes them to "TEMP (°C)"), and the Grid's 16 pt spacing. */
const VALUE_COLUMN = 64;
const COLUMN_GAP = 16;
const subheadlineDigits: TextStyle = { ...Type.systemSubheadline, fontVariant: ['tabular-nums'] };

export function WindsAloftSection(props: WindsAloftSectionProps) {
  const { airport, forecast, onSelectForecast, loading, error, report, now, onRetry, onLoad } = props;
  const key = windsTaskKey(airport.icao, forecast);

  // `.task(id: "\(airport.icao)-\(forecast.rawValue)") { await load() }`
  useEffect(() => {
    onLoad?.(airport, forecast);
    // Keyed like the Swift task id: only a new ICAO or period reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const body = windsBody({ loading, error, report });
  return (
    <View testID="winds-section" style={{ gap: Space.s }}>
      <SystemHeader title={WINDS_SECTION_TITLE} />
      <SegmentRow
        options={FORECAST_OPTIONS.map((o) => String(o.forecast))}
        selected={String(forecast)}
        title={(o) => FORECAST_OPTIONS.find((f) => String(f.forecast) === o)?.label ?? o}
        onSelect={(o) => onSelectForecast(Number(o) as WindsAloftForecast)}
        label={FORECAST_PICKER_LABEL}
        testID="winds-forecast-picker"
      />
      {body.kind === 'loading' ? <LoadingRow testID="winds-loading" label="Loading winds aloft" /> : null}
      {body.kind === 'error' ? <FailureBlock text={body.text} onRetry={onRetry} testID="winds-error" /> : null}
      {body.kind === 'report' ? <ReportView report={body.report} now={now} /> : null}
    </View>
  );
}

function ReportView({ report, now }: { report: WindsAloftReport; now: number }) {
  const t = useTheme();
  const freshness = windsFreshness(report, now);
  const note = blankLevelNote(report);
  const caption = [Type.caption, { color: t.secondaryText }];
  return (
    <View testID="winds-report" style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
        <Text
          accessibilityLabel={stationSpoken(report)}
          testID="winds-station"
          style={[Type.systemSubheadline, { color: t.primaryText, fontWeight: '600', flexShrink: 1 }]}
        >
          {stationLine(report)}
        </Text>
        <View style={{ flex: 1 }} />
        {/* Forecast products are judged by their FOR USE window, not by time since issue. */}
        <DataAgeBadge level={freshness.level} text={freshness.text} productName="Winds aloft" />
      </View>

      <Text testID="winds-period" style={caption}>
        {periodText(report)}
      </Text>

      {showsOutsideForUse(report, now) ? (
        <CautionLabel text={OUTSIDE_FOR_USE_TEXT} size="caption" testID="winds-outside-for-use" />
      ) : null}

      <View testID="winds-grid" style={{ gap: Space.xs }}>
        <View
          accessible
          accessibilityLabel={GRID_HEADING_SPOKEN}
          testID="winds-grid-heading"
          style={{ flexDirection: 'row', alignItems: 'baseline', gap: COLUMN_GAP }}
        >
          {GRID_HEADINGS.map((h, i) => (
            <Text
              key={h}
              style={[
                Type.caption,
                { color: t.secondaryText, fontWeight: '600' },
                i === 0 ? { flex: 1 } : { width: VALUE_COLUMN, textAlign: 'right' },
              ]}
            >
              {h}
            </Text>
          ))}
        </View>
        {gridRows(report).map((row) => {
          const cell = [subheadlineDigits, { color: row.tone === 'primary' ? t.primaryText : t.secondaryText }];
          const value = (width: number, text: string) => (
            <Text style={[cell, { width, textAlign: 'right' as const }]}>{text}</Text>
          );
          return (
            // VoiceOver reads the whole level from the first cell; the other cells are hidden.
            <View
              key={row.altitude}
              accessible
              accessibilityLabel={row.spokenLabel}
              accessibilityValue={{ text: row.spokenValue }}
              testID="winds-level"
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: COLUMN_GAP }}
            >
              <Text style={[cell, { flex: 1 }]}>{row.altitudeText}</Text>
              {row.lightAndVariable !== null ? (
                value(VALUE_COLUMN * 2 + COLUMN_GAP, row.lightAndVariable)
              ) : (
                <>
                  {value(VALUE_COLUMN, row.direction)}
                  {value(VALUE_COLUMN, row.speed)}
                </>
              )}
              {value(VALUE_COLUMN, row.temperature)}
            </View>
          );
        })}
      </View>

      {note !== null ? (
        <Text testID="winds-blank-note" style={caption}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}
