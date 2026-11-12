// The airport column's pieces (efb-212/Views/Log/AirportColumnView.swift, Map/NotamSection.swift not-configured hint,
// Map/AirportChartsSection.swift): title, Direct, info chips, weather, then the sections stacked below it. Each section
// after the weather sits under a rule; `AIRPORT_SECTIONS` is the list the column renders, in J1 relevance order, so
// later tickets (U4b: NOTAM list, PIREPs, winds aloft, diagrams, Israel aerodrome) add entries instead of rewriting this.
// Text the SwiftUI views set in SF uses the `Type.system*` roles.
import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { isLayerAvailable, regionDisplayName, type RegionDataLayer } from '../../../domain/core';
import { DataAgeBadge } from '../../components/Components';
import { flightCategoryColor, flightCategoryLabel } from '../../components/logic';
import { Airplane, ArrowClockwise, ArrowUp, ArrowUpRight, Chevron, FuelPump, Key, WarningTriangle } from '../../Icons';
import { Pressy, SectionLabel, useTheme } from '../../Primitives';
import { Radius, Space, StripMetrics, Type } from '../../tokens';
import {
  NOTAM_KEY_HINT,
  chartId,
  cycleStatus,
  frequencyRows,
  groupedCharts,
  headerAccessibilityLabel,
  infoChips,
  metarFreshness,
  runwayRow,
  stationOnlyCaption,
  tafBlock,
  tafFreshness,
  weatherBody,
  weatherFields,
  type InfoChipIcon,
  type TerminalChart,
} from './logic';
import type { AirportColumnModel } from './store';

/** minWidth of the label column of label/value rows, points. */
const LABEL_COLUMN = 80;

export interface AirportSectionProps {
  model: AirportColumnModel;
}

// MARK: - Header

/** The header title: identifier in chart blue, the flight category beside it when a METAR gives one, then the name. */
export function AirportTitle({ model }: AirportSectionProps) {
  const t = useTheme();
  const name = model.data?.airport?.name ?? model.station?.name ?? null;
  const ident = model.data?.airport?.icao ?? model.station?.id ?? model.icao;
  const category = model.data?.weather.metar?.flightCategory ?? null;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={headerAccessibilityLabel(ident, category, name)}
      testID="airport-title"
      // No `flex: 1`: React Native lays Yoga out with YGErrataAll, under which a flexing block inside ColumnHeader's
      // flex: 1 wrapper is stretched to the header row's 60 pt minimum instead of hugging its content (61.5 pt), so the
      // band ends 1.5 pt short and every row below sits 1.5 pt high (U3.md, run 43102552494).
      style={{ paddingVertical: Space.xs }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
        <Text numberOfLines={1} style={[Type.title, { color: t.airspace, flexShrink: 0 }]}>
          {ident}
        </Text>
        {category ? (
          // Dot out of flow so the container's baseline is the category text's (SwiftUI firstTextBaseline); as a
          // first child the dot's bottom edge became the baseline on iOS. 12 pt dot + Space.xs.
          <View style={{ paddingLeft: 12 + Space.xs, flexShrink: 1 }}>
            <Text numberOfLines={1} style={[Type.systemHeadline, { color: t.primaryText }]}>
              {flightCategoryLabel(category)}
            </Text>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
              <View
                style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: flightCategoryColor(category, t) }}
              />
            </View>
          </View>
        ) : null}
      </View>
      {name ? (
        <Text numberOfLines={2} style={[Type.body, { color: t.inkSecondary, textAlign: 'left' }]}>
          {name}
        </Text>
      ) : null}
    </View>
  );
}

// MARK: - Direct, chips

export function DirectButton({ model }: AirportSectionProps) {
  const t = useTheme();
  const icao = model.data?.airport?.icao;
  if (!icao) return null;
  return (
    <Pressy
      accessibilityLabel={`Direct to ${icao}`}
      testID="airport-direct-to"
      onPress={model.directTo}
      style={{
        minHeight: StripMetrics.cell + 14, // borderedProminent adds 7pt above and below the 60pt label frame (measured 74pt)
        borderRadius: 999,
        backgroundColor: t.accent,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
      }}
    >
      <ArrowUpRight color={t.onAccent} />
      <Text style={[Type.labelBold, { color: t.onAccent }]}>Direct {icao}</Text>
    </Pressy>
  );
}

function ChipIcon({ icon }: { icon: InfoChipIcon }) {
  const t = useTheme();
  switch (icon) {
    case 'elevation':
      return <ArrowUp color={t.ink} size={13} />;
    case 'type':
      return <Airplane color={t.ink} />;
    case 'pattern':
      return <ArrowClockwise color={t.ink} size={12} />;
    case 'fuel':
      return <FuelPump color={t.ink} />;
  }
}

export function InfoChipsRow({ model }: AirportSectionProps) {
  const t = useTheme();
  const airport = model.data?.airport;
  if (!airport) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.s }}>
      {infoChips(airport, model.data?.elevationPublished).map((chip) => (
        <View
          key={chip.icon}
          accessible
          accessibilityLabel={chip.text}
          testID={`airport-chip-${chip.icon}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: Space.xs,
            paddingHorizontal: Space.m,
            paddingVertical: Space.s,
            borderRadius: 999,
            backgroundColor: t.paperSecondary,
          }}
        >
          <ChipIcon icon={chip.icon} />
          <Text style={[Type.data, { color: t.ink }]}>{chip.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// MARK: - Shared rows

/**
 * Label column beside a value, first-baseline aligned. The height is the value's line height (Plex Mono 15: 19.5):
 * iOS baseline alignment otherwise made every row 20 pt, 0.5 pt per row of drift (12 pt down the column, SSIM 0.72;
 * the reference pitch is 27.5 pt = 19.5 + the 8 pt gap).
 */
function Row({
  label,
  spoken,
  value,
  testID,
  children,
}: {
  label: string;
  spoken: string;
  value: string;
  testID?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={spoken}
      accessibilityValue={{ text: value }}
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m, height: Type.data.lineHeight }}
    >
      <Text style={[Type.label, { color: t.inkSecondary, minWidth: LABEL_COLUMN }]}>{label}</Text>
      {children}
    </View>
  );
}

/** SectionHeader (DesignTokens.swift): Archivo SemiBold 12 in the system secondary color. */
function SystemHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[Type.sectionHeader, { color: t.secondaryText }]}>
      {title}
    </Text>
  );
}

/** A caption-size note in the secondary ink ("No runway data available"). */
function Note({ children, testID }: { children: string; testID?: string }) {
  const t = useTheme();
  return (
    <Text testID={testID} style={[Type.caption, { color: t.inkSecondary }]}>
      {children}
    </Text>
  );
}

/** Label with the filled warning triangle, in the caution colour (TAF not loaded, TAF refresh failed). */
function CautionLine({ text, testID }: { text: string; testID?: string }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={text}
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
    >
      <WarningTriangle color={t.caution} bang={t.night ? '#000000' : '#FFFFFF'} />
      <Text style={[Type.caption, { color: t.caution, flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

/** `.bordered` `.controlSize(.large)` Retry button. */
function RetryButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel="Retry"
      testID={testID}
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        minHeight: StripMetrics.cell,
        justifyContent: 'center',
        paddingHorizontal: Space.l,
        borderRadius: Radius.m,
        backgroundColor: t.infoFill,
      }}
    >
      <Text style={[Type.systemSubheadline, { color: t.accent, fontWeight: '600' }]}>Retry</Text>
    </Pressy>
  );
}

/** Raw METAR / TAF text on the active-cell fill. */
function RawReport({ text, testID }: { text: string; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ padding: Space.s, borderRadius: Radius.s, backgroundColor: t.activeCell }}>
      <Text style={[Type.data, { color: t.ink }]}>{text}</Text>
    </View>
  );
}

// MARK: - Weather

/** Amber failure notice with the error and a Retry button (never just an OLD badge). */
function WeatherError({
  title,
  message,
  onRetry,
  testID,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  testID: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ gap: Space.xs }}>
      <View accessible accessibilityLabel={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <WarningTriangle color={t.caution} bang={t.night ? '#000000' : '#FFFFFF'} />
        <Text style={[Type.body, { color: t.caution, fontWeight: '600', flexShrink: 1 }]}>{title}</Text>
      </View>
      <Text style={[Type.caption, { color: t.inkSecondary }]}>{message}</Text>
      <RetryButton onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}

function WeatherHeader({ model }: AirportSectionProps) {
  const t = useTheme();
  const weather = model.data?.weather;
  const freshness = weather ? metarFreshness(weather, model.now) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
      <SectionLabel title="Weather" />
      {freshness ? (
        <View>
          <DataAgeBadge level={freshness.level} text={freshness.text} productName="METAR" />
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressy
        accessibilityLabel="Refresh weather"
        accessibilityState={{ busy: weather?.isLoading === true }}
        testID="airport-refresh-weather"
        onPress={model.refreshWeather}
        style={{ width: StripMetrics.cell, height: StripMetrics.cell, alignItems: 'center', justifyContent: 'center' }}
      >
        {weather?.isLoading ? (
          <ActivityIndicator size="small" color={t.inkSecondary} />
        ) : (
          <ArrowClockwise color={t.inkSecondary} size={16} />
        )}
      </Pressy>
    </View>
  );
}

function RawMetarDisclosure({ model, raw }: AirportSectionProps & { raw: string }) {
  const t = useTheme();
  const expanded = model.rawMetarExpanded;
  return (
    <>
      <Pressy
        accessibilityLabel="Raw METAR"
        accessibilityValue={{ text: expanded ? 'Expanded' : 'Collapsed' }}
        accessibilityState={{ expanded }}
        testID="airport-raw-metar"
        onPress={model.toggleRawMetar}
        style={{
          minHeight: StripMetrics.cell,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={[Type.label, { color: t.inkSecondary }]}>Raw METAR</Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <Chevron dir="down" color={t.inkSecondary} />
        </View>
      </Pressy>
      {expanded ? <RawReport text={raw} testID="airport-raw-metar-text" /> : null}
    </>
  );
}

function TafView({ model }: AirportSectionProps) {
  const weather = model.data?.weather;
  if (!weather) return null;
  const block = tafBlock(weather);
  if (block.kind === 'none') return null;
  if (block.kind === 'notLoaded') {
    // 15 pt row: the caption-size SF triangle's frame (reference: the TAF row is 19.2 pt with its 4 pt top padding).
    return (
      <View style={{ paddingTop: Space.xs, minHeight: Space.xs + 15, justifyContent: 'center' }}>
        <CautionLine text="TAF not loaded" testID="airport-taf-not-loaded" />
      </View>
    );
  }
  const freshness = tafFreshness(weather, model.now);
  return (
    <View style={{ gap: Space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingTop: Space.xs }}>
        <SectionLabel title="TAF" />
        {freshness ? (
          <View testID="taf-age-badge">
            <DataAgeBadge level={freshness.level} text={freshness.text} productName="TAF" />
          </View>
        ) : null}
      </View>
      <RawReport text={block.text} testID="airport-taf-text" />
      {block.refreshFailed ? <CautionLine text="TAF refresh failed. Showing the last forecast." /> : null}
    </View>
  );
}

export function WeatherSection({ model }: AirportSectionProps) {
  const t = useTheme();
  const weather = model.data?.weather;
  const body = weather ? weatherBody(weather) : ({ kind: 'loading' } as const);
  let content: ReactElement;
  switch (body.kind) {
    case 'report':
      content = (
        <View style={{ gap: Space.s }}>
          {body.refreshFailed !== null ? (
            <WeatherError
              title="Weather refresh failed. Showing the last report."
              message={body.refreshFailed}
              onRetry={model.refreshWeather}
              testID="weather-refresh-failed"
            />
          ) : null}
          {weatherFields(weather?.metar ?? null, model.region).map((f) => (
            <Row key={f.label} label={f.label} spoken={f.spoken} value={f.value} testID={`airport-wx-${f.label}`}>
              <Text style={[Type.data, { color: t.ink }]}>{f.value}</Text>
            </Row>
          ))}
          {weather?.metar?.rawMETAR ? <RawMetarDisclosure model={model} raw={weather.metar.rawMETAR} /> : null}
        </View>
      );
      break;
    case 'loading':
      content = (
        <View testID="weather-loading" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
          <ActivityIndicator size="small" color={t.inkSecondary} />
          <Note>Loading weather...</Note>
        </View>
      );
      break;
    case 'error':
      content = (
        <WeatherError
          title="Weather not loaded"
          message={body.message}
          onRetry={model.refreshWeather}
          testID="weather-error"
        />
      );
      break;
    case 'notPublished':
      content = <Note testID="weather-no-metar">{body.text}</Note>;
      break;
    case 'none':
      content = <Note testID="weather-none">No METAR for this airport.</Note>;
      break;
  }
  return (
    <View style={{ gap: Space.s }}>
      <WeatherHeader model={model} />
      {content}
      <TafView model={model} />
    </View>
  );
}

// MARK: - Frequencies, runways

export function FrequenciesSection({ model }: AirportSectionProps) {
  const t = useTheme();
  const airport = model.data?.airport;
  if (!airport) return null;
  const rows = frequencyRows(airport);
  return (
    <View style={{ gap: Space.s }}>
      <SectionLabel title="Frequencies" />
      {rows.length === 0 ? <Note testID="airport-no-frequencies">No frequencies available</Note> : null}
      {rows.map((r) => (
        <Row key={r.key} label={r.label} spoken={r.spoken} value={r.accessibilityValue} testID="airport-frequency">
          <Text style={[Type.dataEmphasis, { color: t.ink }]}>{r.mhz}</Text>
        </Row>
      ))}
    </View>
  );
}

export function RunwaysSection({ model }: AirportSectionProps) {
  const t = useTheme();
  const airport = model.data?.airport;
  if (!airport) return null;
  return (
    <View style={{ gap: Space.s }}>
      <SectionLabel title="Runways" />
      {airport.runways.length === 0 ? <Note testID="airport-no-runways">No runway data available</Note> : null}
      {airport.runways.map((runway, i) => {
        const r = runwayRow(runway, i);
        return (
          <View
            key={r.key}
            accessible
            accessibilityLabel={r.accessibilityLabel}
            accessibilityValue={{ text: r.accessibilityValue }}
            testID="airport-runway"
            // Baseline-aligned row clamped to the Plex line like Row (iOS made it 20 pt, SwiftUI 19.5 pt). One
            // line: the surface word shrinks and truncates before anything overflows the column.
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m, height: Type.data.lineHeight }}
          >
            <Text style={[Type.dataEmphasis, { color: t.ink, minWidth: LABEL_COLUMN }]}>{r.ident}</Text>
            <Text numberOfLines={1} style={[Type.data, { color: t.ink, flexShrink: 0 }]}>
              {r.dimensions}
            </Text>
            <Text numberOfLines={1} style={[Type.body, { color: t.inkSecondary, flexShrink: 1 }]}>
              {r.surface}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// MARK: - NOTAM hint, charts

/** NotamSection while no FAA API key is set (the only NOTAM state this column renders itself; the list is U4b's). */
export function NotamKeySection() {
  const t = useTheme();
  return (
    <View style={{ gap: Space.s }}>
      <SystemHeader title="NOTAMS" />
      <View
        accessible
        accessibilityLabel={NOTAM_KEY_HINT}
        testID="airport-notam-key-hint"
        style={{ flexDirection: 'row', gap: 6 }}
      >
        <View style={{ width: 16, alignItems: 'center', paddingTop: 1 }}>
          <Key color={t.secondaryText} />
        </View>
        <Text style={[Type.systemSubheadline, { color: t.secondaryText, flex: 1, lineHeight: 20 }]}>
          {NOTAM_KEY_HINT}
        </Text>
      </View>
    </View>
  );
}

function ChartGroupView({
  title,
  charts,
  onOpen,
}: {
  title: string;
  charts: readonly TerminalChart[];
  onOpen: (chart: TerminalChart) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: Space.xs }}>
      <Text style={[Type.label, { color: t.secondaryText }]}>{title}</Text>
      {charts.map((chart) => (
        <Pressy
          key={chartId(chart)}
          accessibilityLabel={chart.name}
          testID="airport-chart"
          onPress={() => onOpen(chart)}
          style={{
            minHeight: 44,
            marginVertical: Space.xs,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: Space.s,
          }}
        >
          <Text style={[Type.systemSubheadline, { color: t.primaryText, flex: 1 }]}>{chart.name}</Text>
          <Chevron dir="right" color={t.secondaryText} />
        </Pressy>
      ))}
    </View>
  );
}

export function ChartsSection({ model }: AirportSectionProps) {
  const t = useTheme();
  const charts = model.data?.charts;
  if (!charts) return null;
  const subheadline = [Type.systemSubheadline, { color: t.secondaryText }];
  let content: ReactNode;
  if (charts.state === 'loading') {
    content = (
      <View testID="airport-charts-loading" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
        <ActivityIndicator size="small" color={t.secondaryText} />
        <Text style={subheadline}>Loading charts...</Text>
      </View>
    );
  } else if (charts.state === 'failed') {
    content = (
      <View testID="airport-charts-failed" style={{ gap: 6 }}>
        <Text style={subheadline}>{charts.message}</Text>
        <RetryButton onPress={model.retryCharts} testID="airport-charts-retry" />
      </View>
    );
  } else if (charts.charts.length === 0) {
    content = (
      <Text testID="airport-charts-empty" style={subheadline}>
        No FAA charts for this airport.
      </Text>
    );
  } else {
    const status = cycleStatus(charts.cycle, model.now);
    content = (
      <>
        {status.expired ? (
          <View
            accessible
            accessibilityLabel={status.text}
            testID="airport-charts-expired"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <WarningTriangle color={t.warning} bang={t.night ? '#000000' : '#FFFFFF'} />
            <Text style={[Type.caption, { color: t.warning, flexShrink: 1 }]}>{status.text}</Text>
          </View>
        ) : (
          <Text testID="airport-charts-cycle" style={[Type.caption, { color: t.secondaryText }]}>
            {status.text}
          </Text>
        )}
        {groupedCharts(charts.charts).map((g) => (
          <ChartGroupView key={g.category} title={g.title} charts={g.charts} onOpen={model.openChart} />
        ))}
      </>
    );
  }
  return (
    <View style={{ gap: Space.s }}>
      <SystemHeader title="FAA CHARTS" />
      {content}
    </View>
  );
}

// MARK: - Composition

/** One section below the weather; the column draws a rule above each shown section. */
export interface AirportSection {
  id: string;
  /** Region data layer the section needs (Region.isAvailable); omitted: always available. */
  layer?: RegionDataLayer;
  /** Extra condition on the column data (e.g. the NOTAM hint only while no key is set). */
  isShown?: (model: AirportColumnModel) => boolean;
  Component: (props: AirportSectionProps) => ReactElement | null;
}

/**
 * The sections under the weather, in order (AirportColumnView.body). U4b replaces the NOTAM hint entry with the full
 * NotamSection, swaps runways for IsraelAerodromeSection when an aerodrome is loaded, and appends diagrams, PIREPs and
 * winds aloft.
 */
export const AIRPORT_SECTIONS: readonly AirportSection[] = [
  { id: 'frequencies', Component: FrequenciesSection },
  { id: 'runways', Component: RunwaysSection },
  { id: 'notams', layer: 'notams', isShown: (m) => m.data?.notamKeyConfigured === false, Component: NotamKeySection },
  { id: 'charts', layer: 'airportCharts', Component: ChartsSection },
];

/** The sections shown for this model, in order. */
export const shownSections = (model: AirportColumnModel, sections: readonly AirportSection[] = AIRPORT_SECTIONS) =>
  sections.filter(
    (s) => (s.layer === undefined || isLayerAvailable(model.region, s.layer)) && (s.isShown?.(model) ?? true),
  );

/** Station-only body: a region without airport data still shows the station's weather. */
export function StationOnlyNote({ model }: AirportSectionProps) {
  return <Note testID="airport-station-only">{stationOnlyCaption(regionDisplayName(model.region))}</Note>;
}
