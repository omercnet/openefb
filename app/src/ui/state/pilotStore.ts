import { createStore, type StoreApi } from 'zustand';
import type { PilotProfile } from '../../data/models';
import { describeError } from '../../domain/describeError';
import {
  computePilotCurrency,
  NIGHT_LANDING_STEPPER,
  pilotFieldsFromForm,
  type PilotCurrency,
  type PilotForm,
} from '../../domain/profiles/pilot';
import {
  addNightLandings,
  createPilotProfile,
  deletePilotProfile,
  loadPilotProfiles,
  setActivePilot,
  updatePilotProfile,
} from '../../domain/profiles/profileData';
import type { UserData } from '../../domain/userData';
import { notifyApp } from './notifyApp';
import { createSerialQueue } from './serialQueue';

// View model of the pilot profile screen (PilotProfileViewModel + the save flows of PilotProfileView and PilotEditView).

export interface PilotDeps {
  userData: UserData;
  now(): number;
  newId(): string;
  /** AppState.activePilotProfileID follows the active profile after every successful load. A throw is reported, not propagated. */
  onActiveChange(id: string | null): void;
}

export type PilotSaveResult = 'saved' | 'failed' | 'busy';
/** noActivePilot: nothing is done (`guard let profile = activeProfile`). invalid: the date or the count cannot be stored. */
export type NightLandingResult = 'saved' | 'invalid' | 'noActivePilot' | 'failed' | 'busy';

export interface PilotState {
  loaded: boolean;
  /** Newest first. */
  profiles: PilotProfile[];
  activeId: string | null;
  /** Medical, flight review, night and overall status of the active pilot, as of the last load. */
  currency: PilotCurrency;
  error: string | null;
  /** A create, save or night landing write is running; a second one is refused. */
  saving: boolean;
  load(): Promise<void>;
  select(id: string): Promise<void>;
  /** addProfile(): inserts a blank, inactive profile and resolves its id for the editor; null when it failed or was refused. */
  create(): Promise<string | null>;
  save(id: string, form: PilotForm): Promise<PilotSaveResult>;
  /** True when the profile is gone afterwards (deleted, or already gone); false when the delete failed (see `error`). */
  remove(id: string): Promise<boolean>;
  /** Appends a night landing entry to the pilot who is active when the job runs. */
  addNightLandings(date: number, count: number): Promise<NightLandingResult>;
}

/**
 * A landing the stored list can hold: a finite date and a whole count the sheet's stepper offers. JS-only guard: one entry
 * that does not read back (a NaN date is stored as null) makes the whole list read as empty, and the next write erases it.
 */
const isStorableLanding = (date: number, count: number): boolean =>
  Number.isFinite(date) &&
  Number.isInteger(count) &&
  count >= NIGHT_LANDING_STEPPER.min &&
  count <= NIGHT_LANDING_STEPPER.max;

/** The store a screen renders (`useStore(store)`); the app shell creates it so list and editor share one. */
export type PilotStore = StoreApi<PilotState>;

export function createPilotStore(deps: PilotDeps): PilotStore {
  // Every change to the data runs here, one at a time in call order.
  const enqueue = createSerialQueue();

  return createStore<PilotState>()((set, get) => {
    /** Reads the list again. Returns a problem to show, or null. A failed read keeps what was on screen. */
    const reload = async (): Promise<string | null> => {
      let profiles: PilotProfile[];
      try {
        profiles = await loadPilotProfiles(deps.userData);
      } catch (error) {
        return `Could not load the pilot profiles: ${describeError(error)}`;
      }
      const active = profiles.find((p) => p.isActive) ?? null;
      set({
        profiles,
        activeId: active?.id ?? null,
        currency: computePilotCurrency(active, deps.now()),
        loaded: true,
      });
      const problem = notifyApp(() => deps.onActiveChange(active?.id ?? null));
      return problem === null ? null : `The app could not follow the change: ${problem}`;
    };

    /** One user-initiated write at a time: refuses a second while one runs (a double tap), and always clears the flag. */
    const exclusive = async <T>(busy: T, run: () => Promise<T>): Promise<T> => {
      if (get().saving) return busy;
      set({ saving: true });
      try {
        return await enqueue(run);
      } finally {
        set({ saving: false });
      }
    };

    return {
      loaded: false,
      profiles: [],
      activeId: null,
      currency: computePilotCurrency(null, 0),
      error: null,
      saving: false,

      load: () => enqueue(async () => set({ error: await reload() })),

      select: (id) =>
        enqueue(async () => {
          try {
            await setActivePilot(deps.userData, id);
          } catch (error) {
            set({ error: `Could not change the active pilot: ${describeError(error)}` });
            return;
          }
          set({ error: await reload() });
        }),

      create: () =>
        exclusive<string | null>(null, async () => {
          let id: string;
          try {
            id = (await createPilotProfile(deps.userData, { now: deps.now, newId: deps.newId })).id;
          } catch (error) {
            set({ error: `Could not create the pilot profile: ${describeError(error)}` });
            return null;
          }
          set({ error: await reload() });
          return id;
        }),

      save: (id, form) =>
        exclusive<PilotSaveResult>('busy', async () => {
          try {
            await updatePilotProfile(deps.userData, id, pilotFieldsFromForm(form));
          } catch (error) {
            set({ error: `Could not save the pilot profile: ${describeError(error)}` });
            return 'failed';
          }
          set({ error: await reload() });
          return 'saved';
        }),

      remove: (id) =>
        enqueue(async () => {
          try {
            await deletePilotProfile(deps.userData, id);
          } catch (error) {
            set({ error: `Could not delete the pilot profile: ${describeError(error)}` });
            return false;
          }
          set({ error: await reload() });
          return true;
        }),

      addNightLandings: (date, count) => {
        if (!isStorableLanding(date, count)) return Promise.resolve('invalid');
        return exclusive<NightLandingResult>('busy', async () => {
          // A sheet can open before the list has loaded; without the active pilot the landings would be dropped silently.
          if (!get().loaded) {
            const problem = await reload();
            if (problem !== null) {
              set({ error: problem });
              return 'failed';
            }
          }
          // Read inside the job, so a select queued before this call decides who gets the landings.
          const pilotId = get().activeId;
          if (pilotId === null) return 'noActivePilot';
          try {
            await addNightLandings(deps.userData, pilotId, date, count);
          } catch (error) {
            set({ error: `Could not save the night landings: ${describeError(error)}` });
            return 'failed';
          }
          set({ error: await reload() });
          return 'saved';
        });
      },
    };
  });
}
