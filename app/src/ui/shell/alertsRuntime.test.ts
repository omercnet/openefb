// ALERTS: the runtime around ProximityAlertService and IsraelAlertService. Ports the wiring of MapContainerView
// (initializeServices, .onChange(ownshipPosition), .onChange(israelAlertsSuspended)) and MapViewModel.checkProximityAlerts
// (one warning haptic per newly raised alert; an alert that stays active never repeats), over fakes of the two services,
// plus one run over the real services.
import type { Airspace, Tfr } from '../../domain/core/models';
import type { ActiveRoute } from '../../domain/route/activeRoute';
import type { IsraelAlert } from '../../domain/israel/alertEvaluator';
import type { IsraelFix } from '../../services/israelAlertService';
import type { ProximityAlert } from '../../services/proximityAlert';
import { ProximityAlertService } from '../../services/proximityAlertService';
import {
  createAlertsRuntime,
  type AlertsFix,
  type AlertsRuntime,
  type IsraelAlertsLike,
  type ProximityAlertsLike,
} from './alertsRuntime';

const POS = { lat: 37.46, lon: -122.11 };
const fix = (over: Partial<AlertsFix> = {}): AlertsFix => ({
  region: 'us',
  position: POS,
  altitudeFeet: 1500,
  trackTrue: 90,
  groundSpeedKnots: 100,
  route: null,
  nowMs: 1_000_000,
  ...over,
});
const alert = (id: string, type: ProximityAlert['type'] = 'airspace'): ProximityAlert => ({
  id,
  type,
  name: id,
  distance: 0,
  altitude: "SFC-5000'",
  vertical: 'within',
});
const israelAlert = (id: string): IsraelAlert => ({
  id,
  severity: 'warning',
  kind: 'prohibited',
  title: id,
  detail: null,
});

class FakeProximity implements ProximityAlertsLike {
  activeAlerts: ProximityAlert[] = [];
  isInAirspace = false;
  nearestAirspaceDistance: number | null = null;
  checkUnavailable = false;
  calls: { position: { lat: number; lon: number }; altitude: number | null }[] = [];
  tfrCalls: { tfrs: readonly Tfr[] }[] = [];
  /** What the next check publishes. */
  next: ProximityAlert[] | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  get listenerCount() {
    return this.listeners.size;
  }
  emit() {
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }
  async checkProximity(position: { lat: number; lon: number }, altitude: number | null): Promise<void> {
    this.calls.push({ position, altitude });
    if (this.next) {
      this.activeAlerts = this.next;
      this.next = null;
      this.emit();
    }
  }
  checkTFRProximity(_position: { lat: number; lon: number }, tfrs: readonly Tfr[]): void {
    this.tfrCalls.push({ tfrs });
  }
}

class FakeIsraelAlerts implements IsraelAlertsLike {
  alerts: IsraelAlert[] = [];
  onRaised: ((alerts: IsraelAlert[]) => void) | null = null;
  fixes: IsraelFix[] = [];
  suspended = 0;
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  get listenerCount() {
    return this.listeners.size;
  }
  raise(alerts: IsraelAlert[]) {
    this.alerts = alerts;
    this.version += 1;
    this.onRaised?.(alerts);
    for (const l of [...this.listeners]) l();
  }
  async update(f: IsraelFix): Promise<void> {
    this.fixes.push(f);
  }
  suspend(): void {
    this.suspended += 1;
    if (this.alerts.length) {
      this.alerts = [];
      this.version += 1;
      for (const l of [...this.listeners]) l();
    }
  }
  async setReport(): Promise<void> {}
}

function setup(over: { visibleTfrs?: boolean } = {}) {
  const proximity = new FakeProximity();
  const israel = new FakeIsraelAlerts();
  const haptics: string[] = [];
  const runtime = createAlertsRuntime({
    proximity,
    israel,
    haptics: { warning: () => haptics.push('warning') },
  });
  runtime.start();
  if (over.visibleTfrs) runtime.setTfrs([{ id: 'T1' } as unknown as Tfr], true);
  return { runtime, proximity, israel, haptics };
}

describe('proximity alerts', () => {
  it('checks the fix with its altitude, and a missing vertical fix is passed as unknown', async () => {
    const { runtime, proximity } = setup();
    await runtime.update(fix({ altitudeFeet: 2500 }));
    await runtime.update(fix({ altitudeFeet: null }));
    expect(proximity.calls.map((c) => c.altitude)).toEqual([2500, null]);
    expect(proximity.calls[0]!.position).toEqual(POS);
  });

  it('plays one warning haptic per newly raised alert; an alert that stays active never repeats', async () => {
    const { runtime, proximity, haptics } = setup();
    proximity.next = [alert('A')];
    await runtime.update(fix());
    expect(haptics).toEqual(['warning']);
    proximity.next = [alert('A')]; // the same alert, still active
    await runtime.update(fix());
    expect(haptics).toEqual(['warning']);
    proximity.next = [alert('A'), alert('B')]; // B is new
    await runtime.update(fix());
    expect(haptics).toEqual(['warning', 'warning']);
    proximity.next = [];
    await runtime.update(fix());
    proximity.next = [alert('B')]; // gone, then raised again: new again
    await runtime.update(fix());
    expect(haptics).toHaveLength(3);
  });

  it('checks TFR proximity only while the TFR layer is on, and a TFR alert raises the haptic', async () => {
    const off = setup();
    off.runtime.setTfrs([{ id: 'T1' } as unknown as Tfr], false);
    await off.runtime.update(fix());
    expect(off.proximity.tfrCalls).toHaveLength(0);

    const on = setup({ visibleTfrs: true });
    await on.runtime.update(fix());
    expect(on.proximity.tfrCalls).toHaveLength(1);
    on.proximity.next = [alert('TFR 1', 'tfr')];
    await on.runtime.update(fix());
    expect(on.haptics).toEqual(['warning']);
  });

  it('shows the check-unavailable state and the alerts in the snapshot', async () => {
    const { runtime, proximity } = setup();
    expect(runtime.getSnapshot().airspaceCheckUnavailable).toBe(false);
    proximity.checkUnavailable = true;
    proximity.activeAlerts = [alert('A')];
    proximity.emit();
    const s = runtime.getSnapshot();
    expect(s.airspaceCheckUnavailable).toBe(true);
    expect(s.proximityAlerts.map((a) => a.id)).toEqual(['A']);
  });
});

describe('Israel alerts', () => {
  const route = { legs: [] } as unknown as ActiveRoute;

  it('passes the fix, the region and the route to the Israel service', async () => {
    const { runtime, israel } = setup();
    runtime.setContext({ region: 'israel', gpsStale: false });
    await runtime.update(fix({ region: 'israel', route, trackTrue: 200, groundSpeedKnots: 90, altitudeFeet: null }));
    expect(israel.fixes).toEqual([
      {
        region: 'israel',
        route,
        position: POS,
        altitudeFeet: null,
        trackTrue: 200,
        groundSpeedKnots: 90,
        nowMs: 1_000_000,
      },
    ]);
  });

  it('plays one haptic for newly raised alerts and shows them in priority order as given', () => {
    const { runtime, israel, haptics } = setup();
    runtime.setContext({ region: 'israel', gpsStale: false });
    israel.raise([israelAlert('gaza'), israelAlert('ctr')]);
    expect(haptics).toEqual(['warning']);
    expect(runtime.getSnapshot().israelAlerts.map((a) => a.id)).toEqual(['gaza', 'ctr']);
  });

  it('without a fresh fix in Israel the alerts are suspended: cleared, flagged, never shown as current', () => {
    const { runtime, israel } = setup();
    runtime.setContext({ region: 'israel', gpsStale: false });
    israel.raise([israelAlert('gaza')]);
    runtime.setContext({ region: 'israel', gpsStale: true });
    expect(israel.suspended).toBe(1);
    const s = runtime.getSnapshot();
    expect(s.israelAlertsSuspended).toBe(true);
    expect(s.israelAlerts).toEqual([]);
    runtime.setContext({ region: 'israel', gpsStale: false });
    expect(runtime.getSnapshot().israelAlertsSuspended).toBe(false);
  });

  it('a stale fix in the US suspends nothing (the notice is Israel only)', () => {
    const { runtime, israel } = setup();
    runtime.setContext({ region: 'us', gpsStale: true });
    expect(israel.suspended).toBe(0);
    expect(runtime.getSnapshot().israelAlertsSuspended).toBe(false);
  });

  it('suspends only on the change to stale, not on every context update', () => {
    const { runtime, israel } = setup();
    runtime.setContext({ region: 'israel', gpsStale: true });
    runtime.setContext({ region: 'israel', gpsStale: true });
    expect(israel.suspended).toBe(1);
  });
});

describe('lifecycle and subscription', () => {
  it('a stopped runtime ignores fixes, shows nothing and has let go of the services; start works again', async () => {
    const { runtime, proximity, israel, haptics } = setup();
    runtime.setContext({ region: 'israel', gpsStale: false });
    israel.raise([israelAlert('gaza')]);
    proximity.activeAlerts = [alert('A')];
    runtime.stop();
    expect(proximity.listenerCount).toBe(0);
    expect(israel.listenerCount).toBe(0);
    expect(israel.onRaised).toBeNull();
    const s = runtime.getSnapshot();
    expect(s.proximityAlerts).toEqual([]);
    expect(s.israelAlerts).toEqual([]);
    proximity.next = [alert('B')];
    await runtime.update(fix());
    expect(proximity.calls).toHaveLength(0);
    expect(haptics).toEqual(['warning']); // only the Israel one before stop

    runtime.start();
    await runtime.update(fix());
    expect(proximity.calls).toHaveLength(1);
    expect(haptics).toEqual(['warning', 'warning']); // B is raised now
  });

  it('start and stop are idempotent', () => {
    const { runtime, proximity } = setup();
    runtime.start();
    expect(proximity.listenerCount).toBe(1);
    runtime.stop();
    runtime.stop();
    expect(proximity.listenerCount).toBe(0);
  });

  it('notifies subscribers when either service or the suspended flag changes, and keeps the snapshot stable otherwise', () => {
    const { runtime, proximity, israel } = setup();
    let calls = 0;
    const off = runtime.subscribe(() => (calls += 1));
    const first = runtime.getSnapshot();
    expect(runtime.getSnapshot()).toBe(first);
    proximity.activeAlerts = [alert('A')];
    proximity.emit();
    expect(calls).toBe(1);
    expect(runtime.getSnapshot()).not.toBe(first);
    israel.raise([israelAlert('gaza')]);
    expect(calls).toBe(2);
    runtime.setContext({ region: 'israel', gpsStale: true });
    expect(calls).toBeGreaterThanOrEqual(3);
    const version = runtime.getVersion();
    off();
    proximity.emit();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(runtime.getVersion()).toBeGreaterThan(version);
  });

  it('a failing listener does not stop the others', () => {
    const { runtime, proximity } = setup();
    let ok = 0;
    runtime.subscribe(() => {
      throw new Error('boom');
    });
    runtime.subscribe(() => (ok += 1));
    proximity.emit();
    expect(ok).toBe(1);
  });
});

describe('over the real proximity service', () => {
  const box = (latMin: number, latMax: number, lonMin: number, lonMax: number): Airspace['geometry'] => ({
    kind: 'polygon',
    coordinates: [
      [latMin, lonMin],
      [latMin, lonMax],
      [latMax, lonMax],
      [latMax, lonMin],
      [latMin, lonMin],
    ],
  });
  const classB: Airspace = {
    id: 'sfo',
    classification: 'bravo',
    name: 'SFO Class B',
    floor: 0,
    ceiling: 10000,
    geometry: box(37.4, 37.5, -122.2, -122.0),
  };

  it('raises one haptic when the aircraft enters airspace, none while it stays, and shows the alert', async () => {
    let clock = 1_000_000;
    const source = { airspaces: async () => [classB] };
    const real = new ProximityAlertService({ source, now: () => clock });
    const haptics: string[] = [];
    const runtime: AlertsRuntime = createAlertsRuntime({
      proximity: real,
      israel: new FakeIsraelAlerts(),
      haptics: { warning: () => haptics.push('warning') },
    });
    runtime.start();
    await runtime.update(fix({ nowMs: clock }));
    expect(haptics).toEqual(['warning']);
    expect(runtime.getSnapshot().proximityAlerts.map((a) => a.name)).toContain('SFO Class B');
    expect(runtime.getSnapshot().airspaceCheckUnavailable).toBe(false);
    clock += 20_000; // past the 10 s throttle: checked again, the same alert, no repeat
    await runtime.update(fix({ nowMs: clock }));
    expect(haptics).toEqual(['warning']);
  });

  it('shows "check unavailable" when the database fails, and raises nothing', async () => {
    const real = new ProximityAlertService({
      source: {
        airspaces: async () => {
          throw new Error('db');
        },
      },
      now: () => 5_000_000,
    });
    const haptics: string[] = [];
    const runtime = createAlertsRuntime({
      proximity: real,
      israel: new FakeIsraelAlerts(),
      haptics: { warning: () => haptics.push('warning') },
    });
    runtime.start();
    await runtime.update(fix({ nowMs: 5_000_000 }));
    expect(runtime.getSnapshot().airspaceCheckUnavailable).toBe(true);
    expect(haptics).toEqual([]);
  });
});
