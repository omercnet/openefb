import { migration001Initial } from './001_initial';
import { migration002ImportState } from './002_import_state';

export interface Migration {
  /** Target PRAGMA user_version once applied. Versions are 1..N with no gaps. */
  version: number;
  name: string;
  sql: string;
}

/** Forward-only. Append a NNN_name.ts file and add it here; never edit an applied migration. */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'initial', sql: migration001Initial },
  { version: 2, name: 'import_state', sql: migration002ImportState },
];

export const LATEST_VERSION = migrations[migrations.length - 1].version;
