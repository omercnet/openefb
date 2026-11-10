// SecretStore on expo-secure-store. On iOS the keychainService and key map to kSecAttrService and kSecAttrAccount of a
// generic-password item, so entries written by the Swift app are read in place when the service name matches.
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
