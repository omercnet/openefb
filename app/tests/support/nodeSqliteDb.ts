import { DatabaseSync } from 'node:sqlite';
import type { Db, RunResult, SqlParams, SqlRow } from '../../src/data/db';

/** In-memory Db over Node's built-in SQLite (it ships with R-tree). Tests only; not nested-transaction safe. */
export function openNodeSqliteDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  const db: Db = {
    async all<T extends SqlRow>(sql: string, params: SqlParams = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async get<T extends SqlRow>(sql: string, params: SqlParams = []) {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async run(sql: string, params: SqlParams = []): Promise<RunResult> {
      const r = sqlite.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      sqlite.exec('BEGIN');
      try {
        const value = await fn(db);
        sqlite.exec('COMMIT');
        return value;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
