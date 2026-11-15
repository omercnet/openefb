// WindsAloftSection.swift's decisions as pure functions (efb-212/Views/Map/WindsAloftSection.swift): the body state,
// the station line, the period line, the FOR USE check, the grid cells and their tone, the spoken level and the blank
// level footnote. Nothing reads the clock: `now` (epoch ms) comes from the caller (Swift used `Date()`).
import { evaluateFreshness, metarTimeString, zuluString, type DataFreshness } from '../../../../domain/core';
import { formatInt } from '../../../../services/pirep';
import {
  WINDS_ALOFT_FORECASTS,
  forecastLabel,
  isInForUsePeriod,
  levelIsForecast,
  type WindsAloftForecast,
  type WindsAloftLevel,
  type WindsAloftReport,
} from '../../../../services/windsAloft';

export const WINDS_SECTION_TITLE = 'WINDS ALOFT';
/** The segmented Picker's label. */
export const FORECAST_PICKER_LABEL = 'Forecast';
/** WindsAloftForecast.allCases with their labels ("6 h", "12 h", "24 h"). */
export const FORECAST_OPTIONS: readonly { forecast: WindsAloftForecast; label: string }[] = WINDS_ALOFT_FORECASTS.map(
  (forecast) => ({ forecast, label: forecastLabel(forecast) }),
);
/** The picker's default selection (`@State forecast = .sixHour`). */
export const DEFAULT_FORECAST: WindsAloftForecast = 6;

/** The failure label: "Winds aloft not loaded: <localizedDescription>". */
export const windsErrorText = (message: string): string => `Winds aloft not loaded: ${message}`;

export const OUTSIDE_FOR_USE_TEXT = "Outside the forecast's for-use period";

/** The grid's column headings and the one spoken label that stands for all four. */
export const GRID_HEADINGS = ['ALT (ft MSL)', 'DIR (\u00b0T)', 'SPD (kt)', 'TEMP (\u00b0C)'] as const;
export const GRID_HEADING_SPOKEN = 'Altitude feet MSL, direction degrees true, speed knots, temperature Celsius';
export const LIGHT_AND_VARIABLE_TEXT = 'Light & variable';
/** Placeholder for a value the bulletin leaves blank. */
export const MISSING = '\u2014';

export interface WindsLoadInput {
  /** A fetch is in flight. */
  loading: boolean;
  /** The last fetch's error message (`error.localizedDescription`), or null. */
  error: string | null;
  /** The last loaded report for the selected forecast; null before the first load. */
  report: WindsAloftReport | null;
}

export type WindsBody =
  { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'report'; report: WindsAloftReport };

/**
 * The section body. Unlike the PIREP section, Swift's `load()` sets `.loading` on every load (a new airport, a new
 * forecast period or Retry), so the spinner replaces the report while a fetch runs; then the failure or the report.
 */
export function windsBody(input: WindsLoadInput): WindsBody {
  if (input.loading) return { kind: 'loading' };
  if (input.error !== null) return { kind: 'error', text: windsErrorText(input.error) };
  if (input.report === null) return { kind: 'loading' };
  return { kind: 'report', report: input.report };
}

/** "SFO · San Francisco · 15 NM" (`Int(distanceNM.rounded())`). */
export const stationLine = (r: WindsAloftReport): string =>
  `${r.station.id} \u00b7 ${r.station.name} \u00b7 ${Math.round(r.distanceNM)} NM`;

/** "Station SFO, San Francisco, 15 nautical miles". */
export const stationSpoken = (r: WindsAloftReport): string =>
  `Station ${r.station.id}, ${r.station.name}, ${Math.round(r.distanceNM)} nautical miles`;

/**
 * "Valid 301800Z · For use 1400Z–2100Z · Issued 1400Z"; parts without a time are left out, and with none at all the
 * line reads "6 h forecast".
 */
export function periodText(r: WindsAloftReport): string {
  const parts: string[] = [];
  if (r.validTime !== null) parts.push(`Valid ${metarTimeString(r.validTime)}`);
  if (r.forUseStart !== null && r.forUseEnd !== null) {
    parts.push(`For use ${zuluString(r.forUseStart)}\u2013${zuluString(r.forUseEnd)}`);
  }
  if (r.issued !== null) parts.push(`Issued ${zuluString(r.issued)}`);
  return parts.length === 0 ? `${forecastLabel(r.forecast)} forecast` : parts.join(' \u00b7 ');
}

/**
 * DataAgeBadge(.windsAloft, validFrom: forUseStart, validUntil: forUseEnd): forecast products are judged by their FOR
 * USE window, not by time since issue. VALID inside, EXPIRED after, NOT YET VALID before, N/A without a window.
 */
export const windsFreshness = (r: WindsAloftReport, now: number): DataFreshness =>
  evaluateFreshness('windsAloft', { validFrom: r.forUseStart, validUntil: r.forUseEnd, now });

/** The caution line shows when `now` is outside the FOR USE window (or the bulletin has none). */
export const showsOutsideForUse = (r: WindsAloftReport, now: number): boolean => !isInForUsePeriod(r, now);

/** Forecast levels read in the primary text colour, blank levels in the secondary. */
export type LevelTone = 'primary' | 'secondary';

export interface WindsGridRow {
  altitude: number;
  /** "12,000" (feet MSL, `Int.formatted()`). */
  altitudeText: string;
  /** "Light & variable" spanning the direction and speed columns, else null. */
  lightAndVariable: string | null;
  /** "230" (degrees true, `%03d`) or "—". */
  direction: string;
  /** "16" (knots) or "—". */
  speed: string;
  /** "-7" (degrees Celsius) or "—". */
  temperature: string;
  tone: LevelTone;
  /** VoiceOver reads the whole level from the first cell: "12,000 feet". */
  spokenLabel: string;
  /** ... with this value: "wind 230 degrees at 16 knots, temperature -7 degrees Celsius". */
  spokenValue: string;
}

/** Swift `level.spokenLevel`. */
export function spokenLevel(l: WindsAloftLevel): string {
  const parts: string[] = [];
  if (l.isLightAndVariable) parts.push('wind light and variable');
  else if (l.direction !== null && l.speed !== null) parts.push(`wind ${l.direction} degrees at ${l.speed} knots`);
  if (l.temperature !== null) parts.push(`temperature ${l.temperature} degrees Celsius`);
  if (!levelIsForecast(l)) parts.push('not forecast');
  return parts.length === 0 ? 'no data' : parts.join(', ');
}

export function gridRow(l: WindsAloftLevel): WindsGridRow {
  const altitudeText = formatInt(l.altitude);
  return {
    altitude: l.altitude,
    altitudeText,
    lightAndVariable: l.isLightAndVariable ? LIGHT_AND_VARIABLE_TEXT : null,
    direction: l.direction !== null ? String(l.direction).padStart(3, '0') : MISSING,
    speed: l.speed !== null ? String(l.speed) : MISSING,
    temperature: l.temperature !== null ? String(l.temperature) : MISSING,
    tone: levelIsForecast(l) ? 'primary' : 'secondary',
    spokenLabel: `${altitudeText} feet`,
    spokenValue: spokenLevel(l),
  };
}

/** One row per bulletin level, in the bulletin's (ascending) order: `ForEach(report.levels, id: \.altitude)`. */
export const gridRows = (r: WindsAloftReport): WindsGridRow[] => r.levels.map(gridRow);

/**
 * "— Not forecast within 1,500 ft of station elevation (5,352 ft MSL)." when any level is blank, else null. A report
 * without levels shows only the grid headings (Swift draws the Grid's header row and nothing else).
 */
export function blankLevelNote(r: WindsAloftReport): string | null {
  if (!r.levels.some((l) => !levelIsForecast(l))) return null;
  return `${MISSING} Not forecast within 1,500 ft of station elevation (${formatInt(Math.round(r.station.elevation))} ft MSL).`;
}

/** `.task(id: "\(airport.icao)-\(forecast.rawValue)")`: a new key reloads. */
export const windsTaskKey = (icao: string, forecast: WindsAloftForecast): string => `${icao}-${forecast}`;
