// One contract, two implementations: the real one over the data layer (node sqlite) and the in-memory fake that tests,
// the screenshot fixtures and the web preview use. If the fake drifts from SQL behaviour, these fail.
import { newAircraftProfile, newLogbookEntry, newPilotProfile } from '../../data/defaults';
import { migrate } from '../../data/migrate';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { createMemoryUserData } from './memory';
import { userDataFromDb, type UserData } from './index';

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

describe.each(makers)('UserData over %s', (_name, make) => {
  it('lists aircraft and pilots oldest first, ties in insertion order (D2 repository convention)', async () => {
    const data = await make();
    const a2 = newAircraftProfile('N2', { id: uuid(), createdAt: 200 });
    const a1 = newAircraftProfile('N1', { id: uuid(), createdAt: 100 });
    const a3 = newAircraftProfile('N3', { id: uuid(), createdAt: 200 });
    for (const a of [a2, a1, a3]) await data.aircraft.insert(a);
    expect((await data.aircraft.list()).map((a) => a.nNumber)).toEqual(['N1', 'N2', 'N3']);

    const p2 = newPilotProfile({ id: uuid(), name: 'B', createdAt: 20 });
    const p1 = newPilotProfile({ id: uuid(), name: 'A', createdAt: 10 });
    for (const p of [p2, p1]) await data.pilots.insert(p);
    expect((await data.pilots.list()).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('lists logbook entries newest first and finds those of one flight', async () => {
    const data = await make();
    const flightID = uuid();
    const old = newLogbookEntry({ id: uuid(), date: 100, flightID });
    const recent = newLogbookEntry({ id: uuid(), date: 300 });
    const mid = newLogbookEntry({ id: uuid(), date: 200, flightID });
    for (const e of [old, recent, mid]) await data.logbook.insert(e);
    expect((await data.logbook.list()).map((e) => e.date)).toEqual([300, 200, 100]);
    expect((await data.logbook.byFlightId(flightID)).map((e) => e.date)).toEqual([200, 100]);
  });

  it('get returns null for an unknown id; update merges only the given fields; remove reports whether a row went', async () => {
    const data = await make();
    const id = uuid();
    expect(await data.pilots.get(id)).toBeNull();
    expect(await data.pilots.update(id, { name: 'x' })).toBeNull();
    await data.pilots.insert(newPilotProfile({ id, name: 'Ada', phone: '123', createdAt: 1 }));
    const updated = await data.pilots.update(id, { name: 'Grace', phone: undefined });
    expect(updated).toMatchObject({ id, name: 'Grace', phone: '123' });
    expect(await data.pilots.remove(id)).toBe(true);
    expect(await data.pilots.remove(id)).toBe(false);
  });

  it('a stored record is a copy: changing what was read does not change the store', async () => {
    const data = await make();
    const id = uuid();
    await data.pilots.insert(
      newPilotProfile({ id, name: 'Ada', nightLandingEntries: [{ date: 1, count: 3 }], createdAt: 1 }),
    );
    const read = (await data.pilots.get(id))!;
    read.name = 'changed';
    read.nightLandingEntries.push({ date: 2, count: 1 });
    expect(await data.pilots.get(id)).toMatchObject({ name: 'Ada', nightLandingEntries: [{ date: 1, count: 3 }] });
  });

  it('inserting a second record with the same id rejects', async () => {
    const data = await make();
    const id = uuid();
    await data.aircraft.insert(newAircraftProfile('N1', { id, createdAt: 1 }));
    await expect(data.aircraft.insert(newAircraftProfile('N2', { id, createdAt: 2 }))).rejects.toThrow();
    expect((await data.aircraft.list()).map((a) => a.nNumber)).toEqual(['N1']);
  });

  it('settings: absent until created, created with the model defaults, then updated in place', async () => {
    const data = await make();
    expect(await data.settings.get()).toBeNull();
    const created = await data.settings.getOrCreate({ now: () => 5 });
    expect(created).toMatchObject({ regionRaw: 'israel', defaultMapMode: 'northUp', createdAt: 5 });
    const again = await data.settings.getOrCreate({ now: () => 99 });
    expect(again.id).toBe(created.id);
    expect(again.createdAt).toBe(5);
    expect(await data.settings.update({ regionRaw: 'us' })).toMatchObject({ id: created.id, regionRaw: 'us' });
    expect((await data.settings.get())?.regionRaw).toBe('us');
  });

  describe('atomically', () => {
    it('commits every write when the function resolves, and returns its value', async () => {
      const data = await make();
      const result = await data.atomically(async (tx) => {
        await tx.aircraft.insert(newAircraftProfile('N1', { id: uuid(), createdAt: 1 }));
        await tx.pilots.insert(newPilotProfile({ id: uuid(), name: 'Ada', createdAt: 1 }));
        return 'done';
      });
      expect(result).toBe('done');
      expect(await data.aircraft.list()).toHaveLength(1);
      expect(await data.pilots.list()).toHaveLength(1);
    });

    it('rolls every write back when the function rejects, and rethrows', async () => {
      const data = await make();
      const keep = newAircraftProfile('KEEP', { id: uuid(), createdAt: 1 });
      await data.aircraft.insert(keep);
      await expect(
        data.atomically(async (tx) => {
          await tx.aircraft.update(keep.id, { nNumber: 'CHANGED' });
          await tx.aircraft.insert(newAircraftProfile('N2', { id: uuid(), createdAt: 2 }));
          await tx.pilots.insert(newPilotProfile({ id: uuid(), createdAt: 1 }));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await data.aircraft.list()).map((a) => a.nNumber)).toEqual(['KEEP']);
      expect(await data.pilots.list()).toEqual([]);
    });

    it('rolls back when a write inside rejects (a duplicate id), leaving the earlier write undone', async () => {
      const data = await make();
      const id = uuid();
      await data.aircraft.insert(newAircraftProfile('N1', { id, createdAt: 1 }));
      await expect(
        data.atomically(async (tx) => {
          await tx.pilots.insert(newPilotProfile({ id: uuid(), createdAt: 1 }));
          await tx.aircraft.insert(newAircraftProfile('DUP', { id, createdAt: 2 }));
        }),
      ).rejects.toThrow();
      expect(await data.pilots.list()).toEqual([]);
    });

    it('reads inside see the writes made earlier inside', async () => {
      const data = await make();
      await data.atomically(async (tx) => {
        await tx.pilots.insert(newPilotProfile({ id: uuid(), name: 'Ada', createdAt: 1 }));
        expect(await tx.pilots.list()).toHaveLength(1);
      });
    });
  });
});

describe('createMemoryUserData seed', () => {
  it('starts from the given records', async () => {
    const pilot = newPilotProfile({ id: uuid(), name: 'Seeded', createdAt: 1 });
    const data = createMemoryUserData({ pilots: [pilot], settings: { regionRaw: 'us' } });
    expect(await data.pilots.get(pilot.id)).toMatchObject({ name: 'Seeded' });
    expect((await data.settings.get())?.regionRaw).toBe('us');
  });
});

describe('createMemoryUserData concurrency and columns (#45 review)', () => {
  it('listWhere accepts the id column, as SQL does', async () => {
    const pilot = newPilotProfile({ id: 'p1' });
    const data = createMemoryUserData({ pilots: [pilot] });
    expect((await data.pilots.listWhere('id', 'p1')).map((p) => p.id)).toEqual(['p1']);
  });

  it('two settings updates started together both land', async () => {
    const data = createMemoryUserData();
    await Promise.all([data.settings.update({ regionRaw: 'us' }), data.settings.update({ sectionalOpacity: 0.4 })]);
    expect(await data.settings.get()).toMatchObject({ regionRaw: 'us', sectionalOpacity: 0.4 });
  });

  it('a rollback does not undo another transaction that committed meanwhile', async () => {
    const data = createMemoryUserData();
    const gate = Promise.withResolvers<void>();
    const a = data.atomically(async () => {
      await gate.promise;
      throw new Error('fail');
    });
    const b = data.atomically((r) => r.settings.update({ regionRaw: 'us' }));
    gate.resolve();
    await expect(a).rejects.toThrow('fail');
    await b;
    expect((await data.settings.get())?.regionRaw).toBe('us');
  });
});
