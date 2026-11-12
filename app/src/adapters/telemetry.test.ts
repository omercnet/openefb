import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import { serializeRows } from '../domain/telemetry/counterBuffer';
import type { CounterRow } from '../domain/telemetry/schema';
import { createTelemetry, startTelemetry } from './telemetry';
import { TELEMETRY_BACKLOG_KEY, TELEMETRY_ENABLED_KEY, type KeyValueStore } from './telemetryStorage';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.0' } } }));
jest.mock('expo-updates', () => ({ __esModule: true, isEmbeddedLaunch: true, updateId: null }));

const WORKER = 'https://openefb-telemetry.omerc.workers.dev';
const UUID = '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

/** Runs everything that is queued behind a promise. Nothing here uses a timer, so this is deterministic, not a wait. */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: KeyValueStore = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => void values.set(key, value),
    removeItem: async (key) => void values.delete(key),
  };
  return { values, store };
}

function acceptingFetch() {
  const bodies: { v: number; counters: CounterRow[] }[] = [];
  const urls: string[] = [];
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body as string));
    return { status: 202, json: async () => ({ accepted: 1, dropped: 0 }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, bodies, urls };
}

type Overrides = Partial<Parameters<typeof createTelemetry>[0]>;

function setup(over: Overrides = {}) {
  const { fetchFn, bodies, urls } = acceptingFetch();
  const kv = memoryStore();
  const telemetry = createTelemetry({
    endpoint: WORKER,
    region: () => 'israel',
    dev: false,
    fetch: fetchFn,
    storage: kv.store,
    ...over,
  });
  return { telemetry, fetchFn, bodies, urls, kv };
}

const row = (over: Partial<CounterRow> = {}): CounterRow => ({
  event: 'Recording.started',
  app: '1.2.0',
  platform: 'ios',
  update: 'embedded',
  region: 'israel',
  count: 1,
  ...over,
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_TELEMETRY_URL;
});

describe('createTelemetry', () => {
  test('counts under the app version, platform, update and region, and posts the counts to the Worker', async () => {
    const { telemetry, bodies, urls } = setup();
    telemetry.signal('Recording.started');
    telemetry.signal('Recording.started');
    await telemetry.flush();

    expect(urls).toEqual([`${WORKER}/v1/counters`]);
    expect(bodies).toEqual([{ v: 1, counters: [row({ count: 2 })] }]);
  });

  test('reads the region when a signal happens, so a change of region counts under the new one', async () => {
    let region: 'us' | 'israel' = 'us';
    const { telemetry, bodies } = setup({ region: () => region });
    telemetry.signal('Debrief.generated');
    region = 'israel';
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    expect(bodies[0]?.counters).toEqual([
      row({ event: 'Debrief.generated', region: 'us' }),
      row({ event: 'Debrief.generated' }),
    ]);
  });

  test('counts Android under its own platform', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { telemetry, bodies } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(bodies[0]?.counters).toEqual([row({ platform: 'android' })]);
  });

  test('files the counts of a downloaded update under its id, as the update reports it in any case', async () => {
    jest.replaceProperty(Updates, 'isEmbeddedLaunch', false);
    jest.replaceProperty(Updates, 'updateId', UUID.toUpperCase());
    const { telemetry, bodies } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(bodies[0]?.counters).toEqual([row({ update: UUID })]);
  });

  test('files the counts of the app as it was built under "embedded", although the embedded update has an id of its own', async () => {
    jest.replaceProperty(Updates, 'isEmbeddedLaunch', true);
    jest.replaceProperty(Updates, 'updateId', UUID);
    const { telemetry, bodies } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(bodies[0]?.counters).toEqual([row({ update: 'embedded' })]);
  });

  test('drops a build suffix from the app version', async () => {
    jest.replaceProperty(Constants, 'expoConfig', { version: '2.0.1-beta.4' } as typeof Constants.expoConfig);
    const { telemetry, bodies } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(bodies[0]?.counters).toEqual([row({ app: '2.0.1' })]);
  });

  describe('counts nothing when', () => {
    test('the app version is not x.y.z', async () => {
      jest.replaceProperty(Constants, 'expoConfig', { version: '1.2' } as typeof Constants.expoConfig);
      const { telemetry, fetchFn } = setup();
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('the app config is not there', async () => {
      jest.replaceProperty(Constants, 'expoConfig', null);
      const { telemetry, fetchFn } = setup();
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('the platform is not iOS or Android', async () => {
      jest.replaceProperty(Platform, 'OS', 'web');
      const { telemetry, fetchFn } = setup();
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('the update id is not a UUID', async () => {
      jest.replaceProperty(Updates, 'isEmbeddedLaunch', false);
      jest.replaceProperty(Updates, 'updateId', 'beta-3');
      const { telemetry, fetchFn } = setup();
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('with no endpoint', () => {
    test.each([
      ['not set', undefined],
      ['empty', ''],
      ['not usable', 'http://openefb-telemetry.omerc.workers.dev'],
    ])('sends nothing and keeps nothing when the setting is %s', async (_name, setting) => {
      const { telemetry, fetchFn, kv } = setup({ endpoint: setting });
      telemetry.signal('Recording.started');
      await telemetry.start();
      telemetry.signal('Recording.started');
      await telemetry.flush();
      await drain();

      expect(fetchFn).not.toHaveBeenCalled();
      expect(kv.values.has(TELEMETRY_BACKLOG_KEY)).toBe(false);
    });

    test('reads EXPO_PUBLIC_TELEMETRY_URL unless an endpoint is given', async () => {
      process.env.EXPO_PUBLIC_TELEMETRY_URL = WORKER;
      const { fetchFn, bodies } = acceptingFetch();
      const telemetry = createTelemetry({
        region: () => 'us',
        dev: false,
        fetch: fetchFn,
        storage: memoryStore().store,
      });
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(bodies).toHaveLength(1);
    });

    test('sends nothing when neither is set', async () => {
      const { fetchFn } = acceptingFetch();
      const telemetry = createTelemetry({
        region: () => 'us',
        dev: false,
        fetch: fetchFn,
        storage: memoryStore().store,
      });
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('in a development build', () => {
    test('never sends to the deployed Worker', async () => {
      const { telemetry, fetchFn } = setup({ dev: true });
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('sends to a Worker running on this machine', async () => {
      const { telemetry, urls } = setup({ dev: true, endpoint: 'http://localhost:8788' });
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(urls).toEqual(['http://localhost:8788/v1/counters']);
    });

    test('is what a test run is, unless said otherwise', async () => {
      const { fetchFn, bodies } = acceptingFetch();
      const telemetry = createTelemetry({
        endpoint: WORKER,
        region: () => 'us',
        fetch: fetchFn,
        storage: memoryStore().store,
      });
      telemetry.signal('Recording.started');
      await telemetry.flush();
      expect(bodies).toEqual([]);
    });
  });

  describe('the choice and the backlog', () => {
    test('are kept in the key-value store that expo-sqlite provides, unless another is given', async () => {
      const kvStore = jest.mocked(Storage);
      kvStore.getItem.mockResolvedValue(null);
      kvStore.setItem.mockResolvedValue(undefined);
      kvStore.removeItem.mockResolvedValue(undefined);
      const { fetchFn } = acceptingFetch();
      const telemetry = createTelemetry({ endpoint: WORKER, region: () => 'us', dev: false, fetch: fetchFn });
      await telemetry.start();
      telemetry.signal('Recording.started');
      await drain();
      await telemetry.setEnabled(false);

      expect(kvStore.getItem).toHaveBeenCalledWith(TELEMETRY_ENABLED_KEY);
      expect(kvStore.getItem).toHaveBeenCalledWith(TELEMETRY_BACKLOG_KEY);
      expect(kvStore.setItem).toHaveBeenCalledWith(TELEMETRY_BACKLOG_KEY, expect.stringContaining('Recording.started'));
      expect(kvStore.setItem).toHaveBeenCalledWith(TELEMETRY_ENABLED_KEY, 'false');
    });

    test('keep a pilot who opted out quiet: nothing is counted or sent, and the old backlog goes', async () => {
      const kv = memoryStore({ [TELEMETRY_ENABLED_KEY]: 'false', [TELEMETRY_BACKLOG_KEY]: serializeRows([row()]) });
      const { telemetry, fetchFn } = setup({ storage: kv.store });
      telemetry.signal('App.launched');
      await telemetry.flush();
      await drain();
      expect(fetchFn).not.toHaveBeenCalled();
      expect(kv.values.has(TELEMETRY_BACKLOG_KEY)).toBe(false);
    });

    test('send the backlog of the last session with the first flush of this one', async () => {
      const kv = memoryStore({ [TELEMETRY_BACKLOG_KEY]: serializeRows([row({ count: 3 })]) });
      const { telemetry, bodies } = setup({ storage: kv.store });
      await telemetry.flush();
      expect(bodies[0]?.counters).toEqual([row({ count: 3 })]);
    });
  });
});

describe('startTelemetry', () => {
  function appStateSource() {
    const listeners: ((state: string) => void)[] = [];
    const remove = jest.fn();
    const source = {
      addEventListener: jest.fn((_type: string, listener: (state: string) => void) => {
        listeners.push(listener);
        return { remove };
      }),
    };
    return {
      source: source as unknown as Parameters<typeof startTelemetry>[1],
      source_: source,
      remove,
      emit: (state: string) => listeners.forEach((listener) => listener(state)),
    };
  }

  test('counts the launch and sends it at once, with whatever the last session left behind', async () => {
    const kv = memoryStore({ [TELEMETRY_BACKLOG_KEY]: serializeRows([row({ count: 2 })]) });
    const { telemetry, bodies } = setup({ storage: kv.store });
    startTelemetry(telemetry, appStateSource().source);
    await drain();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.counters).toHaveLength(2);
    expect(bodies[0]?.counters).toEqual(expect.arrayContaining([row({ count: 2 }), row({ event: 'App.launched' })]));
  });

  test('sends again when the app goes to the background and when it comes back', async () => {
    const { telemetry, bodies } = setup();
    const app = appStateSource();
    startTelemetry(telemetry, app.source);
    await drain();
    expect(bodies).toHaveLength(1);

    telemetry.signal('Navigation.screen', { screen: 'log' });
    app.emit('background');
    await drain();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.counters).toEqual([row({ event: 'Navigation.screen', params: { screen: 'log' } })]);

    telemetry.signal('Recording.started');
    app.emit('active');
    await drain();
    expect(bodies).toHaveLength(3);
  });

  test.each(['inactive', 'unknown', 'extension'])(
    'does not send for %s, a pause that is not leaving the app',
    async (state) => {
      const { telemetry, bodies } = setup();
      const app = appStateSource();
      startTelemetry(telemetry, app.source);
      await drain();
      telemetry.signal('Recording.started');
      app.emit(state);
      await drain();
      expect(bodies).toHaveLength(1);
    },
  );

  test('listens for changes of the app state, once', () => {
    const { telemetry } = setup();
    const app = appStateSource();
    startTelemetry(telemetry, app.source);
    expect(app.source_.addEventListener).toHaveBeenCalledTimes(1);
    expect(app.source_.addEventListener.mock.calls[0]?.[0]).toBe('change');
  });

  test('stops listening when the function it returns is called', async () => {
    const { telemetry } = setup();
    const app = appStateSource();
    const stop = startTelemetry(telemetry, app.source);
    await drain();
    expect(app.remove).not.toHaveBeenCalled();
    stop();
    expect(app.remove).toHaveBeenCalledTimes(1);
  });

  test('sends nothing for a pilot who opted out, however often the app changes state', async () => {
    const kv = memoryStore({ [TELEMETRY_ENABLED_KEY]: 'false' });
    const { telemetry, fetchFn } = setup({ storage: kv.store });
    const app = appStateSource();
    startTelemetry(telemetry, app.source);
    app.emit('background');
    app.emit('active');
    await drain();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('listens to the real AppState when none is given', async () => {
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
    const { telemetry } = setup();
    const stop = startTelemetry(telemetry);
    await drain();
    expect(spy).toHaveBeenCalledWith('change', expect.any(Function));
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
