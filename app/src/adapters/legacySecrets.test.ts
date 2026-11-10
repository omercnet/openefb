import { requireOptionalNativeModule } from 'expo-modules-core';

import { createLegacySecretReader } from './legacySecrets';

jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: jest.fn() }));
const mockRequire = jest.mocked(requireOptionalNativeModule);

describe('createLegacySecretReader', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null and ignores remove when the native module is absent', async () => {
    mockRequire.mockReturnValue(null);
    const r = createLegacySecretReader();
    await expect(r.read('svc', 'a')).resolves.toBeNull();
    await expect(r.remove('svc', 'a')).resolves.toBeUndefined();
  });

  it('delegates to the native module by service and account', async () => {
    const native = { read: jest.fn().mockResolvedValue('v'), remove: jest.fn().mockResolvedValue(undefined) };
    mockRequire.mockReturnValue(native);
    const r = createLegacySecretReader();
    await expect(r.read('svc', 'a')).resolves.toBe('v');
    await r.remove('svc', 'a');
    expect(native.read).toHaveBeenCalledWith('svc', 'a');
    expect(native.remove).toHaveBeenCalledWith('svc', 'a');
  });
});
