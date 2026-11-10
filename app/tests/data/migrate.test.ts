import { currentVersion, migrate, splitStatements } from '../../src/data/migrate';
import { LATEST_VERSION, migrations, type Migration } from '../../src/data/migrations';
import { openNodeSqliteDb } from '../support/nodeSqliteDb';

const tableNames = async (db: ReturnType<typeof openNodeSqliteDb>) =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
    (r) => r.name,
  );

describe('schema migrations', () => {
  it('creates the six SchemaV1 tables plus the import tables on a fresh database and records the version', async () => {
    const db = openNodeSqliteDb();
    expect(await currentVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    expect(await tableNames(db)).toEqual([
      'aircraft_profile',
      'app_preferences',
      'flight_plan_record',
      'flight_record',
      'logbook_entry',
      'migration_state',
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

  it('upgrades a v1 database to v2 and keeps its rows', async () => {
    const db = openNodeSqliteDb();
    await migrate(db, migrations.slice(0, 1));
    expect(await currentVersion(db)).toBe(1);
    await db.run("INSERT INTO flight_record (id, start_date, created_at) VALUES ('f1', 5, 5)");
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(await db.all('SELECT id FROM flight_record')).toEqual([{ id: 'f1' }]);
    expect(await db.all('SELECT * FROM migration_state')).toEqual([]);
  });

  it('upgrades a v1 database through a later migration and keeps its rows', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    await db.run("INSERT INTO aircraft_profile (id, n_number, created_at) VALUES ('a1', 'N12345', 1)");
    const v2: Migration = { version: 3, name: 'add_color', sql: 'ALTER TABLE aircraft_profile ADD COLUMN color TEXT;' };
    expect(await migrate(db, [...migrations, v2])).toBe(3);
    expect(await currentVersion(db)).toBe(3);
    expect(await db.get('SELECT n_number, color FROM aircraft_profile')).toEqual({ n_number: 'N12345', color: null });
  });

  it('rolls a failing migration back completely and leaves the version alone', async () => {
    const db = openNodeSqliteDb();
    await migrate(db);
    const bad: Migration = {
      version: 3,
      name: 'bad',
      sql: 'ALTER TABLE aircraft_profile ADD COLUMN color TEXT; ALTER TABLE no_such_table ADD COLUMN x TEXT;',
    };
    await expect(migrate(db, [...migrations, bad])).rejects.toThrow();
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
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
