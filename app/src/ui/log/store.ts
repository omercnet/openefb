// The Log screen's own data and actions (LogStackView.swift reads them from @Query and LogbookViewModel). Navigation,
// recording, ETE and GPS availability are the strip's: the Log reads them from the shared `flightLog` slice.
import type { FlightRecord, LogbookEntry } from '../../data/models';
import { createStoreContext } from '../state/storeContext';

/**
 * Plain data only the Log shows. Totals are not stored: like LogbookViewModel they are derived from `entries`
 * (count, summed duration, unsigned drafts).
 */
export interface LogData {
  /** Recorded flights, any order (shown newest first). */
  flights: FlightRecord[];
  /** Logbook entries, any order (shown newest first). */
  entries: LogbookEntry[];
}

/** Nothing recorded or logged: I1 feeds the repositories in. */
export const log = createStoreContext<LogData>({ flights: [], entries: [] });

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
  /**
   * Delete an unsigned entry (the swipe action). The Log calls it only through `deleteUnsignedEntry` (logic.ts), which
   * skips signed entries; the implementation (I1) MUST still re-check `isConfirmed` on the stored entry and refuse a
   * signed one, as Swift's LogStackView.delete(_:) does: signed entries are locked.
   */
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
