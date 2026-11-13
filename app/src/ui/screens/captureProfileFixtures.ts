// Deterministic fakes for the fidelity captures of the profile and logbook screens (kanaf-dev://aircraft, pilot, ...) and the
// web preview: three aircraft (one active), one active pilot whose three currency statuses show all three colours, and a
// draft and a confirmed logbook entry. They mirror the Swift capture seed (CaptureSeed.swift) value for value, and `now` is
// pinned to the day the SwiftUI references were taken, so dates and currency statuses match them whenever the capture runs.
// Real wiring is the shell's.
import { newAircraftProfile, newLogbookEntry, newPilotProfile } from '../../data/defaults';
import { uuidv4 } from '../../data/ids';
import { FakePreferences } from '../../domain/ports/preferences';
import { preferencesNetworkPreference } from '../../domain/profiles/networkPreference';
import type { UserData } from '../../domain/userData';
import { createMemoryUserData } from '../../domain/userData/memory';
import { createAircraftStore, type AircraftStore } from '../state/aircraftStore';
import { createLogbookEntryStore, type LogbookEntryStore } from '../state/logbookEntryStore';
import { createPilotStore, type PilotStore } from '../state/pilotStore';

const DAY = 86_400_000;

/** 12 Nov 2026, noon: the day of the SwiftUI references. */
export const CAPTURE_NOW = new Date(2026, 10, 12, 12, 0, 0).getTime();

export const CAPTURE_AIRCRAFT_ID = 'capture-aircraft-1';
export const CAPTURE_DRAFT_ENTRY_ID = 'capture-entry-draft';
export const CAPTURE_CONFIRMED_ENTRY_ID = 'capture-entry-confirmed';

export function captureUserData(now: number): UserData {
  return createMemoryUserData({
    aircraft: [
      newAircraftProfile('N172KF', {
        id: CAPTURE_AIRCRAFT_ID,
        aircraftType: 'C172S',
        icaoTypeDesignator: 'C172',
        personsOnBoard: 2,
        fuelCapacityGallons: 53,
        fuelBurnGPH: 9,
        cruiseSpeedKts: 110,
        vSpeeds: { vr: 55, vx: 62, vy: 74, va: 99, vne: 163, vfe: 85, vs0: 40, vs1: 48 },
        annualDue: now + 120 * DAY,
        transponderDue: now + 200 * DAY,
        isActive: true,
        createdAt: now - 200 * DAY,
      }),
      newAircraftProfile('N28PA', {
        id: 'capture-aircraft-2',
        aircraftType: 'PA28',
        createdAt: now - 199 * DAY,
      }),
      newAircraftProfile('4X-ABC', { id: 'capture-aircraft-3', createdAt: now - 198 * DAY }),
    ],
    pilots: [
      newPilotProfile({
        id: 'capture-pilot-1',
        name: 'Test Pilot',
        certificateType: 'private',
        medicalClass: 'third',
        medicalExpiry: now + 20 * DAY, // expiring soon (caution)
        flightReviewDate: now - 200 * DAY, // current
        totalHours: 412.5,
        nightLandingEntries: [
          { date: now - 45 * DAY, count: 1 },
          { date: now - 30 * DAY, count: 1 }, // two landings in 90 days: night currency expired
        ],
        isActive: true,
        createdAt: now - 10 * DAY,
      }),
    ],
    logbook: [
      newLogbookEntry({
        id: CAPTURE_DRAFT_ENTRY_ID,
        date: now - DAY,
        departureICAO: 'LLHA',
        departureName: 'Haifa',
        arrivalICAO: 'LLMG',
        arrivalName: 'Megiddo',
        durationSeconds: 900,
        aircraftType: 'C172S',
        dayLandingCount: 1,
        createdAt: now - DAY,
      }),
      newLogbookEntry({
        id: CAPTURE_CONFIRMED_ENTRY_ID,
        date: now - 10 * DAY,
        departureICAO: 'LLIB',
        departureName: 'Rosh Pina',
        arrivalICAO: 'LLHZ',
        arrivalName: 'Herzliya',
        durationSeconds: 5040,
        aircraftType: 'C172S',
        dayLandingCount: 1,
        nightLandingCount: 1,
        isConfirmed: true,
        notes: 'Smooth air, a little haze on the coast.',
        createdAt: now - 10 * DAY,
      }),
    ],
  });
}

export interface CaptureProfileStores {
  now: () => number;
  aircraft: AircraftStore;
  pilot: PilotStore;
  logbookEntry: LogbookEntryStore;
}

export function captureProfileStores(): CaptureProfileStores {
  const now = () => CAPTURE_NOW;
  const userData = captureUserData(now());
  const base = { userData, now, newId: uuidv4, onActiveChange: () => undefined };
  return {
    now,
    aircraft: createAircraftStore({
      ...base,
      networkPreference: preferencesNetworkPreference(new FakePreferences()),
    }),
    pilot: createPilotStore(base),
    logbookEntry: createLogbookEntryStore({ userData }),
  };
}
