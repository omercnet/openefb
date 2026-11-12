// Port of RemoteConfig (Core/RemoteConfig.swift): the remote config file served by web/notam-relay at /config.json.
// It is data, never code: it can switch a listed feature off, move a listed parameter inside its range, show a
// notice and ask pilots to update. Anything the build does not list is ignored.
// Decoding is lenient on purpose: one bad value is ignored (and reported in `ignored`), the rest of the file still
// applies. Only the envelope (schema, serial, dates) can reject the whole file.
import { reportWindowSeconds } from '../domain/debrief/cvfrDebrief';
import { AppFailure } from '../domain/errors';
import type { Region } from '../domain/core/region';
import { utf8ByteLength } from './http';
import { parseIsoDateTime } from './isoDate';

// MARK: Text

/** Pilot-facing text in English with an optional Hebrew version. */
export interface RemoteText {
  english: string;
  hebrew: string | null;
}

/** Hebrew when the device's first preferred language is Hebrew and a Hebrew text exists, else English. */
export function resolveText(text: RemoteText, preferredLanguage = 'en'): string {
  if (text.hebrew && preferredLanguage.toLowerCase().startsWith('he')) return text.hebrew;
  return text.english;
}

type Json = unknown;
type JsonObject = Record<string, Json>;

const isObject = (v: Json): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** null unless `value` is an object with a non-empty "en" string. */
export function parseRemoteText(value: Json): RemoteText | null {
  if (!isObject(value) || typeof value.en !== 'string') return null;
  const english = value.en.trim();
  if (english === '') return null;
  const hebrew = typeof value.he === 'string' ? value.he.trim() : null;
  return { english, hebrew };
}

// MARK: What a file may touch

/** Features a file may switch off. Anything else in `disabledFeatures` is ignored.
 * Safety functions are never listed here: proximity and airspace alerts, NOTAM closure blocking on filing,
 * disclaimers, data-age and expiry badges. */
export const REMOTE_FEATURES = ['israelDiagramOverlay'] as const;
export type RemoteFeature = (typeof REMOTE_FEATURES)[number];

/** Values a file may adjust, each inside a range fixed in the build. */
export const REMOTE_PARAMETERS = ['cvfrReportWindowSeconds'] as const;
export type RemoteParameter = (typeof REMOTE_PARAMETERS)[number];

/** The value when no file is in effect, and the accepted inclusive range, per parameter. */
export const PARAMETER_INFO: Record<RemoteParameter, { builtIn: number; min: number; max: number }> = {
  cvfrReportWindowSeconds: { builtIn: reportWindowSeconds, min: 30, max: 300 },
};

// MARK: Notices

export interface RemoteNotice {
  id: string;
  severity: 'info' | 'caution';
  /** Region raw values (`us`, `israel`); empty = every region. */
  regions: ReadonlySet<string>;
  untilMs: number | null;
  text: RemoteText;
}

export function noticeApplies(notice: RemoteNotice, region: Region, nowMs: number): boolean {
  if (notice.untilMs !== null && nowMs >= notice.untilMs) return false;
  return notice.regions.size === 0 || notice.regions.has(region);
}

// MARK: Config

export interface RemoteConfig {
  schemaVersion: number;
  /** Increases with every published change; a file with a lower serial than the cached one is a stale copy. */
  serial: number;
  issuedAtMs: number;
  /** After this the file no longer applies and the built-in values are used. */
  expiresAtMs: number;
  /** Build numbers. Below `minSupportedBuild` the app asks for an update on every tab. */
  minSupportedBuild: number | null;
  recommendedBuild: number | null;
  updateMessage: RemoteText | null;
  disabledFeatures: Partial<Record<RemoteFeature, RemoteText>>;
  parameters: Partial<Record<RemoteParameter, number>>;
  notices: RemoteNotice[];
  /** What was left out and why, one line each; for Settings and tests. */
  ignored: string[];
}

export const SUPPORTED_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1]);
/** Larger bodies are refused without parsing. */
export const MAXIMUM_BYTES = 64 * 1024;

export const isExpired = (config: RemoteConfig, nowMs: number): boolean => nowMs >= config.expiresAtMs;

const reject = (reason: string): never => {
  throw new AppFailure({ kind: 'remoteConfigRejected', reason });
};

/** JSON numbers that are whole and below 1e12 (booleans and fractions are not integers). */
function integer(value: Json): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.round(value) !== value || Math.abs(value) >= 1e12) return null;
  return value;
}

function number(value: Json): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function noticeFrom(entry: JsonObject): RemoteNotice | null {
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const text = parseRemoteText(entry.text);
  if (id === '' || !text) return null;
  // A remote notice is never red: anything but "caution" shows as info.
  const severity = entry.severity === 'caution' ? 'caution' : 'info';
  // regions and until narrow where and how long a notice shows. A present but malformed value rejects the notice:
  // ignoring it would widen the notice to every region or to no end date.
  let regions = new Set<string>();
  if ('regions' in entry) {
    const raw = entry.regions;
    if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string')) return null;
    regions = new Set(raw as string[]);
  }
  let untilMs: number | null = null;
  if ('until' in entry) {
    const parsed = parseIsoDateTime(entry.until);
    if (parsed === null) return null;
    untilMs = parsed;
  }
  return { id, severity, regions, untilMs, text };
}

const sortedEntries = (o: JsonObject): [string, Json][] =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Throws AppFailure(remoteConfigRejected) when the envelope is unusable or the file is expired at `nowMs`.
 * @param body the file as UTF-8 text. */
export function parseRemoteConfig(body: string, nowMs: number): RemoteConfig {
  if (utf8ByteLength(body) > MAXIMUM_BYTES) reject('the file is too large');
  let root: Json;
  try {
    root = JSON.parse(body);
  } catch {
    root = undefined;
  }
  if (!isObject(root)) return reject('the file is not a JSON object');
  const schema = integer(root.schemaVersion);
  if (schema === null) return reject('no schema version');
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schema)) return reject(`schema ${schema} is newer than this build understands`);
  const serial = integer(root.serial);
  if (serial === null || serial < 0) return reject('no serial');
  const issuedAtMs = parseIsoDateTime(root.issuedAt);
  const expiresAtMs = parseIsoDateTime(root.expiresAt);
  if (issuedAtMs === null || expiresAtMs === null || expiresAtMs <= issuedAtMs) {
    return reject('missing or invalid dates');
  }
  if (nowMs >= expiresAtMs) return reject('the file has expired');

  const ignored: string[] = [];

  const build = (key: string): number | null => {
    if (!(key in root)) return null;
    const value = integer(root[key]);
    if (value !== null && value >= 0) return value;
    ignored.push(`${key}: not a build number`);
    return null;
  };
  const minSupportedBuild = build('minSupportedBuild');
  const recommendedBuild = build('recommendedBuild');

  let updateMessage: RemoteText | null = null;
  if ('updateMessage' in root) {
    updateMessage = parseRemoteText(root.updateMessage);
    if (!updateMessage) ignored.push('updateMessage: needs an English text');
  }

  const disabledFeatures: RemoteConfig['disabledFeatures'] = {};
  if ('disabledFeatures' in root) {
    const raw = root.disabledFeatures;
    if (isObject(raw)) {
      for (const [key, value] of sortedEntries(raw)) {
        if (!(REMOTE_FEATURES as readonly string[]).includes(key)) {
          ignored.push(`disabledFeatures.${key}: not a feature that can be switched off`);
          continue;
        }
        const message = parseRemoteText(value);
        if (!message) {
          ignored.push(`disabledFeatures.${key}: needs an English message`);
          continue;
        }
        disabledFeatures[key as RemoteFeature] = message;
      }
    } else {
      ignored.push('disabledFeatures: not an object');
    }
  }

  const parameters: RemoteConfig['parameters'] = {};
  if ('parameters' in root) {
    const raw = root.parameters;
    if (isObject(raw)) {
      for (const [key, value] of sortedEntries(raw)) {
        if (!(REMOTE_PARAMETERS as readonly string[]).includes(key)) {
          ignored.push(`parameters.${key}: unknown parameter`);
          continue;
        }
        const parameter = key as RemoteParameter;
        const n = number(value);
        if (n === null) {
          ignored.push(`parameters.${key}: not a number`);
          continue;
        }
        const { min, max } = PARAMETER_INFO[parameter];
        if (n < min || n > max) {
          ignored.push(`parameters.${key}: ${n} is outside ${min}...${max}`);
          continue;
        }
        parameters[parameter] = n;
      }
    } else {
      ignored.push('parameters: not an object');
    }
  }

  const notices: RemoteNotice[] = [];
  if ('notices' in root) {
    const raw = root.notices;
    if (Array.isArray(raw) && raw.every(isObject)) {
      raw.forEach((entry, index) => {
        const notice = noticeFrom(entry as JsonObject);
        if (notice) notices.push(notice);
        else ignored.push(`notices[${index}]: needs an id, an English text, and valid regions and until values`);
      });
    } else {
      ignored.push('notices: not a list of objects');
    }
  }

  return {
    schemaVersion: schema,
    serial,
    issuedAtMs,
    expiresAtMs,
    minSupportedBuild,
    recommendedBuild,
    updateMessage,
    disabledFeatures,
    parameters,
    notices,
    ignored,
  };
}
