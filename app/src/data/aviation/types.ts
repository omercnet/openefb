// Models returned by the aviation database access layer. Port of the aviation parts of Core/AviationModels.swift and the
// enums in Core/Types.swift, trimmed to what the queries produce. The domain track (L1) owns the canonical copies; until
// those land on main these live here, and the field names and raw values match the Swift ones so a later switch is a
// type-import change. Coordinates in degrees, elevations and altitudes in feet MSL, distances in nautical miles,
// frequencies in MHz.

export const AIRPORT_TYPES = ['airport', 'heliport', 'seaplane', 'ultralight'] as const;
export type AirportType = (typeof AIRPORT_TYPES)[number];

export const OWNERSHIP_TYPES = ['public', 'private', 'military'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const SURFACE_TYPES = ['asphalt', 'concrete', 'turf', 'gravel', 'water', 'dirt', 'other'] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const LIGHTING_TYPES = ['none', 'partTime', 'fullTime'] as const;
export type LightingType = (typeof LIGHTING_TYPES)[number];

export const FREQUENCY_TYPES = [
  'ctaf',
  'tower',
  'ground',
  'clearance',
  'approach',
  'departure',
  'atis',
  'awos',
  'asos',
  'unicom',
  'multicom',
  'center',
  'fss',
  'other',
] as const;
export type FrequencyType = (typeof FREQUENCY_TYPES)[number];

export const NAVAID_TYPES = ['vor', 'vortac', 'vor_dme', 'tacan', 'dme', 'ndb', 'ndb_dme'] as const;
export type NavaidType = (typeof NAVAID_TYPES)[number];

export const AIRSPACE_CLASSES = [
  'bravo',
  'charlie',
  'delta',
  'echo',
  'golf',
  'prohibited',
  'restricted',
  'moa',
  'alert',
  'warning',
  'tfr',
] as const;
export type AirspaceClass = (typeof AIRSPACE_CLASSES)[number];

export interface Runway {
  /** e.g. "13/31" */
  id: string;
  /** feet */
  length: number;
  /** feet */
  width: number;
  surface: SurfaceType;
  lighting: LightingType;
  baseEndID: string;
  reciprocalEndID: string;
  baseEndLatitude: number;
  baseEndLongitude: number;
  reciprocalEndLatitude: number;
  reciprocalEndLongitude: number;
  /** TDZE, feet MSL. The bundled database does not carry it, so queries always leave it null. */
  baseEndElevation: number | null;
  reciprocalEndElevation: number | null;
}

export interface Frequency {
  /** UUID string, upper case like Swift's UUID.uuidString. */
  id: string;
  type: FrequencyType;
  /** MHz */
  frequency: number;
  name: string;
}

export interface Airport {
  icao: string;
  faaID: string | null;
  name: string;
  latitude: number;
  longitude: number;
  /** feet MSL */
  elevation: number;
  type: AirportType;
  ownership: OwnershipType;
  ctafFrequency: number | null;
  unicomFrequency: number | null;
  artccID: string | null;
  fssID: string | null;
  /** degrees, east positive */
  magneticVariation: number | null;
  /** feet AGL */
  patternAltitude: number | null;
  fuelTypes: string[];
  hasBeaconLight: boolean;
  runways: Runway[];
  frequencies: Frequency[];
}

export interface Navaid {
  id: string;
  name: string;
  type: NavaidType;
  latitude: number;
  longitude: number;
  frequency: number;
  magneticVariation: number | null;
  /** feet MSL */
  elevation: number | null;
}

/** Circle centre and polygon vertices are [latitude, longitude] pairs, as stored in the database. */
export type AirspaceGeometry =
  { kind: 'circle'; center: [number, number]; radiusNM: number } | { kind: 'polygon'; coordinates: number[][] };

export interface Airspace {
  /** UUID string, upper case. */
  id: string;
  classification: AirspaceClass;
  name: string;
  /** feet MSL */
  floor: number;
  /** feet MSL */
  ceiling: number;
  geometry: AirspaceGeometry;
}

/** NASR cycle of the bundled data. Dates are epoch milliseconds at 00:00 UTC. */
export interface AviationDataCycle {
  source: string;
  effectiveMs: number;
  expiresMs: number;
}

/** Swift's `Enum(rawValue:) ?? fallback`: unknown database values never fail a query. */
export function parseEnum<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
