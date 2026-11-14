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
    expect(loaded).toEqual({ displayMode: 'night', mapMode: 'northUp', sectionalOpacity: 0.7 });
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
});
