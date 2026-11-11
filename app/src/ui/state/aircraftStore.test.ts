// Behaviour of the aircraft list's view model (AircraftProfileViewModel + the save flow of AircraftEditView). Swift has no
// test of it; the cases follow the Swift source, and the guards for failed writes and double taps are JS-only (see U7.md).
import { newAircraftProfile } from '../../data/defaults';
import { emptyAircraftForm, type AircraftForm } from '../../domain/profiles/aircraft';
import { preferencesNetworkPreference } from '../../domain/profiles/networkPreference';
import { FakePreferences } from '../../domain/ports/preferences';
import type { UserData } from '../../domain/userData';
import { createMemoryUserData } from '../../domain/userData/memory';
import { createAircraftStore, type AircraftDeps } from './aircraftStore';

const NOW = Date.UTC(2026, 10, 11, 9, 30);

function setup(over: Partial<AircraftDeps> = {}, userData: UserData = createMemoryUserData()) {
  const prefs = new FakePreferences();
  const onActiveChange = jest.fn();
  let n = 0;
  const deps: AircraftDeps = {
    userData,
    networkPreference: preferencesNetworkPreference(prefs),
    now: () => NOW,
    newId: () => `new-${++n}`,
    onActiveChange,
    ...over,
  };
  return { store: createAircraftStore(deps), userData, prefs, onActiveChange };
}

const form = (over: Partial<AircraftForm> = {}): AircraftForm => ({
  ...emptyAircraftForm(NOW),
  nNumber: 'N12345',
  ...over,
});

async function seeded(): Promise<UserData> {
  const data = createMemoryUserData();
  await data.aircraft.insert(newAircraftProfile('N1', { id: 'a1', createdAt: 100 }));
  await data.aircraft.insert(newAircraftProfile('N2', { id: 'a2', createdAt: 200, isActive: true }));
  await data.aircraft.insert(newAircraftProfile('N3', { id: 'a3', createdAt: 300 }));
  return data;
}

describe('load', () => {
  it('lists the profiles newest first, finds the active one and tells the app', async () => {
    const { store, onActiveChange } = setup({}, await seeded());
    expect(store.getState().loaded).toBe(false);
    await store.getState().load();
    expect(store.getState().profiles.map((p) => p.nNumber)).toEqual(['N3', 'N2', 'N1']);
    expect(store.getState()).toMatchObject({ loaded: true, activeId: 'a2', error: null });
    expect(onActiveChange).toHaveBeenLastCalledWith('a2');
  });

  it('no active profile tells the app null', async () => {
    const data = createMemoryUserData();
    await data.aircraft.insert(newAircraftProfile('N1', { id: 'a1', createdAt: 1 }));
    const { store, onActiveChange } = setup({}, data);
    await store.getState().load();
    expect(store.getState().activeId).toBeNull();
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it('a read that fails keeps the list that was shown and says so (Swift would show an empty list)', async () => {
    const data = await seeded();
    let fail = false;
    const flaky: UserData = {
      ...data,
      aircraft: {
        ...data.aircraft,
        list: () => (fail ? Promise.reject(new Error('db locked')) : data.aircraft.list()),
      },
    };
    const { store } = setup({}, flaky);
    await store.getState().load();
    fail = true;
    await store.getState().load();
    expect(store.getState().profiles).toHaveLength(3);
    expect(store.getState().error).toBe('Could not load the aircraft: db locked');
  });

  it('a first load that fails is not "loaded", so the screen does not claim there are no aircraft', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      aircraft: { ...data.aircraft, list: () => Promise.reject(new Error('db locked')) },
    };
    const { store } = setup({}, broken);
    await store.getState().load();
    expect(store.getState().loaded).toBe(false);
    expect(store.getState().error).toContain('db locked');
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

describe('select (setActive)', () => {
  it('makes one profile active and the others not, and tells the app', async () => {
    const data = await seeded();
    const { store, onActiveChange } = setup({}, data);
    await store.getState().load();
    await store.getState().select('a3');
    expect(store.getState().activeId).toBe('a3');
    expect((await data.aircraft.list()).filter((p) => p.isActive).map((p) => p.id)).toEqual(['a3']);
    expect(onActiveChange).toHaveBeenLastCalledWith('a3');
  });

  it('a profile that is gone is reported and the active one stays', async () => {
    const { store } = setup({}, await seeded());
    await store.getState().load();
    await store.getState().select('missing');
    expect(store.getState().error).toBe(
      'Could not change the active aircraft: This aircraft profile no longer exists.',
    );
    expect(store.getState().activeId).toBe('a2');
  });
});

describe('save', () => {
  it('creates a new inactive profile from the form, keeps its route network under its id and lists it', async () => {
    const { store, userData, prefs } = setup();
    const result = await store.getState().save(
      null,
      form({
        nNumber: ' n777 ',
        aircraftType: 'Cessna 172SP',
        fuelCapacity: '180',
        fuelBurn: '8.5',
        routeNetwork: 'lsa',
      }),
    );
    expect(result).toBe('saved');
    const [created] = await userData.aircraft.list();
    expect(created).toMatchObject({
      id: 'new-1',
      nNumber: 'N777',
      aircraftType: 'Cessna 172SP',
      fuelCapacityGallons: 180,
      fuelBurnGPH: 8.5,
      isActive: false,
      createdAt: NOW,
    });
    expect(await prefs.get('israel.routeNetwork.new-1')).toBe('lsa');
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['new-1']);
    expect(store.getState().error).toBeNull();
  });

  it.each([[''], ['   '], ['\t']])('an N-number of %j is invalid: nothing is written', async (nNumber) => {
    const { store, userData, prefs } = setup();
    expect(await store.getState().save(null, form({ nNumber, routeNetwork: 'cvfr' }))).toBe('invalid');
    expect(await userData.aircraft.list()).toEqual([]);
    expect(await prefs.get('israel.routeNetwork.new-1')).toBeNull();
  });

  it('updates an existing profile and its route network; none clears the preference', async () => {
    const data = await seeded();
    const { store, prefs } = setup({}, data);
    await store.getState().save('a1', form({ nNumber: 'n9', aircraftType: 'PA-28', routeNetwork: 'cvfr' }));
    expect(await data.aircraft.get('a1')).toMatchObject({ nNumber: 'N9', aircraftType: 'PA-28' });
    expect(await prefs.get('israel.routeNetwork.a1')).toBe('cvfr');
    await store.getState().save('a1', form({ nNumber: 'n9', routeNetwork: 'none' }));
    expect(await prefs.get('israel.routeNetwork.a1')).toBeNull();
  });

  it('a write that fails is reported and nothing is half done: no profile is created', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      aircraft: { ...data.aircraft, insert: () => Promise.reject(new Error('disk full')) },
    };
    const { store } = setup({}, broken);
    expect(await store.getState().save(null, form())).toBe('failed');
    expect(store.getState().error).toBe('Could not save the aircraft: disk full');
    expect(await data.aircraft.list()).toEqual([]);
    expect(store.getState().saving).toBe(false);
  });

  it('a profile write that fails after the route network was written clears the network again', async () => {
    const data = createMemoryUserData();
    const broken: UserData = {
      ...data,
      aircraft: { ...data.aircraft, insert: () => Promise.reject(new Error('disk full')) },
    };
    const { store, prefs } = setup({}, broken);
    expect(await store.getState().save(null, form({ routeNetwork: 'cvfr' }))).toBe('failed');
    expect(await prefs.get('israel.routeNetwork.new-1')).toBeNull();
  });

  it('the failed save can be retried: the second attempt creates exactly one aircraft', async () => {
    const data = createMemoryUserData();
    let failInsert = true;
    const flaky: UserData = {
      ...data,
      aircraft: {
        ...data.aircraft,
        insert: (record) => (failInsert ? Promise.reject(new Error('disk full')) : data.aircraft.insert(record)),
      },
    };
    const { store, prefs } = setup({}, flaky);
    expect(await store.getState().save(null, form({ routeNetwork: 'lsa' }))).toBe('failed');
    failInsert = false;
    expect(await store.getState().save(null, form({ routeNetwork: 'lsa' }))).toBe('saved');
    expect((await data.aircraft.list()).map((a) => a.id)).toEqual(['new-2']);
    expect(await prefs.get('israel.routeNetwork.new-1')).toBeNull();
    expect(await prefs.get('israel.routeNetwork.new-2')).toBe('lsa');
    expect(store.getState().error).toBeNull(); // a later good save clears the earlier error
  });

  it('when the route network cannot be saved the profile is not created either, so a retry cannot duplicate it', async () => {
    const failingPrefs = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('prefs down')),
      remove: () => Promise.resolve(),
    };
    const { store, userData } = setup({ networkPreference: preferencesNetworkPreference(failingPrefs) });
    expect(await store.getState().save(null, form({ routeNetwork: 'lsa' }))).toBe('failed');
    expect(await userData.aircraft.list()).toEqual([]);
    expect(store.getState().error).toBe('Could not save the aircraft: prefs down');
  });

  it('a second save while one is in flight is ignored, so a double tap cannot create two aircraft', async () => {
    const data = createMemoryUserData();
    const gate = Promise.withResolvers<void>();
    const slow: UserData = {
      ...data,
      aircraft: {
        ...data.aircraft,
        insert: async (record) => {
          await gate.promise;
          return data.aircraft.insert(record);
        },
      },
    };
    const { store } = setup({}, slow);
    const first = store.getState().save(null, form());
    expect(store.getState().saving).toBe(true);
    expect(await store.getState().save(null, form())).toBe('busy');
    gate.resolve();
    expect(await first).toBe('saved');
    expect(await data.aircraft.list()).toHaveLength(1);
    expect(store.getState().saving).toBe(false);
  });

  it('updating a profile that was deleted meanwhile is reported', async () => {
    const { store } = setup();
    expect(await store.getState().save('gone', form())).toBe('failed');
    expect(store.getState().error).toBe('Could not save the aircraft: This aircraft profile no longer exists.');
  });
});

describe('remove', () => {
  it('deletes the profile and, when it was the active one, leaves none active', async () => {
    const data = await seeded();
    const { store, onActiveChange } = setup({}, data);
    await store.getState().load();
    await store.getState().remove('a2');
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['a3', 'a1']);
    expect(store.getState().activeId).toBeNull();
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it('a delete that fails is reported and the list stays', async () => {
    const data = await seeded();
    const broken: UserData = {
      ...data,
      aircraft: { ...data.aircraft, remove: () => Promise.reject(new Error('locked')) },
    };
    const { store } = setup({}, broken);
    await store.getState().load();
    await store.getState().remove('a1');
    expect(store.getState().error).toBe('Could not delete the aircraft: locked');
    expect(store.getState().profiles).toHaveLength(3);
  });
});

describe('routeNetworkFor', () => {
  it('reads the stored choice for an aircraft', async () => {
    const { store, prefs } = setup();
    await prefs.set('israel.routeNetwork.a1', 'cvfr');
    expect(await store.getState().routeNetworkFor('a1')).toBe('cvfr');
    expect(await store.getState().routeNetworkFor('a2')).toBeNull();
  });

  it('a read that fails reads as none and says so', async () => {
    const failingPrefs = {
      get: () => Promise.reject(new Error('prefs down')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    const { store } = setup({ networkPreference: preferencesNetworkPreference(failingPrefs) });
    expect(await store.getState().routeNetworkFor('a1')).toBeNull();
    expect(store.getState().error).toBe('Could not read the route network: prefs down');
  });
});

describe('order', () => {
  it('actions run in the order they were called: select, then remove of the selected', async () => {
    const data = await seeded();
    const { store } = setup({}, data);
    await store.getState().load();
    await Promise.all([store.getState().select('a1'), store.getState().remove('a1')]);
    expect(store.getState().activeId).toBeNull();
    expect(store.getState().profiles.map((p) => p.id)).toEqual(['a3', 'a2']);
  });
});
