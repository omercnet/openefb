// The expo-sqlite adapter against the shared Db contract, over a fake SQLiteDatabase backed by node:sqlite (a real
// device run is the final check). The fake mirrors expo-sqlite's async API shape: getAllAsync, getFirstAsync,
// runAsync and withExclusiveTransactionAsync that commits on resolve and rolls back and rethrows on reject.
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { expoSqliteDb } from '../../src/adapters/expoSqliteDb';
import { runDbContract } from '../support/dbContract';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

function fakeExpoSqlite(): SQLiteDatabase {
  const sqlite = new DatabaseSync(':memory:');
  const fake = {
    async getAllAsync(sql: string, params: unknown[]) {
      return sqlite.prepare(sql).all(...(params as never[]));
    },
    async getFirstAsync(sql: string, params: unknown[]) {
      return sqlite.prepare(sql).get(...(params as never[])) ?? null;
    },
    async runAsync(sql: string, params: unknown[]) {
      const r = sqlite.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async withExclusiveTransactionAsync(task: (txn: unknown) => Promise<void>) {
      sqlite.exec('BEGIN');
      try {
        await task(fake);
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return fake as unknown as SQLiteDatabase;
}

runDbContract('expo-sqlite', async () => expoSqliteDb(fakeExpoSqlite()));

describe('expo-sqlite adapter specifics', () => {
  it('rejects nested transactions instead of deadlocking', async () => {
    const db = expoSqliteDb(fakeExpoSqlite());
    await expect(db.transaction((tx) => tx.transaction(async () => 1))).rejects.toThrow('nested');
  });

  it('returns the value the transaction body resolves', async () => {
    const db = expoSqliteDb(fakeExpoSqlite());
    expect(await db.transaction(async () => 42)).toBe(42);
  });
});
