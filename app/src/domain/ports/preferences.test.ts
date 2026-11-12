import { FakePreferences, readBool, writeBool } from './preferences';

describe('FakePreferences', () => {
  it('returns null for a missing key, then what was set, then null again after remove', async () => {
    const prefs = new FakePreferences();
    expect(await prefs.get('displayMode')).toBeNull();
    await prefs.set('displayMode', 'night');
    expect(await prefs.get('displayMode')).toBe('night');
    await prefs.remove('displayMode');
    expect(await prefs.get('displayMode')).toBeNull();
  });

  it('starts from the given values and removing a missing key is not an error', async () => {
    const prefs = new FakePreferences({ a: '1' });
    expect(await prefs.get('a')).toBe('1');
    await expect(prefs.remove('missing')).resolves.toBeUndefined();
  });
});

describe('readBool and writeBool', () => {
  const cases: [string | null, boolean, boolean][] = [
    ['true', false, true],
    ['false', true, false],
    [null, true, true],
    [null, false, false],
    ['', true, true], // unknown text reads as the fallback (UserDefaults: object(forKey:) as? Bool ?? fallback)
    ['yes', false, false],
  ];
  it.each(cases)('stored %j with fallback %s reads %s', async (stored, fallback, expected) => {
    const prefs = new FakePreferences(stored === null ? {} : { flag: stored });
    expect(await readBool(prefs, 'flag', fallback)).toBe(expected);
  });

  it('writeBool round-trips through readBool', async () => {
    const prefs = new FakePreferences();
    await writeBool(prefs, 'flag', true);
    expect(await readBool(prefs, 'flag', false)).toBe(true);
    await writeBool(prefs, 'flag', false);
    expect(await readBool(prefs, 'flag', true)).toBe(false);
  });

  it('a rejecting store rejects instead of reading as the fallback (callers decide how to degrade)', async () => {
    const failing = {
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    await expect(readBool(failing, 'flag', true)).rejects.toThrow('storage unavailable');
  });
});
