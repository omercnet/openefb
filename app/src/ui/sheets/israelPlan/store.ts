// ViewModels/IsraelFlightPlanViewModel.swift as a Zustand store: pick departure, destination and via points, route over
// the chosen network with the NOTAM closures for the departure window, build the FPL message, and activate the route for
// navigation. The pure steps live in logic.ts; this file holds the state, the async sequencing and the dependencies.
// Nothing is sent anywhere: the pilot shares or e-mails the message himself (the e-mail goes to the IAA, see logic.ts).
//
// JS-only: the database and the NOTAM feed are async. Each routing run takes a generation number and only the latest
// may write (Swift cancels the previous Task); picker searches carry a token per field for the same reason.
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { AircraftProfile, PilotProfile } from '../../../data/models';
import {
  WHOLE_COUNTRY,
  type IsraelAerodrome,
  type IsraelAviationMetadata,
  type IsraelReportingPoint,
  type IsraelRouteNetwork,
  type IsraelRouteSegment,
  type IsraelGeoBounds,
  type IsraelLSAWeekendRule,
} from '../../../data/aviation/israelTypes';
import { preferredNetwork, type NetworkPreferenceStore } from '../../../domain/israel/aircraftNetworkPreference';
import { briefingRouteFromPlan, type BriefingRoute } from '../../../domain/israel/briefingFilter';
import {
  canFile,
  fpl,
  hebrewSummary,
  validate,
  type IsraelFlightPlanInput,
  type IsraelFlightPlanIssue,
} from '../../../domain/israel/flightPlanMessage';
import type { IsraelDayOverride } from '../../../domain/israel/lsaTimeRules';
import {
  planNetwork,
  type IsraelRouteError,
  type IsraelRoutePlan,
  type IsraelSegmentClosure,
  type IsraelUnresolvedClosure,
} from '../../../domain/israel/routePlanner';
import type { IsraelNotamReport } from '../../../services/israelNotam';
import {
  SEARCH_LIMIT,
  activeProfile,
  computePlan,
  cruiseSpeedKnots,
  defaultDeparture,
  flightPlanMailURL,
  messageInput,
  pickedDeparture,
  plannableAerodromes,
  planActivation,
  searchableQuery,
  viaRefusal,
  type LoadedNetwork,
  type PlanActivation,
} from './logic';

// MARK: - Dependencies

/** The slice of IsraelAviationDatabase the planner reads (IsraelAviationDatabaseProtocol). */
export interface IsraelPlanDatabase {
  metadata(): Promise<Pick<IsraelAviationMetadata, 'lsaWeekendRule'>>;
  reportingPoint(code: string, network?: IsraelRouteNetwork): Promise<IsraelReportingPoint | null>;
  reportingPoints(bounds: IsraelGeoBounds, network?: IsraelRouteNetwork): Promise<IsraelReportingPoint[]>;
  routeSegments(bounds: IsraelGeoBounds, network?: IsraelRouteNetwork): Promise<IsraelRouteSegment[]>;
  searchAerodromes(query: string, limit: number): Promise<IsraelAerodrome[]>;
}

/** The AppState navigation the plan writes: activate() fills it, clear() empties it. */
export interface IsraelPlanNavigation {
  /** Route line, active leg, next point, DTG/ETE; the app then runs updateActiveRouteProgress. */
  activate(activation: PlanActivation): void;
  /** appState.activeRoute != nil */
  hasActiveRoute(): boolean;
  /** AppState.clearActiveNavigation */
  clear(): void;
}

/** MapService calls: the planned route line and pins, and the LSA layer emphasis. */
export interface IsraelPlanMap {
  showRoute(plan: IsraelRoutePlan): void;
  clearRoute(): void;
  setPlanUsesLSA(uses: boolean): void;
}

export interface IsraelPlanDeps {
  /** Rejects when the Israel database cannot be opened (Swift databaseProvider throws). */
  database: () => Promise<IsraelPlanDatabase>;
  /** null: no NOTAM service; the plan then says closures were not checked. */
  fetchNotams: (() => Promise<IsraelNotamReport>) | null;
  /** Epoch ms. */
  now: () => number;
  /** The aircraft and pilot profiles, read on each use (SwiftData fetch); the active one of each is used. */
  profiles: () => { aircraft: AircraftProfile[]; pilots: PilotProfile[] };
  /** Where IsraelAircraftNetworkPreference keeps an aircraft's usual network; null: none. */
  networkPreferences: NetworkPreferenceStore | null;
  navigation: IsraelPlanNavigation;
  map?: IsraelPlanMap | null;
  /** Telemetry.signal */
  signal?: (name: string, parameters?: Record<string, string>) => void;
  /** Open the NOTAM briefing sheet (IsraelBriefingView) for the planned route, or with none. */
  openBriefing?: (route: BriefingRoute | null) => void;
}

// MARK: - State

export interface IsraelPlanState {
  // Pickers
  departureQuery: string;
  destinationQuery: string;
  viaQuery: string;
  departureResults: IsraelAerodrome[];
  destinationResults: IsraelAerodrome[];
  departure: IsraelAerodrome | null;
  destination: IsraelAerodrome | null;
  /** Via point codes in flying order. */
  viaCodes: string[];
  /** Why the last via entry was refused; null when fine. */
  viaError: string | null;

  // Settings
  /** Planned off-block time, epoch ms. Drives the NOTAM closure check and DOF/ETD in the message. */
  departureTime: number;
  /** Pilot override: plan over dashed by-request segments. The result is not fileable. */
  allowByRequest: boolean;
  /** Pilot override: plan over blue military segments. The result is not fileable. */
  allowMilitary: boolean;
  /** The route network the plan is flown on. Changing it clears the via points (their codes belong to one network). */
  network: IsraelRouteNetwork;
  /** The pilot picked the network; the aircraft profile no longer preselects it. */
  networkChosenByPilot: boolean;
  /** The pilot's declaration that the departure day is a holiday or a holiday eve. */
  dayOverride: IsraelDayOverride;
  /** The AIP's weekend definition for the LSA routes, for display; null until the database has been read. */
  weekendRule: IsraelLSAWeekendRule | null;
  /** Persons on board for P/ when the aircraft profile has none. */
  personsOnBoardOverride: number | null;

  // Result
  plan: IsraelRoutePlan | null;
  routeError: IsraelRouteError | null;
  issues: IsraelFlightPlanIssue[];
  /** false: the NOTAM feed was missing or too old, so closures were NOT applied. */
  closuresChecked: boolean;
  isRouting: boolean;
  fplText: string;
  hebrewSummary: string;
  isActive: boolean;
  /** A plan and no issue that blocks filing. */
  canFile: boolean;
  /** Why the Israel database could not be opened; null when it loaded. */
  lastNetworkFailure: string | null;

  // Actions
  /** Read the profiles: the active aircraft's usual network preselects the planner unless the pilot chose one. */
  configure(): void;
  setDepartureQuery(query: string): Promise<void>;
  setDestinationQuery(query: string): Promise<void>;
  setViaQuery(query: string): void;
  searchDeparture(): Promise<void>;
  searchDestination(): Promise<void>;
  selectDeparture(aerodrome: IsraelAerodrome): void;
  selectDestination(aerodrome: IsraelAerodrome): void;
  /** Add a reporting point by code. Refused when it is not a point of the network. */
  addVia(code: string): Promise<void>;
  removeVia(index: number): void;
  setDepartureTime(epochMs: number): void;
  /** The DatePicker's lower bound (`in: Date()...`): now. */
  earliestDeparture(): number;
  /** The departure DatePicker's binding: the picked time, never before now (a past pick is refused: it becomes now). */
  pickDepartureTime(epochMs: number): void;
  setAllowByRequest(allow: boolean): void;
  setAllowMilitary(allow: boolean): void;
  setDayOverride(override: IsraelDayOverride): void;
  /** Choose the network (the pilot's choice, which the aircraft profile no longer overrides). */
  selectNetwork(network: IsraelRouteNetwork): void;
  setPersonsOnBoardOverride(persons: number | null): void;
  /** Route again with the current picks; supersedes a run still waiting on the NOTAM feed. */
  reroute(): void;
  /** Awaitable form of `reroute()` for tests and the return-flight button. */
  computeRoute(): Promise<void>;
  /** Swap departure and destination, reverse the via points and route again. */
  planReturn(): Promise<void>;
  /** Feed the plan to navigation. Refused when the plan cannot be filed. */
  activate(): void;
  clear(): void;
  /** Rebuild the message after the pilot edited a profile or the persons on board. */
  refreshMessage(): void;
  /** The FPL e-mail draft, addressed to the IAA (ais@iaa.gov.il); null without a message. */
  mailURL(): string | null;
  /** Telemetry for the preview's Share and E-mail buttons. */
  fplShared(method: 'share' | 'email'): void;
  openBriefing(): void;
}

export function createIsraelPlanStore(deps: IsraelPlanDeps): StoreApi<IsraelPlanState> {
  /** Bumped by every routing run and by clear(); a run whose number is no longer current writes nothing. */
  let generation = 0;
  const searchTokens = { departure: 0, destination: 0 };
  const loadedNetworks = new Map<IsraelRouteNetwork, LoadedNetwork>();
  // Kept so the message can be re-validated after a profile edit (Swift: private closures / unresolvedClosures).
  let closures = new Map<number, IsraelSegmentClosure>();
  let unresolved: IsraelUnresolvedClosure[] = [];

  return createStore<IsraelPlanState>()((set, get) => {
    /** set() that keeps `canFile` in step with `plan` and `issues`. */
    const update = (partial: Partial<IsraelPlanState>) =>
      set((s) => {
        const next = { ...s, ...partial };
        return { ...partial, canFile: next.plan !== null && canFile(next.issues) };
      });

    const aircraft = (): AircraftProfile | null => activeProfile(deps.profiles().aircraft);
    const input = (): IsraelFlightPlanInput => {
      const s = get();
      return messageInput({
        aircraft: aircraft(),
        pilot: activeProfile(deps.profiles().pilots),
        personsOnBoardOverride: s.personsOnBoardOverride,
        departure: s.departureTime,
      });
    };

    const scheduleReroute = () => {
      const s = get();
      if (s.departure && s.destination) s.reroute();
    };

    const setNetwork = (network: IsraelRouteNetwork) => {
      if (network === get().network) return;
      set({ network, viaCodes: [], viaError: null });
      scheduleReroute();
    };

    const loadNetwork = async (network: IsraelRouteNetwork): Promise<LoadedNetwork> => {
      const cached = loadedNetworks.get(network);
      if (cached) return cached;
      const database = await deps.database();
      const loaded = {
        points: await database.reportingPoints(WHOLE_COUNTRY, network),
        segments: await database.routeSegments(WHOLE_COUNTRY, network),
      };
      loadedNetworks.set(network, loaded);
      if (get().weekendRule === null) {
        const rule = await database.metadata().then(
          (m) => m.lsaWeekendRule,
          () => null,
        );
        set({ weekendRule: rule });
      }
      return loaded;
    };

    const search = async (field: 'departure' | 'destination', query: string): Promise<IsraelAerodrome[] | null> => {
      const token = ++searchTokens[field];
      const trimmed = searchableQuery(query);
      let results: IsraelAerodrome[] = [];
      if (trimmed !== null) {
        try {
          const database = await deps.database();
          results = plannableAerodromes(await database.searchAerodromes(trimmed, SEARCH_LIMIT));
        } catch {
          results = [];
        }
      }
      return token === searchTokens[field] ? results : null;
    };

    return {
      departureQuery: '',
      destinationQuery: '',
      viaQuery: '',
      departureResults: [],
      destinationResults: [],
      departure: null,
      destination: null,
      viaCodes: [],
      viaError: null,
      departureTime: defaultDeparture(deps.now()),
      allowByRequest: false,
      allowMilitary: false,
      network: 'cvfr',
      networkChosenByPilot: false,
      dayOverride: 'none',
      weekendRule: null,
      personsOnBoardOverride: null,
      plan: null,
      routeError: null,
      issues: [],
      closuresChecked: false,
      isRouting: false,
      fplText: '',
      hebrewSummary: '',
      isActive: false,
      canFile: false,
      lastNetworkFailure: null,

      configure() {
        if (get().networkChosenByPilot || !deps.networkPreferences) return;
        const profile = aircraft();
        if (!profile) return;
        const preferred = preferredNetwork(profile.id, deps.networkPreferences);
        if (preferred !== null) setNetwork(preferred);
      },

      async setDepartureQuery(query) {
        set({ departureQuery: query });
        await get().searchDeparture();
      },
      async setDestinationQuery(query) {
        set({ destinationQuery: query });
        await get().searchDestination();
      },
      setViaQuery(query) {
        set({ viaQuery: query });
      },
      async searchDeparture() {
        const results = await search('departure', get().departureQuery);
        if (results) set({ departureResults: results });
      },
      async searchDestination() {
        const results = await search('destination', get().destinationQuery);
        if (results) set({ destinationResults: results });
      },

      selectDeparture(aerodrome) {
        searchTokens.departure++;
        set({ departure: aerodrome, departureQuery: aerodrome.code, departureResults: [] });
        get().reroute();
      },
      selectDestination(aerodrome) {
        searchTokens.destination++;
        set({ destination: aerodrome, destinationQuery: aerodrome.code, destinationResults: [] });
        get().reroute();
      },

      async addVia(rawCode) {
        const code = rawCode.trim().toUpperCase();
        if (code === '') return;
        const network = get().network;
        const known = await deps
          .database()
          .then((database) => database.reportingPoint(code, network))
          .then(
            (point) => point !== null,
            () => false,
          );
        // The lookup ran against `network`: if the pilot switched networks meanwhile, the answer is for the old one.
        if (get().network !== network) return;
        if (!known) {
          set({ viaError: viaRefusal(code, network) });
          return;
        }
        set((s) => ({ viaError: null, viaCodes: [...s.viaCodes, code], viaQuery: '' }));
        get().reroute();
      },
      removeVia(index) {
        const { viaCodes } = get();
        if (index < 0 || index >= viaCodes.length) return;
        set({ viaCodes: viaCodes.filter((_, i) => i !== index) });
        get().reroute();
      },

      setDepartureTime(departureTime) {
        set({ departureTime });
        scheduleReroute();
      },
      earliestDeparture() {
        return deps.now();
      },
      pickDepartureTime(epochMs) {
        get().setDepartureTime(pickedDeparture(epochMs, deps.now()));
      },
      setAllowByRequest(allowByRequest) {
        set({ allowByRequest });
        scheduleReroute();
      },
      setAllowMilitary(allowMilitary) {
        set({ allowMilitary });
        scheduleReroute();
      },
      setDayOverride(dayOverride) {
        set({ dayOverride });
        scheduleReroute();
      },
      selectNetwork(network) {
        set({ networkChosenByPilot: true });
        setNetwork(network);
      },
      setPersonsOnBoardOverride(personsOnBoardOverride) {
        set({ personsOnBoardOverride });
      },

      reroute() {
        void get().computeRoute();
      },

      async computeRoute() {
        const { departure, destination } = get();
        if (!departure || !destination) return;
        const run = ++generation;
        set({ isRouting: true });
        try {
          let loaded: LoadedNetwork;
          try {
            loaded = await loadNetwork(get().network);
          } catch (error) {
            if (run !== generation) return;
            closures = new Map();
            unresolved = [];
            // No plan means no message either: the preview and the e-mail draft must not carry the previous route.
            update({
              plan: null,
              routeError: null,
              issues: [],
              fplText: '',
              hebrewSummary: '',
              isActive: false,
              lastNetworkFailure: error instanceof Error ? error.message : String(error),
            });
            deps.map?.clearRoute();
            deps.map?.setPlanUsesLSA(false);
            return;
          }
          if (run !== generation) return;
          set({ lastNetworkFailure: null });

          // NOTAM closures for the departure window. A missing or stale feed applies none and says so.
          let report: IsraelNotamReport | null = null;
          if (deps.fetchNotams) report = await deps.fetchNotams().catch(() => null);
          if (run !== generation) return;
          const s = get();
          const outcome = await computePlan({
            departure,
            destination,
            via: s.viaCodes,
            network: s.network,
            loaded,
            report,
            departureTime: s.departureTime,
            allowByRequest: s.allowByRequest,
            allowMilitary: s.allowMilitary,
            dayOverride: s.dayOverride,
            cruiseSpeedKnots: cruiseSpeedKnots(aircraft()),
            input: input(),
            nowMs: deps.now(),
          });
          if (run !== generation) return;
          closures = outcome.closures;
          unresolved = outcome.unresolved;
          update({
            plan: outcome.plan,
            routeError: outcome.routeError,
            issues: outcome.issues,
            closuresChecked: outcome.closuresChecked,
            fplText: outcome.fplText,
            hebrewSummary: outcome.hebrewSummary,
            isActive: false,
          });
          if (outcome.plan) {
            deps.map?.showRoute(outcome.plan);
            deps.map?.setPlanUsesLSA(planNetwork(outcome.plan) === 'lsa');
          } else {
            deps.map?.clearRoute();
            deps.map?.setPlanUsesLSA(false);
          }
        } finally {
          if (run === generation) set({ isRouting: false });
        }
      },

      async planReturn() {
        const { departure, destination, viaCodes } = get();
        if (!departure || !destination) return;
        set({
          departure: destination,
          destination: departure,
          departureQuery: destination.code,
          destinationQuery: departure.code,
          viaCodes: [...viaCodes].reverse(),
        });
        await get().computeRoute();
      },

      activate() {
        // A plan still being recomputed is the previous route: never send it to navigation.
        if (get().isRouting) return;
        // Profiles may have been edited since the route was computed: validate against the current ones.
        get().refreshMessage();
        const s = get();
        if (!s.plan || !s.canFile) return;
        const activation = planActivation(s.plan, aircraft());
        if (!activation) return;
        deps.navigation.activate(activation);
        set({ isActive: true });
        deps.signal?.('FlightPlan.activated');
      },

      clear() {
        generation++;
        searchTokens.departure++;
        searchTokens.destination++;
        closures = new Map();
        unresolved = [];
        update({
          departure: null,
          destination: null,
          departureQuery: '',
          destinationQuery: '',
          viaQuery: '',
          viaCodes: [],
          viaError: null,
          departureResults: [],
          destinationResults: [],
          lastNetworkFailure: null,
          plan: null,
          routeError: null,
          issues: [],
          fplText: '',
          hebrewSummary: '',
          isActive: false,
          isRouting: false,
        });
        if (deps.navigation.hasActiveRoute()) deps.navigation.clear();
        deps.map?.clearRoute();
        deps.map?.setPlanUsesLSA(false);
      },

      refreshMessage() {
        const s = get();
        if (!s.plan) return;
        const message = input();
        update({
          fplText: fpl(s.plan, message),
          hebrewSummary: hebrewSummary(s.plan, message),
          issues: validate(s.plan, { closures, unresolved, closuresChecked: s.closuresChecked, input: message }),
        });
      },

      mailURL() {
        return flightPlanMailURL(get().fplText, input());
      },

      fplShared(method) {
        deps.signal?.('Israel.fplShared', { method });
      },

      openBriefing() {
        const s = get();
        deps.openBriefing?.(s.plan ? briefingRouteFromPlan(s.plan, s.departureTime) : null);
      },
    };
  });
}

// MARK: - Context

const IsraelPlanContext = createContext<StoreApi<IsraelPlanState> | null>(null);

/** Supplies the plan store to IsraelFlightPlanSheet: I1 with the real services, the route and tests with fixtures. */
export const IsraelPlanProvider = ({ store, children }: { store: StoreApi<IsraelPlanState>; children: ReactNode }) =>
  createElement(IsraelPlanContext.Provider, { value: store }, children);

export function useIsraelPlanStore(): StoreApi<IsraelPlanState> {
  const store = useContext(IsraelPlanContext);
  if (!store) throw new Error('IsraelFlightPlanSheet needs an IsraelPlanProvider');
  return store;
}

/** Zustand's rule applies: the selector returns a field or a primitive, never a fresh object. */
export const useIsraelPlan = <S>(selector: (state: IsraelPlanState) => S): S =>
  useStore(useIsraelPlanStore(), selector);
