// Position quality for the GPS status chip and stale-ownship greying. Port of Services/GPSStatus.swift: pure logic
// evaluated against a clock so the age of the last fix is testable without a device.
import type { LocationFix } from '../ports/location';

/** The parts of a fix that matter for position quality. */
export interface GpsFix {
  /** Epoch milliseconds. */
  timestampMs: number;
  /** Meters; negative = invalid. */
  horizontalAccuracyM: number;
  /** Meters; negative = no altitude. */
  verticalAccuracyM: number;
  /** Updates paused while stationary: the fix stays valid, so age does not count against it. */
  isStationary: boolean;
}

export function gpsFixFromLocation(fix: LocationFix, isStationary = false): GpsFix {
  return {
    timestampMs: fix.timestampMs,
    horizontalAccuracyM: fix.horizontalAccuracyM,
    verticalAccuracyM: fix.verticalAccuracyM,
    isStationary,
  };
}

export type GpsDegradedReason = { kind: 'noAltitude' } | { kind: 'poorHorizontalAccuracy'; meters: number };

export type GpsStatus =
  /** Fresh fix with altitude and acceptable horizontal accuracy. */
  | { kind: 'ok' }
  /** Fresh fix, but missing altitude or horizontal accuracy worse than the limit. */
  | { kind: 'degraded'; reason: GpsDegradedReason }
  /** No fix, or the last fix is older than GPS_STALE_AFTER_S. ageSeconds is null when no fix was ever received. */
  | { kind: 'lost'; ageSeconds: number | null };

/** A fix older than this (seconds) is lost and the ownship/instruments grey out. */
export const GPS_STALE_AFTER_S = 5;
/** Horizontal accuracy worse than this (meters) is degraded (Wi-Fi-only iPads sit around 65 m). */
export const GPS_MAX_HORIZONTAL_ACCURACY_M = 50;

/** Evaluate position quality at nowMs. gpsAvailable false means the stream itself failed (denied, errored). */
export function evaluateGpsStatus(fix: GpsFix | null, gpsAvailable: boolean, nowMs: number): GpsStatus {
  if (!gpsAvailable || !fix) return { kind: 'lost', ageSeconds: null };
  const age = (nowMs - fix.timestampMs) / 1000; // seconds
  if (age > GPS_STALE_AFTER_S && !fix.isStationary) return { kind: 'lost', ageSeconds: Math.floor(age) };
  if (fix.verticalAccuracyM < 0) return { kind: 'degraded', reason: { kind: 'noAltitude' } };
  if (fix.horizontalAccuracyM < 0 || fix.horizontalAccuracyM > GPS_MAX_HORIZONTAL_ACCURACY_M) {
    return { kind: 'degraded', reason: { kind: 'poorHorizontalAccuracy', meters: fix.horizontalAccuracyM } };
  }
  return { kind: 'ok' };
}

/** True when the ownship chevron and instrument values must be greyed out. */
export function isGpsStale(status: GpsStatus): boolean {
  return status.kind === 'lost';
}

/** Chip text. The age is shown so the pilot knows how old the last position is. */
export function gpsStatusLabel(status: GpsStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'GPS OK';
    case 'degraded':
      return 'GPS DEGR';
    case 'lost':
      return status.ageSeconds === null ? 'GPS LOST' : `GPS LOST ${status.ageSeconds}s`;
  }
}

/** Spoken description for accessibility. */
export function gpsStatusAccessibilityDescription(status: GpsStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'GPS OK';
    case 'degraded':
      return status.reason.kind === 'noAltitude'
        ? 'GPS degraded, no altitude'
        : `GPS degraded, accuracy ${Math.trunc(status.reason.meters)} meters`;
    case 'lost':
      return status.ageSeconds === null ? 'GPS lost, no fix' : `GPS lost, last fix ${status.ageSeconds} seconds ago`;
  }
}

/** Why the source is not delivering a usable position. Names the cause and, when the pilot can fix it, Settings. */
export type GpsFailureReason =
  'authorizationDenied' | 'authorizationRestricted' | 'locationUnavailable' | 'noFixYet' | 'streamFailed';

/** Seconds after tracking starts, with no fix, before noFixYet is shown. */
export const GPS_NO_FIX_GRACE_S = 15;

/** Map the flags of an update that carried no position. null when no flag explains it (e.g. a stationary notice). */
export function gpsFailureFromFlags(flags: {
  authorizationDenied: boolean;
  authorizationRestricted: boolean;
  locationUnavailable: boolean;
}): GpsFailureReason | null {
  if (flags.authorizationDenied) return 'authorizationDenied';
  if (flags.authorizationRestricted) return 'authorizationRestricted';
  if (flags.locationUnavailable) return 'locationUnavailable';
  return null;
}

const FAILURE_TEXT: Record<GpsFailureReason, { title: string; message: string }> = {
  authorizationDenied: {
    title: 'Location access is off',
    message:
      'The moving map, NRST and recording need your position. Allow Location for Kanaf in Settings \u203A Privacy & Security \u203A Location Services.',
  },
  authorizationRestricted: {
    title: 'Location access is restricted',
    message: 'Location is blocked by a restriction on this iPad (Screen Time or device management).',
  },
  locationUnavailable: {
    title: 'No position source',
    message:
      'No GPS receiver is answering. Wi-Fi-only iPads have no GPS: connect an external GPS, or check Airplane Mode.',
  },
  noFixYet: {
    title: 'Waiting for a GPS fix',
    message:
      'No position yet. Outdoors a fix takes under a minute; a Wi-Fi-only iPad has no GPS and needs an external receiver.',
  },
  streamFailed: {
    title: 'GPS stopped',
    message: 'Position updates ended unexpectedly. Relaunch Kanaf; if it repeats, check Location in Settings.',
  },
};

export function gpsFailureTitle(reason: GpsFailureReason): string {
  return FAILURE_TEXT[reason].title;
}

export function gpsFailureMessage(reason: GpsFailureReason): string {
  return FAILURE_TEXT[reason].message;
}

/** Only a denial can be fixed in Settings. Restricted and hardware causes cannot. */
export function gpsFailureOffersSettings(reason: GpsFailureReason): boolean {
  return reason === 'authorizationDenied';
}
