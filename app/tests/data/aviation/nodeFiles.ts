// Node implementations of the aviation install platform piece, for Jest: real files in a temp directory and a file
// backed Db over node:sqlite (tests/support/nodeSqliteDb is in-memory only).
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db, RunResult, SqlParams, SqlRow } from '../../../src/data/db';
import {
  INSTALLED_FILE_NAME,
  VERSION_MARKER_FILE_NAME,
  type AviationDbHandle,
  type AviationInstallFiles,
  type AviationInstallPlatform,
} from '../../../src/data/aviation';

// Every directory made here is removed when the importing test file finishes. Jest gives each test file its own module
// registry, so this hook is registered once per file, at import time (hooks cannot be added from inside a test).
// Without it each run leaked one directory per call (two bundled database copies each) into the shared /tmp.
const createdTempDirs: string[] = [];
afterAll(() => {
  for (const dir of createdTempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

export function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efb-avdb-'));
  createdTempDirs.push(dir);
  return dir;
}

export function sha256OfFile(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function nodeInstallFiles(bundledPath: string, installDir: string): AviationInstallFiles {
  const installed = path.join(installDir, INSTALLED_FILE_NAME);
  const marker = path.join(installDir, VERSION_MARKER_FILE_NAME);
  return {
    async bundledSize() {
      return fs.existsSync(bundledPath) ? fs.statSync(bundledPath).size : null;
    },
    async bundledSha256() {
      return sha256OfFile(bundledPath);
    },
    async installedExists() {
      return fs.existsSync(installed);
    },
    async readMarker() {
      return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
    },
    async removeInstalled() {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(installed + suffix, { force: true });
    },
    async copyBundledToInstalled() {
      fs.mkdirSync(installDir, { recursive: true });
      fs.copyFileSync(bundledPath, installed);
    },
    async writeMarker(text) {
      fs.writeFileSync(marker, text, 'utf8');
    },
  };
}

/** A Db over a node:sqlite database; not nested-transaction safe, like the in-memory support adapter. */
export function wrapNodeSqlite(sqlite: DatabaseSync): AviationDbHandle {
  const db: AviationDbHandle = {
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
    async close() {
      sqlite.close();
    },
  };
  return db;
}

export function nodeInstallPlatform(bundledPath: string, installDir: string): AviationInstallPlatform {
  return {
    files: nodeInstallFiles(bundledPath, installDir),
    async openInstalled() {
      return wrapNodeSqlite(new DatabaseSync(path.join(installDir, INSTALLED_FILE_NAME)));
    },
  };
}
