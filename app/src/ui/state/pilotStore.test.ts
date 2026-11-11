// Behaviour of the pilot profile's view model (PilotProfileViewModel + the save flows of PilotProfileView and PilotEditView).
// Swift has no test of it; the cases follow the Swift source, and the guards are JS-only (see U7.md).
import { newPilotProfile } from '../../data/defaults';
import { emptyPilotForm, type PilotForm } from '../../domain/profiles/pilot';
import type { UserData } from '../../domain/userData';
import { createMemoryUserData } from '../../domain/userData/memory';
import { viaTx } from '../../domain/userData/testSupport';
import { createPilotStore, type PilotDeps } from './pilotStore';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 9, 30);

function setup(over: Partial<PilotDeps> = {}, userData: UserData = createMemoryUserData()) {
  const onActiveChange = jest.fn();
  let n = 0;
  const deps: PilotDeps = { userData, now: () => NOW, newId: () => `new-${++n}`, onActiveChange, ...over };
  return { store: createPilotStore(deps), userData, onActiveChange };
}

const form = (over: Partial<PilotForm> = {}): PilotForm => ({ ...emptyPilotForm(NOW), name: 'Ada', ...over });

/** p1 (oldest, inactive), p2 (active, with a medical and a review), p3 (newest, inactive). */
async function seeded(): Promise<UserData> {
  const data = createMemoryUserData();
  await data.pilots.insert(newPilotProfile({ id: 'p1', name: 'One', createdAt: 100 }));
  await data.pilots.insert(
    newPilotProfile({
      id: 'p2',
      name: 'Two',
      createdAt: 200,
      isActive: true,
      medicalExpiry: NOW + 200 * DAY,
      flightReviewDate: NOW - 30 * DAY,
    }),
  );
  await data.pilots.insert(newPilotProfile({ id: 'p3', name: 'Three', createdAt: 300 }));
  return data;
}

describe('load', () => {
  it('lists newest first, finds the active pilot, computes its currency and tells the app', async () => {
    const { store, onActiveChange } = setup({}, await seeded());
    expect(store.getState().loaded).toBe(false);
    await store.getState().load();
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
    expect(store.getState()).toMatchObject({ loaded: true, activeId: 'p2', error: null });
    expect(store.getState().currency).toEqual({
      medical: 'current',
      flightReview: 'current',
      night: 'expired',
      overall: 'expired',
    });
    expect(onActiveChange).toHaveBeenLastCalledWith('p2');
  });

  it('no active pilot: nothing is active and every status reads expired', async () => {
    const data = createMemoryUserData();
    await data.pilots.insert(newPilotProfile({ id: 'p1', createdAt: 1 }));
    const { store, onActiveChange } = setup({}, data);
    await store.getState().load();
    expect(store.getState().activeId).toBeNull();
    expect(store.getState().currency).toEqual({
      medical: 'expired',
      flightReview: 'expired',
      night: 'expired',
      overall: 'expired',
    });
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it('a read that fails keeps the list that was shown and says so', async () => {
    const data = await seeded();
    let fail = false;
    const flaky: UserData = {
      ...data,
      pilots: { ...data.pilots, list: () => (fail ? Promise.reject(new Error('db locked')) : data.pilots.list()) },
    };
    const { store } = setup({}, flaky);
    await store.getState().load();
    fail = true;
    await store.getState().load();
    expect(store.getState().profiles).toHaveLength(3);
    expect(store.getState().error).toBe('Could not load the pilot profiles: db locked');
  });

  it('a first load that fails is not "loaded"', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      pilots: { ...data.pilots, list: () => Promise.reject(new Error('db locked')) },
    };
    const { store } = setup({}, broken);
    await store.getState().load();
    expect(store.getState().loaded).toBe(false);
  });

  it('a throwing app observer is reported without undoing the load', async () => {
    const { store } = setup(
      {
        onActiveChange: () => {
          throw new Error('app state failed');
        },
      },
      await seeded(),
    );
    await store.getState().load();
    expect(store.getState().profiles).toHaveLength(3);
    expect(store.getState().error).toBe('The app could not follow the change: app state failed');
  });
});

describe('select', () => {
  it('activates one pilot, recomputes the currency for it and tells the app', async () => {
    const { store, onActiveChange } = setup({}, await seeded());
    await store.getState().load();
    await store.getState().select('p3');
    expect(store.getState().activeId).toBe('p3');
    expect(store.getState().currency.medical).toBe('expired'); // p3 has no medical
    expect(onActiveChange).toHaveBeenLastCalledWith('p3');
  });

  it('a pilot that is gone is reported and the active one stays', async () => {
    const { store } = setup({}, await seeded());
    await store.getState().load();
    await store.getState().select('missing');
    expect(store.getState().error).toBe('Could not change the active pilot: This pilot profile no longer exists.');
    expect(store.getState().activeId).toBe('p2');
  });
});

describe('create (addProfile)', () => {
  it('inserts a blank, inactive profile at once and returns its id so the editor can open on it', async () => {
    const { store, userData } = setup();
    const id = await store.getState().create();
    expect(id).toBe('new-1');
    expect(await userData.pilots.get('new-1')).toMatchObject({ name: '', isActive: false, createdAt: NOW });
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['new-1']);
  });

  it('a failed insert is reported and returns null', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      pilots: { ...data.pilots, insert: () => Promise.reject(new Error('disk full')) },
    };
    const { store } = setup({}, broken);
    expect(await store.getState().create()).toBeNull();
    expect(store.getState().error).toBe('Could not create the pilot profile: disk full');
  });

  it('a second tap while one is being created is ignored, so a double tap cannot create two blank profiles', async () => {
    const data = createMemoryUserData();
    const gate = Promise.withResolvers<void>();
    const slow: UserData = {
      ...data,
      pilots: {
        ...data.pilots,
        insert: async (record) => {
          await gate.promise;
          return data.pilots.insert(record);
        },
      },
    };
    const { store } = setup({}, slow);
    const first = store.getState().create();
    expect(await store.getState().create()).toBeNull();
    gate.resolve();
    expect(await first).toBe('new-1');
    expect(await data.pilots.list()).toHaveLength(1);
  });
});

describe('save (PilotEditView.saveProfile)', () => {
  it('writes the form to the profile and lists it', async () => {
    const { store, userData } = setup({}, await seeded());
    expect(
      await store.getState().save('p1', form({ name: 'Grace', certificateType: 'private', totalHours: '412.5' })),
    ).toBe('saved');
    expect(await userData.pilots.get('p1')).toMatchObject({
      name: 'Grace',
      certificateType: 'private',
      totalHours: 412.5,
    });
    expect(store.getState().profiles.find((p) => p.id === 'p1')?.name).toBe('Grace');
    expect(store.getState().error).toBeNull();
  });

  it('a save that changes the active pilot recomputes its currency', async () => {
    const { store } = setup({}, await seeded());
    await store.getState().load();
    expect(store.getState().currency.medical).toBe('current');
    await store.getState().save('p2', form({ hasMedicalExpiry: true, medicalExpiry: NOW + 10 * DAY }));
    expect(store.getState().currency.medical).toBe('warning');
  });

  it('a failed write is reported and leaves the stored profile as it was', async () => {
    const data = await seeded();
    const broken: UserData = {
      ...data,
      pilots: { ...data.pilots, update: () => Promise.reject(new Error('disk full')) },
    };
    const { store } = setup({}, broken);
    expect(await store.getState().save('p1', form({ name: 'Grace' }))).toBe('failed');
    expect(store.getState().error).toBe('Could not save the pilot profile: disk full');
    expect((await data.pilots.get('p1'))?.name).toBe('One');
    expect(store.getState().saving).toBe(false);
  });

  it('a profile that was deleted meanwhile is reported', async () => {
    const { store } = setup();
    expect(await store.getState().save('gone', form())).toBe('failed');
    expect(store.getState().error).toBe('Could not save the pilot profile: This pilot profile no longer exists.');
  });

  it('a second save while one is in flight is ignored', async () => {
    const data = await seeded();
    const gate = Promise.withResolvers<void>();
    const slow: UserData = {
      ...data,
      pilots: {
        ...data.pilots,
        update: async (id, patch) => {
          await gate.promise;
          return data.pilots.update(id, patch);
        },
      },
    };
    const { store } = setup({}, slow);
    const first = store.getState().save('p1', form({ name: 'First' }));
    expect(await store.getState().save('p1', form({ name: 'Second' }))).toBe('busy');
    gate.resolve();
    expect(await first).toBe('saved');
    expect((await data.pilots.get('p1'))?.name).toBe('First');
  });
});

describe('remove', () => {
  it('deleting the active pilot leaves none active, tells the app and reads expired', async () => {
    const { store, onActiveChange } = setup({}, await seeded());
    await store.getState().load();
    await store.getState().remove('p2');
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['p3', 'p1']);
    expect(store.getState().activeId).toBeNull();
    expect(store.getState().currency.overall).toBe('expired');
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it('a delete that fails is reported and the list stays', async () => {
    const data = await seeded();
    const broken: UserData = { ...data, pilots: { ...data.pilots, remove: () => Promise.reject(new Error('locked')) } };
    const { store } = setup({}, broken);
    await store.getState().load();
    await store.getState().remove('p1');
    expect(store.getState().error).toBe('Could not delete the pilot profile: locked');
    expect(store.getState().profiles).toHaveLength(3);
  });
});

describe('addNightLandings', () => {
  it('appends one entry to the active pilot and recomputes night currency', async () => {
    const { store, userData } = setup({}, await seeded());
    await store.getState().load();
    expect(store.getState().currency.night).toBe('expired');
    expect(await store.getState().addNightLandings(NOW - DAY, 3)).toBe('saved');
    expect((await userData.pilots.get('p2'))?.nightLandingEntries).toEqual([{ date: NOW - DAY, count: 3 }]);
    expect(store.getState().currency.night).toBe('current');
    expect((await userData.pilots.get('p1'))?.nightLandingEntries).toEqual([]);
  });

  it('entries accumulate in the order they were added', async () => {
    const { store, userData } = setup({}, await seeded());
    await store.getState().load();
    await store.getState().addNightLandings(10, 1);
    await store.getState().addNightLandings(20, 2);
    expect((await userData.pilots.get('p2'))?.nightLandingEntries).toEqual([
      { date: 10, count: 1 },
      { date: 20, count: 2 },
    ]);
  });

  it('with no active pilot nothing happens (guard let profile = activeProfile)', async () => {
    const data = createMemoryUserData();
    await data.pilots.insert(newPilotProfile({ id: 'p1', createdAt: 1 }));
    const { store } = setup({}, data);
    await store.getState().load();
    expect(await store.getState().addNightLandings(NOW, 3)).toBe('noActivePilot');
    expect((await data.pilots.get('p1'))?.nightLandingEntries).toEqual([]);
    expect(store.getState().error).toBeNull();
  });

  it.each([
    ['a date that is not a time', Number.NaN, 3],
    ['an infinite date', Number.POSITIVE_INFINITY, 3],
    ['zero landings', NOW, 0],
    ['eleven landings', NOW, 11],
    ['a fractional count', NOW, 2.5],
    ['a count that is not a number', NOW, Number.NaN],
    ['a negative count', NOW, -1],
  ])(
    '%s is invalid and never reaches storage (one malformed entry would make the whole list read as empty)',
    async (_name, date, count) => {
      const { store, userData } = setup({}, await seeded());
      await store.getState().load();
      expect(await store.getState().addNightLandings(date, count)).toBe('invalid');
      expect((await userData.pilots.get('p2'))?.nightLandingEntries).toEqual([]);
    },
  );

  it('the lowest and highest counts of the stepper are accepted', async () => {
    const { store, userData } = setup({}, await seeded());
    await store.getState().load();
    expect(await store.getState().addNightLandings(1, 1)).toBe('saved');
    expect(await store.getState().addNightLandings(2, 10)).toBe('saved');
    expect((await userData.pilots.get('p2'))?.nightLandingEntries.map((e) => e.count)).toEqual([1, 10]);
  });

  it('a failed write is reported and the stored list is unchanged', async () => {
    const data = await seeded();
    const broken = viaTx(data, (r) => ({
      ...r,
      pilots: { ...r.pilots, update: () => Promise.reject(new Error('disk full')) },
    }));
    const { store } = setup({}, broken);
    await store.getState().load();
    expect(await store.getState().addNightLandings(NOW, 3)).toBe('failed');
    expect(store.getState().error).toBe('Could not save the night landings: disk full');
    expect((await data.pilots.get('p2'))?.nightLandingEntries).toEqual([]);
    expect(store.getState().saving).toBe(false);
  });

  it('a second save while one is in flight is ignored, so a double tap cannot log the landings twice', async () => {
    const data = await seeded();
    const gate = Promise.withResolvers<void>();
    const slow = viaTx(data, (r) => ({
      ...r,
      pilots: {
        ...r.pilots,
        update: async (id, patch) => {
          await gate.promise;
          return r.pilots.update(id, patch);
        },
      },
    }));
    const { store } = setup({}, slow);
    await store.getState().load();
    const first = store.getState().addNightLandings(NOW, 3);
    expect(await store.getState().addNightLandings(NOW, 3)).toBe('busy');
    gate.resolve();
    expect(await first).toBe('saved');
    expect((await data.pilots.get('p2'))?.nightLandingEntries).toHaveLength(1);
  });

  it('goes to the pilot who is active when the job runs: a queued select decides who gets the landings', async () => {
    const { store, userData } = setup({}, await seeded());
    await store.getState().load();
    await Promise.all([store.getState().select('p3'), store.getState().addNightLandings(NOW, 2)]);
    expect((await userData.pilots.get('p3'))?.nightLandingEntries).toEqual([{ date: NOW, count: 2 }]);
    expect((await userData.pilots.get('p2'))?.nightLandingEntries).toEqual([]);
  });
});
