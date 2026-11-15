// The launch sequence (efb_212App.init, MapContainerView.initializeServices): user database and its migrations, the
// saved region, the aviation databases, the remote config, in that order, with Swift's failure behaviour for each.
import type { AviationDatabase } from '../../data/aviation/aviationDatabase';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { Db } from '../../data/db';
import { migrate } from '../../data/migrate';
import { settingsRepository } from '../../data/repositories';
import { AppFailure } from '../../domain/errors';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { runStartup, type StartupDeps } from './startup';

const aviation = { name: 'aviation' } as unknown as AviationDatabase;
const israel = { name: 'israel' } as unknown as IsraelAviationDatabase;
const remoteConfig = { name: 'remote config' };

function deps(overrides: Partial<StartupDeps> = {}) {
  const steps: string[] = [];
  const logged: string[] = [];
  const base: StartupDeps = {
    openUserDb: async () => {
      steps.push('openUserDb');
      return openNodeSqliteDb();
    },
    openFallbackUserDb: async () => {
      steps.push('openFallbackUserDb');
      return openNodeSqliteDb();
    },
    migrate: async (db) => {
      steps.push('migrate');
      return migrate(db);
    },
    openAviation: async () => {
      steps.push('openAviation');
      return aviation;
    },
    openIsrael: async () => {
      steps.push('openIsrael');
      return israel;
    },
    openRemoteConfig: async () => {
      steps.push('openRemoteConfig');
      return remoteConfig;
    },
    log: (message) => logged.push(message),
  };
  return { deps: { ...base, ...overrides }, steps, logged };
}

describe('runStartup', () => {
  it('opens the user database and migrates it, then the aviation databases, then the remote config', async () => {
    const { deps: d, steps } = deps();
    const started = await runStartup(d);
    expect(steps).toEqual(['openUserDb', 'migrate', 'openAviation', 'openIsrael', 'openRemoteConfig']);
    expect(started.userDbInMemory).toBe(false);
    expect(started.aviation).toBe(aviation);
    expect(started.israel).toBe(israel);
    expect(started.databaseError).toBeNull();
    expect(started.remoteConfig).toBe(remoteConfig);
    expect(started.region).toBe('israel'); // Region.defaultRegion on a fresh install
  });

  it('reads the saved region from the settings row', async () => {
    const disk = openNodeSqliteDb();
    await migrate(disk);
    await settingsRepository(disk).update({ regionRaw: 'us' });
    const { deps: d } = deps({ openUserDb: async () => disk });
    expect((await runStartup(d)).region).toBe('us');
  });

  it('runs on an in-memory store when the user database cannot be opened, and says so in the log', async () => {
    const {
      deps: d,
      steps,
      logged,
    } = deps({
      openUserDb: async () => {
        throw new Error('disk full');
      },
    });
    const started = await runStartup(d);
    expect(started.userDbInMemory).toBe(true);
    expect(steps.slice(0, 2)).toEqual(['openFallbackUserDb', 'migrate']);
    expect(logged.join('\n')).toMatch(/disk full/);
    // The in-memory store is migrated: the settings row can be read and written.
    await expect(settingsRepository(started.userDb).getOrCreate()).resolves.toBeDefined();
  });

  it('falls back to memory when the migration fails, leaving the file untouched', async () => {
    const disk = { name: 'newer schema' } as unknown as Db;
    const { deps: d, steps } = deps({
      openUserDb: async () => disk,
      migrate: async (db) => {
        steps.push('migrate');
        if (db === disk) throw new Error('database schema version 9 is newer than this app supports (1)');
        return migrate(db);
      },
    });
    const started = await runStartup(d);
    expect(started.userDbInMemory).toBe(true);
    expect(started.userDb).not.toBe(disk);
  });

  it('records the aviation database failure for the banner and still starts', async () => {
    const { deps: d } = deps({
      openAviation: async () => {
        throw new AppFailure({ kind: 'databaseCorrupted' });
      },
    });
    const started = await runStartup(d);
    expect(started.aviation).toBeNull();
    expect(started.databaseError).toEqual({ kind: 'databaseCorrupted' });
    expect(started.remoteConfig).toBe(remoteConfig);
  });

  it('reads any other aviation failure as a corrupted database', async () => {
    const { deps: d } = deps({
      openAviation: async () => {
        throw new Error('no such table: airports');
      },
    });
    expect((await runStartup(d)).databaseError).toEqual({ kind: 'databaseCorrupted' });
  });

  it('starts without the Israel database or the remote config when they fail (logged, no banner)', async () => {
    const { deps: d, logged } = deps({
      openIsrael: async () => {
        throw new AppFailure({ kind: 'regionDataUnavailable', region: 'israel' });
      },
      openRemoteConfig: async () => {
        throw new Error('saved config unreadable');
      },
    });
    const started = await runStartup(d);
    expect(started.israel).toBeNull();
    expect(started.remoteConfig).toBeNull();
    expect(started.databaseError).toBeNull();
    expect(logged.join('\n')).toMatch(/regionDataUnavailable/);
    expect(logged.join('\n')).toMatch(/saved config unreadable/);
  });
});
