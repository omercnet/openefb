// LegacySecretReader backed by the local iOS-only Expo module in modules/legacy-keychain. Where the native module is
// absent (Android, web, Jest) reads return null and removes are no-ops. The real read is verified on device in I3.
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { LegacySecretReader } from '../domain/ports/legacySecrets';

interface LegacyKeychainNative {
  read(service: string, account: string): Promise<string | null>;
  remove(service: string, account: string): Promise<void>;
}

export function createLegacySecretReader(): LegacySecretReader {
  const native = requireOptionalNativeModule<LegacyKeychainNative>('LegacyKeychain');
  return {
    read: async (service, account) => (native ? ((await native.read(service, account)) ?? null) : null),
    remove: async (service, account) => {
      if (native) await native.remove(service, account);
    },
  };
}
