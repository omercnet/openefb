// Ports of the data cases of ViewModelTests/LogbookViewModelTests (SwiftData context -> UserData), run against SQLite and
// the in-memory fake, plus the guards the Swift view model did not need (atomic confirm, no double confirm, locked entries).
import { newLogbookEntry, newPilotProfile } from '../../data/defaults';
import { migrate } from '../../data/migrate';
import type { LogbookEntry } from '../../data/models';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { userDataFromDb, type UserData } from '../userData';
import { createMemoryUserData } from '../userData/memory';
import {
  addManualEntry,
  confirmEntryAndUpdateCurrency,
  deleteLogbookEntry,
  loadLogbook,
  saveLogbookEntry,
  LogbookError,
} from './logbookData';

async function sqliteUserData(): Promise<UserData> {
  const db = openNodeSqliteDb();
  await migrate(db);
  return userDataFromDb(db);
}

const makers: [string, () => Promise<UserData>][] = [
  ['sqlite', sqliteUserData],
  ['memory', () => Promise.resolve(createMemoryUserData())],
];

let n = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** insertEntry(context, date:, duration:, nightLandings:) */
async function insertEntry(
  data: UserData,
  date: number,
  durationSeconds: number,
  nightLandingCount = 0,
): Promise<LogbookEntry> {
  const entry = newLogbookEntry({ id: uuid(), date, durationSeconds, nightLandingCount, createdAt: date });
  await data.logbook.insert(entry);
  return entry;
}

describe.each(makers)('LogbookViewModel Tests over %s', (_name, make) => {
  it('loadEntriesSortsMostRecentFirstAndSumsDuration', async () => {
    const data = await make();
    await insertEntry(data, 1_700_000_000_000, 3600);
    await insertEntry(data, 1_700_200_000_000, 5400);
    await insertEntry(data, 1_700_100_000_000, 1800);

    const logbook = await loadLogbook(data);

    expect(logbook.entries.map((e) => e.date)).toEqual([1_700_200_000_000, 1_700_100_000_000, 1_700_000_000_000]);
    expect(logbook.totalFlights).toBe(3);
    expect(logbook.totalFlightTimeSeconds).toBe(10_800);
  });

  it('an empty logbook has no entries and zero totals', async () => {
    const data = await make();
    expect(await loadLogbook(data)).toEqual({ entries: [], totalFlights: 0, totalFlightTimeSeconds: 0 });
  });

  it('manualEntryIsUnconfirmedHasNoFlightIDAndIsDatedNow (inserted, not just returned)', async () => {
    const data = await make();
    const entry = await addManualEntry(data, { now: () => 1_700_000_000_000 });
    expect(entry.flightID).toBeNull();
    expect(entry.isConfirmed).toBe(false);
    expect(entry.date).toBe(1_700_000_000_000);
    expect((await loadLogbook(data)).entries.map((e) => e.id)).toEqual([entry.id]);
  });

  describe('confirm and currency', () => {
    it('confirmWithNightLandingsAppendsToActivePilotOnly', async () => {
      const data = await make();
      const active = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      const inactive = newPilotProfile({ id: uuid(), isActive: false, createdAt: 2 });
      await data.pilots.insert(active);
      await data.pilots.insert(inactive);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 3);

      const confirmed = await confirmEntryAndUpdateCurrency(data, entry.id);

      expect(confirmed.isConfirmed).toBe(true);
      expect((await data.logbook.get(entry.id))?.isConfirmed).toBe(true);
      expect((await data.pilots.get(active.id))?.nightLandingEntries).toEqual([{ date: entry.date, count: 3 }]);
      expect((await data.pilots.get(inactive.id))?.nightLandingEntries).toEqual([]);
    });

    it('the landings go to the active pilot even when an older pilot is inactive', async () => {
      const data = await make();
      const older = newPilotProfile({ id: uuid(), isActive: false, createdAt: 1 });
      const active = newPilotProfile({ id: uuid(), isActive: true, createdAt: 2 });
      await data.pilots.insert(older);
      await data.pilots.insert(active);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 2);

      await confirmEntryAndUpdateCurrency(data, entry.id);

      expect((await data.pilots.get(older.id))?.nightLandingEntries).toEqual([]);
      expect((await data.pilots.get(active.id))?.nightLandingEntries).toEqual([{ date: entry.date, count: 2 }]);
    });

    it('confirmAccumulatesNightLandingsAcrossFlights', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const first = await insertEntry(data, 1_700_000_000_000, 3600, 1);
      const second = await insertEntry(data, 1_700_100_000_000, 3600, 2);

      await confirmEntryAndUpdateCurrency(data, first.id);
      await confirmEntryAndUpdateCurrency(data, second.id);

      expect((await data.pilots.get(pilot.id))?.nightLandingEntries.map((e) => e.count)).toEqual([1, 2]);
    });

    it('confirmWithoutNightLandingsLeavesPilotCurrencyUntouched', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 0);

      const confirmed = await confirmEntryAndUpdateCurrency(data, entry.id);

      expect(confirmed.isConfirmed).toBe(true);
      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toEqual([]);
    });

    it('confirmWithNightLandingsAndNoActivePilotStillConfirmsEntry', async () => {
      const data = await make();
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 2);
      const confirmed = await confirmEntryAndUpdateCurrency(data, entry.id);
      expect(confirmed.isConfirmed).toBe(true);
    });

    it('applies the form edits together with the confirmation, and the bridge uses the edited date and count', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 0);

      const confirmed = await confirmEntryAndUpdateCurrency(data, entry.id, {
        date: 1_700_500_000_000,
        nightLandingCount: 2,
        arrivalICAO: 'LLBG',
        durationSeconds: 5400,
      });

      expect(confirmed).toMatchObject({
        isConfirmed: true,
        date: 1_700_500_000_000,
        nightLandingCount: 2,
        arrivalICAO: 'LLBG',
        durationSeconds: 5400,
      });
      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toEqual([{ date: 1_700_500_000_000, count: 2 }]);
    });

    it('is atomic: when the pilot cannot be updated the entry stays unconfirmed and keeps its edits unsaved', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 3);
      const failing: UserData = {
        ...data,
        atomically: (fn) =>
          data.atomically((tx) =>
            fn({ ...tx, pilots: { ...tx.pilots, update: () => Promise.reject(new Error('pilot write failed')) } }),
          ),
      };

      await expect(confirmEntryAndUpdateCurrency(failing, entry.id, { notes: 'edited' })).rejects.toThrow(
        'pilot write failed',
      );

      expect(await data.logbook.get(entry.id)).toMatchObject({ isConfirmed: false, notes: null });
      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toEqual([]);
    });

    it('confirming an entry that is already confirmed does nothing, so landings are never counted twice', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 3);

      await confirmEntryAndUpdateCurrency(data, entry.id);
      await confirmEntryAndUpdateCurrency(data, entry.id);

      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toHaveLength(1);
    });

    it('two confirmations started together write the landings once (the second waits, then finds it confirmed)', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      const entry = await insertEntry(data, 1_700_000_000_000, 3600, 3);
      // Counting the pilot writes shows a double confirm even when the second write would replace the first with the same list.
      let pilotWrites = 0;
      const counting: UserData = {
        ...data,
        atomically: (fn) =>
          data.atomically((tx) =>
            fn({
              ...tx,
              pilots: {
                ...tx.pilots,
                update: (id, patch) => {
                  pilotWrites += 1;
                  return tx.pilots.update(id, patch);
                },
              },
            }),
          ),
      };

      await Promise.allSettled([
        confirmEntryAndUpdateCurrency(counting, entry.id),
        confirmEntryAndUpdateCurrency(counting, entry.id),
      ]);

      expect(pilotWrites).toBe(1);
      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toHaveLength(1);
    });

    it('a missing entry rejects and writes nothing', async () => {
      const data = await make();
      const pilot = newPilotProfile({ id: uuid(), isActive: true, createdAt: 1 });
      await data.pilots.insert(pilot);
      await expect(confirmEntryAndUpdateCurrency(data, uuid())).rejects.toMatchObject({ reason: 'notFound' });
      expect((await data.pilots.get(pilot.id))?.nightLandingEntries).toEqual([]);
    });
  });

  describe('save', () => {
    it('writes the edits and returns the stored entry', async () => {
      const data = await make();
      const entry = await insertEntry(data, 1_700_000_000_000, 3600);
      const saved = await saveLogbookEntry(data, entry.id, {
        departureICAO: 'KPAO',
        notes: 'smooth',
        dayLandingCount: 2,
      });
      expect(saved).toMatchObject({ departureICAO: 'KPAO', notes: 'smooth', dayLandingCount: 2, isConfirmed: false });
      expect(await data.logbook.get(entry.id)).toEqual(saved);
    });

    it('a confirmed entry is locked: saving it rejects and changes nothing', async () => {
      const data = await make();
      const entry = await insertEntry(data, 1_700_000_000_000, 3600);
      await confirmEntryAndUpdateCurrency(data, entry.id);
      await expect(saveLogbookEntry(data, entry.id, { notes: 'late edit' })).rejects.toBeInstanceOf(LogbookError);
      await expect(saveLogbookEntry(data, entry.id, { notes: 'late edit' })).rejects.toMatchObject({
        reason: 'locked',
      });
      expect((await data.logbook.get(entry.id))?.notes).toBeNull();
    });

    it('a missing entry rejects', async () => {
      const data = await make();
      await expect(saveLogbookEntry(data, uuid(), { notes: 'x' })).rejects.toMatchObject({ reason: 'notFound' });
    });
  });

  it('deleteRemovesOnlyThatEntry', async () => {
    const data = await make();
    const keep = await insertEntry(data, 1_700_000_000_000, 3600);
    const drop = await insertEntry(data, 1_700_100_000_000, 1800);

    expect(await deleteLogbookEntry(data, drop.id)).toBe(true);
    const logbook = await loadLogbook(data);

    expect(logbook.entries.map((e) => e.id)).toEqual([keep.id]);
    expect(logbook.totalFlightTimeSeconds).toBe(3600);
  });

  it('deleting an entry that is not there reports false', async () => {
    const data = await make();
    expect(await deleteLogbookEntry(data, uuid())).toBe(false);
  });
});
