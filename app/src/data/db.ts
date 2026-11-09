// The only database surface the repositories use. A Node sqlite adapter (tests/support) implements it in Jest, so
// repositories and their tests run on Linux with no device. An expo-sqlite adapter in src/adapters is planned for the app.
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

export interface RunResult {
  /** Rows inserted, updated or deleted by the statement. */
  changes: number;
  lastInsertRowId: number;
}

export interface Db {
  /** Every row of a query. */
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): Promise<T[]>;
  /** The first row of a query, or null when there is none. */
  get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): Promise<T | null>;
  /** A statement that changes data or schema. */
  run(sql: string, params?: SqlParams): Promise<RunResult>;
  /** Runs fn atomically on this connection: commits when it resolves, rolls back and rethrows when it rejects. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
