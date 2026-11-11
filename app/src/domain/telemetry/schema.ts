// The vocabulary of the first-party usage counters (owner decision Q7, plan 3.7): which events the app may count and with
// which parameters. It replaces the TelemetryDeck signals of Services/TelemetryService.swift and carries the same names.
// Everything is a closed list or a short lower-case pattern, so no coordinate, airport, tail number, name or free text can be
// counted, and the types below stop a call site from passing one.
//
// web/telemetry/src/schema.json is the server's copy and the source of truth; tests/telemetry/workerSchema.test.ts fails when
// this table and that file differ. Adding an event means changing both, the PRIVACY.md section on usage counters, and the Worker
// deployment first (web/telemetry/README.md).
import type { Region } from '../core/region';
import { isRecord } from '../typeGuards';

const PACK_NAME = '^[a-z0-9][a-z0-9._-]{0,31}$';

export const TELEMETRY_SCHEMA = {
  version: 1,
  /** Rows in one batch. */
  maxRows: 40,
  /** Largest count one row may carry. */
  maxCount: 100000,
  platforms: ['ios', 'android'],
  regions: ['us', 'israel'],
  patterns: {
    app: '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$',
    update: '^(?:embedded|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$',
  },
  /** Event name -> its parameters, in the order the server stores their values. */
  events: {
    'App.launched': {},
    'Navigation.screen': { screen: { values: ['map', 'log'] } },
    'Recording.started': {},
    'Recording.stopped': { durationMinutes: { values: ['0-15', '15-60', '60+'] } },
    'FlightPlan.activated': {},
    'Debrief.generated': {},
    'ChartPack.installed': { product: { pattern: PACK_NAME }, edition: { pattern: PACK_NAME } },
    'Israel.briefingOpened': {},
    'Israel.fplShared': { method: { values: ['share', 'email'] } },
  },
} as const;

type Events = typeof TELEMETRY_SCHEMA.events;
export type EventName = keyof Events;
type ValueOf<Spec> = Spec extends { readonly values: readonly (infer V)[] }
  ? V
  : Spec extends { readonly pattern: string }
    ? string
    : never;

/** The parameters an event takes, typed from the schema: a closed list gives its values, a pattern gives text. */
export type SignalParams<E extends EventName> = keyof Events[E] extends never
  ? Record<string, never> // an event without parameters takes none (an empty object type would accept any literal)
  : { -readonly [K in keyof Events[E]]: ValueOf<Events[E][K]> };

/** The arguments of a signal after its event: the parameters, which an event that has none is called without. */
export type SignalArgs<E extends EventName> = keyof Events[E] extends never ? [] : [params: SignalParams<E>];

export type Platform = (typeof TELEMETRY_SCHEMA.platforms)[number];

interface ParamSpec {
  readonly values?: readonly string[];
  readonly pattern?: string;
}

export interface ValidSignal {
  event: string;
  /** In the order the schema declares them. */
  params: Record<string, string>;
}

const matches = (spec: ParamSpec, value: string): boolean =>
  spec.values ? spec.values.includes(value) : new RegExp(spec.pattern as string).test(value);

/**
 * The signal as it will be counted, or null when it does not fit the schema exactly: an unknown event, a missing or extra
 * parameter, a value outside the schema, or a value that is not text. Callers are typed, but this is what keeps a bad call
 * (a cast, a stored value) out of the counters.
 */
export function validateSignal(name: string, params: unknown): ValidSignal | null {
  if (typeof name !== 'string' || !Object.hasOwn(TELEMETRY_SCHEMA.events, name)) return null;
  const spec: Record<string, ParamSpec> = TELEMETRY_SCHEMA.events[name as EventName];
  const declared = Object.keys(spec);
  const given = params === undefined ? {} : params;
  if (!isRecord(given) || Object.keys(given).length !== declared.length) return null;
  const clean: Record<string, string> = {};
  for (const key of declared) {
    const value = given[key];
    if (typeof value !== 'string' || !matches(spec[key] as ParamSpec, value)) return null;
    clean[key] = value;
  }
  return { event: name, params: clean };
}

/** Swift `Telemetry.durationBucket`: a recording's length in minutes as "0-15", "15-60" or "60+". */
export function durationBucket(seconds: number): '0-15' | '15-60' | '60+' {
  const minutes = seconds / 60;
  if (minutes < 15) return '0-15';
  if (minutes < 60) return '15-60';
  return '60+';
}

// The schema's regions must all be regions the app has (a test checks the lists are equal).
const _regionsAreRegions: readonly Region[] = TELEMETRY_SCHEMA.regions;
void _regionsAreRegions;

/** One counted event with the dimensions it happened under: a row of the batch sent to the Worker, and of the stored backlog. */
export interface CounterRow {
  event: string;
  /** Left out when the event has none. */
  params?: Record<string, string>;
  app: string;
  platform: Platform;
  update: string;
  region: Region;
  count: number;
}

const ROW_KEYS: readonly string[] = ['event', 'params', 'app', 'platform', 'update', 'region', 'count'];

/**
 * The row in wire order (event, params, app, platform, update, region, count), or null unless it fits the schema exactly:
 * the same checks the Worker makes, here applied to what is about to be sent and to what was stored on the device.
 */
export function validateRow(row: unknown): CounterRow | null {
  if (!isRecord(row) || Object.keys(row).some((key) => !ROW_KEYS.includes(key))) return null;
  const signal = typeof row.event === 'string' ? validateSignal(row.event, row.params) : null;
  const { app, platform, update, region, count } = row;
  if (
    !signal ||
    typeof app !== 'string' ||
    !new RegExp(TELEMETRY_SCHEMA.patterns.app).test(app) ||
    typeof platform !== 'string' ||
    !(TELEMETRY_SCHEMA.platforms as readonly string[]).includes(platform) ||
    typeof update !== 'string' ||
    !new RegExp(TELEMETRY_SCHEMA.patterns.update).test(update) ||
    typeof region !== 'string' ||
    !(TELEMETRY_SCHEMA.regions as readonly string[]).includes(region) ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > TELEMETRY_SCHEMA.maxCount
  ) {
    return null;
  }
  return {
    event: signal.event,
    ...(Object.keys(signal.params).length > 0 ? { params: signal.params } : {}),
    app,
    platform: platform as Platform,
    update,
    region: region as Region,
    count,
  };
}
