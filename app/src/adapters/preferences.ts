// Preferences on expo-sqlite's key-value store (the UserDefaults replacement).
import Storage from 'expo-sqlite/kv-store';
import type { Preferences } from '../domain/ports/preferences';
import type { KeyValueStore } from './telemetryStorage';

export function createPreferences(store: KeyValueStore = Storage): Preferences {
  return {
    get: (key) => store.getItem(key),
    set: (key, value) => store.setItem(key, value),
    remove: (key) => store.removeItem(key),
  };
}
