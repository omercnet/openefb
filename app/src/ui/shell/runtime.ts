// The production composition root: builds the services from the platform adapters and runs the launch sequence
// (startup.ts). Imported only by the live app route, never by tests or capture routes, because it requires the bundled
// databases. Tests build the same pieces with fakes (startup.test.ts, liveData.test.ts).
import Constants from 'expo-constants';
import { createLocationSource } from '../../adapters/location';
import { createNetworkStatusSource, type NetworkStatusSource } from '../../adapters/network';
import { openAviationDatabase, openIsraelDatabase } from '../../adapters/aviationDb';
import { fileTextStorage } from '../../adapters/fileTextStorage';
import { openExpoSqliteDb } from '../../adapters/expoSqliteDb';
import { migrate } from '../../data/migrate';
import type { LocationSource } from '../../domain/ports/location';
import { AirSigmetService } from '../../services/airSigmetService';
import { createRemoteConfigService } from '../../services/remoteConfigService';
import { RemoteConfigStore } from '../../services/remoteConfigStore';
import { TfrService } from '../../services/tfrService';
import { WeatherService } from '../../services/weatherService';
import { runStartup, type StartedApp } from './startup';

/** The user database file (SwiftData's default store in the Swift app); the in-memory fallback uses ':memory:'. */
export const USER_DB_NAME = 'kanaf.db';

export interface AppRuntime {
  started: StartedApp<RemoteConfigStore>;
  weather: WeatherService;
  tfr: TfrService;
  advisories: AirSigmetService;
  location: LocationSource;
  network: NetworkStatusSource;
}

const log = (message: string) => console.warn(message);

/** CFBundleVersion / versionCode as the remote config compares it; 0 when the build has none. */
const buildNumber = (): number => Number(Constants.nativeBuildVersion) || 0;

export async function startRuntime(): Promise<AppRuntime> {
  const fetchLike = globalThis.fetch as unknown as import('../../services/ports').FetchLike;
  const remote = createRemoteConfigService({ fetch: fetchLike, log });
  const started = await runStartup<RemoteConfigStore>({
    openUserDb: () => openExpoSqliteDb(USER_DB_NAME),
    openFallbackUserDb: () => openExpoSqliteDb(':memory:'),
    migrate: (db) => migrate(db),
    openAviation: openAviationDatabase,
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a Metro asset module, as aviationDb.ts does
    openIsrael: () => openIsraelDatabase(require('../../../assets/israel-aviation.sqlite')),
    openRemoteConfig: () =>
      RemoteConfigStore.open({ service: remote, storage: fileTextStorage, buildNumber: buildNumber(), log }),
    log,
  });
  return {
    started,
    weather: new WeatherService({ fetch: fetchLike, log }),
    tfr: new TfrService({ fetch: fetchLike, log }),
    advisories: new AirSigmetService({ fetch: fetchLike, log }),
    location: createLocationSource(),
    network: createNetworkStatusSource(),
  };
}

let starting: Promise<AppRuntime> | null = null;

/** One runtime per process: the route may remount, the databases and services must not be opened twice. */
export const getRuntime = (): Promise<AppRuntime> => (starting ??= startRuntime());
