import { FakePreferences } from '../../domain/ports/preferences';
import {
  FIXTURE_AIRCRAFT,
  FIXTURE_NOW,
  FIXTURE_PILOT,
  createFakeIsraelPlanDatabase,
  FIXTURE_AERODROMES,
  FIXTURE_POINTS,
  FIXTURE_SEGMENTS,
  FIXTURE_WEEKEND_RULE,
  seedFixturePlan,
} from '../sheets/israelPlan/fixture';
import { createAppStore } from '../state/appStore';
import { createLiveIsraelPlanStore, createPlannerNetworkStore } from './israelPlanner';

const database = createFakeIsraelPlanDatabase({
  points: FIXTURE_POINTS,
  segments: FIXTURE_SEGMENTS,
  aerodromes: FIXTURE_AERODROMES,
  weekendRule: FIXTURE_WEEKEND_RULE,
});

const live = (over: Partial<Parameters<typeof createLiveIsraelPlanStore>[0]> = {}) => {
  const app = createAppStore();
  const signals: string[] = [];
  const store = createLiveIsraelPlanStore({
    israel: database as never,
    notam: null,
    profiles: () => ({ aircraft: [FIXTURE_AIRCRAFT], pilots: [FIXTURE_PILOT] }),
    networkPreferences: null,
    app,
    now: () => FIXTURE_NOW,
    signal: (name) => void signals.push(name),
    ...over,
  });
  return { app, store, signals };
};

describe('live Israel planner', () => {
  it('activating a plan feeds the app store navigation, and clear empties it', async () => {
    const { app, store, signals } = live();
    await seedFixturePlan(store);
    store.getState().activate();
    const nav = app.getState().navigation;
    expect(nav.activeFlightPlan).toBe(true);
    expect(nav.activeRoute?.legs.length).toBeGreaterThan(0);
    expect(nav.planDestination).toBe('LLIB');
    expect(nav.planDestinationCoordinate).not.toBeNull();
    expect(nav.directTo).toBeNull();
    expect(signals).toContain('FlightPlan.activated');
    store.getState().clear();
    expect(app.getState().navigation.activeRoute).toBeNull();
    expect(app.getState().navigation.activeFlightPlan).toBe(false);
  });

  it('the Brief button opens the briefing for the planned route', async () => {
    const { app, store } = live();
    await seedFixturePlan(store);
    store.getState().openBriefing();
    expect(app.getState().isPresentingBriefing).toBe(true);
    expect(app.getState().briefingRoute?.codes[0]).toBe('LLHZ');
    app.getState().setPresentingBriefing(false);
    expect(app.getState().briefingRoute).toBeNull();
  });

  it('without the Israel database the route says it is unavailable instead of crashing', async () => {
    const { store } = live({ israel: null });
    await seedFixturePlan(store).catch(() => undefined);
    expect(store.getState().plan).toBeNull();
  });
});

describe('route network preference', () => {
  it('reads what was stored once warmed, and writes through', async () => {
    const prefs = new FakePreferences({ 'israel.routeNetwork.a1': 'lsa' });
    const store = createPlannerNetworkStore(prefs);
    expect(store.getString('israel.routeNetwork.a1')).toBeNull(); // not loaded yet
    await store.warm(['a1']);
    expect(store.getString('israel.routeNetwork.a1')).toBe('lsa');
    store.setString('israel.routeNetwork.a1', 'cvfr');
    expect(store.getString('israel.routeNetwork.a1')).toBe('cvfr');
    await new Promise((r) => setTimeout(r, 0));
    expect(await prefs.get('israel.routeNetwork.a1')).toBe('cvfr');
    store.remove('israel.routeNetwork.a1');
    await new Promise((r) => setTimeout(r, 0));
    expect(await prefs.get('israel.routeNetwork.a1')).toBeNull();
  });
});
