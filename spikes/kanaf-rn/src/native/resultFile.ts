// JSON result files in the app's documents directory, read back by CI (simctl get_app_container ... data,
// adb run-as) and by the self test. Native only.
import { File, Paths } from 'expo-file-system';

export const SELFTEST_FILE = 'spike-result.json';
export const ANIMATION_FILE = 'spike-anim.json';

export async function writeResult(name: string, value: unknown): Promise<string> {
  const file = new File(Paths.document, name);
  if (!file.exists) file.create();
  await file.write(JSON.stringify(value, null, 2));
  return file.uri;
}

export async function readResult(name: string): Promise<unknown> {
  const file = new File(Paths.document, name);
  return file.exists ? JSON.parse(await file.text()) : null;
}
