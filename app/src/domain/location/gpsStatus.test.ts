// Ported from efb-212Tests/ServiceTests/GPSStatusTests.swift (14 cases) and the "GPS failure reason" suite of
// ServiceTests/MapGPSRecordingFixesTests.swift (4 cases).
import { makeFix } from '../ports/location';
import {
  evaluateGpsStatus,
  gpsFailureFromFlags,
  gpsFailureMessage,
  gpsFailureOffersSettings,
  gpsFailureTitle,
  gpsFixFromLocation,
  gpsStatusAccessibilityDescription,
  gpsStatusLabel,
  isGpsStale,
  type GpsFailureReason,
  type GpsFix,
} from './gpsStatus';

const t0 = 1_800_000_000_000; // epoch ms

function fix({ age = 0, horizontal = 5, vertical = 8, stationary = false } = {}): GpsFix {
  return {
    timestampMs: t0 - age * 1000,
    horizontalAccuracyM: horizontal,
    verticalAccuracyM: vertical,
    isStationary: stationary,
  };
}

describe('GPS status', () => {
  // OK
  it('fresh accurate fix is OK', () => {
    const status = evaluateGpsStatus(fix(), true, t0);
    expect(status).toEqual({ kind: 'ok' });
    expect(isGpsStale(status)).toBe(false);
    expect(gpsStatusLabel(status)).toBe('GPS OK');
  });

  it('fix at exactly five seconds is still OK', () => {
    expect(evaluateGpsStatus(fix({ age: 5 }), true, t0)).toEqual({ kind: 'ok' });
  });

  it('accuracy at limit is OK', () => {
    expect(evaluateGpsStatus(fix({ horizontal: 50 }), true, t0)).toEqual({ kind: 'ok' });
  });

  // Degraded
  it('missing altitude is degraded', () => {
    const status = evaluateGpsStatus(fix({ vertical: -1 }), true, t0);
    expect(status).toEqual({ kind: 'degraded', reason: { kind: 'noAltitude' } });
    expect(isGpsStale(status)).toBe(false);
    expect(gpsStatusLabel(status)).toBe('GPS DEGR');
  });

  it('poor horizontal accuracy is degraded', () => {
    expect(evaluateGpsStatus(fix({ horizontal: 65 }), true, t0)).toEqual({
      kind: 'degraded',
      reason: { kind: 'poorHorizontalAccuracy', meters: 65 },
    });
  });

  it('invalid horizontal accuracy is degraded', () => {
    expect(evaluateGpsStatus(fix({ horizontal: -1 }), true, t0)).toEqual({
      kind: 'degraded',
      reason: { kind: 'poorHorizontalAccuracy', meters: -1 },
    });
  });

  it('no altitude takes precedence over poor accuracy', () => {
    expect(evaluateGpsStatus(fix({ horizontal: 100, vertical: -1 }), true, t0)).toEqual({
      kind: 'degraded',
      reason: { kind: 'noAltitude' },
    });
  });

  // Lost
  it('no fix ever is lost without age', () => {
    const status = evaluateGpsStatus(null, true, t0);
    expect(status).toEqual({ kind: 'lost', ageSeconds: null });
    expect(isGpsStale(status)).toBe(true);
    expect(gpsStatusLabel(status)).toBe('GPS LOST');
  });

  it('stream failure is lost even with a recent fix', () => {
    expect(evaluateGpsStatus(fix(), false, t0)).toEqual({ kind: 'lost', ageSeconds: null });
  });

  it('stale fix is lost with age in seconds', () => {
    const status = evaluateGpsStatus(fix({ age: 12.7 }), true, t0);
    expect(status).toEqual({ kind: 'lost', ageSeconds: 12 });
    expect(isGpsStale(status)).toBe(true);
    expect(gpsStatusLabel(status)).toBe('GPS LOST 12s');
  });

  it('stale overrides degraded', () => {
    expect(evaluateGpsStatus(fix({ age: 30, vertical: -1 }), true, t0)).toEqual({ kind: 'lost', ageSeconds: 30 });
  });

  it('stationary fix does not age out', () => {
    // Updates pause while parked; the last fix stays valid.
    expect(evaluateGpsStatus(fix({ age: 120, stationary: true }), true, t0)).toEqual({ kind: 'ok' });
  });

  // Transition sequence
  it('OK then degraded then lost as the same fix ages', () => {
    const noAlt = fix({ vertical: -1 });
    expect(evaluateGpsStatus(fix(), true, t0)).toEqual({ kind: 'ok' });
    expect(evaluateGpsStatus(noAlt, true, t0 + 2000)).toEqual({ kind: 'degraded', reason: { kind: 'noAltitude' } });
    expect(evaluateGpsStatus(noAlt, true, t0 + 6000)).toEqual({ kind: 'lost', ageSeconds: 6 });
  });

  it('GPS fix from a location fix copies accuracies', () => {
    const g = gpsFixFromLocation(
      makeFix({ altitudeM: 2, horizontalAccuracyM: 12, verticalAccuracyM: -1, timestampMs: t0 }),
    );
    expect(g).toEqual({ timestampMs: t0, horizontalAccuracyM: 12, verticalAccuracyM: -1, isStationary: false });
    expect(evaluateGpsStatus(g, true, t0)).toEqual({ kind: 'degraded', reason: { kind: 'noAltitude' } });
  });

  // New in TS: the accessibility strings had no Swift test.
  it('accessibility descriptions', () => {
    expect(gpsStatusAccessibilityDescription({ kind: 'ok' })).toBe('GPS OK');
    expect(gpsStatusAccessibilityDescription({ kind: 'degraded', reason: { kind: 'noAltitude' } })).toBe(
      'GPS degraded, no altitude',
    );
    expect(
      gpsStatusAccessibilityDescription({ kind: 'degraded', reason: { kind: 'poorHorizontalAccuracy', meters: 65.9 } }),
    ).toBe('GPS degraded, accuracy 65 meters');
    expect(gpsStatusAccessibilityDescription({ kind: 'lost', ageSeconds: null })).toBe('GPS lost, no fix');
    expect(gpsStatusAccessibilityDescription({ kind: 'lost', ageSeconds: 7 })).toBe('GPS lost, last fix 7 seconds ago');
  });
});

describe('GPS failure reason', () => {
  const flags = (authorizationDenied: boolean, authorizationRestricted: boolean, locationUnavailable: boolean) => ({
    authorizationDenied,
    authorizationRestricted,
    locationUnavailable,
  });

  it('denied wins over unavailable', () => {
    expect(gpsFailureFromFlags(flags(true, false, true))).toBe('authorizationDenied');
  });

  it('restricted and unavailable are distinct', () => {
    expect(gpsFailureFromFlags(flags(false, true, false))).toBe('authorizationRestricted');
    expect(gpsFailureFromFlags(flags(false, false, true))).toBe('locationUnavailable');
  });

  it('no flags means no explanation', () => {
    expect(gpsFailureFromFlags(flags(false, false, false))).toBeNull();
  });

  it('only denial offers open Settings', () => {
    expect(gpsFailureOffersSettings('authorizationDenied')).toBe(true);
    const others: GpsFailureReason[] = ['authorizationRestricted', 'locationUnavailable', 'noFixYet', 'streamFailed'];
    for (const reason of others) expect(gpsFailureOffersSettings(reason)).toBe(false);
  });

  // New in TS: every reason has its own title and message (Swift strings verbatim).
  it('every reason has a distinct title and message', () => {
    const all: GpsFailureReason[] = [
      'authorizationDenied',
      'authorizationRestricted',
      'locationUnavailable',
      'noFixYet',
      'streamFailed',
    ];
    expect(new Set(all.map(gpsFailureTitle)).size).toBe(all.length);
    expect(new Set(all.map(gpsFailureMessage)).size).toBe(all.length);
    expect(gpsFailureTitle('noFixYet')).toBe('Waiting for a GPS fix');
    expect(gpsFailureMessage('authorizationDenied')).toContain('Settings \u203A Privacy & Security');
  });
});
