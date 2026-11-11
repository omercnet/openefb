// The stored side of efb-212/ViewModels/LogbookViewModel.swift: loading with totals, manual entries, saving, confirming with
// the night-landing bridge to the active pilot, and deletion. Multi-record changes go through `atomically`, where Swift saved a
// ModelContext once.
import type { Factory } from '../../data/defaults';
import type { LogbookEntry } from '../../data/models';
import type { UserData } from '../userData';
import { createManualEntry } from './logbook';

/** Why a logbook change was refused. */
export class LogbookError extends Error {
  constructor(
    readonly reason: 'notFound' | 'locked',
    message: string,
  ) {
    super(message);
    this.name = 'LogbookError';
  }
}

const notFound = (): LogbookError => new LogbookError('notFound', 'This logbook entry no longer exists.');

export interface LogbookSnapshot {
  /** Most recent first. */
  entries: LogbookEntry[];
  totalFlights: number;
  /** Total flight time across all entries. */
  totalFlightTimeSeconds: number;
}

/** The fields the edit form writes (LogbookEntryEditView.saveEntry). */
export type LogbookEdits = Partial<
  Pick<
    LogbookEntry,
    | 'date'
    | 'departureICAO'
    | 'arrivalICAO'
    | 'route'
    | 'durationSeconds'
    | 'aircraftType'
    | 'nightLandingCount'
    | 'dayLandingCount'
    | 'notes'
  >
>;

/**
 * loadEntries. A read that fails rejects: Swift showed an empty logbook with zero totals instead, which would read a failed
 * read as a logbook with no flights.
 */
export async function loadLogbook(data: UserData): Promise<LogbookSnapshot> {
  const entries = await data.logbook.list();
  return {
    entries,
    totalFlights: entries.length,
    totalFlightTimeSeconds: entries.reduce((sum, e) => sum + e.durationSeconds, 0),
  };
}

/** createManualEntry: a blank unconfirmed entry dated now, inserted. */
export async function addManualEntry(data: UserData, factory: Factory = {}): Promise<LogbookEntry> {
  const entry = createManualEntry(factory);
  await data.logbook.insert(entry);
  return entry;
}

/** Writes the form's fields. JS-only guard: a confirmed entry is locked ("should not be edited further"), so a stale edit sheet cannot overwrite it. */
export function saveLogbookEntry(data: UserData, id: string, edits: LogbookEdits): Promise<LogbookEntry> {
  return data.atomically(async (tx) => {
    const current = await tx.logbook.get(id);
    if (current === null) throw notFound();
    if (current.isConfirmed) throw new LogbookError('locked', 'This entry has been confirmed and is locked.');
    const saved = await tx.logbook.update(id, edits);
    if (saved === null) throw notFound();
    return saved;
  });
}

/**
 * confirmEntryAndUpdateCurrency: saves the form's fields, locks the entry and, when it has night landings, appends them
 * ({ date, count }) to the first active pilot so night currency (FAR 61.57) follows. One transaction: either the entry is
 * confirmed and the pilot updated, or neither. JS-only guards: confirming an entry that is already confirmed does nothing
 * (landings are never counted twice), and a failed pilot write rejects where Swift's `try?` would have confirmed anyway.
 */
export function confirmEntryAndUpdateCurrency(
  data: UserData,
  id: string,
  edits: LogbookEdits = {},
): Promise<LogbookEntry> {
  return data.atomically(async (tx) => {
    const current = await tx.logbook.get(id);
    if (current === null) throw notFound();
    if (current.isConfirmed) return current;
    const saved = await tx.logbook.update(id, { ...edits, isConfirmed: true });
    if (saved === null) throw notFound();
    if (saved.nightLandingCount > 0) {
      const active = (await tx.pilots.list()).find((p) => p.isActive);
      if (active) {
        const landings = [...active.nightLandingEntries, { date: saved.date, count: saved.nightLandingCount }];
        await tx.pilots.update(active.id, { nightLandingEntries: landings });
      }
    }
    return saved;
  });
}

/** deleteEntry. True when an entry was deleted. */
export const deleteLogbookEntry = (data: UserData, id: string): Promise<boolean> => data.logbook.remove(id);
