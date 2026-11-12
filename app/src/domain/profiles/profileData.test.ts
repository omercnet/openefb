// The stored side of AircraftProfileViewModel and PilotProfileViewModel (loadProfiles, addProfile, deleteProfile, setActive,
// addNightLandings, saveEdits) over UserData, run against SQLite and the in-memory fake. Swift has no test of these.
import { newAircraftProfile, newPilotProfile } from '../../data/defaults';
import { migrate } from '../../data/migrate';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { userDataFromDb, type UserData } from '../userData';
import { createMemoryUserData } from '../userData/memory';
import {
  addNightLandings,
  createAircraftProfile,
  createPilotProfile,
  deleteAircraftProfile,
  deletePilotProfile,
  loadAircraftProfiles,
  loadPilotProfiles,
  ProfileNotFoundError,
  setActiveAircraft,
  setActivePilot,
  updateAircraftProfile,
  updatePilotProfile,
} from './profileData';

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

describe.each(makers)('aircraft profiles over %s', (_name, make) => {
  it('loads newest first (AircraftProfileViewModel.loadProfiles sorts createdAt descending)', async () => {
    const data = await make();
    for (const [nNumber, createdAt] of [
      ['N2', 200],
      ['N1', 100],
      ['N3', 300],
    ] as const) {
      await data.aircraft.insert(newAircraftProfile(nNumber, { id: uuid(), createdAt }));
    }
    expect((await loadAircraftProfiles(data)).map((a) => a.nNumber)).toEqual(['N3', 'N2', 'N1']);
  });

  it('creates an inactive profile with the form fields, and returns it', async () => {
    const data = await make();
    const created = await createAircraftProfile(
      data,
      {
        nNumber: 'N12345',
        aircraftType: 'Cessna 172SP',
        fuelCapacityGallons: 180,
        fuelBurnGPH: 8.5,
        cruiseSpeedKts: 110,
        icaoTypeDesignator: 'C172',
        personsOnBoard: 2,
        vSpeeds: { vr: 55, vx: null, vy: null, va: null, vne: null, vfe: null, vs0: null, vs1: null },
        annualDue: 1_800_000_000_000,
        transponderDue: null,
      },
      { newId: () => 'fixed-id', now: () => 7 },
    );
    expect(created).toMatchObject({
      id: 'fixed-id',
      nNumber: 'N12345',
      isActive: false,
      createdAt: 7,
      personsOnBoard: 2,
    });
    expect(await data.aircraft.get('fixed-id')).toEqual(created);
  });

  it('updates the form fields of a profile and leaves the rest', async () => {
    const data = await make();
    const a = newAircraftProfile('N1', { id: uuid(), createdAt: 1, isActive: true, fuelCapacityGallons: 50 });
    await data.aircraft.insert(a);
    const updated = await updateAircraftProfile(data, a.id, {
      nNumber: 'N9',
      aircraftType: 'PA-28',
      fuelCapacityGallons: null,
      fuelBurnGPH: 9,
      cruiseSpeedKts: null,
      icaoTypeDesignator: null,
      personsOnBoard: null,
      vSpeeds: null,
      annualDue: null,
      transponderDue: null,
    });
    expect(updated).toMatchObject({
      nNumber: 'N9',
      aircraftType: 'PA-28',
      fuelCapacityGallons: null,
      fuelBurnGPH: 9,
      isActive: true,
    });
  });

  it('updating a profile that is gone rejects', async () => {
    const data = await make();
    await expect(updateAircraftProfile(data, uuid(), { nNumber: 'N1' } as never)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });

  it('setActive deactivates the others and activates the chosen one (only one is ever active)', async () => {
    const data = await make();
    const [a, b, c] = ['N1', 'N2', 'N3'].map((nNumber, i) =>
      newAircraftProfile(nNumber, { id: uuid(), createdAt: i + 1 }),
    );
    for (const x of [a, b, c]) await data.aircraft.insert(x);

    await setActiveAircraft(data, a.id);
    expect((await data.aircraft.list()).filter((x) => x.isActive).map((x) => x.id)).toEqual([a.id]);
    await setActiveAircraft(data, c.id);
    expect((await data.aircraft.list()).filter((x) => x.isActive).map((x) => x.id)).toEqual([c.id]);
    await setActiveAircraft(data, c.id);
    expect((await data.aircraft.list()).filter((x) => x.isActive).map((x) => x.id)).toEqual([c.id]);
  });

  it('choosing a profile that is gone rejects and the current one stays active', async () => {
    const data = await make();
    const a = newAircraftProfile('N1', { id: uuid(), createdAt: 1, isActive: true });
    await data.aircraft.insert(a);
    await expect(setActiveAircraft(data, uuid())).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect((await data.aircraft.get(a.id))?.isActive).toBe(true);
  });

  it('deleting the active profile leaves none active; deleting what is not there reports false', async () => {
    const data = await make();
    const a = newAircraftProfile('N1', { id: uuid(), createdAt: 1, isActive: true });
    const b = newAircraftProfile('N2', { id: uuid(), createdAt: 2 });
    await data.aircraft.insert(a);
    await data.aircraft.insert(b);
    expect(await deleteAircraftProfile(data, a.id)).toBe(true);
    expect((await loadAircraftProfiles(data)).some((x) => x.isActive)).toBe(false);
    expect(await deleteAircraftProfile(data, a.id)).toBe(false);
  });
});

describe.each(makers)('pilot profiles over %s', (_name, make) => {
  it('loads newest first', async () => {
    const data = await make();
    await data.pilots.insert(newPilotProfile({ id: uuid(), name: 'old', createdAt: 1 }));
    await data.pilots.insert(newPilotProfile({ id: uuid(), name: 'new', createdAt: 2 }));
    expect((await loadPilotProfiles(data)).map((p) => p.name)).toEqual(['new', 'old']);
  });

  // OWNER-APPROVED DEVIATION FROM SWIFT (Q5, 2026-11-12): Swift never activated a new profile.
  it('addProfile inserts a blank profile at once; the first one becomes the active pilot', async () => {
    const data = await make();
    const created = await createPilotProfile(data, { newId: () => 'p-new', now: () => 9 });
    expect(created).toMatchObject({ id: 'p-new', name: '', isActive: true, createdAt: 9, nightLandingEntries: [] });
    expect((await loadPilotProfiles(data)).map((p) => [p.id, p.isActive])).toEqual([['p-new', true]]);
  });

  it('a second profile does not change the active one', async () => {
    const data = await make();
    await createPilotProfile(data, { newId: () => 'first', now: () => 1 });
    const second = await createPilotProfile(data, { newId: () => 'second', now: () => 2 });
    expect(second.isActive).toBe(false);
    expect((await data.pilots.list()).filter((p) => p.isActive).map((p) => p.id)).toEqual(['first']);
  });

  it('a profile created while another is active (set earlier) stays inactive', async () => {
    const data = await make();
    await data.pilots.insert(newPilotProfile({ id: uuid(), createdAt: 1, isActive: true }));
    expect((await createPilotProfile(data, { now: () => 5 })).isActive).toBe(false);
  });

  it('deleting the active profile leaves none active; deleting what is not there reports false', async () => {
    const data = await make();
    const a = newAircraftProfile('N1', { id: uuid(), createdAt: 1, isActive: true });
    const b = newAircraftProfile('N2', { id: uuid(), createdAt: 2 });
    await data.aircraft.insert(a);
    await data.aircraft.insert(b);
    expect(await deleteAircraftProfile(data, a.id)).toBe(true);
    expect((await loadAircraftProfiles(data)).some((x) => x.isActive)).toBe(false);
    expect(await deleteAircraftProfile(data, a.id)).toBe(false);
  });
});

describe.each(makers)('pilot profiles over %s', (_name, make) => {
  it('loads newest first', async () => {
    const data = await make();
    await data.pilots.insert(newPilotProfile({ id: uuid(), name: 'old', createdAt: 1 }));
    await data.pilots.insert(newPilotProfile({ id: uuid(), name: 'new', createdAt: 2 }));
    expect((await loadPilotProfiles(data)).map((p) => p.name)).toEqual(['new', 'old']);
  });

  // OWNER-APPROVED DEVIATION FROM SWIFT (Q5, 2026-11-12): Swift never activated a new profile.
  it('addProfile inserts a blank profile at once; the first one becomes the active pilot', async () => {
    const data = await make();
    const created = await createPilotProfile(data, { newId: () => 'p-new', now: () => 9 });
    expect(created).toMatchObject({ id: 'p-new', name: '', isActive: true, createdAt: 9, nightLandingEntries: [] });
    expect((await loadPilotProfiles(data)).map((p) => [p.id, p.isActive])).toEqual([['p-new', true]]);
  });

  it('a second profile does not change the active one', async () => {
    const data = await make();
    await createPilotProfile(data, { newId: () => 'first', now: () => 1 });
    const second = await createPilotProfile(data, { newId: () => 'second', now: () => 2 });
    expect(second.isActive).toBe(false);
    expect((await data.pilots.list()).filter((p) => p.isActive).map((p) => p.id)).toEqual(['first']);
  });

  it('a profile created while another is active (set earlier) stays inactive', async () => {
    const data = await make();
    await data.pilots.insert(newPilotProfile({ id: uuid(), createdAt: 1, isActive: true }));
    expect((await createPilotProfile(data, { now: () => 5 })).isActive).toBe(false);
  });

  it('deleting the active profile leaves none active, as in Swift', async () => {
    const data = await make();
    const first = await createPilotProfile(data, { now: () => 1 });
    await createPilotProfile(data, { now: () => 2 });
    await deletePilotProfile(data, first.id);
    expect((await data.pilots.list()).some((p) => p.isActive)).toBe(false);
  });

  it('updates the form fields', async () => {
    const data = await make();
    const p = newPilotProfile({ id: uuid(), createdAt: 1, isActive: true });
    await data.pilots.insert(p);
    const updated = await updatePilotProfile(data, p.id, {
      name: 'Ada',
      certificateNumber: '123',
      phone: null,
      email: null,
      certificateType: 'private',
      medicalClass: 'third',
      medicalExpiry: 1_800_000_000_000,
      flightReviewDate: null,
      totalHours: 300,
    });
    expect(updated).toMatchObject({ name: 'Ada', certificateType: 'private', totalHours: 300, isActive: true });
    await expect(updatePilotProfile(data, uuid(), { name: 'x' } as never)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('setActive works the same way for pilots, and a missing pilot rejects without changing the active one', async () => {
    const data = await make();
    const a = newPilotProfile({ id: uuid(), createdAt: 1, isActive: true });
    const b = newPilotProfile({ id: uuid(), createdAt: 2 });
    await data.pilots.insert(a);
    await data.pilots.insert(b);
    await setActivePilot(data, b.id);
    expect((await data.pilots.list()).filter((p) => p.isActive).map((p) => p.id)).toEqual([b.id]);
    await expect(setActivePilot(data, uuid())).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect((await data.pilots.get(b.id))?.isActive).toBe(true);
  });

  it('deletes a pilot', async () => {
    const data = await make();
    const p = newPilotProfile({ id: uuid(), createdAt: 1 });
    await data.pilots.insert(p);
    expect(await deletePilotProfile(data, p.id)).toBe(true);
    expect(await deletePilotProfile(data, p.id)).toBe(false);
  });

  it('addNightLandings appends to the pilot one entry at a time', async () => {
    const data = await make();
    const p = newPilotProfile({
      id: uuid(),
      createdAt: 1,
      isActive: true,
      nightLandingEntries: [{ date: 1, count: 1 }],
    });
    await data.pilots.insert(p);
    await addNightLandings(data, p.id, 5, 3);
    await addNightLandings(data, p.id, 6, 2);
    expect((await data.pilots.get(p.id))?.nightLandingEntries).toEqual([
      { date: 1, count: 1 },
      { date: 5, count: 3 },
      { date: 6, count: 2 },
    ]);
  });

  it('addNightLandings for a pilot that is gone rejects', async () => {
    const data = await make();
    await expect(addNightLandings(data, uuid(), 5, 3)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});
