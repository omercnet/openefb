import { FakeSecretStore } from './secretStore';

describe('FakeSecretStore', () => {
  it('round-trips, replaces and removes; missing remove is not an error', async () => {
    const s = new FakeSecretStore();
    await expect(s.get('k')).resolves.toBeNull();
    await s.set('k', 'a');
    await s.set('k', 'b');
    await expect(s.get('k')).resolves.toBe('b');
    await s.remove('k');
    await s.remove('k');
    await expect(s.get('k')).resolves.toBeNull();
  });
});
