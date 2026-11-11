// In-memory UserData for tests, the screenshot fixtures and the web preview. It follows the D2 repositories' behaviour
// (list order, copies on read, duplicate ids rejected, rollback on a failed atomically); userData.test.ts runs the same
// contract against it and against SQLite.
import { newUserSettings, type Factory } from '../../data/defaults';
import type { AircraftProfile, LogbookEntry, PilotProfile, UserSettings } from '../../data/models';
import type { SettingsRepository } from '../../data/repositories';
import type { Repository } from '../../data/repositories/table';
import type { UserData, UserDataRepos } from './index';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Store<T extends { id: string }> {
  rows: Map<string, T>;
  /** The repository's list order (a stable sort over insertion order, like `ORDER BY ..., rowid`). */
  compare: (a: T, b: T) => number;
  /** Columns `listWhere` accepts, mapped to record keys. */
  columns: Record<string, keyof T>;
  name: string;
}

function repository<T extends { id: string }>(store: Store<T>): Repository<T> {
  const ordered = (): T[] => [...store.rows.values()].sort(store.compare).map(clone);
  return {
    insert(record) {
      if (store.rows.has(record.id)) return Promise.reject(new Error(`UNIQUE constraint failed: ${store.name}.id`));
      store.rows.set(record.id, clone(record));
      return Promise.resolve();
    },
    get: (id) => Promise.resolve(store.rows.has(id) ? clone(store.rows.get(id) as T) : null),
    list: () => Promise.resolve(ordered()),
    listWhere(column, value) {
      const key = store.columns[column];
      if (key === undefined) return Promise.reject(new Error(`no such column: ${store.name}.${column}`));
      return Promise.resolve(ordered().filter((r) => r[key] === value));
    },
    update(id, patch) {
      const current = store.rows.get(id);
      if (current === undefined) return Promise.resolve(null);
      const defined = Object.entries(patch).filter(([, v]) => v !== undefined);
      const next = { ...current, ...clone(Object.fromEntries(defined)) } as T;
      store.rows.set(id, next);
      return Promise.resolve(clone(next));
    },
    remove: (id) => Promise.resolve(store.rows.delete(id)),
  };
}

export interface MemoryUserDataSeed {
  aircraft?: AircraftProfile[];
  pilots?: PilotProfile[];
  logbook?: LogbookEntry[];
  /** Creates the settings row with these values; omitted means no row yet. */
  settings?: Partial<UserSettings>;
}

export function createMemoryUserData(seed: MemoryUserDataSeed = {}): UserData {
  const aircraft: Store<AircraftProfile> = {
    rows: new Map(),
    compare: (a, b) => a.createdAt - b.createdAt,
    columns: {},
    name: 'aircraft_profile',
  };
  const pilots: Store<PilotProfile> = {
    rows: new Map(),
    compare: (a, b) => a.createdAt - b.createdAt,
    columns: {},
    name: 'pilot_profile',
  };
  const logbook: Store<LogbookEntry> = {
    rows: new Map(),
    compare: (a, b) => b.date - a.date,
    columns: { flight_id: 'flightID' },
    name: 'logbook_entry',
  };
  let settingsRow: UserSettings | null = null;

  for (const a of seed.aircraft ?? []) aircraft.rows.set(a.id, clone(a));
  for (const p of seed.pilots ?? []) pilots.rows.set(p.id, clone(p));
  for (const e of seed.logbook ?? []) logbook.rows.set(e.id, clone(e));
  if (seed.settings) settingsRow = newUserSettings({ ...seed.settings, id: 1 });

  const settings: SettingsRepository = {
    get: () => Promise.resolve(settingsRow === null ? null : clone(settingsRow)),
    async getOrCreate(factory: Factory = {}) {
      settingsRow ??= newUserSettings({ ...factory, id: 1 });
      return clone(settingsRow);
    },
    async update(patch) {
      const current = await settings.getOrCreate();
      const defined = Object.entries(patch).filter(([, v]) => v !== undefined);
      settingsRow = { ...current, ...Object.fromEntries(defined) } as UserSettings;
      return clone(settingsRow);
    },
  };

  const logbookBase = repository(logbook);
  const repos: UserDataRepos = {
    settings,
    aircraft: repository(aircraft),
    pilots: repository(pilots),
    logbook: { ...logbookBase, byFlightId: (flightID) => logbookBase.listWhere('flight_id', flightID) },
  };

  return {
    ...repos,
    async atomically(fn) {
      const saved = {
        aircraft: new Map(aircraft.rows),
        pilots: new Map(pilots.rows),
        logbook: new Map(logbook.rows),
        settings: settingsRow,
      };
      try {
        return await fn(repos);
      } catch (error) {
        aircraft.rows = saved.aircraft;
        pilots.rows = saved.pilots;
        logbook.rows = saved.logbook;
        settingsRow = saved.settings;
        throw error;
      }
    },
  };
}
