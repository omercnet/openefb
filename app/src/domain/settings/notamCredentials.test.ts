// Characterisation of Swift NotamCredentials (Services/NotamService.swift) as the Settings > NOTAM API section uses it.
// Swift has no test of the struct in the U7 files; the behaviours below are read from the Swift source.
import { FakeSecretStore, NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY, type SecretStore } from '../ports/secretStore';
import {
  loadNotamCredentials,
  NOTAM_REGISTRATION_URL,
  removeNotamCredentials,
  saveNotamCredentials,
} from './notamCredentials';

/** A store whose writes (or removals) of selected keys reject. */
function flaky(inner: SecretStore, failSet: string[] = [], failRemove: string[] = []): SecretStore {
  return {
    get: (key) => inner.get(key),
    set: (key, value) =>
      failSet.includes(key) ? Promise.reject(new Error(`set ${key} failed`)) : inner.set(key, value),
    remove: (key) => (failRemove.includes(key) ? Promise.reject(new Error(`remove ${key} failed`)) : inner.remove(key)),
  };
}

async function seed(store: SecretStore, id: string | null, secret: string | null): Promise<void> {
  if (id !== null) await store.set(NOTAM_CLIENT_ID_KEY, id);
  if (secret !== null) await store.set(NOTAM_CLIENT_SECRET_KEY, secret);
}

describe('NotamCredentials.load', () => {
  const cases: [string, string | null, string | null, { clientID: string; clientSecret: string } | null][] = [
    ['nothing stored', null, null, null],
    ['only the id', 'id1', null, null],
    ['only the secret', null, 'secret1', null],
    ['blank id', '   ', 'secret1', null],
    ['blank secret', 'id1', '\n\t ', null],
    ['both', 'id1', 'secret1', { clientID: 'id1', clientSecret: 'secret1' }],
    ['both, padded (values are trimmed)', '  id1 \n', ' secret1\t', { clientID: 'id1', clientSecret: 'secret1' }],
  ];
  it.each(cases)('%s', async (_name, id, secret, expected) => {
    const store = new FakeSecretStore();
    await seed(store, id, secret);
    expect(await loadNotamCredentials(store)).toEqual(expected);
  });

  it('the registration link is the FAA developer portal', () => {
    expect(NOTAM_REGISTRATION_URL).toBe('https://api.faa.gov/s/');
  });
});

describe('NotamCredentials.save', () => {
  it('round-trips through load', async () => {
    const store = new FakeSecretStore();
    await saveNotamCredentials(store, { clientID: 'id1', clientSecret: 'secret1' });
    expect(await loadNotamCredentials(store)).toEqual({ clientID: 'id1', clientSecret: 'secret1' });
  });

  it('replaces an earlier pair', async () => {
    const store = new FakeSecretStore();
    await seed(store, 'old-id', 'old-secret');
    await saveNotamCredentials(store, { clientID: 'new-id', clientSecret: 'new-secret' });
    expect(await loadNotamCredentials(store)).toEqual({ clientID: 'new-id', clientSecret: 'new-secret' });
  });

  it('a failing id write rejects and leaves the stored pair as it was', async () => {
    const inner = new FakeSecretStore();
    await seed(inner, 'old-id', 'old-secret');
    const store = flaky(inner, [NOTAM_CLIENT_ID_KEY]);
    await expect(saveNotamCredentials(store, { clientID: 'new-id', clientSecret: 'new-secret' })).rejects.toThrow(
      'set client_id failed',
    );
    expect(await loadNotamCredentials(inner)).toEqual({ clientID: 'old-id', clientSecret: 'old-secret' });
  });

  it('a failing secret write puts the old id back, so id and secret never come from different pairs (JS-only guard)', async () => {
    const inner = new FakeSecretStore();
    await seed(inner, 'old-id', 'old-secret');
    const store = flaky(inner, [NOTAM_CLIENT_SECRET_KEY]);
    await expect(saveNotamCredentials(store, { clientID: 'new-id', clientSecret: 'new-secret' })).rejects.toThrow(
      'set client_secret failed',
    );
    expect(await loadNotamCredentials(inner)).toEqual({ clientID: 'old-id', clientSecret: 'old-secret' });
  });

  it('a failing secret write on a first save leaves nothing stored', async () => {
    const inner = new FakeSecretStore();
    const store = flaky(inner, [NOTAM_CLIENT_SECRET_KEY]);
    await expect(saveNotamCredentials(store, { clientID: 'id1', clientSecret: 'secret1' })).rejects.toThrow();
    expect(await inner.get(NOTAM_CLIENT_ID_KEY)).toBeNull();
    expect(await loadNotamCredentials(inner)).toBeNull();
  });

  it('keeps the original error when putting the old id back also fails', async () => {
    const inner = new FakeSecretStore();
    await seed(inner, 'old-id', 'old-secret');
    let writes = 0;
    const store: SecretStore = {
      get: (key) => inner.get(key),
      remove: (key) => inner.remove(key),
      set: (key, value) => {
        writes += 1;
        // 1: new id succeeds, 2: new secret fails, 3: restoring the old id fails.
        return writes === 1 ? inner.set(key, value) : Promise.reject(new Error(`write ${writes} failed`));
      },
    };
    await expect(saveNotamCredentials(store, { clientID: 'new-id', clientSecret: 'new-secret' })).rejects.toThrow(
      'write 2 failed',
    );
  });
});

describe('NotamCredentials.remove', () => {
  it('removes both values', async () => {
    const store = new FakeSecretStore();
    await seed(store, 'id1', 'secret1');
    await removeNotamCredentials(store);
    expect(await store.get(NOTAM_CLIENT_ID_KEY)).toBeNull();
    expect(await store.get(NOTAM_CLIENT_SECRET_KEY)).toBeNull();
    expect(await loadNotamCredentials(store)).toBeNull();
  });

  it('removing when nothing is stored is not an error', async () => {
    await expect(removeNotamCredentials(new FakeSecretStore())).resolves.toBeUndefined();
  });

  it('a failing id removal still removes the secret and rejects (JS-only guard: no half-removed key)', async () => {
    const inner = new FakeSecretStore();
    await seed(inner, 'id1', 'secret1');
    const store = flaky(inner, [], [NOTAM_CLIENT_ID_KEY]);
    await expect(removeNotamCredentials(store)).rejects.toThrow('remove client_id failed');
    expect(await inner.get(NOTAM_CLIENT_SECRET_KEY)).toBeNull();
  });
});
