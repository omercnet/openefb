import { createStore, type StoreApi } from 'zustand';
import type { LogbookEntry } from '../../data/models';
import { describeError } from '../../domain/describeError';
import { confirmEntryAndUpdateCurrency, LogbookError, saveLogbookEntry } from '../../domain/logbook/logbookData';
import { logbookEditsFromForm, type LogbookForm } from '../../domain/logbook/logbookForm';
import type { UserData } from '../../domain/userData';
import { createSerialQueue } from './serialQueue';

// View model of the logbook entry editor (LogbookEntryEditView + LogbookViewModel.confirmEntryAndUpdateCurrency). The list of
// entries belongs to the log stack (U3), which calls loadLogbook, addManualEntry and deleteLogbookEntry directly.

export interface LogbookEntryDeps {
  userData: UserData;
}

/**
 * saved: written. invalid: the form cannot be stored (the screen shows why). locked: the entry was confirmed meanwhile.
 * failed: see `error`. busy: a save or confirm is already running.
 */
export type LogbookSaveResult = 'saved' | 'invalid' | 'locked' | 'failed' | 'busy';

export interface LogbookEntryState {
  /** True once the entry was read; with `entry` null it no longer exists. */
  loaded: boolean;
  entry: LogbookEntry | null;
  error: string | null;
  saving: boolean;
  load(id: string): Promise<void>;
  /** Save: writes the form and keeps the entry open for editing. */
  save(form: LogbookForm): Promise<LogbookSaveResult>;
  /** Confirm: writes the form, locks the entry and bridges its night landings to the active pilot, all or nothing. */
  confirm(form: LogbookForm): Promise<LogbookSaveResult>;
}

/** The store a screen renders (`useStore(store)`); the app shell creates it so list and editor share one. */
export type LogbookEntryStore = StoreApi<LogbookEntryState>;

export function createLogbookEntryStore(deps: LogbookEntryDeps): LogbookEntryStore {
  // Loads and writes run one at a time in call order, so a late read cannot replace what a save just wrote.
  const enqueue = createSerialQueue();

  return createStore<LogbookEntryState>()((set, get) => {
    const submit = (form: LogbookForm, confirm: boolean): Promise<LogbookSaveResult> => {
      const parsed = logbookEditsFromForm(form);
      if (!parsed.ok) return Promise.resolve('invalid');
      if (get().saving) return Promise.resolve('busy');
      const id = get().entry?.id;
      if (id === undefined) {
        set({ error: 'There is no logbook entry to save.' });
        return Promise.resolve('failed');
      }
      set({ saving: true });
      return enqueue(async (): Promise<LogbookSaveResult> => {
        try {
          const saved = confirm
            ? await confirmEntryAndUpdateCurrency(deps.userData, id, parsed.edits)
            : await saveLogbookEntry(deps.userData, id, parsed.edits);
          set({ entry: saved, error: null });
          return 'saved';
        } catch (error) {
          if (error instanceof LogbookError && error.reason === 'locked') {
            // Confirmed elsewhere since this editor opened: show the entry as it is now.
            // undefined: the read failed. null: the entry is gone (deleted meanwhile).
            const stored = await deps.userData.logbook.get(id).catch(() => undefined);
            if (stored === null) {
              set({ entry: null, error: 'This logbook entry no longer exists.' });
              return 'locked';
            }
            // The entry is confirmed even when it cannot be read again: never leave the stale draft editable.
            const current = get().entry;
            const locked = stored ?? (current === null ? null : { ...current, isConfirmed: true });
            set(locked === null ? { error: error.message } : { entry: locked, error: error.message });
            return 'locked';
          }
          set({ error: `Could not ${confirm ? 'confirm' : 'save'} the logbook entry: ${describeError(error)}` });
          return 'failed';
        } finally {
          set({ saving: false });
        }
      });
    };

    return {
      loaded: false,
      entry: null,
      error: null,
      saving: false,

      load: (id) =>
        enqueue(async () => {
          try {
            const entry = await deps.userData.logbook.get(id);
            set({ loaded: true, entry, error: entry === null ? 'This logbook entry no longer exists.' : null });
          } catch (error) {
            set({ error: `Could not load the logbook entry: ${describeError(error)}` });
          }
        }),

      save: (form) => submit(form, false),
      confirm: (form) => submit(form, true),
    };
  });
}
