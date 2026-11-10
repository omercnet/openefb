// Plain-object ports of the six SwiftData models (efb-212/Data/Models). Dates are epoch ms, ids are UUID text.

export interface VSpeeds {
  vr: number | null;
  vx: number | null;
  vy: number | null;
  va: number | null;
  vne: number | null;
  vfe: number | null;
  vs0: number | null;
  vs1: number | null;
}
export interface NightLandingEntry {
  date: number;
  count: number;
}
export type MedicalClass = 'first' | 'second' | 'third' | 'basicMed';
export type CertificateType = 'student' | 'sport' | 'recreational' | 'private' | 'commercial' | 'atp';
export type Region = 'us' | 'israel';

export const MEDICAL_CLASSES: readonly MedicalClass[] = ['first', 'second', 'third', 'basicMed'];
export const CERTIFICATE_TYPES: readonly CertificateType[] = [
  'student',
  'sport',
  'recreational',
  'private',
  'commercial',
  'atp',
];
export const REGIONS: readonly Region[] = ['us', 'israel'];
/** Region.defaultRegion (IL-DEFAULT: a fresh record starts in Israel). */
export const DEFAULT_REGION: Region = 'israel';

export interface UserSettings {
  id: number;
  defaultMapMode: string;
  sectionalOpacity: number;
  weatherRefreshInterval: number;
  activeAircraftID: string | null;
  activePilotID: string | null;
  lastFlightPlanID: string | null;
  regionRaw: string;
  createdAt: number;
}

export interface AircraftProfile {
  id: string;
  nNumber: string;
  aircraftType: string;
  fuelCapacityGallons: number | null;
  fuelBurnGPH: number | null;
  cruiseSpeedKts: number | null;
  icaoTypeDesignator: string | null;
  personsOnBoard: number | null;
  vSpeeds: VSpeeds | null;
  isActive: boolean;
  annualDue: number | null;
  transponderDue: number | null;
  createdAt: number;
}

export interface PilotProfile {
  id: string;
  name: string;
  certificateNumber: string | null;
  phone: string | null;
  email: string | null;
  certificateType: string | null;
  medicalClass: string | null;
  medicalExpiry: number | null;
  flightReviewDate: number | null;
  totalHours: number | null;
  isActive: boolean;
  nightLandingEntries: NightLandingEntry[];
  createdAt: number;
}

export interface FlightPlanRecord {
  id: string;
  name: string | null;
  departureICAO: string;
  departureName: string;
  departureLatitude: number;
  departureLongitude: number;
  destinationICAO: string;
  destinationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  cruiseAltitude: number;
  cruiseSpeedKts: number;
  fuelBurnGPH: number | null;
  totalDistanceNM: number;
  estimatedTimeSeconds: number;
  estimatedFuelGallons: number | null;
  notes: string | null;
  lastUsedAt: number;
  createdAt: number;
}

export interface FlightRecord {
  id: string;
  startDate: number;
  endDate: number | null;
  departureICAO: string | null;
  arrivalICAO: string | null;
  departureName: string | null;
  arrivalName: string | null;
  durationSeconds: number;
  audioFileURL: string | null;
  audioQuality: string;
  trackPointCount: number;
  transcriptSegmentCount: number;
  aircraftProfileID: string | null;
  pilotProfileID: string | null;
  hasDebrief: boolean;
  notes: string | null;
  createdAt: number;
}

export interface LogbookEntry {
  id: string;
  flightID: string | null;
  date: number;
  departureICAO: string | null;
  departureName: string | null;
  arrivalICAO: string | null;
  arrivalName: string | null;
  route: string | null;
  durationSeconds: number;
  aircraftProfileID: string | null;
  aircraftType: string | null;
  pilotProfileID: string | null;
  nightLandingCount: number;
  dayLandingCount: number;
  notes: string | null;
  isConfirmed: boolean;
  hasDebrief: boolean;
  createdAt: number;
}

// Computed properties from the Swift models.

/** AircraftProfile.isValid */
export const isAircraftValid = (a: Pick<AircraftProfile, 'nNumber'>): boolean => a.nNumber.length > 0;

/** PilotProfile.medicalClassEnum getter: nil for an unknown raw value. */
export const medicalClassOf = (p: Pick<PilotProfile, 'medicalClass'>): MedicalClass | null =>
  MEDICAL_CLASSES.find((m) => m === p.medicalClass) ?? null;

/** PilotProfile.certificateTypeEnum getter: nil for an unknown raw value. */
export const certificateTypeOf = (p: Pick<PilotProfile, 'certificateType'>): CertificateType | null =>
  CERTIFICATE_TYPES.find((c) => c === p.certificateType) ?? null;

/** UserSettings.region getter: unknown raw values read as the default; the stored value is not repaired. */
export const regionOf = (s: Pick<UserSettings, 'regionRaw'>): Region =>
  REGIONS.find((r) => r === s.regionRaw) ?? DEFAULT_REGION;

export const TRACK_UNREADABLE_NOTE =
  'Track could not be read. The flight and its audio were kept; try again after restarting the app.';
export const RECOVERED_NOTE =
  'Recovered: the app closed while this flight was recording. The track and audio were kept.';

export const isTrackUnreadable = (f: Pick<FlightRecord, 'notes'>): boolean =>
  f.notes?.startsWith(TRACK_UNREADABLE_NOTE) === true;
export const isRecovered = (f: Pick<FlightRecord, 'notes'>): boolean => f.notes?.startsWith(RECOVERED_NOTE) === true;
/** FlightRecord.healthWarning */
export const healthWarning = (f: Pick<FlightRecord, 'notes'>): string | null =>
  isTrackUnreadable(f) ? 'Track damaged' : isRecovered(f) ? 'Recovered' : null;
