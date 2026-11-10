// Importer orchestration (plan section 4). Each step is recorded in migration_state, so a re-run resumes at the first
// step that has not completed and never repeats one that has. A failed step leaves the legacy files untouched and is
// reported for a "retry import" banner; the other steps still run. Nothing here deletes legacy files.
import type { Clock } from '../ids';
import { systemClock } from '../ids';
import type { Db } from '../db';
import { importKeychain, type KeychainResult, type LegacySecretReader, type SecretStore } from './keychain';
import { importSwiftStore, type SwiftStoreResult } from './swiftStore';
import { importUserDefaults, type UserDefaultsResult, type UserDefaultsSnapshot } from './userDefaults';

export type StepName = 'swift-store' | 'user-defaults' | 'keychain';
export const STEPS: readonly StepName[] = ['swift-store', 'user-defaults', 'keychain'];

export interface LegacyInputs {
  /** default.store opened read-only, or null when the legacy file is absent (fresh install, Android). */
  store: Db | null;
  /** The io.omer.efb defaults domain, or null when absent. */
  defaults: UserDefaultsSnapshot | null;
  /** The keychain reader and the new secret store, or null where there is no keychain (Android). */
  secrets: { reader: LegacySecretReader; store: SecretStore } | null;
}

export interface ImportReport {
  status: 'complete' | 'failed';
  /** Steps that ran in this call (steps already complete are not repeated). */
  ran: StepName[];
  failed: { step: StepName; message: string }[];
  swiftStore?: SwiftStoreResult;
  userDefaults?: UserDefaultsResult;
  keychain?: KeychainResult;
}

async function markStep(db: Db, step: StepName, status: 'complete' | 'failed', detail: string, now: Clock) {
  await db.run(
    'INSERT INTO migration_state (step, status, detail, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(step) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at',
    [step, status, detail, now()],
  );
}

export async function importStatus(db: Db): Promise<'complete' | 'incomplete'> {
  const rows = await db.all<{ step: string }>("SELECT step FROM migration_state WHERE status = 'complete'");
  const done = new Set(rows.map((r) => r.step));
  return STEPS.every((s) => done.has(s)) ? 'complete' : 'incomplete';
}

export async function runSwiftImport(
  target: Db,
  legacy: LegacyInputs,
  now: Clock = systemClock,
): Promise<ImportReport> {
  const report: ImportReport = { status: 'complete', ran: [], failed: [] };
  const complete = new Set(
    (await target.all<{ step: string }>("SELECT step FROM migration_state WHERE status = 'complete'")).map(
      (r) => r.step,
    ),
  );
  const run = async (step: StepName, work: () => Promise<string>) => {
    if (complete.has(step)) return;
    report.ran.push(step);
    try {
      await markStep(target, step, 'complete', await work(), now);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report.failed.push({ step, message });
      await markStep(target, step, 'failed', message, now);
    }
  };

  await run('swift-store', async () => {
    if (!legacy.store) return 'no legacy store';
    report.swiftStore = await importSwiftStore(legacy.store, target);
    return JSON.stringify(report.swiftStore.imported);
  });
  await run('user-defaults', async () => {
    if (!legacy.defaults) return 'no legacy defaults';
    report.userDefaults = await importUserDefaults(legacy.defaults, target);
    return `${report.userDefaults.imported} keys`;
  });
  await run('keychain', async () => {
    if (!legacy.secrets) return 'no keychain';
    report.keychain = await importKeychain(legacy.secrets.reader, legacy.secrets.store);
    if (report.keychain.failed.length > 0)
      throw new Error(`keychain items left in place: ${report.keychain.failed.join(', ')}`);
    return `moved ${report.keychain.moved.length}, absent ${report.keychain.absent.length}`;
  });

  if (report.failed.length > 0) report.status = 'failed';
  return report;
}
