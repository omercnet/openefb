// Port for the D3 importer: reads and deletes Keychain items written by the Swift app (plain generic passwords found by
// service + account, without kSecAttrGeneric, which SecretStore cannot see). iOS only; elsewhere nothing exists.

export interface LegacySecretReader {
  /** The stored string, or null when absent, unreadable or unsupported on this platform. */
  read(service: string, account: string): Promise<string | null>;
  /** Deletes the item. A missing item is not an error. */
  remove(service: string, account: string): Promise<void>;
}

/** In-memory LegacySecretReader for tests. */
export class FakeLegacySecretReader implements LegacySecretReader {
  private readonly items = new Map<string, string>();

  private static id(service: string, account: string): string {
    return JSON.stringify([service, account]);
  }

  /** Test helper: seed an item as the Swift app would have stored it. */
  seed(service: string, account: string, value: string): void {
    this.items.set(FakeLegacySecretReader.id(service, account), value);
  }

  read(service: string, account: string): Promise<string | null> {
    return Promise.resolve(this.items.get(FakeLegacySecretReader.id(service, account)) ?? null);
  }

  remove(service: string, account: string): Promise<void> {
    this.items.delete(FakeLegacySecretReader.id(service, account));
    return Promise.resolve();
  }
}
