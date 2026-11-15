// JS-only guards of the flight plan store (U4c.md): Swift runs these steps synchronously on the main actor, so a pick, a
// Clear or a delete can never land in the middle of another step. In JS each step awaits, so the store ignores a step whose
// turn has passed. None of these is a Swift behaviour; the 24 Swift cases are in flightPlanViewModel.test.ts.
import { FIXTURE_AIRCRAFT, FIXTURE_SAVED_PLANS, KOAK, KPAO, KSQL, createFixtureFlightPlanStore } from './fixture';

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('flight plan store races', () => {
  it('a route picked while the saved plans load is not replaced by the restored plan', async () => {
    const g = gate();
    const { store, plans } = createFixtureFlightPlanStore({ plans: FIXTURE_SAVED_PLANS });
    const list = plans.list.bind(plans);
    const slow = createFixtureFlightPlanStore(
      { plans: FIXTURE_SAVED_PLANS },
      { plans: { ...plans, list: async () => (await g.opened, list()) } },
    ).store;
    void store; // the plain store is only here to build the repository
    const configuring = slow.getState().configure();
    slow.getState().selectDeparture(KOAK);
    slow.getState().selectDestination(KSQL);
    g.open();
    await configuring;
    expect(slow.getState().selectedDeparture?.icao).toBe('KOAK');
    expect(slow.getState().selectedDestination?.icao).toBe('KSQL');
    expect(slow.getState().departureQuery).toBe('KOAK');
    expect(slow.getState().activePlanID).toBeNull();
  });

  it('a plan saved a moment before Clear does not come back as the active plan', async () => {
    const g = gate();
    const base = createFixtureFlightPlanStore({ aircraft: [FIXTURE_AIRCRAFT] });
    const { store } = createFixtureFlightPlanStore(
      { aircraft: [FIXTURE_AIRCRAFT] },
      { plans: { ...base.plans, insert: async (r) => (await g.opened, base.plans.insert(r)) } },
    );
    await store.getState().configure();
    store.getState().selectDeparture(KPAO);
    store.getState().selectDestination(KSQL);
    const saving = store.getState().savePlan();
    store.getState().clearPlan();
    g.open();
    await saving;
    expect(store.getState().activePlanID).toBeNull();
    expect(store.getState().savedPlans).toHaveLength(1); // saved, just not active
  });

  it('a failed delete changes nothing: the plan stays, stays active, and the route stays', async () => {
    const { store, plans } = createFixtureFlightPlanStore({ plans: FIXTURE_SAVED_PLANS });
    const failing = createFixtureFlightPlanStore(
      { plans: FIXTURE_SAVED_PLANS },
      { plans: { ...plans, remove: async () => Promise.reject(new Error('disk full')) } },
    ).store;
    void store;
    await failing.getState().configure();
    const active = failing.getState().savedPlans[0]!;
    expect(failing.getState().activePlanID).toBe(active.id);
    await failing.getState().deletePlan(active);
    expect(failing.getState().activePlanID).toBe(active.id);
    expect(failing.getState().selectedDeparture?.icao).toBe('KPAO');
    expect(failing.getState().savedPlans.map((p) => p.id)).toContain(active.id);
  });

  it('a plan deleted while its airports are being looked up is not restored', async () => {
    const g = gate();
    const base = createFixtureFlightPlanStore({ plans: FIXTURE_SAVED_PLANS });
    const { store } = createFixtureFlightPlanStore(
      { plans: FIXTURE_SAVED_PLANS },
      {
        plans: base.plans,
        database: {
          airport: async (icao) => (await g.opened, icao === 'KPAO' ? KPAO : KSQL),
          searchAirports: async () => [],
        },
      },
    );
    await store.getState().loadSavedPlans();
    // loadSavedPlans needs configure; run it with the lookups held back
    const configuring = store.getState().configure();
    await flush();
    const target = store.getState().savedPlans[1]!; // KSQL to KMOD, not the one configure restores
    const loading = store.getState().loadPlan(target);
    await store.getState().deletePlan(target);
    g.open();
    await Promise.all([configuring, loading]);
    expect(store.getState().activePlanID).not.toBe(target.id);
    expect(store.getState().departureQuery).not.toBe(target.departureICAO);
  });
});
