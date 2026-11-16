import { createPreferences } from './preferences';

describe('preferences', () => {
  it('reads, writes and removes through the key-value store', async () => {
    const data = new Map<string, string>();
    const prefs = createPreferences({
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => void data.set(k, v),
      removeItem: async (k) => void data.delete(k),
    });
    expect(await prefs.get('a')).toBeNull();
    await prefs.set('a', '1');
    expect(await prefs.get('a')).toBe('1');
    await prefs.remove('a');
    await prefs.remove('missing');
    expect(await prefs.get('a')).toBeNull();
  });
});
