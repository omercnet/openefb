// Ported from efb-212Tests/CharacterizationTests/LocationServiceCharacterizationTests.swift (15 cases; the
// parameterized failure-flag case is one it.each). The Swift harness polled AppState across actor hops; here the fake
// source delivers synchronously and Jest fake timers drive the grace and backoff delays.
import { FakeLocationSource, makeFix, type LocationFix } from '../ports/location';
import { LocationService, type LocationServiceOptions } from './locationService';
import { METERS_PER_FOOT, VsiDifferencer, displayAltitudeFeet, roundHalfAwayFromZero } from './ownship';

const t0 = 1_800_000_000_000; // epoch ms

/** A fix with explicit units: meters, meters per second, degrees true. */
function fix({ altitudeMeters = 100, speedMS = 0, course = 0, timestampMs = t0 } = {}): LocationFix {
  return makeFix({ altitudeM: altitudeMeters, speedMps: speedMS, courseDeg: course, timestampMs });
}

function harness(options: LocationServiceOptions = {}) {
  const source = new FakeLocationSource();
  const service = new LocationService(source, { noFixGraceMs: 60_000, ...options });
  return { source, service };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('LocationService characterization', () => {
  // Unit conversion of a fix
  it('fix is converted to knots, feet and degrees', () => {
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ altitudeMeters: 1000, speedMS: 10, course: 90 }));
    const s = service.state;
    expect(s.firstLocationReceived).toBe(true);
    expect(s.groundSpeedKt).toBeCloseTo(19.4384, 4); // knots
    expect(s.altitudeFt).toBe(3280); // feet MSL, 3280.84 rounded to 10
    expect(s.trackDeg).toBe(90); // degrees true
    expect(s.gpsAvailable).toBe(true);
    expect(s.gpsFailure).toBeNull();
    expect(s.ownshipPosition?.lat).toBe(37.4611);
  });

  it('invalid course becomes zero and negative speed becomes zero', () => {
    // Course -1 and speed -1 mean invalid. The service shows 0 / 0, not "unknown".
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ speedMS: -1, course: -1 }));
    expect(service.state.groundSpeedKt).toBe(0);
    expect(service.state.trackDeg).toBe(0);
  });

  it('altitude rounds to nearest ten feet', () => {
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ altitudeMeters: 100 })); // 328.08 ft
    expect(service.state.altitudeFt).toBe(330);
  });

  // Vertical speed
  it('vertical speed is derived from fix timestamps, not arrival time', () => {
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ altitudeMeters: 100, timestampMs: t0 }));
    expect(service.state.verticalSpeedFpm).toBe(0);
    // efb-hql: 100 ft climb over 60 s of fix time arrives immediately; VSI is 100 fpm.
    source.emitFix(fix({ altitudeMeters: 130.48, timestampMs: t0 + 60_000 }));
    expect(Math.abs(service.state.verticalSpeedFpm - 100)).toBeLessThan(0.5);
  });

  it('identical fix timestamps give zero vertical speed', () => {
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ altitudeMeters: 100, timestampMs: t0 }));
    source.emitFix(fix({ altitudeMeters: 130.48, timestampMs: t0 }));
    expect(service.state.altitudeFt).not.toBe(330);
    expect(service.state.verticalSpeedFpm).toBe(0);
  });

  // GPS failure flags on updates with no position
  it.each([
    [{ authorizationDenied: true }, 'authorizationDenied'],
    [{ authorizationDeniedGlobally: true }, 'authorizationDenied'],
    [{ authorizationRestricted: true }, 'authorizationRestricted'],
    [{ locationUnavailable: true }, 'locationUnavailable'],
  ])('update without position %o marks GPS unavailable with reason %s', (flags, expected) => {
    const { source, service } = harness();
    service.start();
    source.emit({ fix: null, ...flags });
    expect(service.state.gpsFailure).toBe(expected);
    expect(service.state.gpsAvailable).toBe(false);
  });

  it('a fix after a failure clears the failure and restores availability', () => {
    const { source, service } = harness();
    service.start();
    source.emit({ fix: null, locationUnavailable: true });
    expect(service.state.gpsFailure).toBe('locationUnavailable');
    source.emitFix(fix());
    expect(service.state.gpsAvailable).toBe(true);
    expect(service.state.gpsFailure).toBeNull();
  });

  it('stationary notice keeps the last fix available and only sets the stationary flag', () => {
    const { source, service } = harness();
    service.start();
    source.emitFix(fix({ altitudeMeters: 1000, speedMS: 10 }));
    source.emit({ fix: null, stationary: true });
    const s = service.state;
    expect(s.gpsStationary).toBe(true);
    expect(s.gpsAvailable).toBe(true);
    expect(s.gpsFailure).toBeNull();
    expect(s.groundSpeedKt).toBeCloseTo(19.4384, 4);
  });

  it('update with no position and no flags is ignored', () => {
    const { source, service } = harness();
    service.start();
    source.emit({ fix: null, authorizationDenied: true });
    const before = service.state;
    source.emit({ fix: null });
    expect(service.state).toEqual(before);
    expect(service.state.gpsFailure).toBe('authorizationDenied');
    expect(service.state.gpsAvailable).toBe(false);
  });

  // Stream end
  it('stream error marks GPS lost, then restarts tracking, and a restarted fix recovers it', () => {
    const { source, service } = harness({ restartBaseDelayMs: 20 });
    service.start();
    source.emitFix(fix());
    expect(service.state.gpsAvailable).toBe(true);

    source.fail();
    expect(service.state.gpsFailure).toBe('streamFailed');
    expect(service.state.gpsAvailable).toBe(false);
    expect(service.isTracking).toBe(true);

    // efb-71b: the service asks for a fresh stream; a fix on it clears the failure.
    jest.advanceTimersByTime(20);
    expect(source.requests).toHaveLength(2);
    source.emitFix(fix({ speedMS: 10 }));
    expect(service.state.gpsAvailable).toBe(true);
    expect(service.state.gpsFailure).toBeNull();
    expect(service.state.groundSpeedKt).toBeCloseTo(19.4384, 4);
  });

  it('stop during backoff prevents a restart', () => {
    const { source, service } = harness({ restartBaseDelayMs: 200 });
    service.start();
    source.fail();
    expect(service.state.gpsFailure).toBe('streamFailed');
    service.stop();
    jest.advanceTimersByTime(400);
    expect(source.requests).toHaveLength(1);
    expect(service.isTracking).toBe(false);
  });

  // No fix yet
  it('no fix within the grace delay raises noFixYet', () => {
    const { service } = harness({ noFixGraceMs: 40 });
    service.start();
    jest.advanceTimersByTime(40);
    expect(service.state.gpsFailure).toBe('noFixYet');
    expect(service.state.gpsAvailable).toBe(false);
  });

  it('a fix before the grace delay prevents noFixYet', () => {
    const { source, service } = harness({ noFixGraceMs: 250 });
    service.start();
    source.emitFix(fix());
    jest.advanceTimersByTime(400);
    expect(service.state.gpsFailure).toBeNull();
  });

  it('explicit failure before the grace delay is not overwritten by noFixYet', () => {
    const { source, service } = harness({ noFixGraceMs: 250 });
    service.start();
    source.emit({ fix: null, authorizationDenied: true });
    jest.advanceTimersByTime(400);
    expect(service.state.gpsFailure).toBe('authorizationDenied');
  });

  // Stop
  it('stop ends tracking and later updates are not applied', () => {
    const { source, service } = harness();
    service.start();
    expect(service.isTracking).toBe(true);
    source.emitFix(fix({ altitudeMeters: 1000, speedMS: 10 }));
    service.stop();
    expect(service.isTracking).toBe(false);
    expect(source.subscriberCount).toBe(0);
    source.emitFix(fix({ altitudeMeters: 2000, speedMS: 50 }));
    expect(service.state.groundSpeedKt).toBeCloseTo(19.4384, 4); // unchanged
    expect(service.state.altitudeFt).toBe(3280); // unchanged
  });
});

// New in TS (no Swift test pinned these).
describe('LocationService (TS additions)', () => {
  it('restart delay doubles from the base and caps at 30 s', () => {
    const { service } = harness({ restartBaseDelayMs: 1000 });
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((a) => service.restartDelayMs(a))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it('backoff resets after a real fix', () => {
    const { source, service } = harness({ restartBaseDelayMs: 100 });
    service.start();
    source.fail();
    jest.advanceTimersByTime(100); // attempt 0
    source.fail();
    jest.advanceTimersByTime(100);
    expect(source.requests).toHaveLength(2); // attempt 1 waits 200 ms
    jest.advanceTimersByTime(100);
    expect(source.requests).toHaveLength(3);
    source.emitFix(fix());
    source.fail();
    jest.advanceTimersByTime(100);
    expect(source.requests).toHaveLength(4);
  });

  it('a restarted stream does not difference against the pre-failure altitude', () => {
    const { source, service } = harness({ restartBaseDelayMs: 10 });
    service.start();
    source.emitFix(fix({ altitudeMeters: 100, timestampMs: t0 }));
    source.fail();
    jest.advanceTimersByTime(10);
    source.emitFix(fix({ altitudeMeters: 400, timestampMs: t0 + 60_000 }));
    expect(service.state.verticalSpeedFpm).toBe(0);
  });

  it('requests background otherNavigation updates, reports changes and calls onFix with the clock', () => {
    const changes: boolean[] = [];
    const onFix = jest.fn();
    const { source, service } = harness({ clock: () => 42, onFix, onChange: (s) => changes.push(s.gpsAvailable) });
    service.start();
    service.start(); // no-op while tracking
    expect(source.requests).toEqual([{ activity: 'otherNavigation', background: true }]);
    source.emitFix(fix());
    expect(onFix).toHaveBeenCalledWith(42);
    expect(changes).toEqual([true]);
  });

  it('a fix with the stationary flag set keeps it; the next moving fix clears it', () => {
    const { source, service } = harness();
    service.start();
    source.emit({ fix: fix(), stationary: true });
    expect(service.state.gpsStationary).toBe(true);
    source.emitFix(fix());
    expect(service.state.gpsStationary).toBe(false);
  });
});

describe('ownship conversions', () => {
  it('rounds altitude half away from zero, as Swift rounded() does', () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(displayAltitudeFeet(makeFix({ altitudeM: -15 * METERS_PER_FOOT }))).toBe(-20);
  });

  it('VSI differencer ignores samples 0.1 s or less apart and resets', () => {
    const v = new VsiDifferencer();
    expect(v.update(1000, 0)).toBe(0);
    expect(v.update(1010, 100)).toBe(0); // 0.1 s: too close
    expect(v.update(1110, 60_100)).toBeCloseTo(100, 6);
    v.reset();
    expect(v.update(5000, 120_000)).toBe(0);
  });
});
