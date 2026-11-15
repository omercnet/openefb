import { migrate } from '../../data/migrate';
import { FakePreferences } from '../../domain/ports/preferences';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { createProfiles } from './profiles';

describe('profiles', () => {
  it('has no active profile on a fresh database, and follows one once created and loaded', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    const profiles = createProfiles(db, new FakePreferences());
    await profiles.load();
    expect(profiles.activeIds()).toEqual({ aircraftProfileID: null, pilotProfileID: null });
    await profiles.pilot.getState().create();
    await profiles.load();
    expect(profiles.activeIds().pilotProfileID).not.toBeNull(); // Q5=A: the first pilot profile is active
  });
});
