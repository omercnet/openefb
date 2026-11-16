import { addManualEntry } from '../../domain/logbook/logbookData';
import { migrate } from '../../data/migrate';
import { flightRecordRepository } from '../../data/repositories';
import { userDataFromDb } from '../../domain/userData';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { log } from '../log/store';
import { createAppStore } from '../state/appStore';
import { createLogFeed } from './logFeed';

async function setup() {
  const db = openNodeSqliteDb();
  await migrate(db);
  const userData = userDataFromDb(db);
  const store = log.make();
  const app = createAppStore();
  const feed = createLogFeed({ userData, flights: flightRecordRepository(db), store, app, log: () => undefined });
  return { db, userData, store, app, feed };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

const addManualEntryForTest = (userData: Parameters<typeof addManualEntry>[0]) => addManualEntry(userData);

describe('log feed', () => {
  it('starts empty and reads the logbook entries after a refresh', async () => {
    const { store, feed, userData } = await setup();
    expect(store.getState()).toEqual({ flights: [], entries: [] });
    await feed.refresh();
    expect(store.getState().entries).toEqual([]);
    feed.actions.addEntry();
    await settle();
    expect(store.getState().entries).toHaveLength(1);
    expect(await userData.logbook.list()).toHaveLength(1);
  });

  it('add entry opens the new entry', async () => {
    const { feed, app, store } = await setup();
    feed.actions.addEntry();
    await settle();
    const id = store.getState().entries[0]!.id;
    expect(app.getState().overlay).toEqual({ kind: 'entry', id });
  });

  it('map and plan navigate; an entry opens its editor', async () => {
    const { feed, app } = await setup();
    app.getState().setScreen('log');
    feed.actions.openMap();
    expect(app.getState().selectedScreen).toBe('map');
    feed.actions.openPlanner();
    expect(app.getState().overlay).toEqual({ kind: 'planner' });
    feed.actions.openEntry('e1');
    expect(app.getState().overlay).toEqual({ kind: 'entry', id: 'e1' });
    feed.actions.openFlight('f1');
    expect(app.getState().overlay).toEqual({ kind: 'flight', id: 'f1' });
  });

  it('deletes a draft entry but never a signed one', async () => {
    const { feed, userData, store } = await setup();
    feed.actions.addEntry();
    feed.actions.addEntry();
    await settle();
    const [a, b] = store.getState().entries;
    await userData.logbook.update(b!.id, { isConfirmed: true });
    feed.actions.deleteEntry(a!.id);
    feed.actions.deleteEntry(b!.id);
    await settle();
    const left = await userData.logbook.list();
    expect(left.map((e) => e.id)).toEqual([b!.id]);
    expect(store.getState().entries.map((e) => e.id)).toEqual([b!.id]);
  });

  it('the signed check is part of the delete: an entry confirmed after the check is kept', async () => {
    const { userData } = await setup();
    const entry = await addManualEntryForTest(userData);
    const confirm = userData.logbook.update(entry.id, { isConfirmed: true });
    const removed = userData.logbook.removeUnconfirmed(entry.id);
    await confirm;
    await removed;
    expect(await userData.logbook.get(entry.id)).not.toBeNull();
    expect(await userData.logbook.removeUnconfirmed(entry.id)).toBe(false);
  });

  it('a failed read keeps the list that was shown', async () => {
    const { feed, store } = await setup();
    store.setState({ entries: [{ id: 'kept' } as never] });
    const failing = createLogFeed({
      userData: { logbook: { list: async () => Promise.reject(new Error('x')) } } as never,
      flights: { list: async () => [] },
      store,
      app: createAppStore(),
      log: () => undefined,
    });
    await failing.refresh();
    expect(store.getState().entries).toHaveLength(1);
    void feed;
  });
});
