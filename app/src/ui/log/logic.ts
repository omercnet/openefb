// Pure logic of the Log screen: efb-212/Views/Log/LogStackView.swift (Now text, Flown ordering, totals) and
// LogStackRows.swift (FlownEntryAction, route texts, row texts), plus the LogbookViewModel duration formats they use.
import { healthWarning, type FlightRecord, type LogbookEntry } from '../../data/models';
import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { printfFixed, type NavState } from '../flightLog/logic';

// MARK: - FlownEntryAction

/** What a recorded flight's row offers for its linked logbook entry: Sign an unsigned draft, Review a signed one. */
export type FlownEntryAction = 'sign' | 'review';

/** The action for a flight's linked entry; null when the flight has no entry. */
export function flownEntryAction(entry: Pick<LogbookEntry, 'isConfirmed'> | null): FlownEntryAction | null {
  if (!entry) return null;
  return entry.isConfirmed ? 'review' : 'sign';
}

/**
 * Each recorded flight's logbook entry, keyed by flight ID. An unsigned draft wins over a signed entry so a pending
 * signature is never hidden; otherwise the first entry is kept.
 */
export function entriesByFlight<E extends Pick<LogbookEntry, 'flightID' | 'isConfirmed'>>(
  entries: E[],
): Map<string, E> {
  const byFlight = new Map<string, E>();
  for (const entry of entries) {
    if (entry.flightID == null) continue;
    const current = byFlight.get(entry.flightID);
    if (current && (!current.isConfirmed || entry.isConfirmed)) continue;
    byFlight.set(entry.flightID, entry);
  }
  return byFlight;
}

// MARK: - Durations (LogbookViewModel, Duration.formatted)

/** Round to the nearest integer, exact halves to even (FloatingPointRoundingRule.toNearestOrEven). */
const roundHalfEven = (x: number): number => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/**
 * Shown for a non-finite duration (Infinity, NaN). Swift's Int(seconds) traps on these and Duration would print
 * garbage; the JS formatters would print "Infinity:NaN" or "NaNh NaNm", so they dash instead.
 */
const NO_DURATION = '---';

/** Hours and minutes; under one minute, seconds. 5400 -> "1h 30m", 48 -> "48s", 0 -> "0s". */
export function formatDurationHM(seconds: number): string {
  if (!Number.isFinite(seconds)) return NO_DURATION;
  const whole = Math.trunc(seconds);
  if (whole < 60) return `${Math.max(0, whole)}s`;
  const totalMinutes = Math.floor(whole / 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/**
 * Decimal hours, String(format: "%.1f") of seconds / 3600. printf rounds the exact binary value with exact ties to even
 * (0.25 h -> "0.2"); `printfFixed` does that without a floating-point multiply, which would turn 0.05 h (binary
 * 0.05000000000000000277, so "0.1") into an apparent tie.
 */
export const formatDurationDecimal = (seconds: number): string =>
  Number.isFinite(seconds) ? printfFixed(seconds / 3600, 1) : NO_DURATION;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Duration.formatted(.time(pattern: .hourMinuteSecond)): "0:00:05"; fractional seconds round to even. */
export function formatHourMinuteSecond(seconds: number): string {
  if (!Number.isFinite(seconds)) return NO_DURATION;
  const total = Math.max(0, roundHalfEven(seconds));
  return `${Math.floor(total / 3600)}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
}

/** Duration.formatted(.time(pattern: .hourMinute)): "1:05"; seconds round to the nearest minute, halves to even. */
export function formatHourMinute(seconds: number): string {
  if (!Number.isFinite(seconds)) return NO_DURATION;
  const minutes = Math.max(0, roundHalfEven(seconds / 60));
  return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

// MARK: - Dates (en_US, the device's local time zone)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date.formatted(date: .abbreviated, time: .omitted): "Nov 11, 2026". */
export function formatAbbreviatedDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Date.formatted(date: .abbreviated, time: .shortened): "Nov 11, 2026 at 4:36 PM". iOS puts a narrow no-break space
 * before AM/PM; a plain space here (same look, and VoiceOver reads both alike).
 */
export function formatAbbreviatedDateTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${formatAbbreviatedDate(ms)} at ${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

// MARK: - Routes

const ROUTE_ARROW = '\u25B8';

/** "DEP ▸ ARR" idents; "---" when unknown. */
export const logRouteText = (departure: string | null, arrival: string | null): string =>
  `${departure ?? '---'} ${ROUTE_ARROW} ${arrival ?? '---'}`;

/** "DEP to ARR" for VoiceOver. */
export const logRouteSpoken = (departure: string | null, arrival: string | null): string =>
  `${departure ?? 'unknown'} to ${arrival ?? 'unknown'}`;

/**
 * Route idents of the active plan: the active route's points (Swift reads appState.activeRoute without checking
 * activeFlightPlan), or departure and destination of an active plan; null without either.
 */
export function activePlanCodes(nav: NavState): string[] | null {
  const first = nav.activeRoute?.legs[0];
  if (nav.activeRoute && first) return [first.fromCode, ...nav.activeRoute.legs.map((leg) => leg.toCode)];
  if (!nav.activeFlightPlan || nav.planDeparture == null || nav.planDestination == null) return null;
  return [nav.planDeparture, nav.planDestination];
}

/** "LLHZ ▸ ZOMET ▸ LLIB"; null without codes (an empty list too, so Now never shows a blank route). */
export const activePlanText = (codes: readonly string[] | null): string | null =>
  codes?.length ? codes.join(` ${ROUTE_ARROW} `) : null;

/** "LLHZ to ZOMET to LLIB" for VoiceOver; null like activePlanText. */
export const activePlanSpoken = (codes: readonly string[] | null): string | null =>
  codes?.length ? codes.join(' to ') : null;

// MARK: - Now

/** The Now section shows while recording (any non-idle state) or navigating. */
export const isLive = (recording: RecordingStatus, hasActiveNavigation: boolean): boolean =>
  recording.kind !== 'idle' || hasActiveNavigation;

/** "REC 0:00:05", "REC in 3 s", ...; null when idle. */
export function recordingText(recording: RecordingStatus, elapsedSeconds: number): string | null {
  switch (recording.kind) {
    case 'idle':
      return null;
    case 'countdown':
      return `REC in ${recording.remaining} s`;
    case 'recording':
      return `REC ${formatHourMinuteSecond(elapsedSeconds)}`;
    case 'paused':
      return 'REC paused';
    case 'stopping':
      return 'REC stopping';
  }
}

export interface NowInput {
  directToIcao: string | null;
  planCodes: readonly string[] | null;
  recording: RecordingStatus;
  elapsedSeconds: number;
  /** The next waypoint, with the strip's precedence (a Direct-To wins over the route). */
  nextIdent: string | null;
  /** Seconds to the next waypoint; null when unknown or the fix is stale (non-finite counts as unknown). */
  eteSeconds: number | null;
}

export interface NowTexts {
  routeText: string;
  recordingText: string | null;
  /** "Next LLIB"; null without a next waypoint (and then no ETE either). */
  nextText: string | null;
  eteText: string;
  accessibilityLabel: string;
}

/** What is being flown now: a Direct-To, the plan's route, or a recording without navigation ("Flight"). */
export function nowRowTexts(input: NowInput): NowTexts {
  const direct = input.directToIcao != null ? `Direct ${input.directToIcao}` : null;
  const rec = recordingText(input.recording, input.elapsedSeconds);
  const ete = input.eteSeconds != null && Number.isFinite(input.eteSeconds) ? input.eteSeconds : null;
  const parts = ['Now', direct ?? activePlanSpoken(input.planCodes) ?? 'Flight'];
  if (rec) parts.push(rec);
  if (input.nextIdent != null) {
    parts.push(`next ${input.nextIdent}`);
    parts.push(ete != null ? `time to next ${formatDurationHM(ete)}` : 'time to next unavailable');
  }
  return {
    routeText: direct ?? activePlanText(input.planCodes) ?? 'Flight',
    recordingText: rec,
    nextText: input.nextIdent != null ? `Next ${input.nextIdent}` : null,
    eteText: ete != null ? formatHourMinute(ete) : 'ETE ---',
    accessibilityLabel: parts.join(', '),
  };
}

// MARK: - Flown

/** One row of the Flown section: a recorded flight with its entry, or an entry without a recorded flight. */
export type FlownItem =
  { kind: 'flight'; flight: FlightRecord; entry: LogbookEntry | null } | { kind: 'entry'; entry: LogbookEntry };

const itemDate = (item: FlownItem) => (item.kind === 'flight' ? item.flight.startDate : item.entry.date);
export const flownItemKey = (item: FlownItem) =>
  item.kind === 'flight' ? `f:${item.flight.id}` : `e:${item.entry.id}`;

/**
 * Recorded flights with their logbook entries, plus logbook entries that have no recorded flight (manual, or the
 * recording was deleted), newest first. Inputs in any order: both are sorted newest first like the Swift @Query.
 */
export function flownItems(flights: FlightRecord[], entries: LogbookEntry[]): FlownItem[] {
  const sortedFlights = [...flights].sort((a, b) => b.startDate - a.startDate);
  const sortedEntries = [...entries].sort((a, b) => b.date - a.date);
  const flightIDs = new Set(sortedFlights.map((f) => f.id));
  const byFlight = entriesByFlight(sortedEntries);
  const items: FlownItem[] = [
    ...sortedFlights.map((flight): FlownItem => ({ kind: 'flight', flight, entry: byFlight.get(flight.id) ?? null })),
    ...sortedEntries
      .filter((e) => e.flightID == null || !flightIDs.has(e.flightID))
      .map((entry): FlownItem => ({ kind: 'entry', entry })),
  ];
  return items.sort((a, b) => itemDate(b) - itemDate(a));
}

export interface FlightRowTexts {
  dateText: string;
  routeText: string;
  blockTime: string;
  /** Health caution ("Recovered", "Track damaged"); null for a normal flight. */
  warning: string | null;
  action: FlownEntryAction | null;
  actionLabel: string | null;
  actionTestID: string | null;
}

/** FlownFlightRow: a recorded flight with its block time, health caution and logbook entry action. */
export function flightRowTexts(
  flight: FlightRecord,
  entry: LogbookEntry | null,
): FlightRowTexts & { accessibilityLabel: string } {
  const dateText = formatAbbreviatedDateTime(flight.startDate);
  const routeSpoken = logRouteSpoken(flight.departureICAO, flight.arrivalICAO);
  const blockTime = formatDurationHM(flight.durationSeconds);
  const warning = healthWarning(flight);
  const action = flownEntryAction(entry);
  const parts = ['Flight', dateText, routeSpoken, `block time ${blockTime}`];
  if (warning) parts.push(`Caution, ${warning}`);
  if (action === 'sign') parts.push('Logbook draft, not signed');
  if (action === 'review') parts.push('Logbook entry signed');
  return {
    dateText,
    routeText: logRouteText(flight.departureICAO, flight.arrivalICAO),
    blockTime,
    warning,
    action,
    accessibilityLabel: parts.join(', '),
    actionLabel:
      action === 'sign'
        ? `Sign logbook draft, ${routeSpoken}`
        : action === 'review'
          ? `Logbook entry, ${routeSpoken}`
          : null,
    actionTestID: action === 'sign' ? 'log-sign-draft' : action === 'review' ? 'log-open-entry' : null,
  };
}

export interface EntryRowTexts {
  dateText: string;
  routeText: string;
  duration: string;
  aircraftText: string;
  signed: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
}

/** FlownEntryRow: a logbook entry with no recorded flight. */
export function manualEntryRowTexts(entry: LogbookEntry): EntryRowTexts {
  const dateText = formatAbbreviatedDate(entry.date);
  const duration = formatDurationHM(entry.durationSeconds);
  return {
    dateText,
    routeText: logRouteText(entry.departureICAO, entry.arrivalICAO),
    duration,
    aircraftText: entry.aircraftType ?? 'Aircraft not set',
    signed: entry.isConfirmed,
    accessibilityLabel: [
      'Logbook entry',
      dateText,
      logRouteSpoken(entry.departureICAO, entry.arrivalICAO),
      `time ${duration}`,
      entry.aircraftType ?? 'aircraft not set',
      entry.isConfirmed ? 'signed' : 'draft, not signed',
    ].join(', '),
    accessibilityHint: entry.isConfirmed ? 'Opens the signed entry' : 'Opens the entry to edit and sign',
  };
}

/**
 * The only way the Log deletes an entry (Swift LogStackView.delete(_:)): unsigned entries only, a signed entry is locked.
 * The rows offer the swipe action only for unsigned entries; this re-checks at the call.
 */
export function deleteUnsignedEntry(
  entry: Pick<LogbookEntry, 'id' | 'isConfirmed'>,
  deleteEntry: (id: string) => void,
) {
  if (entry.isConfirmed) return;
  deleteEntry(entry.id);
}

// MARK: - Totals

export interface TotalsTexts {
  flightsText: string;
  timeText: string;
  /** Neutral to-do text ("2 drafts to sign"), not a warning; null without drafts. */
  draftsText: string | null;
  accessibilityLabel: string;
}

/** Logbook totals: LogbookViewModel counts every entry and sums their durations; drafts are the unsigned entries. */
export function totalsTexts(entries: Pick<LogbookEntry, 'durationSeconds' | 'isConfirmed'>[]): TotalsTexts {
  const count = entries.length;
  // A non-finite duration is skipped rather than dashing the whole total (JS-only guard: Swift's sum would be inf/nan).
  const seconds = entries.reduce((sum, e) => (Number.isFinite(e.durationSeconds) ? sum + e.durationSeconds : sum), 0);
  const hours = formatDurationDecimal(seconds);
  const drafts = entries.filter((e) => !e.isConfirmed).length;
  const flightsText = count === 1 ? '1 flight' : `${count} flights`;
  const draftsText = drafts === 0 ? null : drafts === 1 ? '1 draft to sign' : `${drafts} drafts to sign`;
  return {
    flightsText,
    timeText: `${hours} h`,
    draftsText,
    accessibilityLabel: ['Logbook total', flightsText, `${hours} hours`, draftsText]
      .filter((p): p is string => p != null)
      .join(', '),
  };
}
