import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import { ownship } from '../state/ownship';
import { startAlerts, TFR_REFRESH_MS } from './alertsBinding';
import type { AlertsRuntime, AlertsSnapshot } from './alertsRuntime';

const EMPTY: AlertsSnapshot = {
  proximityAlerts: [],
  isInAirspace: false,
  nearestAirspaceDistance: null,
  airspaceCheckUnavailable: false,
  israelAlerts: [],
  israelAlertsSuspended: false,
};

function fakeAlerts() {
  let snapshot = EMPTY;
  let version = 0;
  const listeners = new Set<() => void>();
  const alerts = {
    start: jest.fn(),
    stop: jest.fn(),
    setContext: jest.fn(),
    setTfrs: jest.fn(),
    update: jest.fn(async () => undefined),
    setNotamReport: jest.fn(),
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    getVersion: () => version,
    getSnapshot: () => snapshot,
  } as unknown as AlertsRuntime & { update: jest.Mock; setContext: jest.Mock; setTfrs: jest.Mock };
  return {
    alerts,
    emit(next: Partial<AlertsSnapshot>) {
      snapshot = { ...snapshot, ...next };
      version += 1;
      listeners.forEach((l) => l());
    },
  };
}

const bindings: { stop: () => void }[] = [];
afterEach(() => bindings.splice(0).forEach((b) => b.stop()));

function setup(layers: string[] = ['tfrs']) {
  const fake = fakeAlerts();
  const log = flightLog.make({ ...EMPTY_FLIGHT_LOG, region: 'israel' });
  const own = ownship.make();
  let layerListener: () => void = () => undefined;
  const tfr = { currentTFRs: jest.fn(async () => ({ tfrs: [{ id: 'T1' }], fetchedAt: 1 })) };
  const binding = startAlerts({
    runtime: { started: { aviation: null, israel: null }, israelNotam: {}, tfr } as never,
    haptics: { warning: jest.fn() },
    flightLog: log,
    ownship: own,
    visibleLayers: () => layers,
    subscribeLayers: (l) => ((layerListener = l), () => undefined),
    alerts: fake.alerts,
  });
  bindings.push(binding);
  return { ...fake, log, own, binding, tfr, layers, changeLayers: () => layerListener() };
}

describe('alerts binding', () => {
  it('starts the runtime with the region and the GPS staleness, and follows both', () => {
    const { alerts, log, own, binding } = setup();
    expect(alerts.start).toHaveBeenCalledTimes(1);
    expect(alerts.setContext).toHaveBeenLastCalledWith({ region: 'israel', gpsStale: false });
    own.setState({ input: { ...own.getState().input, stale: true } });
    expect(alerts.setContext).toHaveBeenLastCalledWith({ region: 'israel', gpsStale: true });
    log.setState({ region: 'us' });
    expect(alerts.setContext).toHaveBeenLastCalledWith({ region: 'us', gpsStale: true });
    binding.stop();
    expect(alerts.stop).toHaveBeenCalled();
  });

  it('puts the outputs on the strip: the notices and the Israel banner', () => {
    const { emit, log } = setup();
    emit({ airspaceCheckUnavailable: true, israelAlertsSuspended: true });
    expect(log.getState()).toMatchObject({
      airspaceCheckUnavailable: true,
      israelAlertsSuspended: true,
      israelAlerts: [],
    });
    const alert = { id: 'a1' } as never;
    emit({ israelAlertsSuspended: false, israelAlerts: [alert] });
    expect(log.getState().israelAlerts).toEqual([alert]);
  });

  it('sends each new ownship fix once, with altitude only when the fix has one', () => {
    const { alerts, log, own } = setup();
    own.setState({ input: { ...own.getState().input, position: { lat: 32, lon: 34.8 } } });
    const fix = { timestampMs: 1_000, horizontalAccuracyM: 5, verticalAccuracyM: -1, isStationary: false };
    log.setState({ ownshipFix: fix, hasAltitude: false, altitude: 1500, track: 90, groundSpeed: 100, nowMs: 1_000 });
    log.setState({ nowMs: 2_000 }); // the one-second tick with the same fix
    expect(alerts.update).toHaveBeenCalledTimes(1);
    expect(alerts.update.mock.calls[0]![0]).toMatchObject({
      region: 'israel',
      position: { lat: 32, lon: 34.8 },
      altitudeFeet: null,
      trackTrue: 90,
      groundSpeedKnots: 100,
    });
    log.setState({ ownshipFix: { ...fix, timestampMs: 2_000, verticalAccuracyM: 8 }, hasAltitude: true });
    expect(alerts.update).toHaveBeenCalledTimes(2);
    expect(alerts.update.mock.calls[1]![0].altitudeFeet).toBe(1500);
  });

  it('does nothing for a fix without a position', () => {
    const { alerts, log } = setup();
    log.setState({ ownshipFix: { timestampMs: 5, horizontalAccuracyM: 5, verticalAccuracyM: 5, isStationary: false } });
    expect(alerts.update).not.toHaveBeenCalled();
  });

  it('reads the TFR list while the TFR layer is on, and drops it when the layer goes off', async () => {
    jest.useFakeTimers();
    try {
      const { alerts, tfr, layers, changeLayers, binding } = setup(['tfrs']);
      await Promise.resolve();
      expect(tfr.currentTFRs).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(TFR_REFRESH_MS);
      expect(tfr.currentTFRs).toHaveBeenCalledTimes(2);
      expect(alerts.setTfrs).toHaveBeenLastCalledWith([{ id: 'T1' }], true);
      layers.length = 0;
      changeLayers();
      expect(alerts.setTfrs).toHaveBeenLastCalledWith([], false);
      await jest.advanceTimersByTimeAsync(TFR_REFRESH_MS);
      expect(tfr.currentTFRs).toHaveBeenCalledTimes(2);
      binding.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a TFR answer that arrives after the layer went off does not turn it back on', async () => {
    let answer: (v: { tfrs: unknown[]; fetchedAt: number }) => void = () => undefined;
    const fake = fakeAlerts();
    const layers = ['tfrs'];
    let notify: () => void = () => undefined;
    const binding = startAlerts({
      runtime: {
        started: { aviation: null, israel: null },
        israelNotam: {},
        tfr: { currentTFRs: () => new Promise((resolve) => (answer = resolve as never)) },
      } as never,
      haptics: { warning: jest.fn() },
      flightLog: flightLog.make({ ...EMPTY_FLIGHT_LOG, region: 'us' }),
      ownship: ownship.make(),
      visibleLayers: () => layers,
      subscribeLayers: (l) => ((notify = l), () => undefined),
      alerts: fake.alerts,
    });
    bindings.push(binding);
    layers.length = 0;
    notify(); // the layer is switched off while the request is pending
    expect(fake.alerts.setTfrs).toHaveBeenLastCalledWith([], false);
    answer({ tfrs: [{ id: 'late' }], fetchedAt: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.alerts.setTfrs).not.toHaveBeenCalledWith([{ id: 'late' }], true);
  });
});
