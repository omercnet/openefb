// Port for small secrets (API keys). Replaces Services/KeychainStore.swift. Values are UTF-8 strings.

export interface SecretStore {
  /** The stored string for key, or null when absent or unreadable. */
  get(key: string): Promise<string | null>;
  /** Inserts or replaces the value for key. */
  set(key: string, value: string): Promise<void>;
  /** Deletes the value for key. A missing item is not an error. */
  remove(key: string): Promise<void>;
}

/** Keychain service and account names the Swift app used for the FAA NOTAM credentials. */
export const NOTAM_SECRET_SERVICE = 'quartermint.efb-212.faa-notam-api';
export const NOTAM_CLIENT_ID_KEY = 'client_id';
export const NOTAM_CLIENT_SECRET_KEY = 'client_secret';

/** In-memory SecretStore for tests. */
export class FakeSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}
