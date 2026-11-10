import { currentVersion, migrate, splitStatements } from '../../src/data/migrate';
import { LATEST_VERSION, migrations, type Migration } from '../../src/data/migrations';
import { openNodeSqliteDb } from '../support/nodeSqliteDb';

const tableNames = async (db: ReturnType<typeof openNodeSqliteDb>) =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
    (r) => r.name,
  );

describe('schema migrations', () => {
  it('creates exactly the six SchemaV1 tables on a fresh database and records the version', async () => {
    const db = openNodeSqliteDb();
    expect(await currentVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    expect(await tableNames(db)).toEqual([
      'aircraft_profile',
      'flight_plan_record',
      'flight_record',
      'logbook_entry',
      'pilot_profile',
      'user_settings',
    ]);
  });

  it('numbers migrations 1..N with no gaps', () => {
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
  });

  it('is idempotent: a second run changes nothing and keeps the data', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    await db.run("INSERT INTO pilot_profile (id, name, created_at) VALUES ('p1', 'Test Pilot', 1)");
    await migrate(db);
    expect(await db.all('SELECT name FROM pilot_profile')).toEqual([{ name: 'Test Pilot' }]);
  });

  it('upgrades a v1 database through a later migration and keeps its rows', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    await db.run("INSERT INTO aircraft_profile (id, n_number, created_at) VALUES ('a1', 'N12345', 1)");
    const v2: Migration = { version: 2, name: 'add_color', sql: 'ALTER TABLE aircraft_profile ADD COLUMN color TEXT;' };
    expect(await migrate(db, [...migrations, v2])).toBe(2);
    expect(await currentVersion(db)).toBe(2);
    expect(await db.get('SELECT n_number, color FROM aircraft_profile')).toEqual({ n_number: 'N12345', color: null });
  });

  it('rolls a failing migration back completely and leaves the version alone', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    const bad: Migration = {
      version: 2,
      name: 'bad',
      sql: 'ALTER TABLE aircraft_profile ADD COLUMN color TEXT; ALTER TABLE no_such_table ADD COLUMN x TEXT;',
    };
    await expect(migrate(db, [...migrations, bad])).rejects.toThrow();
    expect(await currentVersion(db)).toBe(1);
    const cols = await db.all<{ name: string }>('PRAGMA table_info(aircraft_profile)');
    expect(cols.map((c) => c.name)).not.toContain('color');
  });

  it('refuses a database written by a newer app', async () => {
    const db = openNodeSqliteDb();
    await db.run('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow('newer than this app supports');
  });

  it('splits scripts into statements', () => {
    expect(splitStatements('A;\n B ;\n')).toEqual(['A', 'B']);
  });
});
