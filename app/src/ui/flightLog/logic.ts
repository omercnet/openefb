// The pure text and ordering functions of the flight log strip: the `static func`s of FlightLogStrip
// (efb-212/Views/Log/FlightLogStrip.swift), AltitudeTape.scaleTop and FlightLogVisibility (FlightLogRows.swift /
// FlightLogStrip.swift). Times are epoch ms with an explicit IANA time zone; durations are seconds.
import type { PredictedEvent } from '../../domain/prediction';
import { currentLeg, destinationCode, type ActiveRoute, type ActiveRouteFollowing } from '../../domain/route';

const DOT = ' \u00B7 ';

/**
 * C `%.Nf` (Swift String(format:)): toFixed already rounds the exact binary value, and differs from printf only on an
 * exact binary tie (0.25, 2.5, 348.5), which printf rounds half to even and toFixed rounds up. The tie is read from the
 * exact decimal expansion (toFixed(100)), never from a floating-point multiply (0.35 * 10 is exactly 3.5, yet 0.35 is
 * below the tie and prints "0.3"). Negative values keep their sign ("-0.0"), NaN and infinities print as C does.
 */
export function printfFixed(value: number, digits: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const sign = value < 0 || Object.is(value, -0) ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e21) return sign + magnitude.toFixed(digits); // toFixed's own range limit
  const exact = magnitude.toFixed(100);
  const point = exact.indexOf('.');
  // The digits printf keeps ("348" for %.0f, "0.2" for %.1f), then whether the rest is exactly one half.
  const kept = exact.slice(0, digits === 0 ? point : point + 1 + digits);
  const tie = /^50*$/.test(exact.slice(point + 1 + digits));
  if (tie && Number(kept[kept.length - 1]) % 2 === 0) return sign + kept;
  return sign + magnitude.toFixed(digits);
}

/** `%03.0f`: degrees as three digits ("041"). */
export const threeDigits = (degrees: number): string => printfFixed(degrees, 0).padStart(3, '0');

/** Swift `Double.rounded()`: half away from zero. */
export const roundAway = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

// MARK: FlightLogVisibility

/** Keys of the map-screen panel toggles (Layers > Panels). Predictions default off: pilots opt in. */
export const FlightLogVisibility = {
  flightLogKey: 'showsFlightLog',
  instrumentsKey: 'showsInstruments',
  predictionsKey: 'showsPredictions',
  predictionsDefault: false,
} as const;

/** NSString.boolValue: leading spaces, sign and zeros skipped, then Y/y/T/t or a digit 1-9 is true. */
const stringBool = (text: string): boolean => /^\s*[+-]?0*[YyTt1-9]/.test(text);

/** The predictions toggle as @AppStorage reads it: a stored Bool, or a "YES"/"NO" launch argument. */
export function predictionsOn(read: (key: string) => unknown): boolean {
  const value = read(FlightLogVisibility.predictionsKey);
  if (value == null) return FlightLogVisibility.predictionsDefault;
  if (typeof value === 'string') return stringBool(value);
  return Boolean(value);
}

// MARK: Navigation state

/** The navigation parts of AppState the strip reads. `directTo` is the Direct-To airport's ICAO. */
export interface NavState {
  directTo: string | null;
  activeFlightPlan: boolean;
  activeRoute: ActiveRoute | null;
  planDeparture: string | null;
  planDestination: string | null;
}

/** Header title for the current navigation state ("DIRECT KSQL", "KPAO -> KSQL"); null when nothing is active. */
export function routeTitle(nav: NavState): string | null {
  if (nav.directTo != null) return `DIRECT ${nav.directTo}`;
  const leg = nav.activeRoute && currentLeg(nav.activeRoute);
  const dest = nav.activeRoute && destinationCode(nav.activeRoute);
  // Multi-leg CVFR route: the next reporting point and the altitude published for this leg.
  if (nav.activeFlightPlan && leg && dest != null) return `\u2192 ${leg.toCode} ${leg.altitudeText} FT${DOT}${dest}`;
  if (nav.activeFlightPlan && nav.planDeparture != null && nav.planDestination != null) {
    return `${nav.planDeparture} \u2192 ${nav.planDestination}`;
  }
  return null;
}

/** The next waypoint: the Direct-To field, else the active route's next point, else the plan destination. */
export function nextIdent(nav: NavState): string | null {
  if (nav.directTo != null) return nav.directTo;
  if (!nav.activeFlightPlan) return null;
  return (nav.activeRoute && currentLeg(nav.activeRoute)?.toCode) ?? nav.planDestination;
}

/** The multi-leg route being followed (Israel CVFR); null for Direct-To and US direct plans. */
export const followedRoute = (nav: NavState): ActiveRoute | null =>
  nav.directTo == null && nav.activeFlightPlan ? nav.activeRoute : null;

/** AppState.hasActiveNavigation. */
export const hasActiveNavigation = (nav: NavState): boolean => nav.directTo != null || nav.activeFlightPlan;

// MARK: Times

/** Time-to as "11:16" (m:ss) under an hour, "1:05" (h:mm) above. */
export function timeToText(seconds: number): string {
  const total = Math.max(0, roundAway(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  if (total < 3600) return `${Math.floor(total / 60)}:${two(total % 60)}`;
  return `${Math.floor(total / 3600)}:${two(Math.floor((total % 3600) / 60))}`;
}

/** Spoken time-to: "11 minutes 16 seconds", "1 minute 50 seconds", "1 hour 5 minutes". */
export function spokenDuration(seconds: number): string {
  const total = Math.max(0, roundAway(seconds));
  const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (total < 3600) return `${count(Math.floor(total / 60), 'minute')} ${count(total % 60, 'second')}`;
  return `${count(Math.floor(total / 3600), 'hour')} ${count(Math.floor((total % 3600) / 60), 'minute')}`;
}

/** The device time zone (Swift TimeZone.current). */
export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One 24 h hour:minute formatter per zone string; an unknown zone maps to the device zone's formatter. */
const clockFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormat = (timeZone: string): Intl.DateTimeFormat => {
  let format = clockFormats.get(timeZone);
  if (!format) {
    const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    try {
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      // Swift `TimeZone(identifier:) ?? .current`: an unknown zone (RangeError) reads in device time.
      format = new Intl.DateTimeFormat('en-US', options);
    }
    clockFormats.set(timeZone, format);
  }
  return format;
};

/** Wall-clock time "15:41" (24 h) in the given zone; "---" for a non-finite time or when the format has no hour/minute. */
export function clockText(epochMs: number, timeZone: string = deviceTimeZone()): string {
  if (!Number.isFinite(epochMs)) return '---';
  const parts = clockFormat(timeZone).formatToParts(epochMs);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  return hour != null && minute != null ? `${hour}:${minute}` : '---';
}

// MARK: NEXT data line

export interface NextData {
  /** Nautical miles. */
  distanceNM: number | null;
  /** Degrees true. */
  bearingTrue: number | null;
  /** Epoch ms. */
  eta: number | null;
  timeZone?: string;
  stale: boolean;
}

/**
 * The NEXT data line, "18.4 NM . 341deg . ETA 15:41". A missing value dashes; a stale fix dashes all three so the last
 * distance, bearing and ETA are never shown as current.
 */
export function nextDataText({ distanceNM, bearingTrue, eta, timeZone, stale }: NextData): string {
  return [
    !stale && distanceNM != null ? `${printfFixed(distanceNM, 1)} NM` : '--- NM',
    !stale && bearingTrue != null ? `${threeDigits(bearingTrue)}\u00B0` : '---\u00B0',
    `ETA ${!stale && eta != null ? clockText(eta, timeZone) : '---'}`,
  ].join(DOT);
}

/** VoiceOver counterpart of `nextDataText`: the known values only, or ", stale" with no numbers on a stale fix. */
export function nextDataSpoken({ distanceNM, bearingTrue, eta, timeZone, stale }: NextData): string {
  if (stale) return 'distance, bearing and ETA unavailable, stale';
  const parts: string[] = [];
  if (distanceNM != null) parts.push(`${printfFixed(distanceNM, 1)} NM`);
  if (bearingTrue != null) parts.push(`${threeDigits(bearingTrue)}\u00B0`);
  if (eta != null) parts.push(`ETA ${clockText(eta, timeZone)}`);
  return parts.join(DOT);
}

// MARK: Route cautions

/** "0.8 NM RIGHT OF ROUTE"; null without a measurement. */
export function offRouteText(following: ActiveRouteFollowing): string | null {
  if (following.crossTrackNM == null || following.side == null) return null;
  return `${printfFixed(following.crossTrackNM, 1)} NM ${following.side === 'L' ? 'LEFT' : 'RIGHT'} OF ROUTE`;
}

/** "350 FT HIGH . FLY 2500". */
export function altitudeText(following: ActiveRouteFollowing, published: string): string | null {
  const deviation = following.altitudeDeviationFeet;
  if (deviation == null) return null;
  return `${roundAway(Math.abs(deviation))} FT ${deviation > 0 ? 'HIGH' : 'LOW'}${DOT}FLY ${published}`;
}

// MARK: Predictions in NEXT (stage 2)

/** One row of NEXT: a predicted airspace entry or a route point (index 0 is the next waypoint), each with its time-to. */
export type NextItem =
  { kind: 'event'; event: PredictedEvent } | { kind: 'waypoint'; index: number; secondsAhead: number | null };

export const nextItemId = (item: NextItem): string =>
  item.kind === 'event' ? `event/${item.event.volumeID}/${item.event.kind}` : `waypoint/${item.index}`;

/** Seconds to the item; null for a waypoint without a meaningful time (slow, stale fix, no ETE). */
export const nextItemSeconds = (item: NextItem): number | null =>
  item.kind === 'event' ? item.event.secondsAhead : item.secondsAhead;

/**
 * Predicted events and route points in one time order. Waypoints keep their route order; a waypoint without a time
 * never goes ahead of an event, and an event wins a tie (caution first).
 */
export function nextItems(events: readonly PredictedEvent[], waypoints: readonly (number | null)[]): NextItem[] {
  // Array.sort is stable, like the Swift merge relies on for equal times.
  const pending = [...events].sort((a, b) => a.secondsAhead - b.secondsAhead);
  const items: NextItem[] = [];
  let index = 0;
  while (index < waypoints.length || pending.length > 0) {
    const event = pending[0];
    const waypoint = waypoints[index];
    if (event && (index === waypoints.length || waypoint == null || event.secondsAhead <= waypoint)) {
      items.push({ kind: 'event', event });
      pending.shift();
    } else {
      items.push({ kind: 'waypoint', index, secondsAhead: waypoint ?? null });
      index += 1;
    }
  }
  return items;
}

/** The top (loud) row, at most `laterCap` later rows, and how many are left for "+N more". */
export function splitNext(
  items: readonly NextItem[],
  laterCap: number,
): { top: NextItem | null; later: NextItem[]; hiddenCount: number } {
  if (items.length === 0) return { top: null, later: [], hiddenCount: 0 };
  const rest = items.slice(1);
  const later = rest.slice(0, laterCap);
  return { top: items[0], later, hiddenCount: rest.length - later.length };
}

export interface TapeFloor {
  /** Feet MSL. */
  feet: number;
  /** Seconds. */
  secondsAhead: number;
  label: string;
}

/** The floor the altitude tape draws: the soonest floor or boundary entry whose floor is above the surface. */
export function tapeFloor(events: readonly PredictedEvent[]): TapeFloor | null {
  const floors = events.filter((e) => e.kind !== 'ceiling' && (e.limitFeetMSL ?? 0) > 0);
  const event = floors.reduce<PredictedEvent | null>(
    (min, e) => (min && min.secondsAhead <= e.secondsAhead ? min : e),
    null,
  );
  if (event?.limitFeetMSL == null) return null;
  return { feet: event.limitFeetMSL, secondsAhead: event.secondsAhead, label: event.title };
}

/** The amber block's assumption line: "at 312deg, +300 fpm" reads "If you hold 312deg and +300 fpm". */
export function holdText(assumption: string): string {
  if (!assumption.startsWith('at ')) return assumption;
  return 'If you hold ' + assumption.slice(3).replaceAll(', ', ' and ');
}

/** "Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold track 312 and climb 300 feet per minute". */
export function spokenEvent(event: PredictedEvent): string {
  const severity = event.severity === 'warning' ? 'Warning' : 'Caution';
  return (
    `${severity}, ${spokenTitle(event.title)} in ${spokenDuration(event.secondsAhead)}, ` +
    spokenAssumption(event.assumption)
  );
}

/**
 * "B floor 3,000" is spoken "Class B floor 3,000 feet"; "CTR LLHA", "P 4", danger area "D 5" and alert area "A" as
 * written. Only B, C and D standing alone or before floor/ceiling are classes.
 */
export function spokenTitle(title: string): string {
  const words = title.split(' ');
  const limit = (word: string | undefined) => word === 'floor' || word === 'ceiling';
  if (['B', 'C', 'D'].includes(words[0]) && (words.length === 1 || limit(words[1]))) words[0] = `Class ${words[0]}`;
  if (words.length >= 3 && limit(words[words.length - 2])) words.push('feet');
  return words.join(' ');
}

/**
 * "at 312deg, +300 fpm" is spoken "if you hold track 312 and climb 300 feet per minute"; "at 312deg, level" "if you
 * hold track 312 and stay level".
 */
export function spokenAssumption(assumption: string): string {
  const parts = assumption.split(', ');
  if (parts.length !== 2 || !parts[0].startsWith('at ')) return `assuming ${assumption}`;
  const track = parts[0].slice(3).replaceAll('\u00B0', ''); // degrees true
  const rateText = parts[1].endsWith(' fpm') ? parts[1].slice(0, -4) : null; // feet per minute
  // Swift Int("+300") accepts one optional sign and ASCII digits only.
  const rate = rateText != null && /^[+-]?[0-9]+$/.test(rateText) ? Number(rateText) : null;
  let vertical: string;
  if (parts[1] === 'level') vertical = 'stay level';
  else if (rate != null) vertical = `${rate > 0 ? 'climb' : 'descend'} ${Math.abs(rate)} feet per minute`;
  else return `assuming ${assumption}`;
  return `if you hold track ${track} and ${vertical}`;
}

// MARK: AltitudeTape

/**
 * Top of the tape in feet: 4,000, or twice the altitude rounded up to 1,000 ft once above 3,500; raised so a floor sits
 * at least 500 ft below the top (the hatched airspace always shows).
 */
export function scaleTop(altitude: number | null, floor: number | null = null): number {
  let top = 4000; // feet
  if (altitude != null && altitude > 3500) top = Math.ceil((altitude * 2) / 1000) * 1000;
  if (floor != null) top = Math.max(top, Math.ceil((floor + 500) / 1000) * 1000);
  return top;
}

/** Swift `Int(x).formatted()` in en-US: "4,000". */
export const grouped = (value: number): string => Math.trunc(value).toLocaleString('en-US');
