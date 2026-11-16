import { FakePreferences } from '../../domain/ports/preferences';
import { MemoryTextStorage } from '../../services/testSupport';
import { createSettingsServices, settingsPreferences } from './settingsServices';
import type { AppRuntime } from './runtime';

jest.mock('../../adapters/secretStore', () => ({ createSecretStore: () => ({}) }));

describe('settings preferences', () => {
  it('the display mode is the map’s value (text storage), everything else the key-value store', async () => {
    const kv = new FakePreferences();
    const files = new MemoryTextStorage();
    const prefs = settingsPreferences(kv, files);
    await prefs.set('displayMode', 'night');
    await prefs.set('telemetryEnabled', 'false');
    expect(await files.read('Preferences/displayMode')).toBe('night');
    expect(await kv.get('displayMode')).toBeNull();
    expect(await kv.get('telemetryEnabled')).toBe('false');
    expect(await prefs.get('displayMode')).toBe('night');
    await prefs.remove('displayMode');
    expect(await files.read('Preferences/displayMode')).toBeNull();
  });
});

const runtime = (over: { aviation?: unknown; israel?: unknown; remote?: unknown } = {}) => {
  const setEnabled = jest.fn(async () => undefined);
  const rt = {
    started: {
      userDb: {},
      aviation: over.aviation === undefined ? { dataCycle: async () => ({ source: 'FAA NASR' }) } : over.aviation,
      israel:
        over.israel === undefined ? { metadata: async () => ({ attribution: 'CAAI data of 1 Jan' }) } : over.israel,
      remoteConfig: over.remote ?? null,
    },
    preferences: new FakePreferences(),
    telemetry: { setEnabled },
    chartPacks: {
      israelChart: { subscribe: () => () => undefined, getVersion: () => 0, status: { kind: 'notDownloaded' } },
      israelDiagrams: { subscribe: () => () => undefined, getVersion: () => 0 },
    },
  } as unknown as AppRuntime;
  return { rt, setEnabled };
};
const services = (rt: AppRuntime, extra: Partial<Parameters<typeof createSettingsServices>[0]> = {}) =>
  createSettingsServices({
    runtime: rt,
    files: new MemoryTextStorage(),
    onRegionChange: jest.fn(),
    onDisplayModeChange: jest.fn(),
    now: () => 1_000,
    ...extra,
  });

describe('settings services', () => {
  it('the data cycle and the Israel attribution come from the databases, the US line is the fallback', async () => {
    const s = services(runtime().rt);
    expect(await s.loadDataCycle()).toMatchObject({ source: 'FAA NASR' });
    expect(await s.dataAttribution('israel')).toBe('CAAI data of 1 Jan');
    expect(await s.dataAttribution('us')).toEqual(expect.any(String));
  });

  it('without the databases: no cycle, the fallback attribution, and the region says its data is unavailable', async () => {
    const s = services(runtime({ aviation: null, israel: null }).rt);
    expect(await s.loadDataCycle()).toBeNull();
    expect(await s.dataAttribution('israel')).toEqual(expect.any(String));
    expect(await s.regionDataUnavailable('us')).toEqual(expect.any(String));
    expect(await s.regionDataUnavailable('israel')).toEqual(expect.any(String));
    expect(await services(runtime().rt).regionDataUnavailable('us')).toBeNull();
  });

  it('the telemetry toggle reaches the telemetry service', () => {
    const { rt, setEnabled } = runtime();
    services(rt).setTelemetryEnabled(false, 'us');
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it('the about block reads the remote config live and has built-in text without one', () => {
    const noRemote = services(runtime().rt).remoteConfig;
    expect(noRemote.sourceDescription).toBe('Built-in');
    expect(noRemote.updateRequest).toBeNull();
    expect(noRemote.ignored).toEqual([]);
    const store = {
      sourceDescription: 'Serial 3, checked just now',
      updateRequest: { kind: 'recommended', message: 'Update soon' },
      active: { ignored: ['x'] },
      lastError: 'offline',
    };
    const live = services(runtime({ remote: store }).rt).remoteConfig;
    expect(live.updateRequest).toEqual({ kind: 'recommended', text: 'Update soon' });
    expect(live.ignored).toEqual(['x']);
    expect(live.lastError).toBe('offline');
    store.sourceDescription = 'Serial 4, checked 1 min ago';
    expect(live.sourceDescription).toBe('Serial 4, checked 1 min ago');
  });

  it('the sectional cycle and sizes are the app’s own', () => {
    const s = services(runtime().rt);
    expect(s.sectionalCycleExpires(Date.UTC(2026, 10, 1))).toBeGreaterThan(Date.UTC(2026, 10, 1));
    expect(s.formatBytes(1_500_000)).toEqual(expect.any(String));
  });
});
