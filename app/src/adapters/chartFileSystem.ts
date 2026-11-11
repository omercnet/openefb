// ChartFileSystem (services/charts/ports) over expo-file-system. Native only; not covered by Jest (no device), so the
// device checks (I3) own it: hashing speed on a real MBTiles pack, folder moves, and backup exclusion.
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { ChartFileSystem } from '../services/charts/ports';
import type { Sha256 } from '../services/charts/sha256';

const HASH_CHUNK = 1 << 20;

/** Absolute location for chart data: documents/<name> (Swift: Application Support). */
export const chartRoot = (name: string): string => `${Paths.document.uri.replace(/\/+$/, '')}/${name}`;

function assertInside(path: string): void {
  if (path.split('/').some((p) => p === '..')) throw new Error(`invalid path: ${path}`);
}

const isDirectory = (path: string): boolean => new Directory(path).exists;

export const chartFileSystem: ChartFileSystem = {
  join: (...parts) => parts.join('/').replace(/([^:])\/{2,}/g, '$1/'),
  exists(path) {
    assertInside(path);
    return new File(path).exists || isDirectory(path);
  },
  size(path) {
    assertInside(path);
    const file = new File(path);
    return file.exists ? file.size : null;
  },
  async readText(path) {
    assertInside(path);
    const file = new File(path);
    return file.exists ? await file.text() : null;
  },
  async writeText(path, text) {
    assertInside(path);
    const file = new File(path);
    file.create({ intermediates: true, overwrite: true });
    await file.write(text);
  },
  async readHead(path, count) {
    assertInside(path);
    const file = new File(path);
    if (!file.exists) return null;
    const handle = file.open(FileMode.ReadOnly);
    try {
      return await handle.readBytes(count);
    } finally {
      handle.close();
    }
  },
  async hashFile(path, hasher: Sha256) {
    assertInside(path);
    const file = new File(path);
    if (!file.exists) throw new Error(`no such file: ${path}`);
    const handle = file.open(FileMode.ReadOnly);
    try {
      for (;;) {
        const chunk = await handle.readBytes(HASH_CHUNK);
        if (chunk.length === 0) break;
        hasher.update(chunk);
      }
    } finally {
      handle.close();
    }
  },
  async ensureDir(path) {
    assertInside(path);
    new Directory(path).create({ intermediates: true, idempotent: true });
  },
  async move(from, to) {
    assertInside(from);
    assertInside(to);
    if (isDirectory(from)) {
      new Directory(from).move(new Directory(to));
    } else {
      new File(from).move(new File(to));
    }
  },
  async remove(path) {
    assertInside(path);
    const dir = new Directory(path);
    if (dir.exists) {
      dir.delete();
      return;
    }
    const file = new File(path);
    if (file.exists) file.delete();
  },
  async list(path) {
    assertInside(path);
    const dir = new Directory(path);
    return dir.exists ? dir.list().map((entry) => entry.name) : [];
  },
};
