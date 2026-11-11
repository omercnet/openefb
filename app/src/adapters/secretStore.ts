// SecretStore on expo-secure-store, using the Swift service name and accessibility. The app starts clean: Swift-written
// keychain items are not imported.
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
