import { createStore, type StoreApi } from 'zustand';
import type { IsraelRouteNetwork } from '../../data/aviation/israelTypes';
import type { AircraftProfile } from '../../data/models';
import { describeError } from '../../domain/describeError';
import type { AircraftForm, AircraftInput } from '../../domain/profiles/aircraft';
import { aircraftFromForm } from '../../domain/profiles/aircraft';
import type { AircraftNetworkPreference } from '../../domain/profiles/networkPreference';
import {
  createAircraftProfile,
  deleteAircraftProfile,
  loadAircraftProfiles,
  setActiveAircraft,
  updateAircraftProfile,
} from '../../domain/profiles/profileData';
import type { UserData } from '../../domain/userData';
import { notifyApp } from './notifyApp';
import { createSerialQueue } from './serialQueue';

// View model of the aircraft list and its edit form (AircraftProfileViewModel + AircraftEditView's save flow).

export interface AircraftDeps {
  userData: UserData;
  networkPreference: AircraftNetworkPreference;
  now(): number;
  newId(): string;
  /** AppState.activeAircraftProfileID follows the active profile after every successful load. A throw is reported, not propagated. */
  onActiveChange(id: string | null): void;
}

/** saved: written. invalid: the N-number is blank (the form shows "N-number is required"). failed: see `error`. busy: a save is already running. */
export type AircraftSaveResult = 'saved' | 'invalid' | 'failed' | 'busy';

export interface AircraftState {
  /** True once a load succeeded; until then the screen must not claim there are no aircraft. */
  loaded: boolean;
  /** Newest first. */
  profiles: AircraftProfile[];
  activeId: string | null;
  /** The last thing that failed, or null. Swift swallowed these ("changes still pending"); here they are shown. */
  error: string | null;
  saving: boolean;
  load(): Promise<void>;
  select(id: string): Promise<void>;
  /** `id` null creates a new, inactive profile. */
  save(id: string | null, form: AircraftForm): Promise<AircraftSaveResult>;
  /** True when the profile is gone afterwards (deleted, or already gone); false when the delete failed (see `error`). */
  remove(id: string): Promise<boolean>;
  /**
   * The route network kept for an aircraft, as `{ network }` (null network: none chosen). Null when it could not be read (see
   * `error`): the editor must not open on a guess, because saving would then erase the stored choice.
   */
  routeNetworkFor(id: string): Promise<{ network: IsraelRouteNetwork | null } | null>;
}

/** The store a screen renders (`useStore(store)`); the app shell creates it so list and editor share one. */
export type AircraftStore = StoreApi<AircraftState>;

export function createAircraftStore(deps: AircraftDeps): AircraftStore {
  // Every change to the data runs here, one at a time in call order.
  const enqueue = createSerialQueue();
  /** Route network settings of aircraft whose insert failed and whose clean-up failed too: tried again before the next save. */
  const orphans = new Set<string>();

  return createStore<AircraftState>()((set, get) => {
    /** Reads the list again. Returns a problem to show, or null. A failed read keeps what was on screen. */
    const reload = async (): Promise<string | null> => {
      let profiles: AircraftProfile[];
      try {
        profiles = await loadAircraftProfiles(deps.userData);
      } catch (error) {
        return `Could not load the aircraft: ${describeError(error)}`;
      }
      const activeId = profiles.find((p) => p.isActive)?.id ?? null;
      set({ profiles, activeId, loaded: true });
      const problem = notifyApp(() => deps.onActiveChange(activeId));
      return problem === null ? null : `The app could not follow the change: ${problem}`;
    };

    /**
     * A new profile writes its route network first and clears it again if the insert fails, so a failed save leaves nothing
     * behind and a retry cannot duplicate the aircraft. An update writes the profile, then the network; a retry is safe.
     */
    const write = async (id: string | null, input: AircraftInput): Promise<void> => {
      for (const orphan of [...orphans]) {
        await deps.networkPreference.set(orphan, null).then(
          () => orphans.delete(orphan),
          () => undefined,
        );
      }
      if (id !== null) {
        const before = await deps.userData.aircraft.get(id);
        await updateAircraftProfile(deps.userData, id, input.fields);
        try {
          await deps.networkPreference.set(id, input.routeNetwork);
        } catch (error) {
          // Not half saved: put the profile back as it was, so the failed save changed nothing.
          if (before !== null) {
            await deps.userData.aircraft.update(id, before).catch((restore) => {
              throw new Error(
                `${describeError(error)} (and the aircraft could not be restored: ${describeError(restore)})`,
              );
            });
          }
          throw error;
        }
        return;
      }
      const newId = deps.newId();
      if (input.routeNetwork !== null) await deps.networkPreference.set(newId, input.routeNetwork);
      try {
        await createAircraftProfile(deps.userData, input.fields, { now: deps.now, newId: () => newId });
      } catch (error) {
        if (input.routeNetwork !== null) {
          try {
            await deps.networkPreference.set(newId, null);
          } catch (cleanup) {
            orphans.add(newId); // cleared before the next save
            throw new Error(
              `${describeError(error)} (and the route network setting could not be cleared: ${describeError(cleanup)})`,
            );
          }
        }
        throw error;
      }
    };

    return {
      loaded: false,
      profiles: [],
      activeId: null,
      error: null,
      saving: false,

      load: () => enqueue(async () => set({ error: await reload() })),

      select: (id) =>
        enqueue(async () => {
          try {
            await setActiveAircraft(deps.userData, id);
          } catch (error) {
            set({ error: `Could not change the active aircraft: ${describeError(error)}` });
            return;
          }
          set({ error: await reload() });
        }),

      save: (id, form) => {
        if (get().saving) return Promise.resolve('busy');
        const input = aircraftFromForm(form);
        if (input === null) return Promise.resolve('invalid');
        set({ saving: true });
        return enqueue(async (): Promise<AircraftSaveResult> => {
          try {
            try {
              await write(id, input);
            } catch (error) {
              set({ error: `Could not save the aircraft: ${describeError(error)}` });
              return 'failed';
            }
            set({ error: await reload() });
            return 'saved';
          } finally {
            set({ saving: false });
          }
        });
      },

      remove: (id) =>
        enqueue(async () => {
          try {
            await deleteAircraftProfile(deps.userData, id);
          } catch (error) {
            set({ error: `Could not delete the aircraft: ${describeError(error)}` });
            return false;
          }
          set({ error: await reload() });
          return true;
        }),

      async routeNetworkFor(id) {
        try {
          const network = await deps.networkPreference.get(id);
          // A read that works after a failed one (Try Again) takes that failure off the screen.
          if (get().error?.startsWith('Could not read the route network')) set({ error: null });
          return { network };
        } catch (error) {
          set({ error: `Could not read the route network: ${describeError(error)}` });
          return null;
        }
      },
    };
  });
}
