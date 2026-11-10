import { FakeLegacySecretReader } from './legacySecrets';

describe('FakeLegacySecretReader', () => {
  it('reads by service and account, and removes idempotently', async () => {
    const r = new FakeLegacySecretReader();
    r.seed('svc', 'client_id', 'abc');
    await expect(r.read('svc', 'client_id')).resolves.toBe('abc');
    await expect(r.read('svc', 'client_secret')).resolves.toBeNull();
    await expect(r.read('other', 'client_id')).resolves.toBeNull();
    await r.remove('svc', 'client_id');
    await r.remove('svc', 'client_id');
    await expect(r.read('svc', 'client_id')).resolves.toBeNull();
  });
});
