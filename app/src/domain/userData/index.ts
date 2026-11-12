// The D2 repositories behind one transactional seam. View models and screens take a UserData: the app shell builds it with
// userDataFromDb, tests and the screenshot fixtures use createMemoryUserData (./memory).
import type { Db } from '../../data/db';
import type { AircraftProfile, PilotProfile } from '../../data/models';
import {
  aircraftRepository,
  logbookRepository,
  pilotRepository,
  settingsRepository,
  type LogbookRepository,
  type SettingsRepository,
} from '../../data/repositories';
import type { Repository } from '../../data/repositories/table';

export interface UserDataRepos {
  settings: SettingsRepository;
  aircraft: Repository<AircraftProfile>;
  pilots: Repository<PilotProfile>;
  logbook: LogbookRepository;
}

export interface UserData extends UserDataRepos {
  /**
   * Runs fn with repositories that share one transaction: every write commits together or none does. A rejection rolls
   * back and is rethrown. Where Swift saved a ModelContext once, a multi-record change goes through here.
   */
  atomically<T>(fn: (repos: UserDataRepos) => Promise<T>): Promise<T>;
}

const reposOn = (db: Db): UserDataRepos => ({
  settings: settingsRepository(db),
  aircraft: aircraftRepository(db),
  pilots: pilotRepository(db),
  logbook: logbookRepository(db),
});

export function userDataFromDb(db: Db): UserData {
  return { ...reposOn(db), atomically: (fn) => db.transaction((tx) => fn(reposOn(tx))) };
}
