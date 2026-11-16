import { migrate } from '../../data/migrate';
import { settingsRepository } from '../../data/repositories';
import type { TextStorage } from '../../services/ports';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { layers } from '../columns/layers/store';
import { DEFAULT_LAYER_SETTINGS, loadLayerSettings, persistLayerSettings } from './layersSettings';

const memoryStorage = (initial: Record<string, string> = {}): TextStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    read: async (k) => data[k] ?? null,
    write: async (k, v) => void (data[k] = v),
    remove: async (k) => void delete data[k],
  };
};

async function freshDb() {
  const db = await openNodeSqliteDb();
  await migrate(db);
  return db;
}
const settle = () => new Promise((r) => setImmediate(r));

describe('layer settings', () => {
  it('launches on the defaults when nothing is saved', async () => {
    expect(await loadLayerSettings(await freshDb(), memoryStorage())).toEqual(DEFAULT_LAYER_SETTINGS);
  });

  it('reads only the saved display mode: orientation and opacity are not restored (Swift keeps them in memory)', async () => {
    const db = await freshDb();
    await settingsRepository(db).update({ defaultMapMode: 'trackUp', sectionalOpacity: 0.4 });
    const loaded = await loadLayerSettings(db, memoryStorage({ 'Preferences/displayMode': 'night' }));
    expect(loaded).toEqual({ displayMode: 'night', mapMode: 'northUp', sectionalOpacity: 0.7, airportDiagrams: true });
  });

  it('ignores a display mode it does not know', async () => {
    const loaded = await loadLayerSettings(await freshDb(), memoryStorage({ 'Preferences/displayMode': 'dusk' }));
    expect(loaded).toEqual(DEFAULT_LAYER_SETTINGS);
  });

  it('writes a change of the display mode back, and never the settings row', async () => {
    const db = await freshDb();
    const storage = memoryStorage();
    const store = layers.make();
    const stop = persistLayerSettings(store, db, storage);
    store.setState({ displayMode: 'night' });
    store.setState({ mapMode: 'trackUp', sectionalOpacity: 0.5 });
    await settle();
    expect(storage.data['Preferences/displayMode']).toBe('night');
    expect(await settingsRepository(db).get()).toBeNull();
    stop();
    store.setState({ displayMode: 'day' });
    await settle();
    expect(storage.data['Preferences/displayMode']).toBe('night');
  });

  it('reports a failed display-mode read and still launches on the default', async () => {
    const log = jest.fn();
    const failing = {
      read: async () => Promise.reject(new Error('io')),
      write: async () => undefined,
      remove: async () => undefined,
    };
    expect(await loadLayerSettings(await freshDb(), failing, log)).toEqual(DEFAULT_LAYER_SETTINGS);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('io'));
  });

  it('saves rapid display-mode changes one after the other, in order', async () => {
    const order: string[] = [];
    let active = 0;
    let overlapped = false;
    const storage = {
      read: async () => null,
      remove: async () => undefined,
      write: async (_k: string, v: string) => {
        active += 1;
        overlapped ||= active > 1;
        await new Promise((r) => setTimeout(r, 5));
        order.push(v);
        active -= 1;
      },
    };
    const store = layers.make();
    const stop = persistLayerSettings(store, await freshDb(), storage);
    store.setState({ displayMode: 'night' });
    store.setState({ displayMode: 'day' });
    store.setState({ displayMode: 'auto' });
    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(['night', 'day', 'auto']);
    expect(overlapped).toBe(false);
    stop();
  });

  it('the diagrams switch is on by default, restored when saved, and saved when it changes', async () => {
    expect((await loadLayerSettings(await freshDb(), memoryStorage())).airportDiagrams).toBe(true);
    expect(
      (await loadLayerSettings(await freshDb(), memoryStorage({ 'Preferences/showAirportDiagrams': 'false' })))
        .airportDiagrams,
    ).toBe(false);
    const storage = memoryStorage();
    const store = layers.make();
    const stop = persistLayerSettings(store, await freshDb(), storage);
    store.setState({ airportDiagrams: false });
    await settle();
    expect(storage.data['Preferences/showAirportDiagrams']).toBe('false');
    stop();
  });
});
