// PirepSection.swift's decisions as pure functions (efb-212/Views/Map/PirepSection.swift): the query window, the body
// state, the row header / location / summary lines, the per-row freshness and the urgent styling. Nothing reads the
// clock: `now` (epoch ms) comes from the caller.
import {
  bearingDeg,
  evaluateFreshness,
  productExpiredAfter,
  type Airport,
  type DataFreshness,
} from '../../../../domain/core';
import {
  distanceNm,
  pirepAltitudeText,
  pirepIcingSummary,
  pirepId,
  pirepIsUrgent,
  pirepSkySummary,
  pirepTurbulenceSummary,
  pirepWindSummary,
  type Pirep,
} from '../../../../services/pirep';

/** The airport fields the PIREP and winds aloft sections read. */
export type SectionAirport = Pick<Airport, 'icao' | 'latitude' | 'longitude'>;

/** PirepSection.radiusNM: reports within 50 NM of the airport (nautical miles). */
export const PIREP_RADIUS_NM = 50;

/**
 * PirepSection.maxAge, seconds (2 hours). DataFreshness.swift's PIREP EXPIRED threshold is documented as this value
 * ("PirepSection.maxAge"), so the query window and the badge agree: a report the query still returns is never past
 * EXPIRED by more than the refresh interval.
 */
export const PIREP_MAX_AGE_SECONDS: number = productExpiredAfter('pirep') ?? 2 * 3600;

export const PIREP_SECTION_TITLE = 'PIREPS';
export const PIREP_REFRESH_LABEL = 'Refresh PIREPs';
export const PIREP_EMPTY_TEXT = 'No PIREPs within 50 NM in the last 2 hours.';

/** The failure label: "PIREPs not loaded: <localizedDescription>". */
export const pirepErrorText = (message: string): string => `PIREPs not loaded: ${message}`;

/** What the section feeds in (the Swift view's LoadState, split into the three fields the store holds). */
export interface PirepLoadInput {
  /** A fetch is in flight. */
  loading: boolean;
  /** The last fetch's error message (`error.localizedDescription`), or null. */
  error: string | null;
  /** The last loaded reports; null until the first load completes. */
  pireps: readonly Pirep[] | null;
}

export type PirepBody =
  | { kind: 'loading' }
  | { kind: 'error'; text: string }
  | { kind: 'empty'; text: string }
  | { kind: 'list'; pireps: Pirep[] };

/**
 * The section body. Swift's `load()` keeps a loaded list on screen while a refresh runs (`if case .loaded = state {}
 * else { state = .loading }`) and replaces it with the failure when a refresh fails, so: an error wins, then any loaded
 * list (even while `loading`), and the spinner only before the first result.
 */
export function pirepBody(input: PirepLoadInput): PirepBody {
  if (input.error !== null) return { kind: 'error', text: pirepErrorText(input.error) };
  if (input.pireps === null) return { kind: 'loading' };
  if (input.pireps.length === 0) return { kind: 'empty', text: PIREP_EMPTY_TEXT };
  return { kind: 'list', pireps: sortNewestFirst(input.pireps) };
}

/**
 * Newest first, ties kept in the given order. PirepService already returns this order (the Swift view shows the
 * service's order as is); sorting again keeps a store that merges or appends reports from reordering the list.
 */
export function sortNewestFirst(pireps: readonly Pirep[]): Pirep[] {
  return pireps
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.observationTime - a.p.observationTime || a.i - b.i)
    .map(({ p }) => p);
}

/** The compass points of `locationText`, clockwise from north. */
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Eight-point compass name of a true bearing in degrees [0, 360): `points[Int((bearing + 22.5) / 45) % 8]`. */
export const compassPoint = (bearingDegrees: number): string =>
  COMPASS_POINTS[Math.trunc((bearingDegrees + 22.5) / 45) % 8]!;

/**
 * Distance (NM) and compass direction of the report from the airport, then the report type:
 * "18 NM NE of KDEN · PIREP"; under 1 NM: "Over KDEN · PIREP". Distance is PirepParser.distanceNM (haversine),
 * bearing CLLocation.bearing(to:) (initial great-circle bearing, degrees true).
 */
export function pirepLocationText(airport: SectionAirport, p: Pirep): string {
  const from = { lat: airport.latitude, lon: airport.longitude };
  const to = { lat: p.latitude, lon: p.longitude };
  const distance = distanceNm(from, to); // nautical miles
  if (distance < 1) return `Over ${airport.icao} \u00b7 ${p.reportType}`;
  const compass = compassPoint(bearingDeg(from, to));
  // Swift `Int(distance.rounded())`: half away from zero; distance is positive here, so Math.round matches.
  return `${Math.round(distance)} NM ${compass} of ${airport.icao} \u00b7 ${p.reportType}`;
}

/** The decoded lines under the location: turbulence, icing, sky, weather, then temperature and wind on one line. */
export function pirepSummaryLines(p: Pirep): string[] {
  const lines: string[] = [];
  const tb = pirepTurbulenceSummary(p);
  if (tb !== null) lines.push(`Turbulence: ${tb}`);
  const ic = pirepIcingSummary(p);
  if (ic !== null) lines.push(`Icing: ${ic}`);
  const sky = pirepSkySummary(p);
  if (sky !== null) lines.push(`Sky: ${sky}`);
  if (p.weather !== null) lines.push(`Weather: ${p.weather}`);
  const air: string[] = [];
  if (p.temperature !== null) air.push(`Temp ${p.temperature}\u00b0C`);
  const wind = pirepWindSummary(p);
  if (wind !== null) air.push(`Wind ${wind}`);
  if (air.length > 0) lines.push(air.join(' \u00b7 '));
  return lines;
}

/** DataAgeBadge(.pirep, observed: observationTime): fresh under 60 min, OLD from 60 min, EXPIRED from 2 h. */
export const pirepFreshness = (p: Pirep, now: number): DataFreshness =>
  evaluateFreshness('pirep', { observed: p.observationTime, now });

/** Urgent rows (UUA) sit on a 15% warning fill with a 1 pt warning stroke; the rest on Palette.fill. */
export type PirepRowTone = 'urgent' | 'normal';

export interface PirepRow {
  id: string;
  tone: PirepRowTone;
  /** "URGENT" label shown first in the header, urgent reports only. */
  urgent: boolean;
  altitudeText: string;
  aircraftType: string | null;
  freshness: DataFreshness;
  locationText: string;
  summaryLines: string[];
  rawText: string;
  /** The header row is one VoiceOver element (`.accessibilityElement(children: .combine)`). */
  headerAccessibilityLabel: string;
}

/** One row of the list. */
export function pirepRow(airport: SectionAirport, p: Pirep, now: number): PirepRow {
  const urgent = pirepIsUrgent(p);
  const freshness = pirepFreshness(p, now);
  const altitudeText = pirepAltitudeText(p);
  const spoken = [urgent ? 'URGENT' : null, altitudeText, p.aircraftType, `PIREP age ${freshness.text}`];
  return {
    id: pirepId(p),
    tone: urgent ? 'urgent' : 'normal',
    urgent,
    altitudeText,
    aircraftType: p.aircraftType,
    freshness,
    locationText: pirepLocationText(airport, p),
    summaryLines: pirepSummaryLines(p),
    rawText: p.rawText,
    headerAccessibilityLabel: spoken.filter((s): s is string => s !== null).join(', '),
  };
}

/** The raw-report disclosure's accessibilityValue. */
export const rawReportValue = (expanded: boolean): string => (expanded ? 'Expanded' : 'Collapsed');
