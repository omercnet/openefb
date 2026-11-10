// UserDefaults import. The platform adapter reads the app's `io.omer.efb` defaults domain into a plain object; this
// module copies the keys the Swift app is known to write (grep of efb-212 for AppStorage / UserDefaults) into
// app_preferences as JSON text. Unknown keys are ignored, as are debug-only switches.
import type { Db } from '../db';

export type DefaultsValue = string | number | boolean | string[] | null;
export type UserDefaultsSnapshot = Record<string, unknown>;

/** Exact keys. displayMode is DisplayMode.defaultsKey. */
export const KNOWN_DEFAULTS_KEYS: readonly string[] = [
  'hasSeenOnboarding',
  'offlineBlockNetwork',
  'showsFlightLog',
  'showsInstruments',
  'showsPredictions',
  'showAirportDiagrams',
  'displayMode',
  'telemetryEnabled',
  'israelOffRouteThresholdNM',
  'israelNotamReadKeys',
  'israelChartHintDismissed',
];
/** One key per flight plan: `israel.routeNetwork.<uuid>` holds that plan's route network ("cvfr" or "lsa"). */
export const ROUTE_NETWORK_PREFIX = 'israel.routeNetwork.';

export const isKnownDefaultsKey = (key: string): boolean =>
  KNOWN_DEFAULTS_KEYS.includes(key) || key.startsWith(ROUTE_NETWORK_PREFIX);

function isPlain(v: unknown): v is DefaultsValue {
  return (
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (Array.isArray(v) && v.every((x) => typeof x === 'string'))
  );
}

export interface UserDefaultsResult {
  imported: number;
  ignored: string[];
}

/** Writes known keys with INSERT OR IGNORE: a re-run never overwrites a preference changed in the new app. */
export async function importUserDefaults(defaults: UserDefaultsSnapshot, target: Db): Promise<UserDefaultsResult> {
  const result: UserDefaultsResult = { imported: 0, ignored: [] };
  await target.transaction(async (tx) => {
    for (const key of Object.keys(defaults).sort()) {
      const value = defaults[key];
      if (!isKnownDefaultsKey(key) || !isPlain(value)) {
        result.ignored.push(key);
        continue;
      }
      // Route network keys carry a UUID; store it lower case like every other id.
      const stored = key.startsWith(ROUTE_NETWORK_PREFIX)
        ? ROUTE_NETWORK_PREFIX + key.slice(ROUTE_NETWORK_PREFIX.length).toLowerCase()
        : key;
      const r = await tx.run('INSERT OR IGNORE INTO app_preferences (key, value) VALUES (?, ?)', [
        stored,
        JSON.stringify(value),
      ]);
      result.imported += r.changes;
    }
  });
  return result;
}
