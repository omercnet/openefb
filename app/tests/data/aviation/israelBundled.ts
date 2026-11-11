// The real efb-212/Resources/israel-aviation.sqlite, referenced in place (never copied into the tree), installed into a
// temp directory and opened through the same code path as the app.
import path from 'node:path';
import {
  createIsraelAviationDatabase,
  openIsraelDatabaseFile,
  type IsraelAviationDatabase,
} from '../../../src/data/aviation';
import { makeTempDir, nodeInstallPlatform } from './nodeFiles';

export const ISRAEL_BUNDLED = path.resolve(__dirname, '../../../../efb-212/Resources/israel-aviation.sqlite');

/** Opens the bundled database once for a test file; call in beforeAll, close in afterAll. */
export async function openBundledIsrael(): Promise<{ db: IsraelAviationDatabase; close: () => Promise<void> }> {
  const handle = await openIsraelDatabaseFile(nodeInstallPlatform(ISRAEL_BUNDLED, path.join(makeTempDir(), 'install')));
  return { db: createIsraelAviationDatabase(handle), close: () => handle.close() };
}
