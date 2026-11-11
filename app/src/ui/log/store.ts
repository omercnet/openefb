// The Log screen's data and actions (LogStackView.swift reads them from @Query, AppState and LogbookViewModel).
import type { FlightRecord, LogbookEntry } from '../../data/models';
import type { RecordingStatus } from '../../domain/core/types';
import type { GpsFix } from '../../domain/location/gpsStatus';
import { createStoreContext } from '../state/storeContext';
import { REFERENCE_LOG } from './fixtures';

/**
 * Plain data behind the Log. Totals are not stored: like LogbookViewModel they are derived from `entries`
 * (count, summed duration, unsigned drafts).
 */
export interface LogData {
  /** Recorded flights, any order (shown newest first). */
  flights: FlightRecord[];
  /** Logbook entries, any order (shown newest first). */
  entries: LogbookEntry[];
  /** Route points of the active plan (the route's legs, or departure and destination); null without a plan. */
  activePlanCodes: string[] | null;
  /** ICAO of the Direct-To airport, if any. */
  directToIcao: string | null;
  /** Navigating (plan or Direct-To) without necessarily recording: Now shows. */
  hasActiveNavigation: boolean;
  recording: RecordingStatus;
  /** AppState.recordingElapsedTime, seconds. */
  recordingElapsedSeconds: number;
  /** FlightLogStrip.nextIdent: the next waypoint (a Direct-To wins over the route); null without one. */
  nextIdent: string | null;
  /** AppState.estimatedTimeEnroute, seconds to the next waypoint. */
  estimatedTimeEnrouteSeconds: number | null;
  /** The last fix and whether the stream works, to age the ETE out once the fix is stale. */
  ownshipFix: GpsFix | null;
  gpsAvailable: boolean;
  /** The clock the staleness is evaluated against; I1 ticks it once a second (the Swift TimelineView). */
  nowMs: number;
}

/** The fake reference state until I1 feeds the repositories and AppState in. */
export const log = createStoreContext<LogData>(REFERENCE_LOG);

/** Navigation and logbook edits the Log triggers. No-ops until I1 wires them. */
export interface LogActions {
  /** Map button and the Now row: back to the chart. */
  openMap: () => void;
  openSettings: () => void;
  /** Plan a flight and the active plan row: the flight planner. */
  openPlanner: () => void;
  /** Flown "+": create a manual entry and open it. */
  addEntry: () => void;
  /** A recorded flight's details, debrief and replay. */
  openFlight: (flightId: string) => void;
  /** A logbook entry: editable while a draft (Sign), read-only once signed (Review). */
  openEntry: (entryId: string) => void;
  /** Delete an unsigned entry (the swipe action); signed entries are locked. */
  deleteEntry: (entryId: string) => void;
}

const noop = () => {};

export const logActions = createStoreContext<LogActions>({
  openMap: noop,
  openSettings: noop,
  openPlanner: noop,
  addEntry: noop,
  openFlight: noop,
  openEntry: noop,
  deleteEntry: noop,
});
