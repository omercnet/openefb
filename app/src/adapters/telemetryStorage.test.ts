import {
  TELEMETRY_BACKLOG_KEY,
  TELEMETRY_ENABLED_KEY,
  createTelemetryStorage,
  type KeyValueStore,
} from './telemetryStorage';

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: KeyValueStore = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => void values.set(key, value),
    removeItem: async (key) => void values.delete(key),
  };
  return { values, store };
}

describe('createTelemetryStorage', () => {
  test('keeps the choice under the key Swift used for it, and the backlog under its own', () => {
    expect(TELEMETRY_ENABLED_KEY).toBe('telemetryEnabled'); // Telemetry.enabledKey in Services/TelemetryService.swift
    expect(TELEMETRY_BACKLOG_KEY).toBe('telemetryBacklog');
  });

  describe('the choice', () => {
    test.each([
      ['true', true],
      ['false', false],
    ])('reads %s as %s', async (text, enabled) => {
      const { store } = memoryStore({ [TELEMETRY_ENABLED_KEY]: text });
      await expect(createTelemetryStorage(store).readEnabled()).resolves.toBe(enabled);
    });

    test('reads a choice that was never made as null (the default is on)', async () => {
      await expect(createTelemetryStorage(memoryStore().store).readEnabled()).resolves.toBeNull();
    });

    test.each(['', '1', '0', 'yes', 'TRUE', 'False', ' true'])(
      'reads %j, which is not a choice it wrote, as null',
      async (text) => {
        const { store } = memoryStore({ [TELEMETRY_ENABLED_KEY]: text });
        await expect(createTelemetryStorage(store).readEnabled()).resolves.toBeNull();
      },
    );

    test('writes true and false as text', async () => {
      const { store, values } = memoryStore();
      const storage = createTelemetryStorage(store);
      await storage.writeEnabled(true);
      expect(values.get(TELEMETRY_ENABLED_KEY)).toBe('true');
      await storage.writeEnabled(false);
      expect(values.get(TELEMETRY_ENABLED_KEY)).toBe('false');
      await expect(storage.readEnabled()).resolves.toBe(false);
    });
  });

  describe('the backlog', () => {
    test('is read, written and removed as the text it is', async () => {
      const { store, values } = memoryStore();
      const storage = createTelemetryStorage(store);
      await expect(storage.readBacklog()).resolves.toBeNull();
      await storage.writeBacklog('{"v":1,"rows":[]}');
      expect(values.get(TELEMETRY_BACKLOG_KEY)).toBe('{"v":1,"rows":[]}');
      await expect(storage.readBacklog()).resolves.toBe('{"v":1,"rows":[]}');
      await storage.removeBacklog();
      expect(values.has(TELEMETRY_BACKLOG_KEY)).toBe(false);
      await expect(storage.readBacklog()).resolves.toBeNull();
    });

    test('and the choice do not touch each other', async () => {
      const { store, values } = memoryStore();
      const storage = createTelemetryStorage(store);
      await storage.writeEnabled(false);
      await storage.writeBacklog('x');
      await storage.removeBacklog();
      expect(values.get(TELEMETRY_ENABLED_KEY)).toBe('false');
      await storage.removeBacklog();
      await storage.writeBacklog('y');
      await storage.writeEnabled(true);
      expect(values.get(TELEMETRY_BACKLOG_KEY)).toBe('y');
    });
  });

  test('lets a failure of the store through: the facade decides what it means', async () => {
    const failing: KeyValueStore = {
      getItem: () => Promise.reject(new Error('locked')),
      setItem: () => Promise.reject(new Error('full')),
      removeItem: () => Promise.reject(new Error('locked')),
    };
    const storage = createTelemetryStorage(failing);
    await expect(storage.readEnabled()).rejects.toThrow('locked');
    await expect(storage.writeEnabled(true)).rejects.toThrow('full');
    await expect(storage.readBacklog()).rejects.toThrow('locked');
    await expect(storage.writeBacklog('x')).rejects.toThrow('full');
    await expect(storage.removeBacklog()).rejects.toThrow('locked');
  });
});
