// The launch sequence before the first screen (plan section 7, brief I1a): the user database and its schema migrations,
// the saved region, the aviation databases, then the remote config's saved copy. The caller then starts the live data
// (location, network, weather refresh) and renders the UI. Swift reference: efb_212App.init (EFBModelContainer.makeForApp),
// MapContainerView.initializeServices (RegionStore.load, AppState.getOrCreateDatabaseService), ContentView.task.
import type { AviationDatabase } from '../../data/aviation/aviationDatabase';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { Db } from '../../data/db';
import { settingsRepository } from '../../data/repositories';
import { parseRegion, type Region } from '../../domain/core';
import { describeError } from '../../domain/describeError';
import { AppFailure, type AppError } from '../../domain/errors';

export interface StartupDeps<RemoteConfig = unknown> {
  /** The on-disk user database. */
  openUserDb: () => Promise<Db>;
  /** An in-memory database for a launch whose on-disk store cannot be opened. */
  openFallbackUserDb: () => Promise<Db>;
  /** Applies the schema migrations; rejects for a store newer than this build. */
  migrate: (db: Db) => Promise<number>;
  openAviation: () => Promise<AviationDatabase>;
  openIsrael: () => Promise<IsraelAviationDatabase>;
  /** The remote config store with its saved copy loaded (no network). */
  openRemoteConfig: () => Promise<RemoteConfig>;
  log: (message: string) => void;
}

export interface StartedApp<RemoteConfig = unknown> {
  userDb: Db;
  /** The on-disk store could not be opened or migrated; this launch keeps nothing (Swift makeForApp, no banner). */
  userDbInMemory: boolean;
  /** The saved operating region (RegionStore.load). */
  region: Region;
  /** Null when it failed to open; `databaseError` then says why (the red banner). */
  aviation: AviationDatabase | null;
  databaseError: AppError | null;
  /** Null when it failed to open; Israel queries then fail (as Swift's `try?`). */
  israel: IsraelAviationDatabase | null;
  remoteConfig: RemoteConfig | null;
}

async function openUserDatabase(deps: StartupDeps<unknown>): Promise<{ db: Db; inMemory: boolean }> {
  try {
    const db = await deps.openUserDb();
    await deps.migrate(db);
    return { db, inMemory: false };
  } catch (error) {
    // Swift leaves the store untouched (never deleted or recreated) and runs on memory so the app still launches.
    deps.log(`Could not open the user database, running in memory: ${describeError(error)}`);
    const db = await deps.openFallbackUserDb();
    await deps.migrate(db);
    return { db, inMemory: true };
  }
}

async function savedRegion(db: Db, log: (message: string) => void): Promise<Region> {
  try {
    return parseRegion((await settingsRepository(db).get())?.regionRaw);
  } catch (error) {
    log(`Could not read the saved region: ${describeError(error)}`);
    return parseRegion(null);
  }
}

export async function runStartup<RemoteConfig>(deps: StartupDeps<RemoteConfig>): Promise<StartedApp<RemoteConfig>> {
  const { db: userDb, inMemory } = await openUserDatabase(deps);
  const region = await savedRegion(userDb, deps.log);

  let aviation: AviationDatabase | null = null;
  let databaseError: AppError | null = null;
  try {
    aviation = await deps.openAviation();
  } catch (error) {
    // AppState.getOrCreateDatabaseService: an EFBError is kept, anything else reads as a corrupted database.
    databaseError = error instanceof AppFailure ? error.error : { kind: 'databaseCorrupted' };
    deps.log(`Could not open the aviation database: ${describeError(error)}`);
  }

  let israel: IsraelAviationDatabase | null = null;
  try {
    israel = await deps.openIsrael();
  } catch (error) {
    deps.log(`Could not open the Israel aviation database: ${describeError(error)}`);
  }

  let remoteConfig: RemoteConfig | null = null;
  try {
    remoteConfig = await deps.openRemoteConfig();
  } catch (error) {
    deps.log(`Could not load the remote config: ${describeError(error)}`);
  }

  return { userDb, userDbInMemory: inMemory, region, aviation, databaseError, israel, remoteConfig };
}
