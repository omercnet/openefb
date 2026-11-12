// The pure part of efb-212/ViewModels/LogbookViewModel.swift: building entries and formatting durations. Reading and writing
// stored entries (loadEntries, confirmEntryAndUpdateCurrency, deleteEntry) is in logbookData.ts.
import { newLogbookEntry, type Factory } from '../../data/defaults';
import type { LogbookEntry } from '../../data/models';
import { fixed1 } from '../numberFormat';
import type { FlightRecordingSummary } from '../recording/recordingCoordinator';

/** The part of a recording summary an entry is built from. */
export type RecordingSummaryLike = Pick<FlightRecordingSummary, 'flightID' | 'startDate' | 'endDate'>;

/** What the caller knows besides the summary (`createFromRecording`'s other parameters in Swift). */
export interface CreateFromRecordingArgs {
  /** Nearest airport at the start and at the end of the recording (the aviation database lookup). */
  departureICAO: string | null;
  departureName: string | null;
  arrivalICAO: string | null;
  arrivalName: string | null;
  aircraftProfileID: string | null;
  /** Denormalised aircraft type for display; flight persistence leaves it empty for the logbook edit view to fill. */
  aircraftType: string | null;
  pilotProfileID: string | null;
}

/**
 * LogbookViewModel.createFromRecording (LOG-01): an unconfirmed entry filled from a flight recording, ready for the pilot's
 * review. Flight persistence inserts it in the same transaction as the FlightRecord.
 */
export function createFromRecording(
  summary: RecordingSummaryLike,
  args: CreateFromRecordingArgs,
  factory: Factory = {},
): LogbookEntry {
  return newLogbookEntry({
    ...factory,
    flightID: summary.flightID,
    date: summary.startDate,
    departureICAO: args.departureICAO,
    departureName: args.departureName,
    arrivalICAO: args.arrivalICAO,
    arrivalName: args.arrivalName,
    durationSeconds: (summary.endDate - summary.startDate) / 1000,
    aircraftProfileID: args.aircraftProfileID,
    aircraftType: args.aircraftType,
    pilotProfileID: args.pilotProfileID,
    isConfirmed: false,
  });
}

/** LogbookViewModel.createManualEntry: a blank entry for a flight not recorded with the app, dated now. */
export const createManualEntry = (factory: Factory = {}): LogbookEntry =>
  newLogbookEntry({ ...factory, flightID: null, isConfirmed: false });

/** LogbookViewModel.confirmEntry: confirming locks the entry. */
export const confirmEntry = (entry: LogbookEntry): LogbookEntry => ({ ...entry, isConfirmed: true });

/** formatDurationDecimal: seconds as decimal hours, one place ("1.5"). Not a number reads as zero (JS-only guard). */
export function formatDurationDecimal(seconds: number): string {
  return fixed1((Number.isFinite(seconds) ? seconds : 0) / 3600);
}

/**
 * formatDurationHM: "1h 30m"; under one minute, seconds ("48s"). Seconds are truncated, never rounded up, and there is no
 * day rollover. Not a number reads as zero (JS-only guard: `Int(NaN)` traps in Swift).
 */
export function formatDurationHM(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
  if (whole < 60) return `${Math.max(0, whole)}s`;
  const totalMinutes = Math.floor(whole / 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
