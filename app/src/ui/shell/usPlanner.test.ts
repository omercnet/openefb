import { migrate } from '../../data/migrate';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { KPAO, KSQL, createFakeAviationDatabase } from '../sheets/flightPlan/fixture';
import { createAppStore } from '../state/appStore';
import { createLiveFlightPlanStore } from './usPlanner';

async function setup(aviation = createFakeAviationDatabase()) {
  const userDb = openNodeSqliteDb();
  await migrate(userDb);
  const app = createAppStore();
  const store = createLiveFlightPlanStore({ aviation, userDb, aircraft: () => [], app, now: () => 1_000 });
  return { store, app, userDb };
}

describe('the US planner on the live app', () => {
  it('a plan publishes to the app navigation and asks the map to fit the route', async () => {
    const { store, app } = await setup();
    await store.getState().configure();
    store.getState().selectDeparture(KPAO);
    store.getState().selectDestination(KSQL);
    store.getState().calculateAndDrawRoute();
    expect(app.getState().navigation.activeFlightPlan).not.toBeNull();
    const frame = app.getState().mapFrameRequest;
    expect(frame?.seq).toBeGreaterThanOrEqual(1);
    expect(frame!.box.south).toBeLessThan(Math.min(KPAO.latitude, KSQL.latitude));
    expect(frame!.box.north).toBeGreaterThan(Math.max(KPAO.latitude, KSQL.latitude));
  });

  it('a saved plan survives in the user database and is restored when the planner opens again', async () => {
    const { store, userDb, app } = await setup();
    await store.getState().configure();
    store.getState().selectDeparture(KPAO);
    store.getState().selectDestination(KSQL);
    store.getState().calculateAndDrawRoute();
    await store.getState().savePlan();
    const again = createLiveFlightPlanStore({
      aviation: createFakeAviationDatabase(),
      userDb,
      aircraft: () => [],
      app: createAppStore(),
      now: () => 2_000,
    });
    await again.getState().configure();
    expect(again.getState().savedPlans).toHaveLength(1);
    expect(app.getState().navigation.activeFlightPlan).not.toBeNull();
  });

  it('without the aviation database the fields simply find nothing', async () => {
    const { store } = await setup(null as never);
    await store.getState().configure();
    await store.getState().setDepartureQuery('KPA');
    expect(store.getState().departureResults).toEqual([]);
  });
});
