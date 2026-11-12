// TelemetryStorage on a key-value store (expo-sqlite/kv-store in the app): the pilot's choice and the counts not sent yet.
import type { TelemetryStorage } from '../domain/ports/telemetry';

/** The part of expo-sqlite/kv-store that is used (its default export satisfies it). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Swift `Telemetry.enabledKey`, the UserDefaults key of the Settings toggle. */
export const TELEMETRY_ENABLED_KEY = 'telemetryEnabled';
export const TELEMETRY_BACKLOG_KEY = 'telemetryBacklog';

export function createTelemetryStorage(store: KeyValueStore): TelemetryStorage {
  return {
    async readEnabled() {
      const text = await store.getItem(TELEMETRY_ENABLED_KEY);
      // Swift: `object(forKey:) as? Bool ?? true`. Anything that is not a choice written here is no choice.
      return text === 'true' ? true : text === 'false' ? false : null;
    },
    writeEnabled: (enabled) => store.setItem(TELEMETRY_ENABLED_KEY, String(enabled)),
    readBacklog: () => store.getItem(TELEMETRY_BACKLOG_KEY),
    writeBacklog: (text) => store.setItem(TELEMETRY_BACKLOG_KEY, text),
    removeBacklog: () => store.removeItem(TELEMETRY_BACKLOG_KEY),
  };
}
