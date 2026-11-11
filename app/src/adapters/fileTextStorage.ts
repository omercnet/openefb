// TextStorage (services/ports) over expo-file-system: small text files under the app's document directory.
// Native only. A crash mid-write leaves a truncated file; readers (RemoteConfigStore) treat that as "no saved copy".
import { File, Paths } from 'expo-file-system';
import type { TextStorage } from '../services/ports';

/** Keys are relative paths like "RemoteConfig/last-config.json"; anything that could leave the root is refused. */
function fileFor(key: string): File {
  const parts = key.split('/');
  if (key === '' || key.startsWith('/') || parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\'))) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return new File(Paths.document, ...parts);
}

export const fileTextStorage: TextStorage = {
  async read(key) {
    const file = fileFor(key);
    return file.exists ? await file.text() : null;
  },
  async write(key, text) {
    // Atomic replace: write the new text beside the old file, then move it over. A crash mid-write leaves the last good copy.
    const target = fileFor(key);
    const temp = fileFor(`${key}.tmp`);
    temp.create({ intermediates: true, overwrite: true });
    try {
      await temp.write(text);
      temp.move(target, { overwrite: true });
    } catch (error) {
      if (temp.exists) temp.delete();
      throw error;
    }
  },
  async remove(key) {
    const file = fileFor(key);
    if (file.exists) file.delete();
  },
};
