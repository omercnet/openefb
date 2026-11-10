// Test-only readers for the Swift fixtures (tests/fixtures/swift-store-v1): a zip reader over node:zlib, a binary
// plist (bplist00) decoder for the UserDefaults export, and a file-backed read-only node sqlite Db. Linux Jest needs no
// unzip binary or extra dependency.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Db, RunResult, SqlParams, SqlRow } from '../../src/data/db';

export const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'swift-store-v1');

/** Every file in a zip as name -> bytes (stored and deflated entries). */
export function readZip(path: string): Map<string, Buffer> {
  const buf = readFileSync(path);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (!name.endsWith('/')) files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Writes selected zip entries under a fresh temp dir (prefix stripped) and returns the dir. */
export function extractZip(files: Map<string, Buffer>, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kanaf-swift-'));
  for (const [name, data] of files) {
    if (!name.startsWith(prefix)) continue;
    const out = join(dir, name.slice(prefix.length));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  return dir;
}

/** bplist00 decoder: booleans, ints, reals, strings, arrays, dictionaries, data. Enough for a defaults export. */
export function parseBinaryPlist(buf: Buffer): unknown {
  if (buf.toString('latin1', 0, 8) !== 'bplist00') throw new Error('not a binary plist');
  const t = buf.subarray(buf.length - 32);
  const offSize = t[6];
  const refSize = t[7];
  const numObjects = Number(t.readBigUInt64BE(8));
  const top = Number(t.readBigUInt64BE(16));
  const tableStart = Number(t.readBigUInt64BE(24));
  const uint = (at: number, n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[at + i];
    return v;
  };
  const offsetOf = (i: number) => uint(tableStart + i * offSize, offSize);
  const lenAt = (pos: number, info: number): [number, number] => {
    if (info !== 0xf) return [info, pos + 1];
    const size = 1 << (buf[pos + 1] & 0xf);
    return [uint(pos + 2, size), pos + 2 + size];
  };
  const read = (i: number): unknown => {
    if (i >= numObjects) throw new Error('bad object ref');
    const pos = offsetOf(i);
    const type = buf[pos] >> 4;
    const info = buf[pos] & 0xf;
    switch (type) {
      case 0x0:
        return info === 0x8 ? false : info === 0x9 ? true : null;
      case 0x1:
        return uint(pos + 1, 1 << info);
      case 0x2:
        return info === 3 ? buf.readDoubleBE(pos + 1) : buf.readFloatBE(pos + 1);
      case 0x4: {
        const [n, start] = lenAt(pos, info);
        return buf.subarray(start, start + n);
      }
      case 0x5: {
        const [n, start] = lenAt(pos, info);
        return buf.toString('latin1', start, start + n);
      }
      case 0x6: {
        const [n, start] = lenAt(pos, info);
        return Buffer.from(buf.subarray(start, start + n * 2))
          .swap16()
          .toString('utf16le');
      }
      case 0xa: {
        const [n, start] = lenAt(pos, info);
        return Array.from({ length: n }, (_, k) => read(uint(start + k * refSize, refSize)));
      }
      case 0xd: {
        const [n, start] = lenAt(pos, info);
        const out: Record<string, unknown> = {};
        for (let k = 0; k < n; k++) {
          out[String(read(uint(start + k * refSize, refSize)))] = read(uint(start + (n + k) * refSize, refSize));
        }
        return out;
      }
      default:
        throw new Error(`unsupported plist type ${type}`);
    }
  };
  return read(top);
}

/** A Db over an existing sqlite file (a copy of default.store with its -wal), read-only. Tests only. */
export function openNodeSqliteFileDb(path: string): Db {
  const sqlite = new DatabaseSync(path, { readOnly: true });
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
      return fn(db);
    },
  };
  return db;
}
