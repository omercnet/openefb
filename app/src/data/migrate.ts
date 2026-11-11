// Forward-only schema migrations keyed by PRAGMA user_version (SwiftData's EFBSchemaMigrationPlan equivalent).
import type { Db } from './db';
import { migrations as defaultMigrations, type Migration } from './migrations';

/** Splits a migration script into statements. Migrations here contain no triggers or semicolons inside strings. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function currentVersion(db: Db): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applies every migration newer than the stored version, each in its own transaction together with its version bump.
 * Idempotent: a database already at the latest version is left alone. A database newer than this build is an error.
 */
export async function migrate(db: Db, migrations: readonly Migration[] = defaultMigrations): Promise<number> {
  const latest = migrations.length === 0 ? 0 : migrations[migrations.length - 1].version;
  const from = await currentVersion(db);
  if (from > latest) throw new Error(`database schema version ${from} is newer than this app supports (${latest})`);
  for (const m of migrations) {
    if (m.version <= from) continue;
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(m.sql)) await tx.run(statement);
      await tx.run(`PRAGMA user_version = ${m.version}`);
    });
  }
  return latest;
}
