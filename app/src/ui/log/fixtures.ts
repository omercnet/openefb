// Fake Log data until I1 feeds the flight and logbook repositories in: the reference screenshot's state, and model
// factories for tests and other states.
import type { FlightRecord, LogbookEntry } from '../../data/models';
import { noNavigationFixture } from '../flightLog/fixtures';
import type { FlightLogData } from '../flightLog/store';
import type { LogData } from './store';

let seq = 0;
/** A fresh, deterministic ID for fake records. */
export const nextId = () => `log-fixture-${++seq}`;

/** A LogbookEntry (src/data/models.ts) with neutral defaults, like SchemaV1.LogbookEntry(). */
export function entry(overrides: Partial<LogbookEntry> = {}): LogbookEntry {
  return {
    id: nextId(),
    flightID: null,
    date: 0,
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
    createdAt: 0,
    ...overrides,
  };
}

/** A FlightRecord with neutral defaults. */
export function flight(overrides: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: nextId(),
    startDate: 0,
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
    createdAt: 0,
    ...overrides,
  };
}

/** 2026-11-11 16:36 local, the reference screenshot's clock. */
export const REFERENCE_NOW_MS = new Date(2026, 10, 11, 16, 36, 5).getTime();

/** reference/ipad-log.png: nothing flown or logged yet (totals "0 flights  0.0 h"), no fix needed (no ETE shown). */
export const REFERENCE_LOG: LogData = { flights: [], entries: [] };

/**
 * The shared flight log slice for reference/ipad-log.png: no plan or Direct-To, a recording 5 s in (Now shows "Flight"
 * and "REC 0:00:05"), GPS available.
 */
export const REFERENCE_FLIGHT_LOG: FlightLogData = {
  ...noNavigationFixture,
  gpsAvailable: true,
  recording: { status: { kind: 'recording' }, elapsedSeconds: 5, levelDBFS: -160, microphoneDenied: false },
};
