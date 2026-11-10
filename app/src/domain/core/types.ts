// Navigation vocabulary shared by state and UI (port of Core/Types.swift StripColumn).

/** What the strip column beside the chart shows. The flight log by default. */
export type StripColumnKind = 'log' | 'airport' | 'nearest' | 'layers' | 'search';

/** Base map style (port of MapStyle). */
export const MAP_STYLES = ['vfrSectional', 'street'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/** Toggleable map layers (port of MapLayer). */
export const MAP_LAYERS = [
  'sectional',
  'airports',
  'airspace',
  'tfrs',
  'advisories',
  'weatherDots',
  'navaids',
  'route',
  'ownship',
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
  'lsaRoutes',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export const CVFR_CHART_LAYERS: readonly MapLayer[] = [
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
];

export const isCvfrChartLayer = (layer: MapLayer): boolean => CVFR_CHART_LAYERS.includes(layer);

// ---- Port of the rest of Core/Types.swift. String values equal the Swift raw values (they are persisted). ----

export const APP_SCREENS = ['map', 'log'] as const;
export type AppScreen = (typeof APP_SCREENS)[number];

export const MAP_MODES = ['northUp', 'trackUp'] as const;
export type MapMode = (typeof MAP_MODES)[number];

export const POWER_STATES = ['normal', 'batteryConscious', 'emergency'] as const;
export type PowerState = (typeof POWER_STATES)[number];

const POWER: Record<PowerState, { gpsUpdateInterval: number; mapTargetFps: number; weatherRefreshInterval: number }> = {
  normal: { gpsUpdateInterval: 1, mapTargetFps: 60, weatherRefreshInterval: 900 },
  batteryConscious: { gpsUpdateInterval: 3, mapTargetFps: 30, weatherRefreshInterval: 1800 },
  emergency: { gpsUpdateInterval: 5, mapTargetFps: 15, weatherRefreshInterval: Infinity },
};
/** Seconds between GPS updates. */
export const gpsUpdateInterval = (p: PowerState): number => POWER[p].gpsUpdateInterval;
export const mapTargetFps = (p: PowerState): number => POWER[p].mapTargetFps;
/** Seconds between weather refreshes; Infinity in emergency (no refresh). */
export const weatherRefreshInterval = (p: PowerState): number => POWER[p].weatherRefreshInterval;

export const AIRPORT_TYPES = ['airport', 'heliport', 'seaplane', 'ultralight'] as const;
export type AirportType = (typeof AIRPORT_TYPES)[number];

/** Swift cases publicOwned/privateOwned persist as "public"/"private". */
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

export const TFR_TYPES = [
  'SECURITY',
  'VIP',
  'HAZARDS',
  'AIR SHOWS/SPORTS',
  'SPACE OPERATIONS',
  'UAS PUBLIC GATHERING',
  'SPECIAL',
  'OTHER',
] as const;
export type TfrType = (typeof TFR_TYPES)[number];

/** TFRType(faaType:): trim, uppercase, unknown values read as OTHER. */
export function tfrTypeFromFaa(faaType: string): TfrType {
  const normalized = faaType.trim().toUpperCase();
  return (TFR_TYPES as readonly string[]).includes(normalized) ? (normalized as TfrType) : 'OTHER';
}

const TFR_NAMES: Record<TfrType, string> = {
  SECURITY: 'Security',
  VIP: 'VIP',
  HAZARDS: 'Hazards',
  'AIR SHOWS/SPORTS': 'Air Show / Sports',
  'SPACE OPERATIONS': 'Space Operations',
  'UAS PUBLIC GATHERING': 'UAS Public Gathering',
  SPECIAL: 'Special',
  OTHER: 'Other',
};
export const tfrTypeDisplayName = (t: TfrType): string => TFR_NAMES[t];

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

export const FLIGHT_CATEGORIES = ['vfr', 'mvfr', 'ifr', 'lifr'] as const;
export type FlightCategory = (typeof FLIGHT_CATEGORIES)[number];

const CATEGORY_COLORS: Record<FlightCategory, string> = { vfr: 'green', mvfr: 'blue', ifr: 'red', lifr: 'magenta' };
export const flightCategoryColorName = (c: FlightCategory): string => CATEGORY_COLORS[c];

export const WAYPOINT_TYPES = ['airport', 'navaid', 'fix', 'userWaypoint', 'latLon'] as const;
export type WaypointType = (typeof WAYPOINT_TYPES)[number];

export interface WindInfo {
  direction: number;
  speed: number;
  gusts: number | null;
  isVariable: boolean;
}

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export function boundingBoxContains(box: BoundingBox, c: { lat: number; lon: number }): boolean {
  return c.lat >= box.minLatitude && c.lat <= box.maxLatitude && c.lon >= box.minLongitude && c.lon <= box.maxLongitude;
}

export interface VSpeeds {
  vr?: number | null;
  vx?: number | null;
  vy?: number | null;
  va?: number | null;
  vne?: number | null;
  vfe?: number | null;
  vs0?: number | null;
  vs1?: number | null;
}

export const MEDICAL_CLASSES = ['first', 'second', 'third', 'basicMed'] as const;
export type MedicalClass = (typeof MEDICAL_CLASSES)[number];

/** Swift privatePilot persists as "private". */
export const CERTIFICATE_TYPES = ['student', 'sport', 'recreational', 'private', 'commercial', 'atp'] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CURRENCY_STATUSES = ['current', 'warning', 'expired'] as const;
export type CurrencyStatus = (typeof CURRENCY_STATUSES)[number];

export type RecordingStatus =
  | { kind: 'idle' }
  | { kind: 'countdown'; remaining: number }
  | { kind: 'recording' }
  | { kind: 'paused' }
  | { kind: 'stopping' };

export const FLIGHT_PHASE_TYPES = [
  'preflight',
  'taxi',
  'takeoff',
  'departure',
  'cruise',
  'approach',
  'landing',
  'postflight',
] as const;
export type FlightPhaseType = (typeof FLIGHT_PHASE_TYPES)[number];

export const AUDIO_QUALITY_PROFILES = ['standard', 'high'] as const;
export type AudioQualityProfile = (typeof AUDIO_QUALITY_PROFILES)[number];

const AUDIO: Record<AudioQualityProfile, { sampleRate: number; bitRate: number; estimatedMBPerHour: number }> = {
  standard: { sampleRate: 16_000, bitRate: 32_000, estimatedMBPerHour: 14 },
  high: { sampleRate: 22_050, bitRate: 64_000, estimatedMBPerHour: 28 },
};
export const audioSampleRate = (p: AudioQualityProfile): number => AUDIO[p].sampleRate;
export const audioBitRate = (p: AudioQualityProfile): number => AUDIO[p].bitRate;
export const audioEstimatedMBPerHour = (p: AudioQualityProfile): number => AUDIO[p].estimatedMBPerHour;

/** Swift's synthesized Codable shape for this enum is a data-layer concern and is not reproduced here. */
export type InterruptionGapReason =
  { kind: 'phoneCall' } | { kind: 'siri' } | { kind: 'headphoneDisconnect' } | { kind: 'other'; description: string };

/** Polygon rings are [lat, lon] pairs; circle center is [lat, lon]. */
export type AirspaceGeometry =
  { kind: 'polygon'; coordinates: number[][] } | { kind: 'circle'; center: number[]; radiusNM: number };

/**
 * Decode the Swift JSON form: `{coordinates}` (polygon) or `{center, radiusNM}` (circle).
 * Throws on anything else ("Invalid AirspaceGeometry").
 */
export function decodeAirspaceGeometry(json: unknown): AirspaceGeometry {
  const o = (json ?? {}) as { coordinates?: unknown; center?: unknown; radiusNM?: unknown };
  if (o.coordinates !== undefined && o.coordinates !== null)
    return { kind: 'polygon', coordinates: o.coordinates as number[][] };
  if (o.center != null && o.radiusNM != null)
    return { kind: 'circle', center: o.center as number[], radiusNM: o.radiusNM as number };
  throw new Error('Invalid AirspaceGeometry');
}

export function encodeAirspaceGeometry(g: AirspaceGeometry): Record<string, unknown> {
  return g.kind === 'polygon' ? { coordinates: g.coordinates } : { center: g.center, radiusNM: g.radiusNM };
}
