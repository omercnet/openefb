// The aircraft and pilot profile stores on the user database (Swift: SwiftData @Query plus AppState's
// activeAircraftProfileID and activePilotProfileID). The stores follow the active profile after every load; the recording
// reads the ids when it stops.
import type { Db } from '../../data/db';
import { userDataFromDb } from '../../domain/userData';
import { preferencesNetworkPreference } from '../../domain/profiles/networkPreference';
import type { Preferences } from '../../domain/ports/preferences';
import { createAircraftStore, type AircraftStore } from '../state/aircraftStore';
import { createPilotStore, type PilotStore } from '../state/pilotStore';

export interface Profiles {
  aircraft: AircraftStore;
  pilot: PilotStore;
  /** AppState.activeAircraftProfileID and activePilotProfileID. */
  activeIds(): { aircraftProfileID: string | null; pilotProfileID: string | null };
  /** Loads both lists (and so settles the active ids). */
  load(): Promise<void>;
}

export function createProfiles(
  db: Db,
  preferences: Preferences,
  clock: { now(): number; newId(): string } = {
    now: Date.now,
    newId: () => globalThis.crypto.randomUUID(),
  },
): Profiles {
  const userData = userDataFromDb(db);
  let aircraftId: string | null = null;
  let pilotId: string | null = null;
  const aircraft = createAircraftStore({
    userData,
    networkPreference: preferencesNetworkPreference(preferences),
    ...clock,
    onActiveChange: (id) => void (aircraftId = id),
  });
  const pilot = createPilotStore({ userData, ...clock, onActiveChange: (id) => void (pilotId = id) });
  return {
    aircraft,
    pilot,
    activeIds: () => ({ aircraftProfileID: aircraftId, pilotProfileID: pilotId }),
    async load() {
      await Promise.all([aircraft.getState().load(), pilot.getState().load()]);
      // The stores report this read's outcome as state (`error`), not as a rejection, and `loaded` stays true after an
      // earlier success: only `error` says whether the ids just read are current.
      const failed = [aircraft.getState(), pilot.getState()].find((s) => s.error !== null);
      if (failed) throw new Error(failed.error ?? 'The profiles could not be loaded');
    },
  };
}
