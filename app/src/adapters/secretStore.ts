// SecretStore on expo-secure-store. Items written by the Swift app are NOT visible through this adapter (expo requires
// kSecAttrGeneric); the D3 importer migrates them with a native Keychain query. See docs/port-notes/A4.md.
import * as SecureStore from 'expo-secure-store';

import { NOTAM_SECRET_SERVICE, type SecretStore } from '../domain/ports/secretStore';

export function createSecretStore(service: string = NOTAM_SECRET_SERVICE): SecretStore {
  const options: SecureStore.SecureStoreOptions = {
    keychainService: service,
    // Matches the Swift kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly so background fetches work.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
  return {
    async get(key) {
      try {
        return await SecureStore.getItemAsync(key, options);
      } catch {
        return null; // Swift: absent or unreadable yields nil
      }
    },
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(key, options),
  };
}
