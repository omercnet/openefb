// What the counters endpoint accepts. schema.json is the source of truth; the app keeps a typed copy
// (app/src/domain/telemetry/schema.ts) and a test in the app compares the two. Everything not in the schema is dropped:
// the Worker stores nothing it was not told to expect.
import raw from "./schema.json";
import { isRecord } from "./typeGuards.js";

/** One Analytics Engine request may write at most this many data points (Cloudflare's documented limit). */
export const MAX_DATA_POINTS_PER_INVOCATION = 250;

export interface ParamSpec {
  /** The closed set of values the parameter may take. */
  values?: string[];
  /** An anchored regular expression the value must match. */
  pattern?: string;
}

export interface SchemaJson {
  version: number;
  /** Rows per batch. */
  maxRows: number;
  /** Largest count one row may carry. */
  maxCount: number;
  platforms: string[];
  regions: string[];
  patterns: { app: string; update: string };
  /** Event name -> its parameters, in the order their values are stored. */
  events: Record<string, Record<string, ParamSpec>>;
}

/** What goes to Workers Analytics Engine: blob1 event, 2 app, 3 platform, 4 update, 5 region, 6 and 7 parameter values. */
export interface DataPoint {
  indexes: [string];
  blobs: string[];
  doubles: [number];
}

export interface CompiledSchema {
  readonly maxRows: number;
  /** The data point for a row, or null when the row does not fit the schema exactly. */
  toDataPoint(row: unknown): DataPoint | null;
}

const EVENT_NAME = /^[A-Z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const PARAM_NAME = /^[a-z][A-Za-z0-9]*$/;
const ROW_KEYS = new Set(["event", "params", "app", "platform", "update", "region", "count"]);
const MAX_PARAMS = 2;

function anchored(pattern: string, what: string): RegExp {
  if (!pattern.startsWith("^") || !pattern.endsWith("$")) throw new Error(`${what} must be anchored with ^ and $`);
  return new RegExp(pattern);
}

function uniqueStrings(list: unknown, what: string): string[] {
  if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== "string")) {
    throw new Error(`${what} must be a non-empty list of text`);
  }
  if (new Set(list).size !== list.length) throw new Error(`${what} has a repeated entry`);
  return list as string[];
}

type Matcher = (value: string) => boolean;

function matcher(spec: ParamSpec, what: string): Matcher {
  if ((spec.values === undefined) === (spec.pattern === undefined)) throw new Error(`${what} needs exactly one of values and pattern`);
  if (spec.values !== undefined) {
    const allowed = new Set(uniqueStrings(spec.values, `${what} values`));
    return (value) => allowed.has(value);
  }
  const pattern = anchored(spec.pattern as string, `${what} pattern`);
  return (value) => pattern.test(value);
}

/** Checks a schema and prepares it for matching. Throws on anything that would make the endpoint ambiguous. */
export function compileSchema(source: SchemaJson): CompiledSchema {
  if (source.version !== 1) throw new Error("schema version must be 1");
  if (!Number.isInteger(source.maxRows) || source.maxRows < 1 || source.maxRows > MAX_DATA_POINTS_PER_INVOCATION) {
    throw new Error(`maxRows must be a whole number from 1 to ${MAX_DATA_POINTS_PER_INVOCATION}`);
  }
  if (!Number.isInteger(source.maxCount) || source.maxCount < 1) throw new Error("maxCount must be a positive whole number");
  const platforms = new Set(uniqueStrings(source.platforms, "platforms"));
  const regions = new Set(uniqueStrings(source.regions, "regions"));
  const appPattern = anchored(source.patterns.app, "the app pattern");
  const updatePattern = anchored(source.patterns.update, "the update pattern");

  const names = Object.keys(source.events);
  if (names.length === 0) throw new Error("the schema has no events");
  const events = new Map<string, { params: string[]; matchers: Matcher[] }>();
  for (const name of names) {
    if (!EVENT_NAME.test(name)) throw new Error(`event name ${name} is not Group.name`);
    const spec = source.events[name] as Record<string, ParamSpec>;
    const params = Object.keys(spec);
    if (params.length > MAX_PARAMS) throw new Error(`${name} has more than ${MAX_PARAMS} parameters`);
    for (const param of params) {
      if (!PARAM_NAME.test(param)) throw new Error(`${name} parameter ${param} is not lower camel case`);
    }
    events.set(name, { params, matchers: params.map((param) => matcher(spec[param] as ParamSpec, `${name}.${param}`)) });
  }

  return {
    maxRows: source.maxRows,

    toDataPoint(row) {
      if (!isRecord(row) || Object.keys(row).some((key) => !ROW_KEYS.has(key))) return null;
      const { event, params, app, platform, update, region, count } = row;
      if (typeof event !== "string") return null;
      const known = events.get(event);
      if (!known) return null;
      const values = paramValues(known, params);
      if (
        !values ||
        typeof app !== "string" || !appPattern.test(app) ||
        typeof platform !== "string" || !platforms.has(platform) ||
        typeof update !== "string" || !updatePattern.test(update) ||
        typeof region !== "string" || !regions.has(region) ||
        typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > source.maxCount
      ) {
        return null;
      }
      const padded = values.concat(Array<string>(MAX_PARAMS - values.length).fill(""));
      return { indexes: [event], blobs: [event, app, platform, update, region, ...padded], doubles: [count] };
    },
  };
}

/** The parameter values in declaration order, or null when they are not exactly the event's parameters. */
function paramValues(known: { params: string[]; matchers: Matcher[] }, params: unknown): string[] | null {
  if (params === undefined) return known.params.length === 0 ? [] : null;
  if (!isRecord(params)) return null;
  const given = Object.keys(params);
  // Same number of keys as declared, each declared one present below: so no key the schema does not name.
  if (given.length !== known.params.length) return null;
  const values: string[] = [];
  for (const [index, name] of known.params.entries()) {
    const value = params[name];
    if (typeof value !== "string" || !(known.matchers[index] as Matcher)(value)) return null;
    values.push(value);
  }
  return values;
}

export const schema: CompiledSchema = compileSchema(raw as SchemaJson);
