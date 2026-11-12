// Port of efb-212Tests/ViewModelTests/IsraelFlightPlanViewModelTests.swift (8 of 8) and the "Israel LSA view model" suite
// of efb-212Tests/ServiceTests/IsraelLSAPlannerTests.swift (5 of 5): routing with a NOTAM detour, the no-route message,
// the return flight, activation into navigation state, the filing block, and the network choice. Plus the issue #39
// cases: the e-mail draft goes to the IAA filing address, never to the pilot (not in Swift; see U4b-plan.md).
import { newAircraftProfile, newPilotProfile } from '../../../data/defaults';
import type { AircraftProfile, PilotProfile } from '../../../data/models';
import type { IsraelRouteActivity, IsraelRouteNetwork } from '../../../data/aviation/israelTypes';
import { setPreferredNetwork, type NetworkPreferenceStore } from '../../../domain/israel/aircraftNetworkPreference';
import { planPointCodes, planNetwork } from '../../../domain/israel/routePlanner';
import { progress } from '../../../domain/israel/routeFollowing';
import { currentLeg, type ActiveRoute } from '../../../domain/route/activeRoute';
import { makeRouteClosure, type IsraelNotamReport, type IsraelRouteClosure } from '../../../services/israelNotam';
import { routeTitle, type NavState } from '../../flightLog/logic';
import { createFakeIsraelPlanDatabase, planAerodrome, planPoint, planSegment } from './fixture';
import type { StoreApi } from 'zustand';
import { createIsraelPlanStore, type IsraelPlanNavigation, type IsraelPlanState } from './store';

type PlanStore = StoreApi<IsraelPlanState>;

const NOW = Date.UTC(2026, 10, 12, 6, 26);

/** The AppState navigation fields the Swift tests read, behind the plan's navigation port. */
interface TestAppState extends NavState {
  distanceToNext: number | null;
}

function appState() {
  const state: TestAppState = {
    directTo: null,
    activeFlightPlan: false,
    activeRoute: null,
    planDeparture: null,
    planDestination: null,
    distanceToNext: null,
  };
  const navigation: IsraelPlanNavigation = {
    activate: (a) =>
      Object.assign(state, {
        activeRoute: a.activeRoute,
        activeFlightPlan: true,
        directTo: null,
        planDeparture: a.planDeparture,
        planDestination: a.planDestination,
        distanceToNext: a.distanceToNext,
      }),
    hasActiveRoute: () => state.activeRoute !== null,
    clear: () =>
      Object.assign(state, {
        activeRoute: null,
        activeFlightPlan: false,
        directTo: null,
        planDeparture: null,
        planDestination: null,
        distanceToNext: null,
      }),
  };
  /** AppState.updateActiveRouteProgress after a fix. */
  const updateActiveRouteProgress = (lat: number, lon: number, groundSpeed: number) => {
    if (!state.activeRoute) return;
    const result = progress(state.activeRoute, { lat, lon }, null, groundSpeed, NOW);
    state.activeRoute = result.route;
    state.distanceToNext = result.distanceToNextNM;
  };
  return { state, navigation, updateActiveRouteProgress };
}

const current = (route: ActiveRoute | null) => (route ? currentLeg(route) : null);

function report(closures: IsraelRouteClosure[]): IsraelNotamReport {
  return { feed: { generatedAt: NOW, items: [], closures }, fetchedAt: NOW, refreshFailed: false };
}

const closure = (notamId: string, chain: string[]) =>
  makeRouteClosure({
    notamId,
    routeKind: 'CVFR',
    routeName: null,
    chain,
    validFrom: null,
    validTo: null,
    schedule: null,
  });

const AERODROMES = [
  planAerodrome('LLHZ', { lat: 32.18, lon: 34.83 }),
  planAerodrome('LLIB', { lat: 32.98, lon: 35.57 }),
];

describe('Israel flight plan view model', () => {
  const pts = [
    planPoint(1, 'LLHZ', { kind: 'arp', lat: 32.18, lon: 34.83 }),
    planPoint(2, 'MIDAA', { lat: 32.3, lon: 34.9 }),
    planPoint(3, 'LLIB', { kind: 'arp', lat: 32.98, lon: 35.57 }),
    planPoint(4, 'MIDBB', { lat: 32.4, lon: 35.2 }),
  ];
  /** LLHZ-MIDAA-LLIB (short) and LLHZ-MIDBB-LLIB (long). */
  const segs = [
    planSegment(1, pts[0], pts[1], { nm: 10 }),
    planSegment(2, pts[1], pts[2], { nm: 40 }),
    planSegment(3, pts[0], pts[3], { nm: 25 }),
    planSegment(4, pts[3], pts[2], { nm: 30 }),
  ];
  const database = () => createFakeIsraelPlanDatabase({ points: pts, segments: segs, aerodromes: AERODROMES });

  function viewModel(o: { report?: IsraelNotamReport; aircraft?: AircraftProfile[]; pilots?: PilotProfile[] } = {}) {
    const db = database();
    const app = appState();
    const vm = createIsraelPlanStore({
      database: async () => db,
      fetchNotams: o.report ? async () => o.report! : null,
      now: () => NOW,
      profiles: () => ({ aircraft: o.aircraft ?? [], pilots: o.pilots ?? [] }),
      networkPreferences: null,
      navigation: app.navigation,
    });
    return { vm, ...app };
  }

  /** A view model whose aircraft and pilot profiles carry what filing needs. */
  function fileableViewModel(o: { report?: IsraelNotamReport; pilotEmail?: string } = {}) {
    const aircraft = newAircraftProfile('4X-CXA', { isActive: true });
    const pilot = newPilotProfile({ name: 'Israel Israeli', isActive: true, email: o.pilotEmail ?? null });
    const made = viewModel({ report: o.report, aircraft: [aircraft], pilots: [pilot] });
    made.vm.getState().configure();
    return made;
  }

  async function pick(vm: PlanStore, from = 'LLHZ', to = 'LLIB') {
    const db = database();
    vm.getState().selectDeparture((await db.aerodrome(from))!);
    vm.getState().selectDestination((await db.aerodrome(to))!);
    await vm.getState().computeRoute();
  }

  const codes = (vm: PlanStore) => {
    const plan = vm.getState().plan;
    return plan ? planPointCodes(plan) : null;
  };

  test('routesTheShortPathWithoutAFeed', async () => {
    const { vm } = viewModel();
    await pick(vm);
    expect(codes(vm)).toEqual(['LLHZ', 'MIDAA', 'LLIB']);
    expect(vm.getState().closuresChecked).toBe(false); // no feed: the pilot is told closures were not applied
  });

  test('fullClosureDetoursAndReturnReversesTheRoute', async () => {
    const { vm } = viewModel({ report: report([closure('C1/26', ['MIDAA', 'LLIB'])]) });
    await pick(vm);
    expect(codes(vm)).toEqual(['LLHZ', 'MIDBB', 'LLIB']);
    expect(vm.getState().closuresChecked).toBe(true);
    await vm.getState().planReturn();
    expect(codes(vm)).toEqual(['LLIB', 'MIDBB', 'LLHZ']);
    expect(vm.getState().departure?.code).toBe('LLIB');
  });

  test('bothWaysClosedGivesNoRouteWithClosureReason', async () => {
    const { vm } = viewModel({
      report: report([closure('C1/26', ['MIDAA', 'LLIB']), closure('C2/26', ['MIDBB', 'LLIB'])]),
    });
    await pick(vm);
    expect(vm.getState().plan).toBeNull();
    expect(vm.getState().routeError?.info).toEqual({ kind: 'noRoute', from: 'LLHZ', to: 'LLIB', reason: 'closed' });
    expect(vm.getState().canFile).toBe(false);
  });

  test('closureNamingAnUnknownPointBlocksFilingWithAnUnresolvedIssue', async () => {
    const { vm } = fileableViewModel({ report: report([closure('C5/26', ['MIDAA', 'ZZZZZ'])]) });
    await pick(vm);
    expect(vm.getState().plan).not.toBeNull();
    expect(vm.getState().issues).toContainEqual({
      kind: { kind: 'unresolvedClosure', value: 'C5/26' },
      blocksFiling: true,
    });
    expect(vm.getState().canFile).toBe(false);
  });

  test('unknownViaPointIsRefused', async () => {
    const { vm } = viewModel();
    await vm.getState().addVia('NOPE');
    expect(vm.getState().viaError).not.toBeNull();
    expect(vm.getState().viaCodes).toEqual([]);
  });

  test('activateFeedsNavigationStateAndClearResetsIt', async () => {
    const { vm, state } = fileableViewModel();
    await pick(vm);
    vm.getState().activate();
    expect(state.activeFlightPlan).toBe(true);
    expect(current(state.activeRoute)?.toCode).toBe('MIDAA');
    expect(current(state.activeRoute)?.altitudeText).toBe('1500');
    expect(state.planDestination).toBe('LLIB');
    expect(routeTitle(state)).toContain('MIDAA');
    vm.getState().clear();
    expect(state.activeFlightPlan).toBe(false);
    expect(state.activeRoute).toBeNull();
  });

  test('activateIsRefusedWithoutAircraftAndPilotProfiles', async () => {
    const { vm, state } = viewModel();
    await pick(vm);
    expect(vm.getState().plan).not.toBeNull();
    expect(vm.getState().canFile).toBe(false); // no registration, no pilot name
    vm.getState().activate();
    expect(state.activeFlightPlan).toBe(false);
    expect(state.activeRoute).toBeNull();
  });

  test('routeProgressAdvancesToTheNextLegNearThePoint', async () => {
    const { vm, state, updateActiveRouteProgress } = fileableViewModel();
    await pick(vm);
    vm.getState().activate();
    updateActiveRouteProgress(32.3, 34.9, 90); // over MIDAA
    expect(current(state.activeRoute)?.toCode).toBe('LLIB');
    expect(state.distanceToNext).toBeGreaterThan(40);
  });

  // Issue #39 (not in Swift): the draft is addressed to the IAA, and the pilot's own address is not in the link.
  test('mailURLIsAddressedToTheFilingAddressNotThePilot (issue #39)', async () => {
    const { vm } = fileableViewModel({ pilotEmail: 'pilot@example.com' });
    expect(vm.getState().mailURL()).toBeNull(); // no message yet
    await pick(vm);
    const mail = vm.getState().mailURL();
    expect(mail).not.toBeNull();
    const url = new URL(mail!);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('ais@iaa.gov.il');
    expect(url.searchParams.get('subject')).toBe('FPL 4XCXA');
    expect(url.searchParams.get('body')).toBe(vm.getState().fplText.replace(/\n/g, '\r\n'));
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(mail).not.toContain('pilot');
    expect(mail).not.toContain('example.com');
  });
});

// MARK: - Israel LSA view model (IsraelLSAPlannerTests.swift)

describe('Israel flight plan view model: review fixes (PR #58)', () => {
  const pts = [
    planPoint(1, 'LLHZ', { kind: 'arp', lat: 32.18, lon: 34.83 }),
    planPoint(2, 'MIDAA', { lat: 32.3, lon: 34.9 }),
    planPoint(3, 'LLIB', { kind: 'arp', lat: 32.98, lon: 35.57 }),
  ];
  const segs = [planSegment(1, pts[0], pts[1], { nm: 10 }), planSegment(2, pts[1], pts[2], { nm: 40 })];
  const baseDb = () => createFakeIsraelPlanDatabase({ points: pts, segments: segs, aerodromes: AERODROMES });

  /** A fileable store with hooks: the database (and its reporting-point lookup) and the NOTAM feed can be held or failed. */
  function harness(o: { burn?: number | null } = {}) {
    const aircraft = newAircraftProfile('4X-CXA', { isActive: true });
    if (o.burn !== undefined) aircraft.fuelBurnGPH = o.burn;
    const pilots: PilotProfile[] = [newPilotProfile({ name: 'Israel Israeli', isActive: true })];
    const ctl = {
      failDatabase: false,
      lookupGate: null as PromiseWithResolvers<void> | null,
      notamGate: null as PromiseWithResolvers<void> | null,
    };
    const db = baseDb();
    const activations: { fuelGallons: number | null }[] = [];
    const map = { showRoute: jest.fn(), clearRoute: jest.fn(), setPlanUsesLSA: jest.fn(), zoomToRoute: jest.fn() };
    const store = createIsraelPlanStore({
      database: async () => {
        if (ctl.failDatabase) throw new Error('database unavailable');
        return {
          ...db,
          reportingPoint: async (code, net) => {
            await ctl.lookupGate?.promise;
            return db.reportingPoint(code, net);
          },
        };
      },
      fetchNotams: async () => {
        await ctl.notamGate?.promise;
        return report([]);
      },
      now: () => NOW,
      profiles: () => ({ aircraft: [aircraft], pilots }),
      networkPreferences: null,
      navigation: {
        activate: (a) => activations.push({ fuelGallons: a.fuelGallons }),
        hasActiveRoute: () => false,
        clear: () => {},
      },
      map: map as never,
    });
    store.getState().configure();
    return { store, ctl, pilots, activations, map, db };
  }

  async function routed(h: ReturnType<typeof harness>) {
    h.store.getState().selectDeparture((await h.db.aerodrome('LLHZ'))!);
    h.store.getState().selectDestination((await h.db.aerodrome('LLIB'))!);
    await h.store.getState().computeRoute();
    expect(h.store.getState().plan).not.toBeNull();
  }

  test('aNonPositiveFuelBurnPublishesNoFuelEstimate', async () => {
    for (const burn of [0, -5]) {
      const h = harness({ burn });
      await routed(h);
      h.store.getState().activate();
      expect(h.activations).toEqual([{ fuelGallons: null }]);
    }
    const ok = harness({ burn: 10 });
    await routed(ok);
    ok.store.getState().activate();
    expect(ok.activations[0]!.fuelGallons).toBeGreaterThan(0);
  });

  test('aViaLookupThatFinishesAfterANetworkSwitchChangesNothing', async () => {
    const h = harness();
    h.ctl.lookupGate = Promise.withResolvers<void>();
    const pending = h.store.getState().addVia('MIDAA');
    h.store.getState().selectNetwork('lsa'); // clears the via state for the new network
    h.ctl.lookupGate.resolve();
    await pending;
    expect(h.store.getState().viaCodes).toEqual([]);
    expect(h.store.getState().viaError).toBeNull();
  });

  test('activateIsIgnoredWhileTheRouteIsBeingRecomputed', async () => {
    const h = harness();
    await routed(h);
    h.ctl.notamGate = Promise.withResolvers<void>();
    h.store.getState().reroute(); // waits for the NOTAM feed
    await Promise.resolve();
    expect(h.store.getState().isRouting).toBe(true);
    h.store.getState().activate();
    expect(h.activations).toEqual([]);
    h.ctl.notamGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.store.getState().isRouting).toBe(false);
    h.store.getState().activate();
    expect(h.activations).toHaveLength(1);
  });

  test('aNetworkLoadFailureLeavesNoStaleMessageOrMapRoute', async () => {
    const h = harness();
    await routed(h);
    expect(h.store.getState().mailURL()).not.toBeNull();
    h.ctl.failDatabase = true;
    h.store.getState().selectNetwork('lsa'); // a network that is not cached: the load fails
    await new Promise((resolve) => setImmediate(resolve));
    const s = h.store.getState();
    expect(s.plan).toBeNull();
    expect(s.lastNetworkFailure).toBe('database unavailable');
    expect(s.fplText).toBe('');
    expect(s.hebrewSummary).toBe('');
    expect(s.mailURL()).toBeNull();
    expect(h.map.clearRoute).toHaveBeenCalled();
    expect(h.map.setPlanUsesLSA).toHaveBeenLastCalledWith(false);
  });

  test('editingTheProfilesAfterRoutingBlocksActivation', async () => {
    const h = harness();
    await routed(h);
    expect(h.store.getState().canFile).toBe(true);
    h.pilots[0]!.name = ''; // the pilot edits the profile after routing
    h.store.getState().activate();
    expect(h.activations).toEqual([]);
    expect(h.store.getState().canFile).toBe(false);
  });
});

describe('Israel LSA view model', () => {
  /** LSAFixture.israel: Israel local time in November (UTC+2). */
  const israel = (day: number, hour: number) => Date.UTC(2026, 10, day, hour - 2);
  const wednesday = israel(4, 10);
  const saturday = israel(7, 10);

  const point = (id: number, code: string, network: IsraelRouteNetwork, lat: number, lon: number, arp = false) =>
    planPoint(id, code, { kind: arp ? 'arp' : 'compulsory', network, lat, lon });
  const cvfr = [
    point(1, 'LLHZ', 'cvfr', 32.18, 34.83, true),
    point(2, 'MIDCV', 'cvfr', 32.3, 34.9),
    point(3, 'LLIB', 'cvfr', 32.98, 35.57, true),
  ];
  const lsa = [
    point(4, 'LLHZ', 'lsa', 32.18, 34.83, true),
    point(5, 'MIDLS', 'lsa', 32.4, 35.0),
    point(6, 'LLIB', 'lsa', 32.98, 35.57, true),
  ];
  const segment = (
    id: number,
    a: (typeof cvfr)[number],
    b: (typeof cvfr)[number],
    nm: number,
    activity: IsraelRouteActivity,
  ) => planSegment(id, a, b, { nm, forward: '1500', reverse: '1500', activity });
  /** CVFR: LLHZ-MIDCV-LLIB. LSA: LLHZ-MIDLS-LLIB, the first leg weekend-only. Different mid points per network. */
  const database = () =>
    createFakeIsraelPlanDatabase({
      points: [...cvfr, ...lsa],
      segments: [
        segment(1, cvfr[0], cvfr[1], 10, 'unspecified'),
        segment(2, cvfr[1], cvfr[2], 40, 'unspecified'),
        segment(3, lsa[0], lsa[1], 12, 'weekend'),
        segment(4, lsa[1], lsa[2], 42, 'all_week'),
      ],
      aerodromes: AERODROMES,
    });

  function viewModel(o: { aircraft?: AircraftProfile[]; preferences?: NetworkPreferenceStore } = {}) {
    const db = database();
    const vm = createIsraelPlanStore({
      database: async () => db,
      fetchNotams: null,
      now: () => NOW,
      profiles: () => ({ aircraft: o.aircraft ?? [], pilots: [] }),
      networkPreferences: o.preferences ?? null,
      navigation: appState().navigation,
    });
    vm.getState().setDepartureTime(saturday);
    return vm;
  }

  async function pick(vm: PlanStore) {
    const db = database();
    vm.getState().selectDeparture((await db.aerodrome('LLHZ'))!);
    vm.getState().selectDestination((await db.aerodrome('LLIB'))!);
    await vm.getState().computeRoute();
  }

  const codes = (vm: PlanStore) => {
    const plan = vm.getState().plan;
    return plan ? planPointCodes(plan) : null;
  };

  function preferences(): NetworkPreferenceStore {
    const values = new Map<string, string>();
    return {
      getString: (key) => values.get(key) ?? null,
      setString: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    };
  }

  test('theNetworkChoiceDecidesWhichRoutesArePlanned', async () => {
    const vm = viewModel();
    await pick(vm);
    expect(codes(vm)).toEqual(['LLHZ', 'MIDCV', 'LLIB']);
    vm.getState().selectNetwork('lsa');
    await vm.getState().computeRoute();
    expect(codes(vm)).toEqual(['LLHZ', 'MIDLS', 'LLIB']);
    expect(planNetwork(vm.getState().plan!)).toBe('lsa');
    expect(vm.getState().hebrewSummary.startsWith('תכנית טיסה בנתיבי התעופה הספורטיבית')).toBe(true);
  });

  test('aWeekdayDepartureOnTheLSANetworkHasNoRouteBecauseTheFirstLegIsWeekendOnly', async () => {
    const vm = viewModel();
    vm.getState().setDepartureTime(wednesday);
    vm.getState().selectNetwork('lsa');
    await pick(vm);
    expect(vm.getState().plan).toBeNull();
    expect(vm.getState().routeError?.info).toEqual({ kind: 'noRoute', from: 'LLHZ', to: 'LLIB', reason: 'notInUse' });
    vm.getState().setDayOverride('holiday');
    await vm.getState().computeRoute();
    expect(codes(vm)).toEqual(['LLHZ', 'MIDLS', 'LLIB']);
  });

  test('switchingNetworkClearsViaPointsThatBelongToTheOtherNetwork', async () => {
    const vm = viewModel();
    await vm.getState().addVia('MIDCV');
    expect(vm.getState().viaCodes).toEqual(['MIDCV']);
    vm.getState().selectNetwork('lsa');
    expect(vm.getState().viaCodes).toEqual([]);
    await vm.getState().addVia('MIDCV');
    expect(vm.getState().viaError).toBe('MIDCV is not a reporting point of the LSA network.');
  });

  test('theActiveAircraftsUsualNetworkPreselectsUntilThePilotChooses', () => {
    const aircraft = newAircraftProfile('4X-LSA', { isActive: true });
    const prefs = preferences();
    setPreferredNetwork('lsa', aircraft.id, prefs);
    const vm = viewModel({ aircraft: [aircraft], preferences: prefs });
    vm.getState().configure();
    expect(vm.getState().network).toBe('lsa');
    expect(vm.getState().networkChosenByPilot).toBe(false);

    vm.getState().selectNetwork('cvfr');
    vm.getState().configure(); // the pilot's choice stays
    expect(vm.getState().network).toBe('cvfr');
  });

  test('anAircraftWithoutAPreferenceStartsOnCVFR', () => {
    const aircraft = newAircraftProfile('4X-GA', { isActive: true });
    const vm = viewModel({ aircraft: [aircraft], preferences: preferences() });
    vm.getState().configure();
    expect(vm.getState().network).toBe('cvfr');
  });
});
