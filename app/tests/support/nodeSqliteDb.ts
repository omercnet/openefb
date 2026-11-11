import { DatabaseSync } from 'node:sqlite';
import type { Db, RunResult, SqlParams, SqlRow } from '../../src/data/db';

/** Db over Node's built-in SQLite (it ships with R-tree); in memory unless a file path is given. Tests only; not nested-transaction safe. */
export function openNodeSqliteDb(path: string = ':memory:'): Db {
  const sqlite = new DatabaseSync(path);
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
