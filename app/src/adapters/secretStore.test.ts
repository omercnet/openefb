import * as SecureStore from 'expo-secure-store';

import { createSecretStore } from './secretStore';
import { NOTAM_SECRET_SERVICE } from '../domain/ports/secretStore';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = jest.mocked(SecureStore);
const options = {
  keychainService: NOTAM_SECRET_SERVICE,
  keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
};

describe('createSecretStore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the Swift keychain service and accessibility', async () => {
    mocked.getItemAsync.mockResolvedValue('abc');
    await expect(createSecretStore().get('client_id')).resolves.toBe('abc');
    expect(mocked.getItemAsync).toHaveBeenCalledWith('client_id', options);
  });

  it('returns null when the read throws', async () => {
    mocked.getItemAsync.mockRejectedValue(new Error('locked'));
    await expect(createSecretStore().get('client_id')).resolves.toBeNull();
  });

  it('sets and removes with the same options', async () => {
    const store = createSecretStore();
    await store.set('client_secret', 'v');
    await store.remove('client_secret');
    expect(mocked.setItemAsync).toHaveBeenCalledWith('client_secret', 'v', options);
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith('client_secret', options);
  });
});
