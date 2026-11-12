// Behaviour of the Settings screen's view model (SettingsView.swift state and actions). Swift has no test of these; the
// cases follow the Swift source, and the guards for races and failed writes are the JS-only additions listed in U7.md.
import { newPilotProfile } from '../../data/defaults';
import { fallbackDataAttribution } from '../../domain/core/region';
import { DISPLAY_MODE_DEFAULTS_KEY } from '../../domain/displayMode';
import { FakePreferences, type Preferences } from '../../domain/ports/preferences';
import {
  FakeSecretStore,
  NOTAM_CLIENT_ID_KEY,
  NOTAM_CLIENT_SECRET_KEY,
  type SecretStore,
} from '../../domain/ports/secretStore';
import { createMemoryUserData } from '../../domain/userData/memory';
import type { UserData } from '../../domain/userData';
import { canSaveNotamKey, createSettingsStore, type SettingsDeps } from './settingsStore';

const NOW = Date.UTC(2026, 10, 11);
const DAY = 86_400_000;

function setup(over: Partial<SettingsDeps> = {}, userData: UserData = createMemoryUserData()) {
  const secrets = new FakeSecretStore();
  const prefs = new FakePreferences();
  const setTelemetryEnabled = jest.fn();
  const onRegionChange = jest.fn();
  const onDisplayModeChange = jest.fn();
  const deps: SettingsDeps = {
    userData,
    secrets,
    prefs,
    loadDataCycle: () => Promise.resolve(null),
    dataAttribution: (r) => Promise.resolve(fallbackDataAttribution(r)),
    regionDataUnavailable: () => Promise.resolve(null),
    setTelemetryEnabled,
    onRegionChange,
    onDisplayModeChange,
    now: () => NOW,
    ...over,
  };
  const store = createSettingsStore(deps);
  return { deps, userData, secrets, prefs, store, setTelemetryEnabled, onRegionChange, onDisplayModeChange };
}

/** A UserData whose settings writes can be slowed or failed. */
function withSettings(inner: UserData, over: Partial<UserData['settings']>): UserData {
  return { ...inner, settings: { ...inner.settings, ...over } };
}

describe('load', () => {
  it('a fresh install reads the defaults', async () => {
    const { store } = setup();
    expect(store.getState().loaded).toBe(false);
    await store.getState().load();
    expect(store.getState()).toMatchObject({
      loaded: true,
      region: 'israel',
      displayMode: 'auto',
      shareUsageData: true,
      dataAttribution: fallbackDataAttribution('israel'),
      regionDataError: null,
      regionSaveError: null,
      preferenceError: null,
      loadError: null,
      currencyToRenew: 0,
      dataCycle: null,
      notam: { clientID: '', clientSecret: '', configured: false, message: null },
    });
  });

  it('reads what was persisted', async () => {
    const cycle = { source: 'FAA NASR', effectiveMs: NOW - 10 * DAY, expiresMs: NOW + 18 * DAY };
    const userData = createMemoryUserData({
      settings: { regionRaw: 'us' },
      pilots: [newPilotProfile({ id: 'p1', isActive: true, createdAt: 1 })],
    });
    const { store, prefs, secrets } = setup({ loadDataCycle: () => Promise.resolve(cycle) }, userData);
    await prefs.set('displayMode', 'night');
    await prefs.set('telemetryEnabled', 'false');
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'id1');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'secret1');

    await store.getState().load();

    expect(store.getState()).toMatchObject({
      region: 'us',
      displayMode: 'night',
      shareUsageData: false,
      dataAttribution: fallbackDataAttribution('us'),
      currencyToRenew: 3, // nothing recorded for the active pilot
      dataCycle: cycle,
      notam: { clientID: 'id1', clientSecret: 'secret1', configured: true },
    });
  });

  it('an unknown region or display mode reads as the default and is not rewritten', async () => {
    const userData = createMemoryUserData({ settings: { regionRaw: 'mars' } });
    const { store, prefs } = setup({}, userData);
    await prefs.set('displayMode', 'sepia');
    await store.getState().load();
    expect(store.getState()).toMatchObject({ region: 'israel', displayMode: 'auto', loadError: null });
    expect((await userData.settings.get())?.regionRaw).toBe('mars');
    expect(await prefs.get('displayMode')).toBe('sepia');
  });

  it('a settings row that cannot be read leaves the default region and says so', async () => {
    const userData = withSettings(createMemoryUserData(), { get: () => Promise.reject(new Error('db locked')) });
    const { store } = setup({}, userData);
    await store.getState().load();
    expect(store.getState().region).toBe('israel');
    expect(store.getState().loadError).toContain('db locked');
    expect(store.getState().loaded).toBe(true);
  });

  it('an unreadable telemetry flag reads as off, never on, and says so', async () => {
    const prefs: Preferences = {
      get: (key) => (key === 'telemetryEnabled' ? Promise.reject(new Error('prefs down')) : Promise.resolve(null)),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    const { store } = setup({ prefs });
    await store.getState().load();
    expect(store.getState().shareUsageData).toBe(false);
    expect(store.getState().displayMode).toBe('auto'); // the other reads are not lost
    expect(store.getState().loadError).toContain('prefs down');
  });

  it('an unreadable pilot list counts nothing to renew and says so', async () => {
    const base = createMemoryUserData();
    const userData: UserData = {
      ...base,
      pilots: { ...base.pilots, list: () => Promise.reject(new Error('no pilots')) },
    };
    const { store } = setup({}, userData);
    await store.getState().load();
    expect(store.getState().currencyToRenew).toBe(0);
    expect(store.getState().loadError).toContain('no pilots');
  });

  it('a data cycle that cannot be read is unknown, as Swift try? has it, with no report', async () => {
    const { store } = setup({ loadDataCycle: () => Promise.reject(new Error('no db')) });
    await store.getState().load();
    expect(store.getState().dataCycle).toBeNull();
    expect(store.getState().loadError).toBeNull();
  });

  it('counts only the first active pilot (@Query isActive == true, first)', async () => {
    const lapsed = newPilotProfile({ id: 'a', isActive: false, createdAt: 1 });
    const current = newPilotProfile({
      id: 'b',
      isActive: true,
      createdAt: 2,
      medicalExpiry: NOW + 200 * DAY,
      flightReviewDate: NOW - 30 * DAY,
      nightLandingEntries: [{ date: NOW - 5 * DAY, count: 3 }],
    });
    const { store } = setup({}, createMemoryUserData({ pilots: [lapsed, current] }));
    await store.getState().load();
    expect(store.getState().currencyToRenew).toBe(0);
  });

  it('loading again picks up changes made elsewhere (coming back from the profiles screen)', async () => {
    const userData = createMemoryUserData({ pilots: [newPilotProfile({ id: 'p', isActive: true, createdAt: 1 })] });
    const { store } = setup({}, userData);
    await store.getState().load();
    expect(store.getState().currencyToRenew).toBe(3);
    await userData.pilots.update('p', {
      medicalExpiry: NOW + 200 * DAY,
      flightReviewDate: NOW - 30 * DAY,
      nightLandingEntries: [{ date: NOW - 5 * DAY, count: 3 }],
    });
    await store.getState().load();
    expect(store.getState().currencyToRenew).toBe(0);
  });

  it('loads run one at a time: the later one decides even when the earlier is slow', async () => {
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const { store } = setup({
      loadDataCycle: async () => {
        calls += 1;
        if (calls === 1) {
          await gate.promise;
          return { source: 'old', effectiveMs: 1, expiresMs: 2 };
        }
        return { source: 'new', effectiveMs: 3, expiresMs: 4 };
      },
    });
    const first = store.getState().load();
    const second = store.getState().load();
    gate.resolve();
    await Promise.all([first, second]);
    expect(store.getState().dataCycle?.source).toBe('new');
  });
});

describe('setRegion (SettingsView.regionBinding)', () => {
  it('changes the region at once, saves it, tells the app and refreshes the attribution', async () => {
    const { store, userData, onRegionChange } = setup();
    await store.getState().load();
    const pending = store.getState().setRegion('us');
    expect(store.getState().region).toBe('us'); // before the save finishes
    await pending;
    expect((await userData.settings.get())?.regionRaw).toBe('us');
    expect(onRegionChange).toHaveBeenCalledWith('us');
    expect(store.getState()).toMatchObject({
      dataAttribution: fallbackDataAttribution('us'),
      regionSaveError: null,
    });
  });

  it('choosing the current region does nothing (guard newRegion != appState.region)', async () => {
    const { store, userData, onRegionChange } = setup();
    await store.getState().load();
    await store.getState().setRegion('israel');
    expect(onRegionChange).not.toHaveBeenCalled();
    expect(await userData.settings.get()).toBeNull(); // not even the row was created
  });

  it('a failed save keeps the new region and shows the Swift message; a later good save clears it', async () => {
    let fail = true;
    const base = createMemoryUserData();
    const userData = withSettings(base, {
      update: (patch) => (fail ? Promise.reject(new Error('disk full')) : base.settings.update(patch)),
    });
    const { store } = setup({}, userData);
    await store.getState().load();
    await store.getState().setRegion('us');
    expect(store.getState().region).toBe('us');
    expect(store.getState().regionSaveError).toBe('Region changed, but it could not be saved: disk full');

    fail = false;
    await store.getState().setRegion('israel');
    expect(store.getState().regionSaveError).toBeNull();
    expect((await base.settings.get())?.regionRaw).toBe('israel');
  });

  it('shows why the region data is unavailable, following the region', async () => {
    const { store } = setup({
      regionDataUnavailable: (r) => Promise.resolve(r === 'israel' ? 'Israel database missing' : null),
    });
    await store.getState().load();
    expect(store.getState().regionDataError).toBe('Israel database missing');
    await store.getState().setRegion('us');
    expect(store.getState().regionDataError).toBeNull();
  });

  it('attribution that cannot be read falls back to the default text (JS-only guard)', async () => {
    const { store } = setup({ dataAttribution: () => Promise.reject(new Error('metadata unreadable')) });
    await store.getState().load();
    expect(store.getState().dataAttribution).toBe(fallbackDataAttribution('israel'));
  });

  it('quick successive changes save in order, so the last choice is the one stored', async () => {
    const gate = Promise.withResolvers<void>();
    const base = createMemoryUserData();
    let writes = 0;
    const userData = withSettings(base, {
      update: async (patch) => {
        writes += 1;
        if (writes === 1) await gate.promise; // the first save is slow
        return base.settings.update(patch);
      },
    });
    const { store } = setup({}, userData);
    await store.getState().load();
    const first = store.getState().setRegion('us');
    const second = store.getState().setRegion('israel');
    gate.resolve();
    await Promise.all([first, second]);
    expect((await base.settings.get())?.regionRaw).toBe('israel');
    expect(store.getState().region).toBe('israel');
    expect(store.getState().dataAttribution).toBe(fallbackDataAttribution('israel'));
  });
});

describe('setDisplayMode (AppState.displayMode didSet)', () => {
  it('applies at once, saves under the Swift key and tells the app', async () => {
    const { store, prefs, onDisplayModeChange } = setup();
    await store.getState().load();
    const pending = store.getState().setDisplayMode('night');
    expect(store.getState().displayMode).toBe('night');
    expect(onDisplayModeChange).toHaveBeenCalledWith('night');
    await pending;
    expect(await prefs.get('displayMode')).toBe('night');
    expect(store.getState().preferenceError).toBeNull();
  });

  it('a failed save keeps the mode for this session and says it was not saved', async () => {
    const prefs: Preferences = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('prefs down')),
      remove: () => Promise.resolve(),
    };
    const { store, onDisplayModeChange } = setup({ prefs });
    await store.getState().load();
    await store.getState().setDisplayMode('day');
    expect(store.getState().displayMode).toBe('day');
    expect(onDisplayModeChange).toHaveBeenCalledWith('day');
    expect(store.getState().preferenceError).toBe('Changed, but it could not be saved: prefs down');
  });
});

describe('setShareUsageData (Privacy toggle)', () => {
  it('saves the flag and tells telemetry with the current region', async () => {
    const { store, prefs, setTelemetryEnabled } = setup();
    await store.getState().load();
    await store.getState().setRegion('us');
    await store.getState().setShareUsageData(false);
    expect(store.getState().shareUsageData).toBe(false);
    expect(await prefs.get('telemetryEnabled')).toBe('false');
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false, 'us');
  });

  it('a failed save still switches telemetry, because opting out must not wait on storage, and says so', async () => {
    const prefs: Preferences = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('prefs down')),
      remove: () => Promise.resolve(),
    };
    const { store, setTelemetryEnabled } = setup({ prefs });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false, 'israel');
    expect(store.getState().shareUsageData).toBe(false);
    expect(store.getState().preferenceError).toBe('Changed, but it could not be saved: prefs down');
  });

  it('a later good save clears the preference error', async () => {
    let fail = true;
    const inner = new FakePreferences();
    const prefs: Preferences = {
      get: (k) => inner.get(k),
      remove: (k) => inner.remove(k),
      set: (k, v) => (fail ? Promise.reject(new Error('prefs down')) : inner.set(k, v)),
    };
    const { store } = setup({ prefs });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    fail = false;
    await store.getState().setShareUsageData(true);
    expect(store.getState().preferenceError).toBeNull();
  });
});

describe('NOTAM API key', () => {
  it.each([
    ['', '', false],
    ['id', '', false],
    ['', 'secret', false],
    ['  ', 'secret', false],
    ['id', ' \n', false],
    ['id', 'secret', true],
    [' id ', ' secret ', true],
  ])('can save %j + %j -> %s (Button("Save Key").disabled)', (clientID, clientSecret, can) => {
    expect(canSaveNotamKey({ clientID, clientSecret })).toBe(can);
  });

  it('saving with a blank value does nothing', async () => {
    const { store, secrets } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('id');
    await store.getState().saveNotamKey();
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBeNull();
    expect(store.getState().notam.message).toBeNull();
  });

  it('saves trimmed values, confirms by reading them back and says so', async () => {
    const { store, secrets } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('  id1 ');
    store.getState().setNotamClientSecret('secret1\n');
    await store.getState().saveNotamKey();
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBe('id1');
    expect(await secrets.get(NOTAM_CLIENT_SECRET_KEY)).toBe('secret1');
    expect(store.getState().notam).toEqual({
      clientID: 'id1',
      clientSecret: 'secret1',
      configured: true,
      partiallyStored: false,
      message: 'Saved. NOTAMs appear in the airport sheet.',
    });
  });

  it('a failed save shows the error and keeps the stored pair as it was', async () => {
    const inner = new FakeSecretStore();
    await inner.set(NOTAM_CLIENT_ID_KEY, 'old-id');
    await inner.set(NOTAM_CLIENT_SECRET_KEY, 'old-secret');
    const secrets: SecretStore = {
      get: (k) => inner.get(k),
      remove: (k) => inner.remove(k),
      set: (k, v) => (k === NOTAM_CLIENT_SECRET_KEY ? Promise.reject(new Error('keychain locked')) : inner.set(k, v)),
    };
    const { store } = setup({ secrets });
    await store.getState().load();
    store.getState().setNotamClientID('new-id');
    store.getState().setNotamClientSecret('new-secret');
    await store.getState().saveNotamKey();
    expect(store.getState().notam.message).toBe('keychain locked');
    expect(store.getState().notam.configured).toBe(true);
    expect(await inner.get(NOTAM_CLIENT_ID_KEY)).toBe('old-id');
  });

  it('removing clears the fields and says so', async () => {
    const { store, secrets } = setup();
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'id1');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'secret1');
    await store.getState().load();
    await store.getState().removeNotamKey();
    expect(store.getState().notam).toEqual({
      clientID: '',
      clientSecret: '',
      configured: false,
      partiallyStored: false,
      message: 'Key removed.',
    });
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBeNull();
  });

  it('a failed removal shows the error and re-reads the store so the status stays truthful', async () => {
    const inner = new FakeSecretStore();
    await inner.set(NOTAM_CLIENT_ID_KEY, 'id1');
    await inner.set(NOTAM_CLIENT_SECRET_KEY, 'secret1');
    const secrets: SecretStore = {
      get: (k) => inner.get(k),
      set: (k, v) => inner.set(k, v),
      remove: (k) => (k === NOTAM_CLIENT_ID_KEY ? Promise.reject(new Error('keychain locked')) : inner.remove(k)),
    };
    const { store } = setup({ secrets });
    await store.getState().load();
    expect(store.getState().notam.configured).toBe(true);
    await store.getState().removeNotamKey();
    expect(store.getState().notam.message).toBe('keychain locked');
    // The secret did go, so the pair is no longer usable and the screen must not keep saying "Configured".
    expect(store.getState().notam.configured).toBe(false);
  });

  it('a save followed at once by a removal runs in tap order and ends not configured', async () => {
    const { store } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('id1');
    store.getState().setNotamClientSecret('secret1');
    const save = store.getState().saveNotamKey();
    const remove = store.getState().removeNotamKey();
    await Promise.all([save, remove]);
    expect(store.getState().notam).toMatchObject({ configured: false, message: 'Key removed.', clientID: '' });
  });

  it('typing edits the fields without touching the store', async () => {
    const { store, secrets } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('typed');
    expect(store.getState().notam.clientID).toBe('typed');
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBeNull();
  });
});

describe('app notifications that throw', () => {
  it('a throwing onRegionChange does not stop the region being saved, and is reported', async () => {
    const { store, userData } = setup({
      onRegionChange: () => {
        throw new Error('map reload failed');
      },
    });
    await store.getState().load();
    await store.getState().setRegion('us');
    expect((await userData.settings.get())?.regionRaw).toBe('us');
    expect(store.getState().region).toBe('us');
    expect(store.getState().regionSaveError).toBe('Region changed, but the app could not apply it: map reload failed');
  });

  it('a failed save is reported in preference to a failed notification', async () => {
    const base = createMemoryUserData();
    const userData = withSettings(base, { update: () => Promise.reject(new Error('disk full')) });
    const { store } = setup(
      {
        onRegionChange: () => {
          throw new Error('map reload failed');
        },
      },
      userData,
    );
    await store.getState().load();
    await store.getState().setRegion('us');
    expect(store.getState().regionSaveError).toBe('Region changed, but it could not be saved: disk full');
  });

  it('a throwing onDisplayModeChange does not stop the mode being saved, and is reported', async () => {
    const { store, prefs } = setup({
      onDisplayModeChange: () => {
        throw new Error('theme failed');
      },
    });
    await store.getState().load();
    await store.getState().setDisplayMode('night');
    expect(await prefs.get('displayMode')).toBe('night');
    expect(store.getState().preferenceError).toBe('Changed, but the app could not apply it: theme failed');
  });

  it('a throwing setTelemetryEnabled does not stop the flag being saved, and is reported', async () => {
    const { store, prefs } = setup({
      setTelemetryEnabled: () => {
        throw new Error('telemetry failed');
      },
    });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    expect(await prefs.get('telemetryEnabled')).toBe('false');
    expect(store.getState().preferenceError).toBe('Changed, but the app could not apply it: telemetry failed');
  });

  it('a rejecting regionDataUnavailable check is shown as the region data error', async () => {
    const { store } = setup({ regionDataUnavailable: () => Promise.reject(new Error('corrupt database')) });
    await store.getState().load();
    expect(store.getState().regionDataError).toBe('corrupt database');
  });
});

describe('review fixes on #45', () => {
  it('a region whose save failed can be saved again, without telling the app twice', async () => {
    const inner = createMemoryUserData();
    let broken = true;
    const userData = withSettings(inner, {
      update: (patch) => (broken ? Promise.reject(new Error('disk full')) : inner.settings.update(patch)),
    });
    const { store, onRegionChange } = setup({}, userData);
    await store.getState().load();
    await store.getState().setRegion('us');
    expect(store.getState().regionSaveError).toContain('could not be saved');
    broken = false;
    await store.getState().setRegion('us');
    expect(store.getState().regionSaveError).toBeNull();
    expect((await inner.settings.get())?.regionRaw).toBe('us');
    expect(onRegionChange).toHaveBeenCalledTimes(1);
  });

  it('a load that reads before a queued region write does not put the old region back', async () => {
    const { store, userData } = setup();
    await store.getState().load();
    const loading = store.getState().load();
    const changing = store.getState().setRegion('us');
    await Promise.all([loading, changing]);
    expect(store.getState().region).toBe('us');
    expect((await userData.settings.get())?.regionRaw).toBe('us');
  });

  it('a failed display mode save keeps its warning when a later privacy write succeeds', async () => {
    const prefs = new FakePreferences();
    const real = prefs.set.bind(prefs);
    prefs.set = (key, value) =>
      key.toLowerCase().includes('display') ? Promise.reject(new Error('full')) : real(key, value);
    const { store } = setup({ prefs });
    await store.getState().load();
    await store.getState().setDisplayMode('night');
    await store.getState().setShareUsageData(false);
    expect(store.getState().preferenceError).toContain('could not be saved');
    expect(store.getState().preferenceErrorFor).toBe('displayMode');
  });

  it('credentials typed while the first load is reading are kept', async () => {
    const { store, secrets } = setup();
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'saved-id');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'saved-secret');
    const loading = store.getState().load();
    store.getState().setNotamClientID('typing');
    await loading;
    expect(store.getState().notam.clientID).toBe('typing');
    expect(store.getState().notam.configured).toBe(true);
  });

  it('a saved key that cannot be read back is not reported as plain "Saved" nor as absent', async () => {
    const inner = new FakeSecretStore();
    const secrets: SecretStore = {
      set: (k, v) => inner.set(k, v),
      get: () => Promise.resolve(null),
      remove: (k) => inner.remove(k),
    };
    const { store } = setup({ secrets });
    await store.getState().load();
    store.getState().setNotamClientID('id');
    store.getState().setNotamClientSecret('secret');
    await store.getState().saveNotamKey();
    expect(store.getState().notam.configured).toBe(true);
    expect(store.getState().notam.message).toContain('could not be read back');
  });

  it('a display mode or privacy change made while load is reading is kept on screen', async () => {
    const { store, prefs } = setup();
    await store.getState().load();
    const loading = store.getState().load();
    const a = store.getState().setDisplayMode('night');
    const b = store.getState().setShareUsageData(false);
    await Promise.all([loading, a, b]);
    expect(store.getState()).toMatchObject({ displayMode: 'night', shareUsageData: false });
    expect(await prefs.get(DISPLAY_MODE_DEFAULTS_KEY)).toBe('night');
  });

  it('Retry repeats the notification when that is what failed, and does not write again', async () => {
    const onRegionChange = jest.fn().mockImplementationOnce(() => {
      throw new Error('map not ready');
    });
    const { store, userData } = setup({ onRegionChange });
    await store.getState().load();
    await store.getState().setRegion('us');
    expect(store.getState().regionSaveError).toContain('could not apply');
    const update = jest.spyOn(userData.settings, 'update');
    await store.getState().setRegion('us');
    expect(onRegionChange).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(store.getState().regionSaveError).toBeNull();
  });

  it('NOTAM text edited while a save is pending is not overwritten by the saved values', async () => {
    const { store, secrets } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('id');
    store.getState().setNotamClientSecret('secret');
    const saving = store.getState().saveNotamKey();
    store.getState().setNotamClientID('id-edited');
    await saving;
    expect(store.getState().notam).toMatchObject({ clientID: 'id-edited', clientSecret: 'secret', configured: true });
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBe('id');
  });

  it("a retry queued behind a different region change does not use the earlier region's failure state", async () => {
    const inner = createMemoryUserData();
    let failSave = false;
    const gate = Promise.withResolvers<void>();
    const userData = withSettings(inner, {
      update: async (patch) => {
        if (patch.regionRaw === 'israel') {
          await gate.promise;
          if (failSave) throw new Error('disk full');
        }
        return inner.settings.update(patch);
      },
    });
    const onRegionChange = jest.fn().mockImplementationOnce(() => {
      throw new Error('map not ready');
    });
    const { store } = setup({ onRegionChange }, userData);
    await store.getState().load();
    gate.resolve();
    await store.getState().setRegion('us'); // saved, notification failed
    const gate2 = Promise.withResolvers<void>();
    failSave = true;
    userData.settings.update = async (patch) => {
      await gate2.promise;
      throw new Error('disk full');
    };
    const change = store.getState().setRegion('israel'); // its save waits
    const retry = store.getState().setRegion('israel'); // retried during that wait
    gate2.resolve();
    await Promise.all([change, retry]);
    expect(store.getState().regionSaveError).toContain('could not be saved');
    expect((await inner.settings.get())?.regionRaw).toBe('us');
  });

  it('a reload after a failed region save keeps the chosen region, so Retry still has something to retry', async () => {
    const inner = createMemoryUserData();
    let broken = true;
    const userData = withSettings(inner, {
      update: (patch) => (broken ? Promise.reject(new Error('disk full')) : inner.settings.update(patch)),
    });
    const { store } = setup({}, userData);
    await store.getState().load();
    await store.getState().setRegion('us');
    await store.getState().load();
    expect(store.getState().region).toBe('us');
    broken = false;
    await store.getState().setRegion('us');
    expect((await inner.settings.get())?.regionRaw).toBe('us');
    expect(store.getState().regionSaveError).toBeNull();
  });

  it('a late failure of an older region save does not overwrite the current region state', async () => {
    const inner = createMemoryUserData();
    const gate = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    const userData = withSettings(inner, {
      update: async (patch) => {
        if (patch.regionRaw === 'us') {
          await gate.promise;
          throw new Error('disk full');
        }
        await hold.promise; // the newer save is still running when the older one fails
        return inner.settings.update(patch);
      },
    });
    const { store } = setup({}, userData);
    await store.getState().load();
    const first = store.getState().setRegion('us');
    const second = store.getState().setRegion('israel');
    gate.resolve();
    await first;
    expect(store.getState().region).toBe('israel');
    expect(store.getState().regionSaveError).toBeNull();
    hold.resolve();
    await second;
    expect(store.getState().regionSaveError).toBeNull();
  });

  it('NOTAM fields the user cleared while load is reading stay cleared', async () => {
    const { store, secrets } = setup();
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'saved-id');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'saved-secret');
    await store.getState().load();
    const loading = store.getState().load();
    store.getState().setNotamClientID('');
    store.getState().setNotamClientSecret('');
    await loading;
    expect(store.getState().notam).toMatchObject({ clientID: '', clientSecret: '' });
  });

  it('NOTAM edits made while the attribution lookups are pending are kept', async () => {
    const { secrets } = setup();
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'saved-id');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'saved-secret');
    const gate = Promise.withResolvers<string>();
    const slow = createSettingsStore({
      ...setup().deps,
      secrets,
      dataAttribution: () => gate.promise,
    });
    const loading = slow.getState().load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    slow.getState().setNotamClientID('');
    slow.getState().setNotamClientSecret('typed');
    gate.resolve('attribution');
    await loading;
    expect(slow.getState().notam).toMatchObject({ clientID: '', clientSecret: 'typed' });
  });

  it('a failed opt-out can be retried without switching telemetry back on, and without telling the app again', async () => {
    const prefs = new FakePreferences();
    const real = prefs.set.bind(prefs);
    let broken = true;
    prefs.set = (key, value) => (broken ? Promise.reject(new Error('full')) : real(key, value));
    const { store, setTelemetryEnabled } = setup({ prefs });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    expect(store.getState().preferenceErrorFor).toBe('shareUsageData');
    broken = false;
    await store.getState().retryPreferenceSave();
    expect(store.getState().preferenceError).toBeNull();
    expect(store.getState().shareUsageData).toBe(false);
    expect(setTelemetryEnabled).toHaveBeenCalledTimes(1);
    const reload = setup({ prefs }).store;
    await reload.getState().load();
    expect(reload.getState().shareUsageData).toBe(false);
  });

  it('retrying with no failed preference does nothing', async () => {
    const { store, prefs } = setup();
    await store.getState().load();
    const set = jest.spyOn(prefs, 'set');
    await store.getState().retryPreferenceSave();
    expect(set).not.toHaveBeenCalled();
  });

  it('credentials typed while Remove Key is waiting are kept, and not wiped by its completion', async () => {
    const { store, secrets } = setup();
    await secrets.set(NOTAM_CLIENT_ID_KEY, 'id');
    await secrets.set(NOTAM_CLIENT_SECRET_KEY, 'secret');
    await store.getState().load();
    const removing = store.getState().removeNotamKey();
    store.getState().setNotamClientID('new-id');
    store.getState().setNotamClientSecret('new-secret');
    await removing;
    expect(store.getState().notam).toMatchObject({ clientID: 'new-id', clientSecret: 'new-secret', configured: false });
    await store.getState().saveNotamKey();
    expect(await secrets.get(NOTAM_CLIENT_ID_KEY)).toBe('new-id');
    expect(store.getState().notam.clientID).toBe('new-id');
  });

  it('after a removal that failed half way, Remove Key stays available and can finish the job', async () => {
    const inner = new FakeSecretStore();
    let failSecret = true;
    const secrets: SecretStore = {
      get: (k) => inner.get(k),
      set: (k, v) => inner.set(k, v),
      remove: (k) =>
        k === NOTAM_CLIENT_SECRET_KEY && failSecret ? Promise.reject(new Error('keychain locked')) : inner.remove(k),
    };
    const { store } = setup({ secrets });
    await inner.set(NOTAM_CLIENT_ID_KEY, 'id');
    await inner.set(NOTAM_CLIENT_SECRET_KEY, 'secret');
    await store.getState().load();
    await store.getState().removeNotamKey();
    expect(store.getState().notam).toMatchObject({ configured: false, partiallyStored: true });
    failSecret = false;
    await store.getState().removeNotamKey();
    expect(store.getState().notam).toMatchObject({
      configured: false,
      partiallyStored: false,
      message: 'Key removed.',
    });
    expect(await inner.get(NOTAM_CLIENT_SECRET_KEY)).toBeNull();
  });

  it('a failed opt-out stays selected across a later load, and Retry saves the opt-out, not the stored value', async () => {
    const prefs = new FakePreferences();
    const real = prefs.set.bind(prefs);
    let broken = true;
    prefs.set = (key, value) => (broken ? Promise.reject(new Error('full')) : real(key, value));
    const { store } = setup({ prefs });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    await store.getState().load();
    expect(store.getState().shareUsageData).toBe(false);
    broken = false;
    await store.getState().retryPreferenceSave();
    const reload = setup({ prefs }).store;
    await reload.getState().load();
    expect(reload.getState().shareUsageData).toBe(false);
  });

  it('Retry repeats a telemetry callback that threw, and keeps the warning until it works', async () => {
    let failing = true;
    const setTelemetryEnabled = jest.fn(() => {
      if (failing) throw new Error('crash reporter busy');
    });
    const { store } = setup({ setTelemetryEnabled });
    await store.getState().load();
    await store.getState().setShareUsageData(false);
    expect(store.getState().preferenceError).toContain('could not apply');
    await store.getState().retryPreferenceSave();
    expect(setTelemetryEnabled).toHaveBeenCalledTimes(2);
    expect(store.getState().preferenceError).toContain('could not apply'); // still failing
    failing = false;
    await store.getState().retryPreferenceSave();
    expect(setTelemetryEnabled).toHaveBeenCalledTimes(3);
    expect(setTelemetryEnabled).toHaveBeenLastCalledWith(false, expect.anything());
    expect(store.getState().preferenceError).toBeNull();
  });

  it('Retry repeats a display mode callback that threw', async () => {
    let failing = true;
    const onDisplayModeChange = jest.fn(() => {
      if (failing) throw new Error('map not ready');
    });
    const { store } = setup({ onDisplayModeChange });
    await store.getState().load();
    await store.getState().setDisplayMode('night');
    failing = false;
    await store.getState().retryPreferenceSave();
    expect(onDisplayModeChange).toHaveBeenCalledTimes(2);
    expect(store.getState().preferenceError).toBeNull();
  });

  it('editing a NOTAM field clears the old result, and does not change whether a key is configured', async () => {
    const { store } = setup();
    await store.getState().load();
    store.getState().setNotamClientID('id');
    store.getState().setNotamClientSecret('secret');
    await store.getState().saveNotamKey();
    expect(store.getState().notam.message).toContain('Saved');
    store.getState().setNotamClientSecret('secret2');
    expect(store.getState().notam).toMatchObject({ message: null, configured: true });
    await store.getState().saveNotamKey();
    store.getState().setNotamClientID('other');
    expect(store.getState().notam.message).toBeNull();
  });
});
