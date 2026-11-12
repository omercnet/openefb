// The pure parts of ViewModels/IsraelFlightPlanViewModel.swift and Views/Planning/IsraelFlightPlanView.swift: the default
// departure, the picker filter, the routing step (computeRoute without the view model's state), the FPL message input,
// the activation hand-off to navigation, the e-mail and route-weather links, and the text the sheet shows.
// Times are epoch ms; durations named `...Seconds` are seconds, as in Swift.
//
// DEVIATION (issue #39, https://github.com/omercnet/openefb/issues/39): Swift's `mailURL(to:)` addresses the draft to the
// pilot's own e-mail. Here `flightPlanMailURL` always addresses it to FILING_ADDRESS (ais@iaa.gov.il) and never puts
// the pilot's address anywhere in the link. See app/docs/port-notes/U4b-plan.md.
import type { AircraftProfile, PilotProfile } from '../../../data/models';
import {
  NETWORK_TITLE,
  type IsraelAerodrome,
  type IsraelReportingPoint,
  type IsraelRouteNetwork,
  type IsraelRouteSegment,
} from '../../../data/aviation/israelTypes';
import { bearingDeg } from '../../../domain/core/geometry';
import { DRAWABLE_FRESHNESS, IsraelNetworkLookup, closureMarks } from '../../../domain/israel/closureMarks';
import {
  FILING_ADDRESS,
  canFile as issuesAllowFiling,
  fpl,
  hebrewSummary,
  registrationField,
  validate,
  type IsraelFlightPlanInput,
  type IsraelFlightPlanIssue,
} from '../../../domain/israel/flightPlanMessage';
import { israelClock, type IsraelDayOverride } from '../../../domain/israel/lsaTimeRules';
import {
  IsraelRouteError,
  IsraelRoutePlanner,
  cautionBadge,
  cautionBlocksFiling,
  legAltitudeText,
  legPolyline,
  makeRouteOptions,
  planPoints,
  planTotalDistanceNM,
  planTotalETESeconds,
  type IsraelRouteCaution,
  type IsraelRoutePlan,
  type IsraelSegmentClosure,
  type IsraelUnresolvedClosure,
} from '../../../domain/israel/routePlanner';
import { makeActiveRoute, type ActiveRoute, type ActiveRouteLeg } from '../../../domain/route/activeRoute';
import { closureSeverity, type IsraelRouteClosure } from '../../../domain/israel/notamTypes';
import { altitudeChartText, reportFreshness, type IsraelNotamReport } from '../../../services/israelNotam';

// MARK: - Defaults

const HOUR_MS = 3_600_000;

/** The next full hour, at least 30 minutes ahead (A-11: file at least 60 min before ETD). */
export function defaultDeparture(nowMs: number): number {
  const next = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  return next - nowMs < HOUR_MS / 2 ? next + HOUR_MS : next;
}

/** Cruise speed for the plan when the aircraft profile has none (or a non-positive one), knots. */
export const DEFAULT_CRUISE_SPEED_KNOTS = 100;

export function cruiseSpeedKnots(aircraft: AircraftProfile | null): number {
  const speed = aircraft?.cruiseSpeedKts;
  return speed != null && speed > 0 ? speed : DEFAULT_CRUISE_SPEED_KNOTS;
}

/** The active profile; the only one when none is marked active (new profiles start inactive). */
export function activeProfile<T extends { isActive: boolean }>(all: readonly T[]): T | null {
  return all.find((p) => p.isActive) ?? (all.length === 1 ? all[0] : null);
}

// MARK: - Pickers

/** Characters a picker query needs before it searches. */
export const MIN_QUERY_LENGTH = 2;
/** Results per picker. */
export const SEARCH_LIMIT = 8;

/** The query as searched, or null when it is too short to search. */
export function searchableQuery(query: string): string | null {
  const trimmed = query.trim();
  return [...trimmed].length >= MIN_QUERY_LENGTH ? trimmed : null;
}

/** Military and foreign aerodromes cannot be planned to. */
export const plannableAerodromes = (results: readonly IsraelAerodrome[]): IsraelAerodrome[] =>
  results.filter((a) => a.use !== 'military' && a.use !== 'foreign');

/** Why a via entry was refused. */
export const viaRefusal = (code: string, network: IsraelRouteNetwork): string =>
  `${code} is not a reporting point of the ${NETWORK_TITLE[network]} network.`;

// MARK: - Message input

export interface MessageInputSource {
  aircraft: AircraftProfile | null;
  pilot: PilotProfile | null;
  /** Persons on board for P/ when the aircraft profile has none. */
  personsOnBoardOverride: number | null;
  /** Planned off-block time, epoch ms. */
  departure: number;
}

/** Aircraft and pilot profile fields for the message; missing ones stay null/empty and surface as warnings. */
export function messageInput({
  aircraft,
  pilot,
  personsOnBoardOverride,
  departure,
}: MessageInputSource): IsraelFlightPlanInput {
  const capacity = aircraft?.fuelCapacityGallons;
  const burn = aircraft?.fuelBurnGPH;
  const endurance = capacity != null && burn != null && capacity > 0 && burn > 0 ? (capacity / burn) * 3600 : null;
  return {
    registration: aircraft?.nNumber ?? '',
    typeDesignator: aircraft?.icaoTypeDesignator ?? null,
    typeDescription: aircraft?.aircraftType ?? null,
    cruiseSpeedKnots: cruiseSpeedKnots(aircraft),
    enduranceSeconds: endurance,
    personsOnBoard: personsOnBoardOverride ?? aircraft?.personsOnBoard ?? null,
    departure,
    picName: pilot?.name ?? '',
    licenseNumber: pilot?.certificateNumber ?? null,
    phone: pilot?.phone ?? null,
    email: pilot?.email ?? null,
  };
}

// MARK: - Routing

/** A loaded route network (IsraelFlightPlanViewModel.loadNetwork). */
export interface LoadedNetwork {
  points: IsraelReportingPoint[];
  segments: IsraelRouteSegment[];
}

export interface PlanRequest {
  departure: IsraelAerodrome;
  destination: IsraelAerodrome;
  /** Via point codes in flying order. */
  via: readonly string[];
  network: IsraelRouteNetwork;
  loaded: LoadedNetwork;
  /** null: no NOTAM feed (closures are then not applied, and the plan says so). */
  report: IsraelNotamReport | null;
  /** Epoch ms. */
  departureTime: number;
  allowByRequest: boolean;
  allowMilitary: boolean;
  dayOverride: IsraelDayOverride;
  cruiseSpeedKnots: number;
  input: IsraelFlightPlanInput;
  /** Epoch ms the feed's freshness and the closure labels are judged at. */
  nowMs: number;
}

/** What computeRoute leaves on the view model. */
export interface PlanOutcome {
  plan: IsraelRoutePlan | null;
  routeError: IsraelRouteError | null;
  issues: IsraelFlightPlanIssue[];
  /** false: the NOTAM feed was missing or too old, so closures were NOT applied. */
  closuresChecked: boolean;
  fplText: string;
  hebrewSummary: string;
  /** Kept so the message can be re-validated after a profile edit. */
  closures: Map<number, IsraelSegmentClosure>;
  unresolved: IsraelUnresolvedClosure[];
}

/** The route for the request: NOTAM closure marks for the departure window, the planner, the checks and the message. */
export async function computePlan(request: PlanRequest): Promise<PlanOutcome> {
  const { loaded, report, nowMs } = request;
  const options = makeRouteOptions({
    allowByRequest: request.allowByRequest,
    allowMilitary: request.allowMilitary,
    departure: request.departureTime,
    dayOverride: request.dayOverride,
  });
  const freshnessLevel = report ? reportFreshness(report, nowMs).level : null;
  const marks = await closureMarks({
    report: report && freshnessLevel ? { freshnessLevel, closures: report.feed.closures } : null,
    network: new IsraelNetworkLookup(loaded.points, loaded.segments),
    routeNetwork: request.network,
    departureMs: request.departureTime,
    windowSeconds: options.closureWindow,
    closureText: (c) => closureText(c, nowMs),
  });
  const closuresChecked = freshnessLevel !== null && DRAWABLE_FRESHNESS.includes(freshnessLevel);
  const planner = new IsraelRoutePlanner(loaded.points, loaded.segments, marks.segments);
  const base = { closuresChecked, closures: marks.segments, unresolved: marks.unresolved };
  try {
    const plan = planner.route(
      request.departure.code,
      request.destination.code,
      request.cruiseSpeedKnots,
      options,
      request.via,
    );
    return {
      ...base,
      plan,
      routeError: null,
      issues: validate(plan, {
        closures: marks.segments,
        unresolved: marks.unresolved,
        closuresChecked,
        input: request.input,
      }),
      fplText: fpl(plan, request.input),
      hebrewSummary: hebrewSummary(plan, request.input),
    };
  } catch (error) {
    if (!(error instanceof IsraelRouteError)) throw error;
    return { ...base, plan: null, routeError: error, issues: [], fplText: '', hebrewSummary: '' };
  }
}

/** IsraelFlightPlanViewModel.canFile: a plan, and no issue that blocks filing. */
export const planCanBeFiled = (plan: IsraelRoutePlan | null, issues: readonly IsraelFlightPlanIssue[]): boolean =>
  plan !== null && issuesAllowFiling(issues);

// MARK: - Activate

/** What `activate()` writes into AppState: the route, the active leg and the first leg's distance, time and bearing. */
export interface PlanActivation {
  activeRoute: ActiveRoute;
  activeFlightPlan: true;
  /** Activation replaces a Direct-To. */
  directTo: null;
  planDeparture: string;
  planDestination: string | null;
  /** NM to the first point. */
  distanceToNext: number;
  /** Seconds to the first point. */
  estimatedTimeEnroute: number;
  /** Degrees true, first leg. */
  bearingToNext: number;
  /** Gallons for the whole plan at the aircraft's burn; null without a burn rate. */
  fuelGallons: number | null;
}

/** null when the plan has no legs. The caller checks canFile first (Swift refuses an unfileable plan). */
export function planActivation(plan: IsraelRoutePlan, aircraft: AircraftProfile | null): PlanActivation | null {
  const first = plan.legs[0];
  if (!first) return null;
  const legs: ActiveRouteLeg[] = plan.legs.map((leg) => ({
    segmentID: leg.segment.id,
    fromCode: leg.from.code,
    toCode: leg.to.code,
    fromLatitude: leg.from.latitude,
    fromLongitude: leg.from.longitude,
    toLatitude: leg.to.latitude,
    toLongitude: leg.to.longitude,
    altitudeText: legAltitudeText(leg),
    distanceNM: leg.distanceNM,
    path: legPolyline(leg).map((c) => [c.lat, c.lon]),
  }));
  const points = planPoints(plan);
  const burn = aircraft?.fuelBurnGPH;
  return {
    activeRoute: makeActiveRoute(legs),
    activeFlightPlan: true,
    directTo: null,
    planDeparture: first.from.code,
    planDestination: points[points.length - 1]?.code ?? null,
    distanceToNext: first.distanceNM,
    estimatedTimeEnroute: first.eteSeconds,
    bearingToNext: bearingDeg(
      { lat: first.from.latitude, lon: first.from.longitude },
      { lat: first.to.latitude, lon: first.to.longitude },
    ),
    fuelGallons: burn != null ? (planTotalETESeconds(plan) / 3600) * burn : null,
  };
}

// MARK: - Links

/**
 * Percent-encoding for a mailto header value (RFC 6068): everything but the unreserved characters is encoded, and line
 * breaks in the body travel as %0D%0A.
 */
export function mailtoEncode(text: string): string {
  return encodeURIComponent(text.replace(/\r\n|\r|\n/g, '\r\n')).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The e-mail draft for the FPL: To is the IAA filing address (FILING_ADDRESS, ais@iaa.gov.il), subject "FPL <reg>", the
 * message as the body. null without a message. The pilot's own address (`input.email`) is never used: not as To, not as
 * Cc. The app only opens the draft; the pilot taps Send.
 * DEVIATION from Swift's `mailURL(to:)`, which defaulted the recipient to the pilot (issue #39).
 */
export function flightPlanMailURL(fplText: string, input: IsraelFlightPlanInput): string | null {
  if (fplText === '') return null;
  const subject = `FPL ${registrationField(input.registration)}`;
  return `mailto:${FILING_ADDRESS}?subject=${mailtoEncode(subject)}&body=${mailtoEncode(fplText)}`;
}

/** Windy route-weather link (fpl.co.il offers the same): first and last point as lat/lon pairs. */
export function windyURL(plan: IsraelRoutePlan | null): string | null {
  const points = plan ? planPoints(plan) : [];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const f = (n: number) => n.toFixed(4);
  return `https://www.windy.com/distance/${f(first.latitude)}/${f(first.longitude)}/${f(last.latitude)}/${f(last.longitude)}`;
}

// MARK: - Closure labels (IsraelChartFeatureBuilder.closureText)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Full: "CLSD to 13:30Z", "CLSD to 3 Nov 13:30Z" (end on another UTC day), "CLSD" (no end).
 * Partial: "CLSD 2500 · AVBL 3000 to 13:30Z", "CLSD EXC to 13:30Z". Unread: "CHECK NOTAM".
 * With `dataAge`, "... (data 1h20m old)".
 */
export function closureText(closure: IsraelRouteClosure, nowMs: number, dataAge?: string): string {
  const severity = closureSeverity(closure);
  let text: string;
  if (severity === 'check') text = 'CHECK NOTAM';
  else if (severity === 'full') text = 'CLSD';
  else {
    const closed = (closure.closedAltitudes ?? []).map(altitudeChartText);
    const open = (closure.availableAltitudes ?? []).map(altitudeChartText);
    const hasExceptions = (closure.exceptions ?? []).length > 0;
    const parts = [closed.length === 0 ? 'CLSD' : `CLSD ${closed.join('/')}`];
    if (open.length > 0) parts.push(`AVBL ${open.join('/')}`);
    if (hasExceptions) parts.push('EXC');
    // "CLSD EXC" reads better than "CLSD · EXC" when exceptions are the only condition.
    text = parts.join(closed.length === 0 && open.length === 0 ? ' ' : ' \u00B7 ');
  }
  if (severity !== 'check' && closure.validTo !== null) {
    const end = new Date(closure.validTo);
    const now = new Date(nowMs);
    const sameDay =
      end.getUTCFullYear() === now.getUTCFullYear() &&
      end.getUTCMonth() === now.getUTCMonth() &&
      end.getUTCDate() === now.getUTCDate();
    const time = `${two(end.getUTCHours())}:${two(end.getUTCMinutes())}Z`;
    text += ` to ${sameDay ? time : `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${time}`}`;
  }
  if (dataAge) text += ` (data ${dataAge} old)`;
  return text;
}

// MARK: - Sheet text

/** The departure picker's value: "Thu 12.11.2026 10:00" in Israel local time (the DatePicker's Asia/Jerusalem zone). */
export function departureTimeText(epochMs: number): string {
  const c = israelClock(epochMs);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][c.weekday] ?? '';
  return `${weekday} ${two(c.day)}.${two(c.month)}.${c.year} ${two(c.hour)}:${two(c.minute)}`.trim();
}

/** Minutes one press of the departure stepper moves the time. */
export const DEPARTURE_STEP_MINUTES = 15;

/** The departure moved by `steps` stepper presses, never before `nowMs` (the DatePicker's `in: Date()...`). */
export function steppedDeparture(current: number, steps: number, nowMs: number): number {
  return Math.max(nowMs, current + steps * DEPARTURE_STEP_MINUTES * 60_000);
}

export interface SummaryCell {
  label: string;
  value: string;
}

/** DIST, ETE, TAS, LEGS above the legs table. */
export function summaryCells(plan: IsraelRoutePlan): SummaryCell[] {
  const total = Math.trunc(planTotalETESeconds(plan));
  const hours = Math.trunc(total / 3600);
  const minutes = Math.trunc((total % 3600) / 60);
  return [
    { label: 'DIST', value: `${planTotalDistanceNM(plan).toFixed(1)} NM` },
    { label: 'ETE', value: `${hours}:${two(minutes)}` },
    { label: 'TAS', value: `${plan.cruiseSpeedKnots.toFixed(0)} KT` },
    { label: 'LEGS', value: String(plan.legs.length) },
  ];
}

export interface CautionBadgeText {
  text: string;
  /** Red when it blocks filing, amber otherwise. */
  blocksFiling: boolean;
}

/** A leg's caution badge: "PARTIAL CLSD · CLSD 2500 (A1/26)", "CHECK NOTAM A2/26", else the plain badge. */
export function cautionBadgeText(caution: IsraelRouteCaution): CautionBadgeText {
  let text = cautionBadge(caution);
  if (caution.kind === 'partialClosure') text = `${text} \u00B7 ${caution.text} (${caution.notamID})`;
  else if (caution.kind === 'checkNotam') text = `${text} ${caution.notamID}`;
  return { text, blocksFiling: cautionBlocksFiling(caution) };
}

export interface LegRow {
  key: string;
  /** "LLHZ → BAZRA" */
  route: string;
  altitude: string;
  distance: string;
  eteMinutes: string;
  badges: CautionBadgeText[];
}

/** One row of the legs table: FROM → TO, ALT FT, NM, ETE MIN, then its caution badges. */
export function legRows(plan: IsraelRoutePlan): LegRow[] {
  return plan.legs.map((leg, index) => ({
    key: `${leg.segment.id}-${index}`,
    route: `${leg.from.code} \u2192 ${leg.to.code}`,
    altitude: legAltitudeText(leg),
    distance: leg.distanceNM.toFixed(1),
    eteMinutes: Math.round(leg.eteSeconds / 60).toFixed(0),
    badges: leg.cautions.map(cautionBadgeText),
  }));
}

/** The preview sheet's filing note; names the address the E-mail button writes to. */
export const FILING_NOTE = `File by phone or by e-mail to ${FILING_ADDRESS}, at least 60 minutes before departure (AIP A-11). The app never sends it for you.`;

/** The LSA weekend explanation when the database has not been read yet. */
export const WEEKEND_RULE_FALLBACK =
  'Routes marked weekend run on Saturdays and holidays all day and Fridays from 06:00 (some areas from 12:00 or 14:00), holiday eves from 14:00 (AIP B-08).';
