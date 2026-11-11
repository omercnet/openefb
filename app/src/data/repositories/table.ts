// Table-driven row codec and CRUD shared by the five id-keyed models. One field spec per model keeps the column list
// in a single place; the SQL itself lives in migrations/001_initial.ts.
import type { Db, SqlRow, SqlValue } from '../db';
import type { NightLandingEntry, VSpeeds } from '../models';

export type Kind = 'text' | 'num' | 'bool' | 'vSpeeds' | 'nightLandings';
export interface Field {
  key: string;
  column: string;
  kind: Kind;
}
export const f = (key: string, column: string, kind: Kind = 'text'): Field => ({ key, column, kind });

const V_KEYS = ['vr', 'vx', 'vy', 'va', 'vne', 'vfe', 'vs0', 'vs1'] as const;

/** Swift JSONEncoder omits nil optionals; a missing key reads back as nil. */
export function encodeVSpeeds(v: VSpeeds): string {
  const out: Record<string, number> = {};
  for (const k of V_KEYS) if (v[k] !== null && v[k] !== undefined) out[k] = v[k];
  return JSON.stringify(out);
}
/** VSpeeds.decode with try?: unreadable data is nil. */
export function decodeVSpeeds(text: string): VSpeeds | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const v = {} as VSpeeds;
    for (const k of V_KEYS) v[k] = typeof o[k] === 'number' ? o[k] : null;
    return v;
  } catch {
    return null;
  }
}
/** [NightLandingEntry].decode with try? ?? []: unreadable data is an empty list. */
export function decodeNightLandings(text: string): NightLandingEntry[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: NightLandingEntry[] = [];
    for (const e of raw as unknown[]) {
      const o = e as Record<string, unknown> | null;
      if (!o || typeof o.date !== 'number' || typeof o.count !== 'number') return [];
      out.push({ date: o.date, count: o.count });
    }
    return out;
  } catch {
    return [];
  }
}

function toSql(kind: Kind, value: unknown): SqlValue {
  if (value === null || value === undefined) return kind === 'nightLandings' ? '[]' : null;
  switch (kind) {
    case 'bool':
      return value ? 1 : 0;
    case 'vSpeeds':
      return encodeVSpeeds(value as VSpeeds);
    case 'nightLandings':
      return JSON.stringify(value);
    default:
      return value as SqlValue;
  }
}

function fromSql(kind: Kind, value: SqlValue | undefined): unknown {
  switch (kind) {
    case 'bool':
      return value === 1;
    case 'vSpeeds':
      return typeof value === 'string' ? decodeVSpeeds(value) : null;
    case 'nightLandings':
      return typeof value === 'string' ? decodeNightLandings(value) : [];
    default:
      return value ?? null;
  }
}

export interface Repository<T extends { id: string }> {
  insert(record: T): Promise<void>;
  get(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  /** Rows where `column` equals `value`, in list order. `column` must be a trusted constant, never user input. */
  listWhere(column: string, value: string): Promise<T[]>;
  /** Writes the given fields; resolves the stored record, or null when no row has that id. */
  update(id: string, patch: Partial<Omit<T, 'id'>>): Promise<T | null>;
  /** True when a row was deleted. */
  remove(id: string): Promise<boolean>;
}

export function makeRepository<T extends { id: string }>(
  db: Db,
  table: string,
  fields: readonly Field[],
  orderBy: string,
): Repository<T> {
  const columns = ['id', ...fields.map((x) => x.column)];
  const select = `SELECT ${columns.join(', ')} FROM ${table}`;
  const toRecord = (row: SqlRow): T => {
    const rec: Record<string, unknown> = { id: row.id };
    for (const x of fields) rec[x.key] = fromSql(x.kind, row[x.column]);
    return rec as unknown as T;
  };
  const repo: Repository<T> = {
    async insert(record) {
      const src = record as unknown as Record<string, unknown>;
      const values = [record.id, ...fields.map((x) => toSql(x.kind, src[x.key]))];
      await db.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values,
      );
    },
    async get(id) {
      const row = await db.get(`${select} WHERE id = ?`, [id]);
      return row ? toRecord(row) : null;
    },
    async list() {
      return (await db.all(`${select} ORDER BY ${orderBy}`)).map(toRecord);
    },
    async listWhere(column, value) {
      return (await db.all(`${select} WHERE ${column} = ? ORDER BY ${orderBy}`, [value])).map(toRecord);
    },
    async update(id, patch) {
      const src = patch as Record<string, unknown>;
      const changed = fields.filter((x) => x.key in src && src[x.key] !== undefined);
      if (changed.length > 0) {
        const set = changed.map((x) => `${x.column} = ?`).join(', ');
        const res = await db.run(`UPDATE ${table} SET ${set} WHERE id = ?`, [
          ...changed.map((x) => toSql(x.kind, src[x.key])),
          id,
        ]);
        if (res.changes === 0) return null;
      }
      return repo.get(id);
    },
    async remove(id) {
      return (await db.run(`DELETE FROM ${table} WHERE id = ?`, [id])).changes > 0;
    },
  };
  return repo;
}
