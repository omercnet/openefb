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
    const file = fileFor(key);
    file.create({ intermediates: true, overwrite: true });
    await file.write(text);
  },
  async remove(key) {
    const file = fileFor(key);
    if (file.exists) file.delete();
  },
};
