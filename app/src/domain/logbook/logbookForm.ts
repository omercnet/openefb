// The form logic of Views/Logbook/LogbookEntryEditView.swift: the initial values (init), what Save writes (saveEntry) and the
// read-only summary, as pure functions. The view only lays the form out.
import type { LogbookEntry } from '../../data/models';
import { fixed1, parseSwiftDouble } from '../numberFormat';
import { formatDurationDecimal, formatDurationHM } from './logbook';
import type { LogbookEdits } from './logbookData';

/** The @State of LogbookEntryEditView. */
export interface LogbookForm {
  date: number;
  departureICAO: string;
  arrivalICAO: string;
  route: string;
  /** Block time in hours as typed; shown with one decimal. */
  blockTimeHours: string;
  /**
   * The stored duration the text was made from. Swift edits a full-precision Double that is only displayed to one decimal, so
   * while the text is unchanged the stored seconds are kept exactly (3727 s shows as "1.0" and stays 3727 s).
   */
  originalDurationSeconds: number;
  aircraftType: string;
  nightLandingCount: number;
  dayLandingCount: number;
  notes: string;
}

const hoursText = (seconds: number): string => fixed1((Number.isFinite(seconds) ? seconds : 0) / 3600);

export function logbookFormFromEntry(entry: LogbookEntry): LogbookForm {
  return {
    date: entry.date,
    departureICAO: entry.departureICAO ?? '',
    arrivalICAO: entry.arrivalICAO ?? '',
    route: entry.route ?? '',
    blockTimeHours: hoursText(entry.durationSeconds),
    originalDurationSeconds: entry.durationSeconds,
    aircraftType: entry.aircraftType ?? '',
    nightLandingCount: entry.nightLandingCount,
    dayLandingCount: entry.dayLandingCount,
    notes: entry.notes ?? '',
  };
}

export type LogbookFormResult = { ok: true; edits: LogbookEdits } | { ok: false; error: string };

const LANDINGS_ERROR = 'Landings must be whole numbers from 0 to 99.';
const isLandingCount = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 99;
const orNull = (text: string): string | null => (text === '' ? null : text);

/**
 * saveEntry: what the form writes. ICAO codes are upper-cased; empty text is none (nothing is trimmed). The block time is read
 * as hours and written as seconds. JS-only guards: where Swift's numeric field quietly kept the old value for text that is not a
 * number, this is an error the form shows; a negative block time and landings outside the steppers' 0 to 99 are errors too.
 */
export function logbookEditsFromForm(form: LogbookForm): LogbookFormResult {
  if (!Number.isFinite(form.date)) return { ok: false, error: 'Choose a valid date.' };
  if (!isLandingCount(form.dayLandingCount) || !isLandingCount(form.nightLandingCount)) {
    return { ok: false, error: LANDINGS_ERROR };
  }
  let durationSeconds = form.originalDurationSeconds;
  if (form.blockTimeHours !== hoursText(form.originalDurationSeconds)) {
    const hours = parseSwiftDouble(form.blockTimeHours);
    if (hours === null) return { ok: false, error: 'Enter the block time as a number of hours, like 1.5.' };
    if (hours < 0) return { ok: false, error: 'The block time cannot be negative.' };
    durationSeconds = hours * 3600;
  }
  return {
    ok: true,
    edits: {
      date: form.date,
      departureICAO: orNull(form.departureICAO.toUpperCase()),
      arrivalICAO: orNull(form.arrivalICAO.toUpperCase()),
      route: orNull(form.route),
      durationSeconds,
      aircraftType: orNull(form.aircraftType),
      nightLandingCount: form.nightLandingCount,
      dayLandingCount: form.dayLandingCount,
      notes: orNull(form.notes),
    },
  };
}

export interface LogbookSummary {
  /** "1.5h (1h 30m)" */
  duration: string;
  departureName: string | null;
  arrivalName: string | null;
  /** "AI Debrief Available" */
  hasDebrief: boolean;
}

/** The Summary section a confirmed (read-only) entry shows. */
export const logbookSummary = (entry: LogbookEntry): LogbookSummary => ({
  duration: `${formatDurationDecimal(entry.durationSeconds)}h (${formatDurationHM(entry.durationSeconds)})`,
  departureName: entry.departureName,
  arrivalName: entry.arrivalName,
  hasDebrief: entry.hasDebrief,
});
