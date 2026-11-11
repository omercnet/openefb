// Port for device position updates. Replaces CLLocationUpdate.liveUpdates and the LocationUpdateSnapshot seam of
// Services/LocationService.swift and Services/Recording/TrackRecorder.swift. Units follow CoreLocation: meters,
// meters per second, degrees true, and negative accuracy/speed/course mean "invalid".

/** One position fix. Replaces CLLocation (only the fields the app reads). */
export interface LocationFix {
  /** Degrees, WGS84. */
  lat: number;
  lon: number;
  /** Meters MSL. Meaningless when verticalAccuracyM is negative. */
  altitudeM: number;
  /** Meters; negative = invalid. */
  horizontalAccuracyM: number;
  /** Meters; negative = no altitude (Wi-Fi-only fix). */
  verticalAccuracyM: number;
  /** Meters per second; negative = invalid. */
  speedMps: number;
  /** Degrees true; negative = invalid. */
  courseDeg: number;
  /** Fix time, epoch milliseconds (the fix's own time, not arrival time). */
  timestampMs: number;
}

/** One update from the source. Mirrors LocationUpdateSnapshot: a fix, or flags explaining why there is none. */
export interface LocationUpdate {
  fix: LocationFix | null;
  /** The device is stationary and updates are paused; the last fix stays valid. */
  stationary?: boolean;
  /** Location access denied for this app. */
  authorizationDenied?: boolean;
  /** Location Services off device-wide. */
  authorizationDeniedGlobally?: boolean;
  /** Access blocked by restrictions (parental controls, MDM). */
  authorizationRestricted?: boolean;
  /** Access granted but no position source. */
  locationUnavailable?: boolean;
}

/**
 * Activity hint. Swift asked CoreLocation for .otherNavigation (moving map) and .airborne (track recording).
 * Platforms without the hint ignore it.
 */
export type LocationActivity = 'otherNavigation' | 'airborne';

export interface LocationRequest {
  activity: LocationActivity;
  /** Keep delivering while the app is in the background (CLBackgroundActivitySession in Swift). */
  background: boolean;
}

export interface LocationListener {
  onUpdate(update: LocationUpdate): void;
  /** The stream failed and delivers nothing more. Swift: the AsyncThrowingStream threw. Subscribe again to retry. */
  onError(error: Error): void;
}

export interface LocationSubscription {
  /** Stops delivery. Idempotent. No listener call happens after it returns. */
  stop(): void;
}

export type LocationPermissionScope = 'foreground' | 'background';

export interface LocationPermission {
  granted: boolean;
  /** False when the OS will not prompt again (denied or restricted): only Settings can change it. */
  canAskAgain: boolean;
}

export interface LocationSource {
  /** Starts updates and delivers them to listener until stop() or onError. */
  subscribe(request: LocationRequest, listener: LocationListener): LocationSubscription;
  /** Asks for permission (prompts when the OS allows it). */
  requestPermission(scope: LocationPermissionScope): Promise<LocationPermission>;
}

/** Scriptable LocationSource for tests: push updates and failures to every live subscriber. */
export class FakeLocationSource implements LocationSource {
  /** Every subscribe call, in order, with its request. */
  readonly requests: LocationRequest[] = [];
  permission: LocationPermission = { granted: true, canAskAgain: true };
  private readonly live = new Set<LocationListener>();

  subscribe(request: LocationRequest, listener: LocationListener): LocationSubscription {
    this.requests.push(request);
    this.live.add(listener);
    return { stop: () => void this.live.delete(listener) };
  }

  requestPermission(): Promise<LocationPermission> {
    return Promise.resolve(this.permission);
  }

  /** Number of subscribers that have not stopped or failed. */
  get subscriberCount(): number {
    return this.live.size;
  }

  /** Delivers update to every live subscriber. */
  emit(update: LocationUpdate): void {
    for (const l of [...this.live]) l.onUpdate(update);
  }

  /** Delivers a fix (shorthand for emit({ fix })). */
  emitFix(fix: LocationFix): void {
    this.emit({ fix });
  }

  /** Fails every live subscriber; they receive nothing more. */
  fail(error: Error = new Error('location stream failed')): void {
    const listeners = [...this.live];
    this.live.clear();
    for (const l of listeners) l.onError(error);
  }
}

/** A valid fix with defaults; override any field. Test helper shared by the location suites. */
export function makeFix(overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    lat: 37.4611,
    lon: -122.115,
    altitudeM: 100,
    horizontalAccuracyM: 5,
    verticalAccuracyM: 8,
    speedMps: 0,
    courseDeg: 0,
    timestampMs: 1_800_000_000_000,
    ...overrides,
  };
}
