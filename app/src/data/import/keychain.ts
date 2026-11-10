// Keychain step. expo-secure-store cannot read the Swift app's items, so a native LegacySecretReader (adapters track,
// src/domain/ports/legacySecrets.ts) reads them; they are written through SecretStore (src/domain/ports/secretStore.ts)
// and the legacy items are deleted only after the new write is read back. Both ports are declared structurally here
// until they are on main; the real ones must stay assignable to these.
//
// NEEDS AN ON-DEVICE CHECK: the simulator build cannot use the keychain (errSecMissingEntitlement), so no fixture
// exists. Service and account names come from the code (NotamService.swift:65, KeychainStore.swift).

export interface LegacySecretReader {
  /** The UTF-8 string of the generic-password item, or null when absent. */
  read(service: string, account: string): Promise<string | null>;
  /** Deletes the item; a missing item is not an error. */
  remove(service: string, account: string): Promise<void>;
}
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// These values mirror NOTAM_SECRET_SERVICE, NOTAM_CLIENT_ID_KEY and NOTAM_CLIENT_SECRET_KEY exported by
// src/domain/ports/secretStore.ts (PR #27); replace them with those imports once it merges.
export const LEGACY_NOTAM_SERVICE = 'quartermint.efb-212.faa-notam-api';
/** Swift account name -> SecretStore key. The new keys keep the Swift account names. */
export const LEGACY_SECRETS: readonly { account: string; key: string }[] = [
  { account: 'client_id', key: 'client_id' },
  { account: 'client_secret', key: 'client_secret' },
];

export interface KeychainResult {
  /** Accounts copied and removed from the legacy keychain. */
  moved: string[];
  /** Accounts with no legacy item (the user re-enters the key if they never had one). */
  absent: string[];
  /** Accounts left in the legacy keychain because the write or the delete failed; a retry picks them up. */
  failed: string[];
}

/** Idempotent: an item already moved is absent from the legacy keychain, so a second run finds nothing to do. */
export async function importKeychain(legacy: LegacySecretReader, store: SecretStore): Promise<KeychainResult> {
  const result: KeychainResult = { moved: [], absent: [], failed: [] };
  for (const { account, key } of LEGACY_SECRETS) {
    try {
      const value = await legacy.read(LEGACY_NOTAM_SERVICE, account);
      if (value === null || value === '') {
        result.absent.push(account);
        continue;
      }
      // Never replace a value the user already entered in the new app.
      if ((await store.get(key)) === null) {
        await store.set(key, value);
        if ((await store.get(key)) !== value) throw new Error('read-back mismatch');
      }
      await legacy.remove(LEGACY_NOTAM_SERVICE, account);
      result.moved.push(account);
    } catch {
      result.failed.push(account);
    }
  }
  return result;
}
