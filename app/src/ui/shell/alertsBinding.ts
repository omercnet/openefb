// Mounts the alerts runtime (Track B's createAlertsRuntime) on the live app: the services on the real databases and feeds,
// the ownship fixes in, the notices and the Israel banner out, the warning haptic. Swift: MapContainerView.initializeServices,
// `.onChange(of: appState.ownshipPosition)` and `.onChange(of: israelAlertsSuspended)`.
import type { StoreApi } from 'zustand';
import type { Haptics } from '../../adapters/haptics';
import type { Tfr } from '../../domain/core/models';
import { IsraelAlertService } from '../../services/israelAlertService';
import { ProximityAlertService } from '../../services/proximityAlertService';
import type { Logger } from '../../services/ports';
import type { FlightLogData } from '../flightLog/store';
import type { OwnshipData } from '../state/ownship';
import { createAlertsRuntime, type AlertsRuntime } from './alertsRuntime';
import type { AppRuntime } from './runtime';

/** How often the TFR list is read again while the TFR layer is on (the service answers from its own cache between fetches). */
export const TFR_REFRESH_MS = 60_000;

export interface AlertsBindingDeps {
  runtime: Pick<AppRuntime, 'started' | 'israelNotam' | 'tfr'>;
  haptics: Pick<Haptics, 'warning'>;
  flightLog: StoreApi<FlightLogData>;
  ownship: StoreApi<OwnshipData>;
  /** The visible map layers (the Layers slice). */
  visibleLayers: () => readonly string[];
  subscribeLayers: (listener: () => void) => () => void;
  log?: Logger;
  /** Overrides the runtime (tests). */
  alerts?: AlertsRuntime;
}

export function startAlerts(deps: AlertsBindingDeps): { alerts: AlertsRuntime; stop: () => void } {
  const { runtime, flightLog, ownship } = deps;
  const { aviation, israel } = runtime.started;
  const log = deps.log ?? console.warn;
  const alerts =
    deps.alerts ??
    createAlertsRuntime({
      // No aviation database: the check fails and the strip says "Airspace check unavailable" rather than showing nothing.
      proximity: new ProximityAlertService({
        source: {
          airspaces: (near, radiusNM) =>
            aviation
              ? aviation.airspacesNear(near, radiusNM)
              : Promise.reject(new Error('Aviation database unavailable')),
        },
        log,
      }),
      israel: new IsraelAlertService({
        databaseProvider: () =>
          israel ? Promise.resolve(israel) : Promise.reject(new Error('Israel database unavailable')),
        notamFetcher: () => runtime.israelNotam.fetchFeed(),
        log,
      }),
      haptics: deps.haptics,
      log,
    });

  const publish = () => {
    const snapshot = alerts.getSnapshot();
    flightLog.setState({
      airspaceCheckUnavailable: snapshot.airspaceCheckUnavailable,
      israelAlertsSuspended: snapshot.israelAlertsSuspended,
      israelAlerts: snapshot.israelAlerts,
    });
  };
  const stopOutput = alerts.subscribe(publish);

  const context = () => {
    const data = flightLog.getState();
    alerts.setContext({ region: data.region, gpsStale: ownship.getState().input.stale });
  };
  context();
  const stopContext = ownship.subscribe((state, previous) => {
    if (state.input.stale !== previous.input.stale) context();
  });
  const stopRegion = flightLog.subscribe((state, previous) => {
    if (state.region !== previous.region) context();
  });

  // A new ownship fix (Swift onChange of ownshipPosition): the tick republishes the same fix every second, so compare stamps.
  let lastFix: number | null = null;
  const stopFixes = flightLog.subscribe((state) => {
    const stamp = state.ownshipFix?.timestampMs ?? null;
    const position = ownship.getState().input.position;
    if (stamp === null || stamp === lastFix || !position) return;
    lastFix = stamp;
    void alerts.update({
      region: state.region,
      position,
      altitudeFeet: state.hasAltitude ? state.altitude : null, // unknown altitude is never "inside" an airspace
      trackTrue: state.track,
      groundSpeedKnots: state.groundSpeed,
      route: state.activeRoute,
      nowMs: state.nowMs,
    });
  });

  // The TFR list for the proximity check: read while the TFR layer is on.
  let tfrTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const loadTfrs = () => {
    runtime.tfr.currentTFRs().then(
      (snapshot) => !stopped && alerts.setTfrs(snapshot.tfrs as Tfr[], true),
      (error) => log(`TFR list for alerts failed: ${String(error)}`),
    );
  };
  const followTfrLayer = () => {
    const on = deps.visibleLayers().includes('tfrs');
    if (on && tfrTimer === null) {
      loadTfrs();
      tfrTimer = setInterval(loadTfrs, TFR_REFRESH_MS);
    } else if (!on && tfrTimer !== null) {
      clearInterval(tfrTimer);
      tfrTimer = null;
      alerts.setTfrs([], false);
    }
  };
  followTfrLayer();
  const stopLayers = deps.subscribeLayers(followTfrLayer);

  alerts.start();
  publish();
  return {
    alerts,
    stop() {
      stopped = true;
      if (tfrTimer !== null) clearInterval(tfrTimer);
      stopLayers();
      stopFixes();
      stopRegion();
      stopContext();
      stopOutput();
      alerts.stop();
    },
  };
}
