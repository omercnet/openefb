// Property defaults of the Swift @Model initialisers. Id and clock are injectable so tests are deterministic.
import { systemClock, uuidv4, type Clock, type IdGenerator } from './ids';
import type {
  AircraftProfile,
  FlightPlanRecord,
  FlightRecord,
  LogbookEntry,
  PilotProfile,
  UserSettings,
} from './models';

export interface Factory {
  now?: Clock;
  newId?: IdGenerator;
}

export function newUserSettings(o: Partial<UserSettings> & Factory = {}): UserSettings {
  const { now = systemClock, newId: _newId, ...rest } = o;
  return {
    id: 0,
    defaultMapMode: 'northUp',
    sectionalOpacity: 0.7,
    weatherRefreshInterval: 900,
    activeAircraftID: null,
    activePilotID: null,
    lastFlightPlanID: null,
    regionRaw: 'israel',
    createdAt: now(),
    ...rest,
  };
}

export function newAircraftProfile(nNumber: string, o: Partial<AircraftProfile> & Factory = {}): AircraftProfile {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return {
    id: newId(),
    nNumber,
    aircraftType: '',
    fuelCapacityGallons: null,
    fuelBurnGPH: null,
    cruiseSpeedKts: null,
    icaoTypeDesignator: null,
    personsOnBoard: null,
    vSpeeds: null,
    isActive: false,
    annualDue: null,
    transponderDue: null,
    createdAt: now(),
    ...rest,
  };
}

export function newPilotProfile(o: Partial<PilotProfile> & Factory = {}): PilotProfile {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return {
    id: newId(),
    name: '',
    certificateNumber: null,
    phone: null,
    email: null,
    certificateType: null,
    medicalClass: null,
    medicalExpiry: null,
    flightReviewDate: null,
    totalHours: null,
    isActive: false,
    nightLandingEntries: [],
    createdAt: now(),
    ...rest,
  };
}

export function newFlightPlanRecord(o: Partial<FlightPlanRecord> & Factory = {}): FlightPlanRecord {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  const t = now();
  return {
    id: newId(),
    name: null,
    departureICAO: '',
    departureName: '',
    departureLatitude: 0,
    departureLongitude: 0,
    destinationICAO: '',
    destinationName: '',
    destinationLatitude: 0,
    destinationLongitude: 0,
    cruiseAltitude: 3000,
    cruiseSpeedKts: 100,
    fuelBurnGPH: null,
    totalDistanceNM: 0,
    estimatedTimeSeconds: 0,
    estimatedFuelGallons: null,
    notes: null,
    lastUsedAt: t,
    createdAt: t,
    ...rest,
  };
}

export function newFlightRecord(o: Partial<FlightRecord> & Factory = {}): FlightRecord {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  const t = now();
  return {
    id: newId(),
    startDate: t,
    endDate: null,
    departureICAO: null,
    arrivalICAO: null,
    departureName: null,
    arrivalName: null,
    durationSeconds: 0,
    audioFileURL: null,
    audioQuality: 'standard',
    trackPointCount: 0,
    transcriptSegmentCount: 0,
    aircraftProfileID: null,
    pilotProfileID: null,
    hasDebrief: false,
    notes: null,
    createdAt: t,
    ...rest,
  };
}

export function newLogbookEntry(o: Partial<LogbookEntry> & Factory = {}): LogbookEntry {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  const t = now();
  return {
    id: newId(),
    flightID: null,
    date: t,
    departureICAO: null,
    departureName: null,
    arrivalICAO: null,
    arrivalName: null,
    route: null,
    durationSeconds: 0,
    aircraftProfileID: null,
    aircraftType: null,
    pilotProfileID: null,
    nightLandingCount: 0,
    dayLandingCount: 0,
    notes: null,
    isConfirmed: false,
    hasDebrief: false,
    createdAt: t,
    ...rest,
  };
}
