// Repository behaviour over the Node sqlite Db. The seeded-store cases port
// SwiftDataMigrationCharacterizationTests.seedStore/expectSeededRows (the store reopens with all rows intact).
import type { Db } from '../../src/data/db';
import {
  newAircraftProfile,
  newFlightPlanRecord,
  newFlightRecord,
  newLogbookEntry,
  newPilotProfile,
} from '../../src/data/defaults';
import { migrate } from '../../src/data/migrate';
import {
  aircraftRepository,
  flightPlanRepository,
  flightRecordRepository,
  logbookRepository,
  pilotRepository,
  settingsRepository,
} from '../../src/data/repositories';
import { openNodeSqliteDb } from '../support/nodeSqliteDb';

const START = 1_793_332_020_000;
const ids = { flight: 'F1', aircraft: 'A1', pilot: 'P1', plan: 'PL1' };

let db: Db;
beforeEach(async () => {
  db = openNodeSqliteDb();
  await migrate(db);
});

describe('seeded store', () => {
  it('reads back every seeded row (appStyleStoreReopensWithTheSameAppStyleContainer)', async () => {
    const settings = settingsRepository(db);
    await settings.update({ activeAircraftID: ids.aircraft, regionRaw: 'us' });
    await aircraftRepository(db).insert(
      newAircraftProfile('N12345', { id: ids.aircraft, aircraftType: 'C172', fuelCapacityGallons: 56, isActive: true }),
    );
    await pilotRepository(db).insert(newPilotProfile({ id: ids.pilot, name: 'Test Pilot', totalHours: 123.4 }));
    await flightPlanRepository(db).insert(
      newFlightPlanRecord({ id: ids.plan, departureICAO: 'KPAO', destinationICAO: 'KSQL', cruiseAltitude: 4500 }),
    );
    await flightRecordRepository(db).insert(
      newFlightRecord({
        id: ids.flight,
        startDate: START,
        endDate: START + 1_800_000,
        trackPointCount: 1800,
        audioFileURL: `recordings/${ids.flight}.m4a`,
      }),
    );
    await logbookRepository(db).insert(
      newLogbookEntry({ flightID: ids.flight, isConfirmed: true, durationSeconds: 1800 }),
    );

    const s = await settings.get();
    expect(s).toMatchObject({
      activeAircraftID: ids.aircraft,
      defaultMapMode: 'northUp',
      sectionalOpacity: 0.7,
      weatherRefreshInterval: 900,
      regionRaw: 'us',
    });
    const aircraft = await aircraftRepository(db).list();
    expect(aircraft).toHaveLength(1);
    expect(aircraft[0]).toMatchObject({ id: ids.aircraft, nNumber: 'N12345', fuelCapacityGallons: 56, isActive: true });
    const pilots = await pilotRepository(db).list();
    expect(pilots).toHaveLength(1);
    expect(pilots[0]).toMatchObject({ id: ids.pilot, name: 'Test Pilot', totalHours: 123.4 });
    const plans = await flightPlanRepository(db).list();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: ids.plan, destinationICAO: 'KSQL', cruiseAltitude: 4500 });
    const flights = await flightRecordRepository(db).list();
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({
      id: ids.flight,
      startDate: START,
      trackPointCount: 1800,
      audioFileURL: `recordings/${ids.flight}.m4a`,
    });
    const entries = await logbookRepository(db).list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ flightID: ids.flight, isConfirmed: true });
  });
});

describe('aircraft repository', () => {
  it('aircraftVSpeedsRoundTrip', async () => {
    const repo = aircraftRepository(db);
    const a = newAircraftProfile('N4543A', {
      vSpeeds: { vr: 55, vx: null, vy: 76, va: null, vne: null, vfe: null, vs0: null, vs1: null },
    });
    await repo.insert(a);
    const back = (await repo.get(a.id))!;
    expect(back.vSpeeds).not.toBeNull();
    expect(back.vSpeeds?.vr).toBe(55);
    expect(back.vSpeeds?.vy).toBe(76);
    expect(back.vSpeeds?.vx).toBeNull();
    expect(back).toEqual(a);
  });
  it('unreadable v-speeds data reads as nil, like try? in Swift', async () => {
    const repo = aircraftRepository(db);
    const a = newAircraftProfile('N1');
    await repo.insert(a);
    await db.run('UPDATE aircraft_profile SET v_speeds_data = ? WHERE id = ?', ['{not json', a.id]);
    expect((await repo.get(a.id))!.vSpeeds).toBeNull();
  });
  it('updates only the given fields and reports a missing id', async () => {
    const repo = aircraftRepository(db);
    const a = newAircraftProfile('N1', { aircraftType: 'C172' });
    await repo.insert(a);
    expect(await repo.update(a.id, { isActive: true, personsOnBoard: 2 })).toEqual({
      ...a,
      isActive: true,
      personsOnBoard: 2,
    });
    expect(await repo.update(a.id, {})).toMatchObject({ aircraftType: 'C172' });
    expect(await repo.update('missing', { isActive: true })).toBeNull();
  });
  it('lists oldest first and removes by id', async () => {
    const repo = aircraftRepository(db);
    await repo.insert(newAircraftProfile('N2', { id: 'b', createdAt: 20 }));
    await repo.insert(newAircraftProfile('N1', { id: 'a', createdAt: 10 }));
    expect((await repo.list()).map((x) => x.id)).toEqual(['a', 'b']);
    expect(await repo.remove('a')).toBe(true);
    expect(await repo.remove('a')).toBe(false);
    expect(await repo.get('a')).toBeNull();
  });
  it('rejects a duplicate id', async () => {
    const repo = aircraftRepository(db);
    await repo.insert(newAircraftProfile('N1', { id: 'x' }));
    await expect(repo.insert(newAircraftProfile('N2', { id: 'x' }))).rejects.toThrow();
  });
});

describe('pilot repository', () => {
  it('pilotNightLandingsRoundTrip', async () => {
    const repo = pilotRepository(db);
    const p = newPilotProfile({ nightLandingEntries: [{ date: 1_700_000_000_000, count: 3 }] });
    await repo.insert(p);
    const back = (await repo.get(p.id))!;
    expect(back.nightLandingEntries).toHaveLength(1);
    expect(back.nightLandingEntries[0].count).toBe(3);
    expect(back).toEqual(p);
  });
  it('missing or unreadable night landing data reads as an empty list', async () => {
    const repo = pilotRepository(db);
    const p = newPilotProfile();
    await repo.insert(p);
    await db.run('UPDATE pilot_profile SET night_landing_entries_data = NULL WHERE id = ?', [p.id]);
    expect((await repo.get(p.id))!.nightLandingEntries).toEqual([]);
    await db.run('UPDATE pilot_profile SET night_landing_entries_data = ? WHERE id = ?', ['[{"date":"x"}]', p.id]);
    expect((await repo.get(p.id))!.nightLandingEntries).toEqual([]);
  });
  it('keeps dates and optional strings', async () => {
    const repo = pilotRepository(db);
    const p = newPilotProfile({
      medicalClass: 'basicMed',
      medicalExpiry: 1_900_000_000_000,
      email: 'a@b.c',
      isActive: true,
    });
    await repo.insert(p);
    expect(await repo.get(p.id)).toEqual(p);
  });
});

describe('flight plan, flight and logbook repositories', () => {
  it('round-trips a flight plan and lists the most recently used first', async () => {
    const repo = flightPlanRepository(db);
    const old = newFlightPlanRecord({ id: 'old', lastUsedAt: 1, departureICAO: 'KPAO', departureLatitude: 37.4613 });
    await repo.insert(old);
    await repo.insert(newFlightPlanRecord({ id: 'new', lastUsedAt: 9, fuelBurnGPH: 8.5 }));
    expect((await repo.list()).map((p) => p.id)).toEqual(['new', 'old']);
    expect(await repo.get('old')).toEqual(old);
    expect((await repo.update('old', { lastUsedAt: 99 }))!.lastUsedAt).toBe(99);
  });
  it('round-trips a flight record with an open end and lists newest first', async () => {
    const repo = flightRecordRepository(db);
    const open = newFlightRecord({ id: 'open', startDate: 2000, hasDebrief: true });
    await repo.insert(open);
    await repo.insert(newFlightRecord({ id: 'older', startDate: 1000, endDate: 1500 }));
    expect((await repo.list()).map((f) => f.id)).toEqual(['open', 'older']);
    expect((await repo.get('open'))!.endDate).toBeNull();
    expect(await repo.get('open')).toEqual(open);
  });
  it('round-trips logbook entries, finds them by flight and confirms one', async () => {
    const repo = logbookRepository(db);
    const e = newLogbookEntry({ id: 'e1', flightID: 'F1', date: 5, nightLandingCount: 2, route: 'KPAO KSQL' });
    await repo.insert(e);
    await repo.insert(newLogbookEntry({ id: 'e2', flightID: 'F2', date: 9 }));
    expect(await repo.get('e1')).toEqual(e);
    expect((await repo.byFlightId('F1')).map((x) => x.id)).toEqual(['e1']);
    expect((await repo.list()).map((x) => x.id)).toEqual(['e2', 'e1']);
    expect((await repo.update('e1', { isConfirmed: true }))!.isConfirmed).toBe(true);
  });
  it('rejects a non-boolean flag value at the database', async () => {
    await expect(
      db.run("INSERT INTO logbook_entry (id, date, is_confirmed, created_at) VALUES ('x', 1, 2, 1)"),
    ).rejects.toThrow();
  });
});

describe('settings repository', () => {
  it('has no row until first use, then creates one with the Swift defaults', async () => {
    const repo = settingsRepository(db);
    expect(await repo.get()).toBeNull();
    const s = await repo.getOrCreate({ now: () => 42 });
    expect(s).toMatchObject({
      defaultMapMode: 'northUp',
      sectionalOpacity: 0.7,
      weatherRefreshInterval: 900,
      regionRaw: 'israel',
      createdAt: 42,
    });
    expect(s.activeAircraftID).toBeNull();
  });
  it('keeps a single row across calls', async () => {
    const repo = settingsRepository(db);
    const a = await repo.getOrCreate();
    const b = await repo.getOrCreate();
    expect(b.id).toBe(a.id);
    expect(await db.all('SELECT id FROM user_settings')).toHaveLength(1);
  });
  it('updates fields, creating the row when needed, and stores an unknown region raw value as is', async () => {
    const repo = settingsRepository(db);
    const s = await repo.update({ lastFlightPlanID: 'PL1', regionRaw: 'atlantis', sectionalOpacity: 0.5 });
    expect(s).toMatchObject({ lastFlightPlanID: 'PL1', regionRaw: 'atlantis', sectionalOpacity: 0.5 });
    expect((await repo.update({ activePilotID: null })).lastFlightPlanID).toBe('PL1');
  });
});
