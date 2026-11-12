// The pure decisions of AirportColumnView.swift (frequency labels, spoken names and order, info chips, runway rows, the
// weather section's state), WeatherViewModel's decoded weather fields and AirportChartsSection's grouping and cycle line.
// Region, freshness, METAR visibility and TAF validity come from domain/core; nothing here reads the clock.
import {
  evaluateFreshness,
  formatVisibility,
  formattedAltimeter,
  tafValidUntil,
  visibilityMetres,
  type Airport,
  type DataFreshness,
  type FrequencyType,
  type Region,
  type Runway,
  type WeatherCache,
} from '../../../domain/core';

/** What a decoded weather field shows when the report lacks it. */
export const MISSING = '---';

// MARK: - Frequencies

const FREQUENCY_LABELS: Record<FrequencyType, string> = {
  ctaf: 'CTAF',
  tower: 'TWR',
  ground: 'GND',
  clearance: 'CD',
  approach: 'APP',
  departure: 'DEP',
  atis: 'ATIS',
  awos: 'AWOS',
  asos: 'ASOS',
  unicom: 'UNICOM',
  multicom: 'MULTICOM',
  center: 'CTR',
  fss: 'FSS',
  other: 'FREQ',
};

const FREQUENCY_SPOKEN: Record<FrequencyType, string> = {
  ctaf: 'C TAF',
  tower: 'Tower',
  ground: 'Ground',
  clearance: 'Clearance delivery',
  approach: 'Approach',
  departure: 'Departure',
  atis: 'ATIS',
  awos: 'AWOS',
  asos: 'ASOS',
  unicom: 'Unicom',
  multicom: 'Multicom',
  center: 'Center',
  fss: 'Flight service',
  other: 'Frequency',
};

/** Arrival-to-departure order: weather first, then the local frequency, then the ATC sequence. */
const FREQUENCY_RANK: Record<FrequencyType, number> = {
  atis: 0,
  awos: 0,
  asos: 0,
  ctaf: 1,
  unicom: 1,
  multicom: 1,
  approach: 2,
  tower: 3,
  ground: 4,
  clearance: 5,
  departure: 6,
  center: 7,
  fss: 8,
  other: 9,
};

/** Standard aviation abbreviations (AirportColumnView.frequencyLabel); a fixed label column never hyphenates them. */
export const frequencyLabel = (type: FrequencyType): string => FREQUENCY_LABELS[type];
/** Spoken names so VoiceOver does not read "TWR" / "CD" as letters (AirportColumnView.frequencySpokenName). */
export const frequencySpokenName = (type: FrequencyType): string => FREQUENCY_SPOKEN[type];
export const frequencyRank = (type: FrequencyType): number => FREQUENCY_RANK[type];

/** MHz with three decimals: "118.025". */
export const formatMhz = (mhz: number): string => mhz.toFixed(3);

/** One row of the Frequencies section. */
export interface FrequencyRow {
  key: string;
  label: string;
  spoken: string;
  /** "125.900" */
  mhz: string;
  /** "125.900 megahertz" */
  accessibilityValue: string;
}

const frequencyRow = (key: string, type: FrequencyType, mhz: number): FrequencyRow => {
  const text = formatMhz(mhz);
  return {
    key,
    label: frequencyLabel(type),
    spoken: frequencySpokenName(type),
    mhz: text,
    accessibilityValue: `${text} megahertz`,
  };
};

/**
 * The Frequencies rows: the airport's frequency list by rank (stable within a rank, like Swift's sort), else its CTAF and
 * UNICOM fields; empty when it has none of them ("No frequencies available").
 */
export function frequencyRows(airport: Airport): FrequencyRow[] {
  if (airport.frequencies.length === 0) {
    const rows: FrequencyRow[] = [];
    if (airport.ctafFrequency != null) rows.push(frequencyRow('ctaf', 'ctaf', airport.ctafFrequency));
    if (airport.unicomFrequency != null) rows.push(frequencyRow('unicom', 'unicom', airport.unicomFrequency));
    return rows;
  }
  return airport.frequencies
    .map((f, index) => ({ f, index }))
    .sort((a, b) => frequencyRank(a.f.type) - frequencyRank(b.f.type) || a.index - b.index)
    .map(({ f, index }) => frequencyRow(`${f.id}-${index}`, f.type, f.frequency));
}

// MARK: - Info chips and runways

/** Swift `String.capitalized`: the first letter of every word upper case, the rest lower case. */
export const capitalized = (raw: string): string =>
  raw.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** Grouped integer as a SwiftUI `Text` interpolation renders it in en-US: 2621 -> "2,621". */
export const groupedInt = (n: number): string => Math.trunc(n).toLocaleString('en-US');

export type InfoChipIcon = 'elevation' | 'type' | 'pattern' | 'fuel';
export interface InfoChip {
  icon: InfoChipIcon;
  text: string;
}

/**
 * The info chips row: elevation (or "ELEV not published" for an Israeli aerodrome without one), type, pattern altitude
 * when known, fuel when sold. Plain String interpolation in Swift, so no digit grouping ("5000' MSL").
 */
export function infoChips(airport: Airport, elevationPublished = true): InfoChip[] {
  const chips: InfoChip[] = [
    { icon: 'elevation', text: elevationPublished ? `${Math.trunc(airport.elevation)}' MSL` : 'ELEV not published' },
    { icon: 'type', text: capitalized(airport.type) },
  ];
  if (airport.patternAltitude != null) chips.push({ icon: 'pattern', text: `TPA ${airport.patternAltitude}'` });
  if (airport.fuelTypes.length > 0) chips.push({ icon: 'fuel', text: airport.fuelTypes.join(', ') });
  return chips;
}

/** One runway row: "12/30", "2,621' x 75'", "Asphalt", and its VoiceOver label and value. */
export interface RunwayRow {
  key: string;
  ident: string;
  dimensions: string;
  surface: string;
  accessibilityLabel: string;
  accessibilityValue: string;
}

export function runwayRow(runway: Runway, index = 0): RunwayRow {
  const surface = capitalized(runway.surface);
  const length = groupedInt(runway.length);
  const width = groupedInt(runway.width);
  return {
    key: `${runway.id}-${index}`,
    ident: runway.id,
    dimensions: `${length}' x ${width}'`,
    surface,
    accessibilityLabel: `Runway ${runway.id}`,
    accessibilityValue: `${length} by ${width} feet, ${surface}`,
  };
}

// MARK: - Decoded weather (WeatherViewModel.decoded*)

const pad = (n: number, width: number): string => {
  const s = String(Math.abs(Math.trunc(n))).padStart(width, '0');
  return n < 0 ? `-${s}` : s;
};

/** "310/08 KT", "310/08 G15 KT", "VRB/02 KT" (no direction for variable wind) or "Calm". */
export function decodedWind(wx: WeatherCache | null): string {
  if (!wx || wx.windSpeed == null) return MISSING;
  if (wx.windSpeed === 0) return 'Calm';
  const direction = wx.windDirection != null ? pad(wx.windDirection, 3) : 'VRB';
  if (wx.windGust != null) return `${direction}/${pad(wx.windSpeed, 2)} G${Math.trunc(wx.windGust)} KT`;
  return `${direction}/${pad(wx.windSpeed, 2)} KT`;
}

/** "2500' BKN" or "CLR". */
export function decodedCeiling(wx: WeatherCache | null): string {
  if (!wx) return MISSING;
  return wx.ceiling != null ? `${wx.ceiling}' BKN` : 'CLR';
}

/** US: "9.0 SM", ">10 SM". Israel: metres from the raw METAR ("4000 m", "\u226510 km"); the AWC value caps at "6+". */
export function decodedVisibility(wx: WeatherCache | null, region: Region): string {
  if (!wx) return MISSING;
  if (region === 'israel') {
    const metres = visibilityMetres(wx.rawMETAR);
    return metres === null ? MISSING : formatVisibility(metres);
  }
  const vis = wx.visibility;
  if (vis == null) return MISSING;
  if (vis.includes('+') || vis === '10') return '>10 SM';
  return `${vis} SM`;
}

/** Whole degrees Celsius, truncated like Swift `Int(_)`: "15\u00B0C". */
const celsius = (value: number | null | undefined): string =>
  value == null ? MISSING : `${Math.trunc(value) || 0}\u00B0C`;
export const decodedTemp = (wx: WeatherCache | null): string => celsius(wx?.temperature);
export const decodedDew = (wx: WeatherCache | null): string => celsius(wx?.dewpoint);

/** The altimeter in the region's unit: "30.18 inHg" or "1017 hPa". */
export function decodedAltimeter(wx: WeatherCache | null, region: Region): string {
  const hPa = wx?.altimeterHPa;
  return hPa == null ? MISSING : formattedAltimeter(region, hPa);
}

/** A label/value row of the weather section. */
export interface WeatherField {
  label: string;
  spoken: string;
  value: string;
}

export function weatherFields(wx: WeatherCache | null, region: Region): WeatherField[] {
  return [
    { label: 'Wind', spoken: 'Wind', value: decodedWind(wx) },
    { label: 'Vis', spoken: 'Visibility', value: decodedVisibility(wx, region) },
    { label: 'Ceiling', spoken: 'Ceiling', value: decodedCeiling(wx) },
    { label: 'Temp', spoken: 'Temperature', value: decodedTemp(wx) },
    { label: 'Dewpt', spoken: 'Dew point', value: decodedDew(wx) },
    { label: 'Altim', spoken: 'Altimeter', value: decodedAltimeter(wx, region) },
  ];
}

// MARK: - Weather section state

/** The weather data the column shows (WeatherViewModel's published state, as plain data). */
export interface AirportWeather {
  /** The current METAR, decoded; null before the first load or when none is published. */
  metar: WeatherCache | null;
  isLoading: boolean;
  /** The last load's failure (EFBError.localizedDescription); with a METAR it means the refresh failed. */
  errorMessage: string | null;
  /** Israel: the station publishes a METAR / TAF (always true in the US). */
  metarPublished: boolean;
  tafPublished: boolean;
  /** Raw TAF text. */
  taf: string | null;
  /** Epoch ms of the TAF fetch. */
  tafFetchedAt: number | null;
  tafFailed: boolean;
}

/** What the weather section shows under its header (the if/else chain of `weatherSection`). */
export type WeatherBody =
  | { kind: 'report'; refreshFailed: string | null }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'notPublished'; text: string }
  | { kind: 'none' };

export function weatherBody(w: AirportWeather): WeatherBody {
  if (w.metar) return { kind: 'report', refreshFailed: w.errorMessage };
  if (w.isLoading) return { kind: 'loading' };
  if (w.errorMessage !== null) return { kind: 'error', message: w.errorMessage };
  if (!w.metarPublished) {
    return {
      kind: 'notPublished',
      text: w.tafPublished
        ? 'No METAR is published for this aerodrome. The forecast (TAF) is below.'
        : 'No METAR or TAF is published for this aerodrome.',
    };
  }
  return { kind: 'none' };
}

/** The METAR age badge; null without a report (Swift shows the badge only beside a METAR). */
export const metarFreshness = (w: AirportWeather, now: number): DataFreshness | null =>
  w.metar ? evaluateFreshness('metar', { observed: w.metar.observationTime ?? null, now }) : null;

/** WeatherViewModel.tafFreshness: the valid period end from the TAF text decides, else its fetch age. */
export const tafFreshness = (w: AirportWeather, now: number): DataFreshness | null =>
  w.taf === null
    ? null
    : evaluateFreshness('taf', { observed: w.tafFetchedAt, validUntil: tafValidUntil(w.taf, now), now });

/** The TAF block: the forecast (with a failed-refresh note), "TAF not loaded", or nothing. */
export type TafBlock = { kind: 'taf'; text: string; refreshFailed: boolean } | { kind: 'notLoaded' } | { kind: 'none' };

export function tafBlock(w: AirportWeather): TafBlock {
  if (w.taf !== null) return { kind: 'taf', text: w.taf, refreshFailed: w.tafFailed };
  if (w.tafFailed) return { kind: 'notLoaded' };
  return { kind: 'none' };
}

/** VoiceOver label of the header: identifier, flight category when a METAR gives one, then the name. */
export function headerAccessibilityLabel(ident: string, category: string | null, name: string | null): string {
  return [ident, category ? `flight category ${category.toUpperCase()}` : null, name].filter(Boolean).join(', ');
}

// MARK: - Charts (AirportChartsSection, TerminalProcedureService)

export const CHART_CATEGORIES = ['diagram', 'approach', 'departure', 'arrival', 'minimums', 'other'] as const;
export type TerminalChartCategory = (typeof CHART_CATEGORIES)[number];

/** One d-TPP chart (TerminalChart.swift); the category derives from the chart code. */
export interface TerminalChart {
  /** d-TPP chart_code: "APD", "IAP", ... */
  chartCode: string;
  /** "RNAV (GPS) Y RWY 30" */
  name: string;
  /** "09219RY30.PDF" */
  pdfName: string;
  /** YYNN, "2611" */
  cycle: string;
}

/** A 28-day d-TPP cycle; dates are epoch ms (0901Z). */
export interface ChartCycle {
  code: string;
  effective: number;
  expires: number;
}

/** Several records share a PDF, so the name is part of the id (TerminalChart.id). */
export const chartId = (c: TerminalChart): string => `${c.cycle}/${c.pdfName}/${c.name}`;

/** TerminalChartCategory(chartCode:). */
export function chartCategory(chartCode: string): TerminalChartCategory {
  switch (chartCode.trim().toUpperCase()) {
    case 'APD':
      return 'diagram';
    case 'IAP':
      return 'approach';
    case 'DP':
    case 'ODP':
      return 'departure';
    case 'STR':
    case 'STAR':
      return 'arrival';
    case 'MIN':
      return 'minimums';
    default:
      return 'other';
  }
}

const CATEGORY_TITLES: Record<TerminalChartCategory, string> = {
  diagram: 'Airport Diagram',
  approach: 'Approaches',
  departure: 'Departures',
  arrival: 'Arrivals',
  minimums: 'Minimums',
  other: 'Other',
};
export const chartCategoryTitle = (c: TerminalChartCategory): string => CATEGORY_TITLES[c];

export interface ChartGroup {
  category: TerminalChartCategory;
  title: string;
  charts: TerminalChart[];
}

/** AirportChartsSection.grouped: by category in display order (diagram first), metafile order within a group. */
export function groupedCharts(charts: readonly TerminalChart[]): ChartGroup[] {
  return CHART_CATEGORIES.map((category) => ({
    category,
    title: chartCategoryTitle(category),
    charts: charts.filter((c) => chartCategory(c.chartCode) === category),
  })).filter((g) => g.charts.length > 0);
}

/** "MM/dd" in UTC (en_US_POSIX). */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** DTPPCycle.isExpired: from 0901Z on the next cycle's first day. */
export const chartCycleIsExpired = (c: ChartCycle, now: number): boolean => now >= c.expires;

/** The line under FAA CHARTS: the cycle and its end, or the expired warning. */
export function cycleStatus(c: ChartCycle, now: number): { expired: boolean; text: string } {
  return chartCycleIsExpired(c, now)
    ? { expired: true, text: `Charts expired ${shortDate(c.expires)}. Do not use for navigation.` }
    : { expired: false, text: `Cycle ${c.code} \u00B7 Valid to ${shortDate(c.expires)}` };
}

/** NotamSection's not-configured hint. */
export const NOTAM_KEY_HINT = 'NOTAMs need a free FAA API key. Add it in Settings \u203A NOTAM API.';

/** The station-only caption (a region without airport data still shows the station's weather). */
export const stationOnlyCaption = (regionName: string): string =>
  `Airport data for ${regionName} is not available yet. Only this station's weather is shown.`;
