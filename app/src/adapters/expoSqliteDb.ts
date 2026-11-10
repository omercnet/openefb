// expo-sqlite implementation of the Db interface (src/data/db.ts). Behaviour matches tests/support/nodeSqliteDb.ts,
// which tests/support/dbContract.ts pins: same row shapes, null from get, commit/rollback-and-rethrow transactions.
import { openDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite';
import type { Db, RunResult, SqlParams, SqlRow } from '../data/db';

const bind = (params: SqlParams): SQLiteBindValue[] => params as SQLiteBindValue[];

/** Wraps an open expo-sqlite database. A transaction runs on its own exclusive connection (expo-sqlite queues other work behind it). */
export function expoSqliteDb(sqlite: SQLiteDatabase): Db {
  const api = (inner: SQLiteDatabase): Omit<Db, 'transaction'> => ({
    all: <T extends SqlRow>(sql: string, params: SqlParams = []) => inner.getAllAsync<T>(sql, bind(params)),
    async get<T extends SqlRow>(sql: string, params: SqlParams = []) {
      return (await inner.getFirstAsync<T>(sql, bind(params))) ?? null;
    },
    async run(sql: string, params: SqlParams = []): Promise<RunResult> {
      const r = await inner.runAsync(sql, bind(params));
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
  });
  const db: Db = {
    ...api(sqlite),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      let result!: T;
      await sqlite.withExclusiveTransactionAsync(async (txn) => {
        // Inside the transaction every call goes through txn; nested transactions are rejected.
        const tx: Db = {
          ...api(txn as unknown as SQLiteDatabase),
          transaction: () => Promise.reject(new Error('nested transactions are not supported')),
        };
        result = await fn(tx);
      });
      return result;
    },
  };
  return db;
}

/** Opens (creating if needed) a database file in the expo-sqlite directory and wraps it. */
export async function openExpoSqliteDb(name: string): Promise<Db> {
  return expoSqliteDb(await openDatabaseAsync(name));
}
