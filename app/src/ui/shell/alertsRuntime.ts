// ALERTS: the runtime that runs the proximity (airspace and TFR) alerts and the Israel in-flight alerts and gives the shell
// one place to read what the Swift app shows. Port of the wiring in MapContainerView (initializeServices,
// `.onChange(of: appState.ownshipPosition)`, `.onChange(of: israelAlertsSuspended)`) and of
// MapViewModel.checkProximityAlerts. The rules are the services' (services/proximityAlertService.ts,
// services/israelAlertService.ts); this adds the routing Swift did in the views.
//
// What Swift does with the outputs, and so what this exposes:
// - Proximity alerts: only a warning haptic, once per newly raised alert (an alert that stays active never repeats). Swift
//   draws no banner for them (a gap kept, see port-notes/ALERTS.md); `proximityAlerts` is in the snapshot for when it does.
//   `airspaceCheckUnavailable` is the amber "Airspace check unavailable" notice (FlightLogNotices).
// - Israel alerts: the banner (`IsraelAlertBanner`, highest priority first) and one warning haptic per newly raised alert;
//   `israelAlertsSuspended` is the "ALERTS OFF: NO GPS POSITION" notice, shown instead of the alerts. No speech is involved.
//
// API (Track A mounts it, I1d):
//   const alerts = createAlertsRuntime({ proximity, israel, haptics });   // services built by the shell (see deps)
//   alerts.start();                                   // when the map screen appears (Swift onAppear / initializeServices)
//   alerts.setContext({ region, gpsStale });          // whenever the region or the GPS staleness changes
//   alerts.setTfrs(loadedTfrs, tfrLayerVisible);      // whenever the TFR list or the TFR layer toggle changes
//   await alerts.update(fix);                         // on every ownship fix (Swift onChange of ownshipPosition)
//   alerts.stop();                                    // when the map screen goes away
//   useSyncExternalStore(alerts.subscribe, alerts.getVersion) then alerts.getSnapshot() for the outputs.
// `fix.altitudeFeet` must be null without a vertical fix (verticalAccuracy < 0): unknown altitude is never "inside".
// Feed the FlightLog notices with `snapshot.airspaceCheckUnavailable` and `snapshot.israelAlertsSuspended`, and mount
// `IsraelAlertBanner` (ui/flightLog) with `snapshot.israelAlerts` where FlightLogNotices stacks it (Swift: when not suspended).
// The NOTAM closures feed is the Israel service's own (`notamFetcher`, refreshed every 5 minutes); `setNotamReport` pushes a
// report into it (previews and tests), as Swift's `setReport`.
import type { Region } from '../../domain/core/region';
import type { Tfr } from '../../domain/core/models';
import type { IsraelAlert } from '../../domain/israel/alertEvaluator';
import type { ActiveRoute } from '../../domain/route/activeRoute';
import type { IsraelFix } from '../../services/israelAlertService';
import type { IsraelNotamReport } from '../../services/israelNotam';
import type { ProximityAlert } from '../../services/proximityAlert';
import type { Logger } from '../../services/ports';

/** The part of ProximityAlertService the runtime uses (the real class satisfies it). */
export interface ProximityAlertsLike {
  readonly activeAlerts: ProximityAlert[];
  readonly isInAirspace: boolean;
  readonly nearestAirspaceDistance: number | null;
  readonly checkUnavailable: boolean;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  checkProximity(position: { lat: number; lon: number }, altitude: number | null, nowMs?: number): Promise<void>;
  checkTFRProximity(position: { lat: number; lon: number }, tfrs: readonly Tfr[], nowMs?: number): void;
  /** Drop all alerts, the throttle and any lookup still running. */
  reset(): void;
}

/** The part of IsraelAlertService the runtime uses (the real class satisfies it). */
export interface IsraelAlertsLike {
  readonly alerts: IsraelAlert[];
  onRaised: ((alerts: IsraelAlert[]) => void) | null;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  update(fix: IsraelFix): Promise<void>;
  suspend(): void;
  setReport(report: IsraelNotamReport | null, nowMs?: number): Promise<void>;
}

/** Swift `Haptics.warning()` (UINotificationFeedbackGenerator .warning). */
export interface AlertHaptics {
  warning(): void;
}

export interface AlertsRuntimeDeps {
  proximity: ProximityAlertsLike;
  israel: IsraelAlertsLike;
  haptics: AlertHaptics;
  log?: Logger;
}

/** One ownship fix, as MapContainerView passes it to the two services. */
export interface AlertsFix {
  region: Region;
  position: { lat: number; lon: number };
  /** Feet MSL; null without a vertical fix. */
  altitudeFeet: number | null;
  trackTrue: number;
  groundSpeedKnots: number;
  /** The active route, or null. */
  route: ActiveRoute | null;
  /** Epoch ms; defaults to each service's clock. */
  nowMs?: number;
}

export interface AlertsContext {
  region: Region;
  /** The GPS status is stale (no fresh fix): Swift `gpsStatus.isStale`. */
  gpsStale: boolean;
}

export interface AlertsSnapshot {
  proximityAlerts: readonly ProximityAlert[];
  isInAirspace: boolean;
  nearestAirspaceDistance: number | null;
  airspaceCheckUnavailable: boolean;
  /** Highest priority first; empty while suspended. */
  israelAlerts: readonly IsraelAlert[];
  /** Israel only: no fresh fix, so the position-based alerts are not running. */
  israelAlertsSuspended: boolean;
}

export interface AlertsRuntime {
  start(): void;
  stop(): void;
  setContext(context: AlertsContext): void;
  setTfrs(tfrs: readonly Tfr[], layerVisible: boolean): void;
  update(fix: AlertsFix): Promise<void>;
  setNotamReport(report: IsraelNotamReport | null, nowMs?: number): Promise<void>;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  getSnapshot(): AlertsSnapshot;
}

const EMPTY_SNAPSHOT: AlertsSnapshot = {
  proximityAlerts: [],
  isInAirspace: false,
  nearestAirspaceDistance: null,
  airspaceCheckUnavailable: false,
  israelAlerts: [],
  israelAlertsSuspended: false,
};

export function createAlertsRuntime(deps: AlertsRuntimeDeps): AlertsRuntime {
  const { proximity, israel, haptics } = deps;
  const listeners = new Set<() => void>();
  let version = 0;
  let started = false;
  let context: AlertsContext = { region: 'us', gpsStale: false };
  let tfrs: readonly Tfr[] = [];
  let tfrLayerVisible = false;
  /** The proximity alert ids already shown: a haptic only for an id that is not in here. */
  let knownProximity = new Set<string>();
  let unsubscribe: (() => void)[] = [];
  let cached: { version: number; snapshot: AlertsSnapshot } | null = null;

  const suspended = () => context.region === 'israel' && context.gpsStale;

  const changed = () => {
    version += 1;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        deps.log?.(`Alerts listener failed: ${String(error)}`);
      }
    }
  };

  /** Swift checkProximityAlerts: one warning haptic when an alert is newly raised. */
  const hapticForNewProximityAlerts = () => {
    const ids = new Set(proximity.activeAlerts.map((a) => a.id));
    let raised = false;
    for (const id of ids) if (!knownProximity.has(id)) raised = true;
    knownProximity = ids;
    if (raised) haptics.warning();
  };

  return {
    start() {
      if (started) return;
      started = true;
      knownProximity = new Set(proximity.activeAlerts.map((a) => a.id));
      // IsraelAlertService.onRaised = { _ in Haptics.warning() }. JS-only guard: an evaluation that was already running when the
      // alerts were suspended can still raise; the pilot must not feel a warning for alerts the snapshot hides.
      // The haptic is only for alerts the pilot can see: Israel, with a fresh fix.
      israel.onRaised = () => {
        if (context.region === 'israel' && !suspended()) haptics.warning();
      };
      unsubscribe = [proximity.subscribe(changed), israel.subscribe(changed)];
      changed();
    },

    stop() {
      if (!started) return;
      started = false;
      for (const off of unsubscribe) off();
      unsubscribe = [];
      israel.onRaised = null;
      israel.suspend(); // nothing may be shown as current once the runtime is gone
      proximity.reset(); // and a restart starts clean: no old alerts, no throttle, no late lookup answer
      knownProximity = new Set();
      changed();
    },

    setContext(next) {
      const was = suspended();
      const wasIsrael = context.region === 'israel';
      context = next;
      if (!started) return;
      // `.onChange(of: israelAlertsSuspended) { if suspended { israelAlertService?.suspend() } }`. JS-only additions: also
      // when the suspension ends (an evaluation that ran meanwhile had its haptic dropped, so the service forgets what it
      // published and the next fix raises it afresh) and when the region leaves Israel (an evaluation still running must
      // not raise there, and old alerts must not come back on return).
      if (was !== suspended() || (wasIsrael && next.region !== 'israel')) israel.suspend();
      changed();
    },

    setTfrs(next, layerVisible) {
      tfrs = next;
      tfrLayerVisible = layerVisible;
    },

    async update(fix) {
      if (!started) return;
      // Proximity: the airspace check, then the TFR check when the TFR layer is on (it merges into a lookup still running).
      const check = proximity.checkProximity(fix.position, fix.altitudeFeet, fix.nowMs);
      if (tfrLayerVisible) {
        proximity.checkTFRProximity(fix.position, tfrs, fix.nowMs);
        // The TFR alert is published at once: warn for it now, not after an unrelated airspace lookup settles.
        hapticForNewProximityAlerts();
      }
      // Israel: closed legs ahead, P/R/D and CTR, border buffers, squawk (the service resets outside Israel).
      const israelFix: IsraelFix = {
        region: fix.region,
        route: fix.route,
        position: fix.position,
        altitudeFeet: fix.altitudeFeet,
        trackTrue: fix.trackTrue,
        groundSpeedKnots: fix.groundSpeedKnots,
        ...(fix.nowMs === undefined ? {} : { nowMs: fix.nowMs }),
      };
      const israelUpdate = israel.update(israelFix).catch((error: unknown) => {
        deps.log?.(`Israel alert update failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      await check.catch((error: unknown) => {
        deps.log?.(`Proximity check failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (started) hapticForNewProximityAlerts();
      await israelUpdate;
    },

    setNotamReport: (report, nowMs) => israel.setReport(report, nowMs),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getVersion: () => version,

    getSnapshot() {
      if (!started) return EMPTY_SNAPSHOT;
      const key = version * 4 + (suspended() ? 1 : 0) + (context.region === 'israel' ? 2 : 0);
      if (cached?.version === key) return cached.snapshot;
      const snapshot: AlertsSnapshot = {
        proximityAlerts: [...proximity.activeAlerts],
        isInAirspace: proximity.isInAirspace,
        nearestAirspaceDistance: proximity.nearestAirspaceDistance,
        airspaceCheckUnavailable: proximity.checkUnavailable,
        // Israel only: the service clears itself at the next fix outside Israel, the snapshot does not wait for it.
        israelAlerts: context.region === 'israel' && !suspended() ? [...israel.alerts] : [],
        israelAlertsSuspended: suspended(),
      };
      cached = { version: key, snapshot };
      return snapshot;
    },
  };
}
