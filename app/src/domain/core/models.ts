// Port of Core/AviationModels.swift. Field names match the Swift structs (and the aviation DB columns).
// Dates are epoch ms, durations seconds, UUIDs plain strings (callers supply ids; the domain generates none).
import type { Coordinate } from './geometry';
import { ringCentroid } from './polygon';
import type {
  AirportType,
  AirspaceClass,
  AirspaceGeometry,
  BoundingBox,
  FlightCategory,
  FrequencyType,
  LightingType,
  NavaidType,
  OwnershipType,
  SurfaceType,
  TfrType,
  WaypointType,
} from './types';

export interface Frequency {
  id: string;
  type: FrequencyType;
  frequency: number;
  name: string;
}

export interface Runway {
  id: string;
  length: number; // feet
  width: number; // feet
  surface: SurfaceType;
  lighting: LightingType;
  baseEndID: string;
  reciprocalEndID: string;
  baseEndLatitude: number;
  baseEndLongitude: number;
  reciprocalEndLatitude: number;
  reciprocalEndLongitude: number;
  baseEndElevation?: number | null;
  reciprocalEndElevation?: number | null;
}

export interface Airport {
  icao: string; // identity
  faaID?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number; // feet
  type: AirportType;
  ownership: OwnershipType;
  ctafFrequency?: number | null;
  unicomFrequency?: number | null;
  artccID?: string | null;
  fssID?: string | null;
  magneticVariation?: number | null;
  patternAltitude?: number | null;
  fuelTypes: string[];
  hasBeaconLight: boolean;
  runways: Runway[];
  frequencies: Frequency[];
}

/** Swift defaults for the optional/collection fields of Airport.init. */
export function makeAirport(
  a: Pick<Airport, 'icao' | 'name' | 'latitude' | 'longitude' | 'elevation' | 'type' | 'ownership'> & Partial<Airport>,
): Airport {
  return { fuelTypes: [], hasBeaconLight: false, runways: [], frequencies: [], ...a };
}

export const airportCoordinate = (a: { latitude: number; longitude: number }): Coordinate => ({
  lat: a.latitude,
  lon: a.longitude,
});

/** Airport equality is by ICAO only (Swift == and hash). */
export const airportsEqual = (a: Airport, b: Airport): boolean => a.icao === b.icao;

export interface AviationDataCycle {
  source: string;
  effective: number;
  expires: number;
}

export const cycleIsExpired = (c: AviationDataCycle, nowMs: number): boolean => nowMs >= c.expires;

export interface Navaid {
  id: string;
  name: string;
  type: NavaidType;
  latitude: number;
  longitude: number;
  frequency: number;
  magneticVariation?: number | null;
  elevation?: number | null;
}

export interface Airspace {
  id: string;
  classification: AirspaceClass;
  name: string;
  floor: number;
  ceiling: number;
  geometry: AirspaceGeometry;
}

export type TfrAltitudeReference = 'msl' | 'agl' | 'flightLevel';

export interface TfrAltitude {
  value: number;
  reference: TfrAltitudeReference;
}

export const tfrAltitudeFeet = (a: TfrAltitude): number => (a.reference === 'flightLevel' ? a.value * 100 : a.value);

export function tfrAltitudeDisplay(a: TfrAltitude): string {
  switch (a.reference) {
    case 'flightLevel':
      return `FL${String(a.value).padStart(3, '0')}`;
    case 'agl':
      return a.value === 0 ? 'SFC' : `${a.value}' AGL`;
    case 'msl':
      return a.value === 0 ? 'SFC' : `${a.value}' MSL`;
  }
}

export interface Tfr {
  id: string;
  notamID: string;
  type: TfrType;
  title: string;
  state?: string | null;
  facility?: string | null;
  effectiveDate?: number | null;
  expirationDate?: number | null;
  boundaries: number[][]; // [lat, lon] ring
  floor?: TfrAltitude | null;
  ceiling?: TfrAltitude | null;
  lastModified?: number | null;
}

export function tfrIsActive(t: Tfr, atMs: number): boolean {
  if (t.effectiveDate != null && atMs < t.effectiveDate) return false;
  if (t.expirationDate != null && atMs > t.expirationDate) return false;
  return true;
}

/** Ring centroid, or 0,0 for an empty ring. */
export const tfrCoordinate = (t: Tfr): Coordinate => ringCentroid(t.boundaries) ?? { lat: 0, lon: 0 };

export function tfrAltitudeDescription(t: Tfr): string {
  if (!t.floor || !t.ceiling) return 'See NOTAM';
  return `${tfrAltitudeDisplay(t.floor)}-${tfrAltitudeDisplay(t.ceiling)}`;
}

export const tfrDetailUrl = (t: Tfr): string =>
  `https://tfr.faa.gov/tfr3/?page=detail_${t.notamID.replaceAll('/', '_')}`;

export interface Waypoint {
  id: string;
  identifier: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  type: WaypointType;
}

export const waypointCoordinate = (w: Waypoint): Coordinate => ({ lat: w.latitude, lon: w.longitude });

export interface FlightPlan {
  id: string;
  name?: string | null;
  departure: string;
  destination: string;
  waypoints: Waypoint[];
  cruiseAltitude: number;
  cruiseSpeed: number;
  fuelBurnRate?: number | null;
  totalDistance: number;
  estimatedTime: number; // seconds
  estimatedFuel?: number | null;
  createdAt: number;
  notes?: string | null;
}

/** Swift FlightPlan.init defaults; `id` and `createdAt` must be supplied. */
export function makeFlightPlan(
  p: Pick<FlightPlan, 'id' | 'departure' | 'destination' | 'createdAt'> & Partial<FlightPlan>,
): FlightPlan {
  return { waypoints: [], cruiseAltitude: 3000, cruiseSpeed: 100, totalDistance: 0, estimatedTime: 0, ...p };
}

export function makeWaypoint(
  w: Pick<Waypoint, 'id' | 'identifier' | 'name' | 'latitude' | 'longitude'> & Partial<Waypoint>,
): Waypoint {
  return { type: 'airport', ...w };
}

export interface WeatherCache {
  id: string;
  stationID: string;
  rawMETAR?: string | null;
  rawTAF?: string | null;
  temperature?: number | null;
  dewpoint?: number | null;
  windDirection?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  visibility?: string | null;
  ceiling?: number | null;
  altimeterHPa?: number | null;
  flightCategory: FlightCategory;
  observationTime?: number | null;
  fetchedAt: number;
}

export const weatherCacheAge = (w: WeatherCache, nowMs: number): number => (nowMs - w.fetchedAt) / 1000;
export const weatherCacheIsStale = (w: WeatherCache, nowMs: number): boolean => weatherCacheAge(w, nowMs) > 3600;

export function makeWeatherCache(
  w: Pick<WeatherCache, 'id' | 'stationID' | 'fetchedAt'> & Partial<WeatherCache>,
): WeatherCache {
  return { flightCategory: 'vfr', ...w };
}

export interface ChartRegion {
  id: string;
  name: string;
  effectiveDate: number;
  expirationDate: number;
  boundingBox: BoundingBox;
  fileSizeMB: number;
  isDownloaded: boolean;
  localPath?: string | null;
}

export const chartRegionIsExpired = (c: ChartRegion, nowMs: number): boolean => c.expirationDate < nowMs;
