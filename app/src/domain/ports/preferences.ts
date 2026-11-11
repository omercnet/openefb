// Port for small user preferences. Replaces the UserDefaults keys the Swift app reads (displayMode, hasSeenOnboarding,
// telemetryEnabled, israel.routeNetwork.<aircraft id>). Values are strings; booleans use 'true' / 'false'. The adapter
// (expo-sqlite key-value store) is wired by the app shell.

export interface Preferences {
  /** The stored string for key, or null when absent. Rejects when the store cannot be read. */
  get(key: string): Promise<string | null>;
  /** Inserts or replaces the value for key. */
  set(key: string, value: string): Promise<void>;
  /** Deletes the value for key. A missing key is not an error. */
  remove(key: string): Promise<void>;
}

/** UserDefaults `object(forKey:) as? Bool ?? fallback`: absent or unrecognised text reads as the fallback. */
export async function readBool(prefs: Preferences, key: string, fallback: boolean): Promise<boolean> {
  const raw = await prefs.get(key);
  return raw === 'true' ? true : raw === 'false' ? false : fallback;
}

export const writeBool = (prefs: Preferences, key: string, value: boolean): Promise<void> =>
  prefs.set(key, value ? 'true' : 'false');

/** In-memory Preferences for tests and the screenshot fixtures. */
export class FakePreferences implements Preferences {
  private readonly values: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.values = new Map(Object.entries(initial));
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}
