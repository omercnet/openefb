import { createFakeNetworkStatus } from '../../adapters/network';
import type { Airport } from '../../domain/core';
import { FakeLocationSource } from '../../domain/ports/location';
import { createAppStore } from '../state/appStore';
import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import { nearest } from '../columns/nearest/store';
import { gps } from '../state/gps';
import { ownship } from '../state/ownship';
import { regionSlice } from '../state/region';
import { startLiveData, TICK_MS, type LiveDataStores } from './liveData';

const NOW = 1_700_000_000_000;

function setup(region: 'us' | 'israel' = 'us') {
  const location = new FakeLocationSource();
  const network = createFakeNetworkStatus(false);
  const stores: LiveDataStores = {
    app: createAppStore(),
    flightLog: flightLog.make(EMPTY_FLIGHT_LOG),
    gps: gps.make(),
    nearest: nearest.make(),
    ownship: ownship.make(),
    region: regionSlice.make(),
  };
  let now = NOW;
  const stop = startLiveData({ location, network, region, clock: () => now, stores });
  const fix = (over: Partial<{ lat: number; lon: number; ts: number; vacc: number; speed: number }> = {}) =>
    location.emit({
      fix: {
        lat: over.lat ?? 37.5,
        lon: over.lon ?? -122.25,
        altitudeM: 100,
        horizontalAccuracyM: 5,
        verticalAccuracyM: over.vacc ?? 5,
        speedMps: over.speed ?? 50,
        courseDeg: 90,
        timestampMs: over.ts ?? now,
      },
    });
  return { stores, network, stop, fix, advance: (ms: number) => (now += ms) };
}

const KSQL = { icao: 'KSQL', latitude: 37.511, longitude: -122.249 } as unknown as Airport;

describe('live data', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts with the saved region and no position', () => {
    const { stores, stop } = setup('israel');
    expect(stores.region.getState().region).toBe('israel');
    expect(stores.flightLog.getState().region).toBe('israel');
    expect(stores.flightLog.getState().hasPosition).toBe(false);
    stop();
  });

  it('a fix reaches the map ownship, the NOW readouts, the GPS status and the nearest list', () => {
    const { stores, fix, stop } = setup();
    fix();
    expect(stores.ownship.getState().input.position).toEqual({ lat: 37.5, lon: -122.25 });
    expect(stores.ownship.getState().input.stale).toBe(false);
    const log = stores.flightLog.getState();
    expect(log.hasPosition).toBe(true);
    expect(log.hasAltitude).toBe(true);
    expect(log.groundSpeed).toBeCloseTo(97.2, 1);
    expect(stores.gps.getState().status).toEqual({ kind: 'ok' });
    expect(stores.nearest.getState().ownship).toEqual({ lat: 37.5, lon: -122.25 });
    stop();
  });

  it('a fix older than 5 s turns the ownship stale on the tick, with no new update', () => {
    const { stores, fix, advance, stop } = setup();
    fix();
    advance(6000);
    jest.advanceTimersByTime(TICK_MS);
    expect(stores.gps.getState().status.kind).toBe('lost');
    expect(stores.ownship.getState().input.stale).toBe(true);
    stop();
  });

  it('a Wi-Fi-only fix has no altitude', () => {
    const { stores, fix, stop } = setup();
    fix({ vacc: -1 });
    expect(stores.flightLog.getState().hasAltitude).toBe(false);
    stop();
  });

  it('the network status drives the offline flag', () => {
    const { stores, network, stop } = setup();
    network.set(true);
    expect(stores.flightLog.getState().isOffline).toBe(true);
    network.set(false);
    expect(stores.flightLog.getState().isOffline).toBe(false);
    stop();
  });

  it('Direct-To without a fix shows no distance, bearing or ETE (setDirectTo, no position)', () => {
    const { stores, stop } = setup();
    stores.nearest.getState().directTo(KSQL);
    const log = stores.flightLog.getState();
    expect(log.directTo).toBe('KSQL');
    expect(log.activeFlightPlan).toBe(true);
    expect(log.distanceToNext).toBeNull();
    expect(log.estimatedTimeEnroute).toBeNull();
    stop();
  });

  it('Direct-To with a fix seeds the numbers, the next fix refreshes them, Clear removes them', () => {
    const { stores, fix, stop } = setup();
    fix();
    stores.nearest.getState().directTo(KSQL);
    const first = stores.flightLog.getState().distanceToNext;
    expect(first).toBeGreaterThan(0);
    expect(stores.flightLog.getState().estimatedTimeEnroute).not.toBeNull();
    fix({ lat: 37.505, ts: NOW + 1000 });
    expect(stores.flightLog.getState().distanceToNext).toBeLessThan(first!);
    stores.flightLog.getState().actions.clear();
    const log = stores.flightLog.getState();
    expect(log.directTo).toBeNull();
    expect(log.activeFlightPlan).toBe(false);
    expect(log.distanceToNext).toBeNull();
    expect(stores.app.getState().navigation.directTo).toBeNull();
    stop();
  });
});
