// Pure parts of the Israel NOTAM briefing sheet (IL-BRIEF): the derived state of ViewModels/IsraelBriefingViewModel.swift
// (freshness gate, window, query, rows, unread count) and the text and decisions of Views/Briefing/IsraelBriefingView.swift
// (status banners, filter summary, badges, "Show on map", BriefingTimeFormat), plus the pure IsraelBriefingGeometry of
// Services/IsraelBriefingMapHighlight.swift. Filtering and ordering live in domain/israel/briefingFilter.ts.
// Times are epoch ms; positions { lat, lon } degrees; distances nautical miles.
import type { Coordinate } from '../../../domain/core/geometry';
import { evaluateFreshness, productDisplayName, type DataFreshness } from '../../../domain/core/freshness';
import {
  briefingRouteAerodromes,
  briefingRows,
  flightWindow,
  makeBriefingQuery,
  type BriefingQuery,
  type BriefingReference,
  type BriefingRoute,
  type BriefingRow,
  type BriefingSection,
  type BriefingWindow,
} from '../../../domain/israel/briefingFilter';
import { ISRAEL_TIME_ZONE } from '../../../domain/israel/lsaTimeRules';
import type { IsraelLatLon, IsraelNotam } from '../../../domain/israel/notamTypes';
import type { IsraelNotamReport } from '../../../services/israelNotam';

// MARK: - Inputs the user sets

/** IsraelBriefingViewModel.WindowChoice, in CaseIterable order. */
export type WindowChoice = 'flight' | 'next6h' | 'next24h';
export const WINDOW_CHOICES: readonly WindowChoice[] = ['flight', 'next6h', 'next24h'];
/** The raw values: the segmented control titles. */
export const WINDOW_CHOICE_TITLE: Record<WindowChoice, string> = { flight: 'Flight', next6h: '6 h', next24h: '24 h' };

/** IsraelBriefingViewModel.DistanceChoice, in CaseIterable order. */
export type DistanceChoice = 'off' | 'route' | 'ownship';
export const DISTANCE_CHOICES: readonly DistanceChoice[] = ['off', 'route', 'ownship'];
export const DISTANCE_CHOICE_TITLE: Record<DistanceChoice, string> = { off: 'Any', route: 'Route', ownship: 'Ownship' };

/** The corridor stepper: 5...100 NM in steps of 5. */
export const CORRIDOR_STEPPER = { min: 5, max: 100, step: 5 } as const;

export interface BriefingFilters {
  windowChoice: WindowChoice;
  distanceChoice: DistanceChoice;
  /** Corridor half-width, nautical miles. */
  corridorNM: number;
  aerodromeFilter: string;
  unreadOnly: boolean;
  /** The pilot asked to see a list the app judges too old to be current. */
  showStaleList: boolean;
}

/** The view model's initial inputs. */
export const DEFAULT_FILTERS: BriefingFilters = {
  windowChoice: 'flight',
  distanceChoice: 'off',
  corridorNM: 25,
  aerodromeFilter: '',
  unreadOnly: false,
  showStaleList: false,
};

/** What the rows are computed from: the inputs plus the caller's context and the loaded report. */
export interface BriefingInputs extends BriefingFilters {
  route: BriefingRoute | null;
  ownship: IsraelLatLon | null;
  report: IsraelNotamReport | null;
}

export type IsReadFn = (notam: IsraelNotam) => boolean;

// MARK: - Freshness

/** IsraelNotamReport.freshness(now:): the badge on the relay's scrape time. null before a feed is loaded. */
export function briefingFreshness(report: IsraelNotamReport | null, nowMs: number): DataFreshness | null {
  return report ? evaluateFreshness('notam', { observed: report.feed.generatedAt, now: nowMs }) : null;
}

/** Fresh enough to list as current: the relay scraped the IAA within the NOTAM old limit. */
export const isCurrent = (freshness: DataFreshness | null): boolean => freshness?.level === 'fresh';

/** Listed with an age badge but not as current (old), or hidden behind the stale gate (expired). */
export function isListable(freshness: DataFreshness | null, showStaleList: boolean): boolean {
  if (!freshness) return false;
  switch (freshness.level) {
    case 'fresh':
    case 'old':
      return true;
    default:
      return showStaleList;
  }
}

// MARK: - Rows

/** The flight window for the chosen length. */
export function briefingWindow(choice: WindowChoice, route: BriefingRoute | null, nowMs: number): BriefingWindow {
  switch (choice) {
    case 'flight':
      return flightWindow(route, nowMs);
    case 'next6h':
      return { start: nowMs, end: nowMs + 6 * 3600 * 1000 };
    case 'next24h':
      return { start: nowMs, end: nowMs + 24 * 3600 * 1000 };
  }
}

export function briefingQuery(s: Omit<BriefingInputs, 'report'>, nowMs: number): BriefingQuery {
  let reference: BriefingReference = { kind: 'none' };
  if (s.distanceChoice === 'route' && s.route) reference = { kind: 'route', route: s.route };
  if (s.distanceChoice === 'ownship' && s.ownship) reference = { kind: 'ownship', point: s.ownship };
  return makeBriefingQuery({
    window: briefingWindow(s.windowChoice, s.route, nowMs),
    reference,
    corridorNM: s.corridorNM,
    aerodrome: s.aerodromeFilter,
    routeAerodromes: s.route ? briefingRouteAerodromes(s.route) : new Set<string>(),
    network: s.route?.network ?? 'cvfr',
  });
}

/** Rows for the current filters, closures first. Empty until a feed is loaded and listable. */
export function visibleRows(s: BriefingInputs, nowMs: number, isRead: IsReadFn): BriefingRow[] {
  if (!s.report || !isListable(briefingFreshness(s.report, nowMs), s.showStaleList)) return [];
  const all = briefingRows(s.report.feed.items, briefingQuery(s, nowMs));
  return s.unreadOnly ? all.filter((row) => !isRead(row.notam)) : all;
}

export const rowsInSection = (rows: readonly BriefingRow[], section: BriefingSection): BriefingRow[] =>
  rows.filter((row) => row.section === section);

export const unreadCount = (rows: readonly BriefingRow[], isRead: IsReadFn): number =>
  rows.filter((row) => !isRead(row.notam)).length;

// MARK: - Status section

export type BannerTone = 'caution' | 'warning';
export interface Banner {
  text: string;
  tone: BannerTone;
}

/** What the status section shows, top to bottom (statusSection). */
export type StatusContent =
  | {
      kind: 'feed';
      freshness: DataFreshness;
      productName: string;
      count: number;
      /** Banners between the feed line and the button; then `showStaleButton`; then `trailing`. */
      banners: Banner[];
      showStaleButton: boolean;
      trailing: Banner[];
    }
  | { kind: 'loading' }
  | { kind: 'error'; banner: Banner }
  | { kind: 'empty' };

export function statusContent(
  s: { report: IsraelNotamReport | null; isLoading: boolean; errorMessage: string | null; showStaleList: boolean },
  nowMs: number,
): StatusContent {
  const freshness = briefingFreshness(s.report, nowMs);
  if (s.report && freshness) {
    const banners: Banner[] = [];
    const trailing: Banner[] = [];
    if (freshness.level === 'old') {
      banners.push({ text: 'List is OLD. Re-check NOTAMs with the IAA before flying.', tone: 'caution' });
    }
    const listable = isListable(freshness, s.showStaleList);
    if (!listable) {
      banners.push({
        text: `NOTAM feed is ${freshness.text}. The list is not current and is hidden. Check NOTAMs with the IAA.`,
        tone: 'warning',
      });
    } else if (s.showStaleList && freshness.level !== 'fresh' && freshness.level !== 'old') {
      trailing.push({ text: 'Showing a stale list. It is NOT current.', tone: 'warning' });
    }
    if (s.report.refreshFailed) {
      trailing.push({ text: 'Refresh failed. Showing the copy downloaded earlier.', tone: 'caution' });
    }
    return {
      kind: 'feed',
      freshness,
      productName: productDisplayName('notam'),
      count: s.report.feed.items.length,
      banners,
      showStaleButton: !listable,
      trailing,
    };
  }
  if (s.isLoading) return { kind: 'loading' };
  if (s.errorMessage !== null) {
    return { kind: 'error', banner: { text: `NOTAMs not loaded: ${s.errorMessage}`, tone: 'warning' } };
  }
  return { kind: 'empty' };
}

// MARK: - Filter text

/** Swift trimmingCharacters(in: .whitespaces): spaces and tab, not newlines. */
const trimWhitespaces = (text: string): string => text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '');

/** The Filters row's summary: "Flight . Route 25 NM . LLHZ . Unread". */
export function filterSummary(f: Omit<BriefingFilters, 'showStaleList'>): string {
  const parts = [WINDOW_CHOICE_TITLE[f.windowChoice]];
  if (f.distanceChoice !== 'off')
    parts.push(`${DISTANCE_CHOICE_TITLE[f.distanceChoice]} ${Math.trunc(f.corridorNM)} NM`);
  const aerodrome = trimWhitespaces(f.aerodromeFilter);
  if (aerodrome !== '') parts.push(aerodrome.toUpperCase());
  if (f.unreadOnly) parts.push('Unread');
  return parts.join(' \u00B7 ');
}

/** The caption under the window picker. */
export const windowText = (window: BriefingWindow): string =>
  `Valid ${BriefingTimeFormat.local(window.start)} to ${BriefingTimeFormat.local(window.end)} LT, PERM always`;

export const corridorText = (corridorNM: number): string => `Within ${Math.trunc(corridorNM)} NM`;

/** The note under the distance picker when its reference is missing; null when there is none to show. */
export function distanceNote(s: Pick<BriefingInputs, 'distanceChoice' | 'route' | 'ownship'>): string | null {
  if (s.distanceChoice === 'route' && s.route === null) {
    return 'No planned or active route. Plan a flight to filter by route.';
  }
  if (s.distanceChoice === 'ownship' && s.ownship === null) return 'No GPS position yet.';
  return null;
}

export const EMPTY_TEXT = 'No NOTAMs match these filters. Widen the window or distance.';

export const WEATHER_TEXT =
  'SIGMET/AIRMET for LLLL are not in the aviationweather.gov feed the app reads. The Israel Meteorological Service is the authoritative source.';
/** IMS aviation page: the authoritative SIGMET/AIRMET and forecast source (docs/research/israel-cvfr.md section 5). */
export const IMS_AVIATION_URL = 'https://ims.gov.il/en/aviation';
export const IMS_LINK_TITLE = 'IMS aviation: SIGMET, AIRMET, forecasts';

export const CANNOT_SHOW_TEXT = 'The map is not ready, or this NOTAM has no area or route to draw.';

// MARK: - Row text

/** E) as published; the full text when the relay could not read the fields. Lines joined with spaces. */
export function plainText(notam: IsraelNotam): string {
  const text = (notam.parsed ? notam.e : null) ?? notam.raw;
  return trimWhitespaces(
    text
      .split(/\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/)
      .filter((line) => line !== '')
      .join(' '),
  );
}

/** "On the reference" under half a mile, else "12 NM away"; null without a distance. */
export function distanceText(distanceNM: number | null): string | null {
  if (distanceNM === null) return null;
  return distanceNM < 0.5 ? 'On the reference' : `${distanceNM.toFixed(0)} NM away`;
}

export const isReplacement = (notam: IsraelNotam): boolean => notam.type?.toUpperCase() === 'NOTAMR';

export const rowAccessibilityLabel = (notam: IsraelNotam, read: boolean): string =>
  `${notam.id}, ${notam.location}, ${read ? 'read' : 'unread'}`;

export interface BadgeSpec {
  text: string;
  icon: 'xmark.octagon.fill' | 'exclamationmark.triangle.fill';
  tone: BannerTone;
  testID: string;
}

const badge = (text: string, icon: BadgeSpec['icon'], tone: BannerTone): BadgeSpec => ({
  text,
  icon,
  tone,
  testID: `briefing-badge-${text.toLowerCase().replaceAll(' ', '-')}`,
});

/** CLOSED (red), PARTIAL (amber) or CHECK NOTAM (amber); null for an ordinary NOTAM. */
export function closureBadge(row: BriefingRow): BadgeSpec | null {
  switch (row.closure) {
    case 'full':
      return badge('CLOSED', 'xmark.octagon.fill', 'warning');
    case 'partial':
      return badge('PARTIAL', 'exclamationmark.triangle.fill', 'caution');
    default:
      return row.needsCheck ? badge('CHECK NOTAM', 'exclamationmark.triangle.fill', 'caution') : null;
  }
}

/** A closure of someone else's routes (HEL, ultralight, ATS for a CVFR pilot): named, never red or amber. */
export function otherRouteLabel(row: BriefingRow): { text: string; accessibilityLabel: string } | null {
  if (row.closure !== 'none' || row.needsCheck || row.otherRouteKinds.length === 0) return null;
  const kinds = row.otherRouteKinds.join(' + ');
  return { text: `${kinds} ROUTE CLSD`, accessibilityLabel: `${kinds} routes closed. Not your route network.` };
}

// MARK: - Show on map

/** Something to draw: an E) polygon or circle, a Q-line circle under 100 NM, or a closed chain of two points or more. */
export function canShowOnMap(notam: IsraelNotam): boolean {
  if (notam.geometry.polygon !== null || notam.geometry.circle !== null) return true;
  if (notam.q?.centre && (notam.q.radiusNM ?? Infinity) < 100) return true;
  return notam.closures.some((closure) => closure.chain.length >= 2);
}

/** MapColor.notamClosure / notamCaution / notamInfo. */
export type HighlightTint = 'closure' | 'caution' | 'info';

export function highlightTint(row: BriefingRow): HighlightTint {
  switch (row.closure) {
    case 'full':
      return 'closure';
    case 'partial':
    case 'check':
      return 'caution';
    case 'none':
      return row.needsCheck ? 'caution' : 'info';
  }
}

// MARK: - IsraelBriefingGeometry (Services/IsraelBriefingMapHighlight.swift)

/** Ring approximating a circle of `radiusNM` nautical miles around `centre`. */
function circleRing(centre: IsraelLatLon, radiusNM: number, points = 72): Coordinate[] {
  const latStep = radiusNM / 60;
  const lonStep = radiusNM / (60 * Math.max(0.1, Math.cos((centre.lat * Math.PI) / 180)));
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * 2 * Math.PI;
    return { lat: centre.lat + latStep * Math.sin(angle), lon: centre.lon + lonStep * Math.cos(angle) };
  });
}

/** Areas (closed rings) and lines (chains) to draw for a NOTAM. */
function shapes(
  notam: IsraelNotam,
  pointLookup: (code: string) => IsraelLatLon | null,
): { rings: Coordinate[][]; lines: Coordinate[][] } {
  let rings: Coordinate[][] = [];
  let qLineFallback = false;
  const { polygon, circle } = notam.geometry;
  if (polygon && polygon.length >= 3) {
    rings.push(polygon.map((p) => ({ lat: p.lat, lon: p.lon })));
  } else if (circle) {
    rings.push(circleRing(circle.centre, circle.radiusNM));
    qLineFallback = true; // the relay copies the Q-line circle here for route closures
  } else if (notam.q?.centre && notam.q.radiusNM !== null && notam.q.radiusNM < 100) {
    // A Q-line circle of 100 NM or more is a FIR-wide placeholder, not a place.
    rings.push(circleRing(notam.q.centre, notam.q.radiusNM));
    qLineFallback = true;
  }
  const lines: Coordinate[][] = [];
  for (const closure of notam.closures) {
    const coordinates = closure.chain.flatMap((code) => {
      const p = pointLookup(code);
      return p ? [{ lat: p.lat, lon: p.lon }] : [];
    });
    if (coordinates.length >= 2) lines.push(coordinates);
  }
  // A route closure is the chain itself. The Q-line circle is only the NOTAM's scope (tens of NM wide), and drawn
  // filled it read as "this whole area is closed" (UX-IL).
  if (qLineFallback && lines.length > 0) rings = [];
  return { rings, lines };
}

export const IsraelBriefingGeometry = { circleRing, shapes } as const;

// MARK: - BriefingTimeFormat

/** en_GB "d MMM HH:mm" in `timeZone`; Swift falls back to GMT when the zone is unknown. */
function format(epochMs: number, timeZone: string): string {
  const options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).formatToParts(new Date(epochMs));
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).formatToParts(new Date(epochMs));
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = String(Number(part('hour')) % 24).padStart(2, '0');
  return `${Number(part('day'))} ${part('month')} ${hour}:${part('minute')}`;
}

export const BriefingTimeFormat = {
  israel: ISRAEL_TIME_ZONE,
  /** "28 Oct 10:45" in Israel local time. */
  local: (epochMs: number): string => format(epochMs, ISRAEL_TIME_ZONE),
  /** "28 Oct 07:45Z". */
  zulu: (epochMs: number): string => `${format(epochMs, 'UTC')}Z`,
  /** "LT 28 Oct 10:45 to 28 Oct 16:30" / "UTC 28 Oct 07:45Z to 28 Oct 13:30Z"; PERM and EST marked. */
  validity(notam: IsraelNotam, local: boolean): string {
    const label = local ? 'LT' : 'UTC';
    const render = local ? BriefingTimeFormat.local : BriefingTimeFormat.zulu;
    const from = notam.validFrom !== null ? render(notam.validFrom) : '?';
    let to: string;
    if (notam.permanent) to = 'PERM';
    else if (notam.validTo !== null) to = render(notam.validTo) + (notam.estimated ? ' EST' : '');
    else to = '?';
    return `${label} ${from} to ${to}`;
  },
} as const;
