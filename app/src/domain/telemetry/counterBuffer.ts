// The counts waiting to be sent: one row per distinct (event, parameters, app version, platform, update, region), with how
// many times it happened. Nothing else is kept: no time stamp, no order of events, no id, so the buffer cannot say what
// happened when, or to whom.
import { TELEMETRY_SCHEMA, validateRow, type CounterRow } from './schema';
import { isRecord } from '../typeGuards';

/** Distinct rows held at once. A launch that lands in many dimensions at once cannot grow the backlog past this. */
export const MAX_BUFFER_KEYS = 200;

type Dimensions = Omit<CounterRow, 'count'>;

const byName = ([a]: [string, string], [b]: [string, string]): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rows are the same row when everything but the count matches; the order a caller listed parameters in does not matter. */
const keyOf = (row: Dimensions): string =>
  JSON.stringify([
    row.event,
    Object.entries(row.params ?? {}).sort(byName),
    row.app,
    row.platform,
    row.update,
    row.region,
  ]);

export class CounterBuffer {
  private readonly byKey = new Map<string, CounterRow>();

  constructor(
    private readonly maxKeys: number = MAX_BUFFER_KEYS,
    private readonly maxCount: number = TELEMETRY_SCHEMA.maxCount,
  ) {}

  get size(): number {
    return this.byKey.size;
  }

  /**
   * Counts `by` more of a row. False when nothing was counted: `by` is not a whole number of at least 1, or the row is new
   * and the buffer already holds its limit of rows (a row it has is always counted).
   */
  add(row: Dimensions, by = 1): boolean {
    if (!Number.isInteger(by) || by < 1) return false;
    const key = keyOf(row);
    const existing = this.byKey.get(key);
    if (existing) {
      existing.count = Math.min(existing.count + by, this.maxCount);
      return true;
    }
    if (this.byKey.size >= this.maxKeys) return false;
    this.byKey.set(key, {
      event: row.event,
      ...(row.params && Object.keys(row.params).length > 0 ? { params: { ...row.params } } : {}),
      app: row.app,
      platform: row.platform,
      update: row.update,
      region: row.region,
      count: Math.min(by, this.maxCount),
    });
    return true;
  }

  /** Removes and returns up to `max` rows, oldest first. */
  drain(max: number): CounterRow[] {
    const limit = Math.floor(max);
    const out: CounterRow[] = [];
    if (!(limit >= 1)) return out;
    for (const [key, row] of this.byKey) {
      if (out.length >= limit) break;
      out.push(row);
      this.byKey.delete(key);
    }
    return out;
  }

  /** Puts rows back (a send that failed): their counts are added to what was counted since, within the row limit. */
  restore(rows: readonly CounterRow[]): void {
    for (const { count, ...dimensions } of rows) this.add(dimensions, count);
  }

  clear(): void {
    this.byKey.clear();
  }

  /** A copy of the rows, oldest first. */
  rows(): CounterRow[] {
    return [...this.byKey.values()].map((row) => ({ ...row, ...(row.params ? { params: { ...row.params } } : {}) }));
  }
}

/** The form the backlog is kept in between launches. */
export function serializeRows(rows: readonly CounterRow[]): string {
  return JSON.stringify({ v: 1, rows });
}

/**
 * Reads a stored backlog. What was stored is not trusted (an older version, a damaged value): every row is checked against
 * the schema and a bad one is dropped by itself; text that is not a backlog gives no rows.
 */
export function parseRows(text: string | null, maxRows = MAX_BUFFER_KEYS): CounterRow[] {
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.rows)) return [];
  const rows: CounterRow[] = [];
  for (const candidate of parsed.rows) {
    if (rows.length >= maxRows) break;
    const valid = validateRow(candidate);
    if (valid) rows.push(valid);
  }
  return rows;
}
