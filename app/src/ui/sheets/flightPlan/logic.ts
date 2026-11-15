// The pure steps of ViewModels/FlightPlanViewModel.swift (the US flight planner) and the text its two views show
// (Views/Planning/FlightPlanView.swift, Views/Planning/FlightPlanSummaryCard.swift). The store (store.ts) holds the state
// and the async sequencing; everything here is plain values in, plain values out.
//
// The US plan is direct: one departure, one destination, a great-circle line between them. Distance, ETE and fuel come
// from the active aircraft profile (100 kt and no fuel without one).
import { newFlightPlanRecord, type Factory } from '../../../data/defaults';
import type { AircraftProfile, FlightPlanRecord } from '../../../data/models';
import { bearingDeg, distanceNm, type Airport, type Coordinate } from '../../../domain/core';
import type { ActiveNavigation } from '../../../domain/route/navigation';

// MARK: - Search

/** Characters a query needs before it searches (`departureQuery.count >= 2`). */
export const SEARCH_MIN_CHARACTERS = 2;
/** Results per airport field (`searchAirports(query:limit: 10)`). */
export const SEARCH_LIMIT = 10;

/**
 * The query to search with, or null when it is too short (the field's results are then emptied). Swift counts
 * characters, not UTF-16 units, and does not trim: "K " searches.
 */
export const searchableQuery = (query: string): string | null =>
  [...query].length >= SEARCH_MIN_CHARACTERS ? query : null;

// MARK: - Route math

/** TAS in knots when there is no active aircraft or it has no positive cruise speed. */
export const DEFAULT_CRUISE_SPEED_KTS = 100;

/** The active aircraft: the profile marked active (`#Predicate { $0.isActive == true }`, first match), else none. */
export const activeAircraft = (aircraft: readonly AircraftProfile[]): AircraftProfile | null =>
  aircraft.find((a) => a.isActive) ?? null;

/** Cruise speed for the plan: the aircraft's when positive, else 100 kt. */
export function cruiseSpeedKts(aircraft: AircraftProfile | null): number {
  const speed = aircraft?.cruiseSpeedKts;
  return speed != null && speed > 0 ? speed : DEFAULT_CRUISE_SPEED_KTS;
}

export interface RouteEstimate {
  /** Great-circle distance, nautical miles. */
  distanceNM: number;
  /** Seconds at the cruise speed. */
  estimatedTimeSeconds: number;
  /** US gallons; null without a positive fuel burn. */
  estimatedFuelGallons: number | null;
}

/** calculateAndDrawRoute's numbers: distance, ETE at the cruise speed, fuel from the aircraft's burn rate. */
export function routeEstimate(
  departure: Airport,
  destination: Airport,
  aircraft: AircraftProfile | null,
): RouteEstimate {
  const distance = distanceNm(airportCoordinate(departure), airportCoordinate(destination));
  const speed = cruiseSpeedKts(aircraft);
  const hours = distance / speed;
  const burn = aircraft?.fuelBurnGPH;
  return {
    distanceNM: distance,
    estimatedTimeSeconds: hours * 3600,
    estimatedFuelGallons: burn != null && burn > 0 ? hours * burn : null,
  };
}

export const airportCoordinate = (a: Pick<Airport, 'latitude' | 'longitude'>): Coordinate => ({
  lat: a.latitude,
  lon: a.longitude,
});

/** `formattedETE`: "h:mm", whole minutes truncated (59 s is 0:00, 7500 s is 2:05). */
export function formattedETE(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
  const hours = Math.trunc(whole / 3600);
  const minutes = Math.trunc((whole % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

// MARK: - Navigation (AppState)

export interface PublishedPlan extends RouteEstimate {
  departure: Airport;
  destination: Airport;
}

/**
 * What calculateAndDrawRoute writes into AppState: the plan is flown (it replaces a Direct-To and any multi-leg route
 * left from Israel), with its distance, ETE, true bearing departure to destination, ends and fuel.
 */
export function publishPlan(nav: ActiveNavigation, plan: PublishedPlan): ActiveNavigation {
  const from = airportCoordinate(plan.departure);
  const to = airportCoordinate(plan.destination);
  return {
    ...nav,
    activeFlightPlan: true,
    directTo: null,
    activeRoute: null,
    distanceToNext: plan.distanceNM,
    estimatedTimeEnroute: plan.estimatedTimeSeconds,
    bearingToNext: bearingDeg(from, to),
    planDeparture: plan.departure.icao,
    planDestination: plan.destination.icao,
    planDestinationCoordinate: to,
    planFuelGallons: plan.estimatedFuelGallons,
  };
}

/**
 * clearPlan's AppState part: the plan's ends and fuel go. A Direct-To being flown is not the plan's, so it keeps its
 * navigation flag and live DTG, ETE and bearing.
 */
export function withdrawPlan(nav: ActiveNavigation): ActiveNavigation {
  const keepsDirectTo = nav.directTo !== null;
  return {
    ...nav,
    ...(keepsDirectTo
      ? {}
      : { activeFlightPlan: false, distanceToNext: null, estimatedTimeEnroute: null, bearingToNext: null }),
    planDeparture: null,
    planDestination: null,
    planDestinationCoordinate: null,
    planFuelGallons: null,
  };
}

/**
 * The automatic restore when the planner opens (`replacesDirectTo: false`) fills the planner only while a Direct-To is
 * flown: no route line, no camera move, the Direct-To's live numbers stay.
 */
export const publishesRoute = (replacesDirectTo: boolean, nav: ActiveNavigation): boolean =>
  replacesDirectTo || nav.directTo === null;

// MARK: - Map

/** The camera fit around the route: the two ends with half a degree of margin on every side. */
export interface RouteBounds {
  sw: Coordinate;
  ne: Coordinate;
}

/** Degrees added around the route ends when the map zooms to the plan. */
export const ROUTE_BOUNDS_MARGIN_DEG = 0.5;
/** Edge padding of the camera fit, points (UIEdgeInsets 80 on every side). */
export const ROUTE_EDGE_PADDING = 80;

export function routeBounds(departure: Airport, destination: Airport): RouteBounds {
  const m = ROUTE_BOUNDS_MARGIN_DEG;
  return {
    sw: {
      lat: Math.min(departure.latitude, destination.latitude) - m,
      lon: Math.min(departure.longitude, destination.longitude) - m,
    },
    ne: {
      lat: Math.max(departure.latitude, destination.latitude) + m,
      lon: Math.max(departure.longitude, destination.longitude) + m,
    },
  };
}

// MARK: - Persistence

/**
 * savePlan's record: both ends, the numbers, and the cruise speed recovered from distance and ETE (100 kt for a zero
 * distance). Created and last used now.
 */
export function planRecord(plan: PublishedPlan, factory: Factory = {}): FlightPlanRecord {
  const { departure: dep, destination: dest } = plan;
  return newFlightPlanRecord({
    ...factory,
    departureICAO: dep.icao,
    departureName: dep.name,
    departureLatitude: dep.latitude,
    departureLongitude: dep.longitude,
    destinationICAO: dest.icao,
    destinationName: dest.name,
    destinationLatitude: dest.latitude,
    destinationLongitude: dest.longitude,
    cruiseSpeedKts:
      plan.distanceNM > 0 ? plan.distanceNM / (plan.estimatedTimeSeconds / 3600) : DEFAULT_CRUISE_SPEED_KTS,
    totalDistanceNM: plan.distanceNM,
    estimatedTimeSeconds: plan.estimatedTimeSeconds,
    estimatedFuelGallons: plan.estimatedFuelGallons,
  });
}

/** `loadSavedPlans` order: most recently used first; equal times keep their order. */
export const byLastUsed = (plans: readonly FlightPlanRecord[]): FlightPlanRecord[] =>
  [...plans].sort((a, b) => b.lastUsedAt - a.lastUsedAt);

// MARK: - Display text

/** `String(format: "%.1f", value)`. */
export const oneDecimal = (value: number): string => value.toFixed(1);

export interface SummaryMetric {
  /** Accessibility label of the metric (the cell is one element). */
  label: string;
  /** The big number. */
  value: string;
  /** The caption under it. */
  unit: string;
  /** What VoiceOver reads after the label. */
  accessibilityValue: string;
}

export interface SummaryCardInput {
  distanceNM: number;
  /** Pre-formatted "h:mm". */
  ete: string;
  /** Gallons; null without an aircraft fuel burn, and the fuel cell is left out. */
  fuelGallons: number | null;
}

/** FlightPlanSummaryCard's metric row: distance, ETE and (with a fuel estimate) fuel. */
export function summaryMetrics({ distanceNM, ete, fuelGallons }: SummaryCardInput): SummaryMetric[] {
  const distance = oneDecimal(distanceNM);
  const metrics: SummaryMetric[] = [
    { label: 'Distance', value: distance, unit: 'nm', accessibilityValue: `${distance} nautical miles` },
    { label: 'Estimated time en route', value: ete, unit: 'ETE', accessibilityValue: ete },
  ];
  if (fuelGallons !== null) {
    const fuel = oneDecimal(fuelGallons);
    metrics.push({ label: 'Fuel', value: fuel, unit: 'gal', accessibilityValue: `${fuel} gallons` });
  }
  return metrics;
}

/** The card header's accessibility label. */
export const routeLabel = (departure: string, destination: string): string => `Route ${departure} to ${destination}`;

/** The saved plan row's distance: "%.1f nm". */
export const savedPlanDistanceText = (record: Pick<FlightPlanRecord, 'totalDistanceNM'>): string =>
  `${oneDecimal(record.totalDistanceNM)} nm`;

const RELATIVE_UNITS: readonly { seconds: number; one: string; many: string }[] = [
  { seconds: 86_400, one: 'day', many: 'days' },
  { seconds: 3600, one: 'hour', many: 'hours' },
  { seconds: 60, one: 'minute', many: 'minutes' },
  { seconds: 1, one: 'second', many: 'seconds' },
];

/**
 * `Text(date, style: .relative)`: the time between the date and now in its two largest units, without "ago"
 * ("2 hours, 5 minutes", "45 seconds"). Days are the largest unit here (SwiftUI moves on to weeks, months and years).
 */
export function relativeText(dateMs: number, nowMs: number): string {
  let remaining = Math.floor(Math.abs(nowMs - dateMs) / 1000);
  const counts = RELATIVE_UNITS.map((unit) => {
    const count = Math.floor(remaining / unit.seconds);
    remaining -= count * unit.seconds;
    return count;
  });
  const text = (i: number) => `${counts[i]} ${counts[i] === 1 ? RELATIVE_UNITS[i].one : RELATIVE_UNITS[i].many}`;
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return '0 seconds';
  // The unit after the largest only when it is not zero: "2 hours", not "2 hours, 0 minutes".
  return first + 1 < counts.length && counts[first + 1] > 0 ? `${text(first)}, ${text(first + 1)}` : text(first);
}

/** The saved plan row as one accessibility element: "KPAO to KSQL, 7.0 nm, 2 hours", plus ", active plan". */
export function savedPlanAccessibilityLabel(record: FlightPlanRecord, nowMs: number, isActive: boolean): string {
  const base = `${record.departureICAO} to ${record.destinationICAO}, ${savedPlanDistanceText(record)}, ${relativeText(
    record.lastUsedAt,
    nowMs,
  )}`;
  return isActive ? `${base}, Active plan` : base;
}

export const EMPTY_SAVED_PLANS_TITLE = 'No saved plans';
export const EMPTY_SAVED_PLANS_DESCRIPTION = 'Pick a departure and destination above, then Save Plan.';
export const AIRPORT_SEARCH_PLACEHOLDER = 'Search airport (ICAO, name, city)';
