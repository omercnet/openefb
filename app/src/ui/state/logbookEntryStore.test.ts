// Behaviour of the logbook entry editor's view model (LogbookEntryEditView + LogbookViewModel.confirmEntryAndUpdateCurrency).
// Swift has no test of the view; the cases follow the Swift source, and the guards are JS-only (see U7.md).
import { newLogbookEntry, newPilotProfile } from '../../data/defaults';
import { logbookFormFromEntry, type LogbookForm } from '../../domain/logbook/logbookForm';
import type { UserData } from '../../domain/userData';
import { createMemoryUserData } from '../../domain/userData/memory';
import { viaTx } from '../../domain/userData/testSupport';
import { createLogbookEntryStore } from './logbookEntryStore';

const DATE = Date.UTC(2026, 10, 11, 9, 30);

async function seeded(over: Parameters<typeof newLogbookEntry>[0] = {}): Promise<UserData> {
  const data = createMemoryUserData();
  await data.logbook.insert(newLogbookEntry({ id: 'e1', date: DATE, durationSeconds: 3600, createdAt: DATE, ...over }));
  return data;
}

const open = async (data: UserData) => {
  const store = createLogbookEntryStore({ userData: data });
  await store.getState().load('e1');
  const entry = store.getState().entry;
  if (entry === null) throw new Error('entry not loaded');
  return { store, form: logbookFormFromEntry(entry) };
};
const edit = (form: LogbookForm, over: Partial<LogbookForm>): LogbookForm => ({ ...form, ...over });

describe('load', () => {
  it('reads the stored entry', async () => {
    const data = await seeded({ route: 'LLHZ LLIB' });
    const store = createLogbookEntryStore({ userData: data });
    expect(store.getState()).toMatchObject({ loaded: false, entry: null });
    await store.getState().load('e1');
    expect(store.getState()).toMatchObject({ loaded: true, error: null, entry: { id: 'e1', route: 'LLHZ LLIB' } });
  });

  it('an entry that is gone is reported', async () => {
    const store = createLogbookEntryStore({ userData: createMemoryUserData() });
    await store.getState().load('missing');
    expect(store.getState()).toMatchObject({
      loaded: true,
      entry: null,
      error: 'This logbook entry no longer exists.',
    });
  });

  it('a read that fails is reported and is not "loaded"', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      logbook: { ...data.logbook, get: () => Promise.reject(new Error('db locked')) },
    };
    const store = createLogbookEntryStore({ userData: broken });
    await store.getState().load('e1');
    expect(store.getState()).toMatchObject({ loaded: false, error: 'Could not load the logbook entry: db locked' });
  });

  it('the last load wins when two overlap (opening another entry before the first read finished)', async () => {
    const data = await seeded();
    await data.logbook.insert(newLogbookEntry({ id: 'e2', date: DATE, createdAt: DATE, notes: 'second' }));
    const gate = Promise.withResolvers<void>();
    const slowFirst: UserData = {
      ...data,
      logbook: {
        ...data.logbook,
        get: async (id) => {
          if (id === 'e1') await gate.promise;
          return data.logbook.get(id);
        },
      },
    };
    const store = createLogbookEntryStore({ userData: slowFirst });
    const first = store.getState().load('e1');
    const second = store.getState().load('e2');
    gate.resolve();
    await Promise.all([first, second]);
    expect(store.getState().entry?.id).toBe('e2');
  });
});

describe('save', () => {
  it('writes the form and keeps the entry unconfirmed', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    const result = await store
      .getState()
      .save(edit(form, { departureICAO: 'llhz', notes: 'smooth', dayLandingCount: 2 }));
    expect(result).toBe('saved');
    expect(await data.logbook.get('e1')).toMatchObject({
      departureICAO: 'LLHZ',
      notes: 'smooth',
      dayLandingCount: 2,
      isConfirmed: false,
    });
    expect(store.getState().entry).toEqual(await data.logbook.get('e1'));
    expect(store.getState().error).toBeNull();
  });

  it('a form that is not valid is refused without touching the data', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    expect(await store.getState().save(edit(form, { blockTimeHours: 'abc' }))).toBe('invalid');
    expect((await data.logbook.get('e1'))?.durationSeconds).toBe(3600);
    expect(store.getState().saving).toBe(false);
  });

  it('a confirmed entry is locked: the save is refused and the screen learns the entry is confirmed', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    await data.logbook.update('e1', { isConfirmed: true }); // confirmed elsewhere after this editor opened
    expect(await store.getState().save(edit(form, { notes: 'late edit' }))).toBe('locked');
    expect((await data.logbook.get('e1'))?.notes).toBeNull();
    expect(store.getState().entry?.isConfirmed).toBe(true);
    expect(store.getState().error).toBe('This entry has been confirmed and is locked.');
  });

  it('a confirmed entry that cannot be read again is still shown locked, never as the stale editable draft', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    await data.logbook.update('e1', { isConfirmed: true });
    const unreadable = { ...data, logbook: { ...data.logbook, get: () => Promise.reject(new Error('db locked')) } };
    const lockedStore = createLogbookEntryStore({ userData: unreadable });
    lockedStore.setState({ entry: store.getState().entry, loaded: true });
    expect(await lockedStore.getState().save(edit(form, { notes: 'late edit' }))).toBe('locked');
    expect(lockedStore.getState().entry?.isConfirmed).toBe(true);
    expect(lockedStore.getState().error).toBe('This entry has been confirmed and is locked.');
  });

  it('an entry deleted while the save was refused as locked is shown as gone, not as a locked summary', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    await data.logbook.update('e1', { isConfirmed: true });
    const gone = { ...data, logbook: { ...data.logbook, get: () => Promise.resolve(null) } };
    const lockedStore = createLogbookEntryStore({ userData: gone });
    lockedStore.setState({ entry: store.getState().entry, loaded: true });
    expect(await lockedStore.getState().save(edit(form, { notes: 'late edit' }))).toBe('locked');
    expect(lockedStore.getState().entry).toBeNull();
    expect(lockedStore.getState().error).toBe('This logbook entry no longer exists.');
  });

  it('a write that fails is reported and the stored entry is unchanged', async () => {
    const data = await seeded();
    const { form } = await open(data);
    const broken = viaTx(data, (r) => ({
      ...r,
      logbook: { ...r.logbook, update: () => Promise.reject(new Error('disk full')) },
    }));
    const store = createLogbookEntryStore({ userData: broken });
    await store.getState().load('e1');
    expect(await store.getState().save(edit(form, { notes: 'x' }))).toBe('failed');
    expect(store.getState().error).toBe('Could not save the logbook entry: disk full');
    expect((await data.logbook.get('e1'))?.notes).toBeNull();
    expect(store.getState().saving).toBe(false);
  });

  it('an entry that was deleted meanwhile is reported', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    await data.logbook.remove('e1');
    expect(await store.getState().save(edit(form, { notes: 'x' }))).toBe('failed');
    expect(store.getState().error).toBe('Could not save the logbook entry: This logbook entry no longer exists.');
  });

  it('saving before an entry is loaded is refused', async () => {
    const data = await seeded();
    const { form } = await open(data);
    const unloaded = createLogbookEntryStore({ userData: data });
    expect(await unloaded.getState().save(form)).toBe('failed');
    expect(unloaded.getState().error).toBe('There is no logbook entry to save.');
    expect((await data.logbook.get('e1'))?.notes).toBeNull();
  });

  it('a second save while one is in flight is ignored', async () => {
    const data = await seeded();
    const { form } = await open(data);
    const gate = Promise.withResolvers<void>();
    const slow = viaTx(data, (r) => ({
      ...r,
      logbook: {
        ...r.logbook,
        update: async (id, patch) => {
          await gate.promise;
          return r.logbook.update(id, patch);
        },
      },
    }));
    const store = createLogbookEntryStore({ userData: slow });
    await store.getState().load('e1');
    const first = store.getState().save(edit(form, { notes: 'first' }));
    expect(await store.getState().save(edit(form, { notes: 'second' }))).toBe('busy');
    gate.resolve();
    expect(await first).toBe('saved');
    expect((await data.logbook.get('e1'))?.notes).toBe('first');
  });
});

describe('confirm', () => {
  it('saves the form, locks the entry and bridges its night landings to the active pilot', async () => {
    const data = await seeded();
    await data.pilots.insert(newPilotProfile({ id: 'p1', isActive: true, createdAt: 1 }));
    const { store, form } = await open(data);
    const result = await store.getState().confirm(edit(form, { nightLandingCount: 2, notes: 'done' }));
    expect(result).toBe('saved');
    expect(store.getState().entry).toMatchObject({ isConfirmed: true, nightLandingCount: 2, notes: 'done' });
    expect((await data.pilots.get('p1'))?.nightLandingEntries).toEqual([{ date: DATE, count: 2 }]);
  });

  it('is all or nothing: when the pilot cannot be updated the entry stays unconfirmed and the edits are not saved', async () => {
    const data = await seeded();
    await data.pilots.insert(newPilotProfile({ id: 'p1', isActive: true, createdAt: 1 }));
    const { form } = await open(data);
    const broken = viaTx(data, (r) => ({
      ...r,
      pilots: { ...r.pilots, update: () => Promise.reject(new Error('pilot write failed')) },
    }));
    const store = createLogbookEntryStore({ userData: broken });
    await store.getState().load('e1');
    expect(await store.getState().confirm(edit(form, { nightLandingCount: 2, notes: 'done' }))).toBe('failed');
    expect(store.getState().error).toBe('Could not confirm the logbook entry: pilot write failed');
    expect(await data.logbook.get('e1')).toMatchObject({ isConfirmed: false, notes: null, nightLandingCount: 0 });
    expect(store.getState().entry?.isConfirmed).toBe(false);
  });

  it('an invalid form is refused and nothing is confirmed', async () => {
    const data = await seeded();
    const { store, form } = await open(data);
    expect(await store.getState().confirm(edit(form, { blockTimeHours: '-3' }))).toBe('invalid');
    expect((await data.logbook.get('e1'))?.isConfirmed).toBe(false);
  });

  it('a double tap confirms once and counts the landings once', async () => {
    const data = await seeded({ nightLandingCount: 3 });
    await data.pilots.insert(newPilotProfile({ id: 'p1', isActive: true, createdAt: 1 }));
    const { store, form } = await open(data);
    const results = await Promise.all([store.getState().confirm(form), store.getState().confirm(form)]);
    expect(results).toEqual(['saved', 'busy']);
    expect((await data.pilots.get('p1'))?.nightLandingEntries).toHaveLength(1);
  });

  it('confirming an entry that was confirmed meanwhile leaves it confirmed and counts nothing twice', async () => {
    const data = await seeded({ nightLandingCount: 3 });
    await data.pilots.insert(newPilotProfile({ id: 'p1', isActive: true, createdAt: 1 }));
    const { store, form } = await open(data);
    await data.logbook.update('e1', { isConfirmed: true });
    expect(await store.getState().confirm(form)).toBe('saved');
    expect((await data.pilots.get('p1'))?.nightLandingEntries).toEqual([]);
    expect(store.getState().entry?.isConfirmed).toBe(true);
  });
});
