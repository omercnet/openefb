// Port of the stateful part of ProximityAlertService (Services/ProximityAlertService.swift): throttled airspace checks
// against the database, TFR alerts merged in, and an explicit "check unavailable" state.
import type { Airspace, Tfr } from '../domain/core/models';
import { systemClock, type Clock, type Logger } from './ports';
import { airspaceAlerts, tfrAlerts, type ProximityAlert } from './proximityAlert';

/** What the service needs from the aviation database (Swift DatabaseServiceProtocol.airspaces(near:radiusNM:)). */
export interface AirspaceSource {
  airspaces(near: { lat: number; lon: number }, radiusNM: number): Promise<Airspace[]>;
}

/** Throttle to once per 10 seconds to avoid excessive DB queries. */
export const PROXIMITY_CHECK_INTERVAL_SECONDS = 10;
/** Airspace lookup radius around the aircraft in nautical miles. */
export const PROXIMITY_LOOKUP_RADIUS_NM = 5;

export interface ProximityAlertServiceOptions {
  source: AirspaceSource;
  now?: Clock;
  log?: Logger;
}

export class ProximityAlertService {
  activeAlerts: ProximityAlert[] = [];
  isInAirspace = false;
  nearestAirspaceDistance: number | null = null; // nautical miles
  /** The last airspace check could not run (database error). "No alert" and "check failed" must never look the same, so the
   * map shows an amber "airspace check unavailable" while this is true. */
  checkUnavailable = false;

  private lastCheckMs: number | null = null;
  private checkSeq = 0;
  private readonly now: Clock;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly options: ProximityAlertServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.options.log?.(`Proximity listener failed: ${String(error)}`);
      }
    }
  }

  /** Check airspace proximity for the given position. Throttled to once per 10 seconds. `altitude` is GPS altitude in feet
   * MSL, or null when unknown (GPS Degraded, no vertical fix): unknown altitude never produces an INSIDE alert. A check that
   * is overtaken by a newer one (the database answered late) is dropped, so an old position never overwrites a new one. */
  async checkProximity(
    position: { lat: number; lon: number },
    altitude: number | null,
    nowMs: number = this.now(),
  ): Promise<void> {
    if (this.lastCheckMs !== null && (nowMs - this.lastCheckMs) / 1000 < PROXIMITY_CHECK_INTERVAL_SECONDS) return;
    this.lastCheckMs = nowMs;
    const seq = ++this.checkSeq;
    try {
      const nearby = await this.options.source.airspaces(position, PROXIMITY_LOOKUP_RADIUS_NM);
      if (seq !== this.checkSeq) return;
      const result = airspaceAlerts(position, altitude, nearby);
      this.activeAlerts = result.alerts;
      this.isInAirspace = result.alerts.some((a) => a.distance <= 0 && (a.type === 'tfr' || a.vertical === 'within'));
      this.nearestAirspaceDistance = result.nearestDistance;
      this.checkUnavailable = false;
    } catch (error) {
      if (seq !== this.checkSeq) return;
      this.options.log?.(`Airspace proximity check failed: ${error instanceof Error ? error.message : String(error)}`);
      // Old alerts describe an earlier position, so they are cleared; the failure is shown, never silent.
      this.activeAlerts = [];
      this.isInAirspace = false;
      this.nearestAirspaceDistance = null;
      this.checkUnavailable = true;
    }
    this.changed();
  }

  /** Check TFR proximity separately (called when TFR data is available); merged with the airspace alerts. */
  checkTFRProximity(position: { lat: number; lon: number }, tfrs: readonly Tfr[], nowMs: number = this.now()): void {
    const airspace = this.activeAlerts.filter((a) => a.type === 'airspace');
    this.activeAlerts = [...airspace, ...tfrAlerts(position, tfrs, nowMs)];
    this.changed();
  }
}
