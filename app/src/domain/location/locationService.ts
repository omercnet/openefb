// Ownship tracking. Port of Services/LocationService.swift: consumes a LocationSource, converts fixes to aviation
// units, differences VSI, derives the GPS failure cause, restarts a failed stream with backoff and raises noFixYet
// after a grace period. Swift wrote into AppState; AppState is not ported, so this owns a plain OwnshipState and
// reports every change through onChange (see docs/port-notes/A1.md).
import type { LocationFix, LocationSource, LocationSubscription, LocationUpdate } from '../ports/location';
import { GPS_NO_FIX_GRACE_S, gpsFailureFromFlags, type GpsFailureReason } from './gpsStatus';
import { VsiDifferencer, altitudeFeet, displayAltitudeFeet, speedKnots, trackDegrees } from './ownship';

/** The AppState fields LocationService wrote. Defaults match AppState.swift. */
export interface OwnshipState {
  ownshipPosition: LocationFix | null;
  /** Knots. */
  groundSpeedKt: number;
  /** Feet MSL, rounded to 10. */
  altitudeFt: number;
  /** Feet per minute. */
  verticalSpeedFpm: number;
  /** Degrees true. */
  trackDeg: number;
  gpsAvailable: boolean;
  /** Why no position is coming; null once a fix arrives. */
  gpsFailure: GpsFailureReason | null;
  /** Updates paused while the device is still; the last fix stays valid. */
  gpsStationary: boolean;
  firstLocationReceived: boolean;
}

export function initialOwnshipState(): OwnshipState {
  return {
    ownshipPosition: null,
    groundSpeedKt: 0,
    altitudeFt: 0,
    verticalSpeedFpm: 0,
    trackDeg: 0,
    gpsAvailable: false,
    gpsFailure: null,
    gpsStationary: false,
    firstLocationReceived: false,
  };
}

/** Timer seam so tests can drive time. Defaults to the global timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const globalTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface LocationServiceOptions {
  /** Milliseconds with no fix before noFixYet is raised. */
  noFixGraceMs?: number;
  /** First wait before re-subscribing after a stream failure; doubles per failure, max 30 s. */
  restartBaseDelayMs?: number;
  /** Max restart delay in milliseconds. */
  restartMaxDelayMs?: number;
  /** "Now" for route following; scenario playback and tests accelerate it. Epoch ms. */
  clock?: () => number;
  timers?: Timers;
  /** Called with a fresh copy of the state after every change. */
  onChange?: (state: OwnshipState) => void;
  /** Called after each applied fix with clock(). Swift: appState.updateActiveRouteProgress(now:). */
  onFix?: (nowMs: number) => void;
}

export class LocationService {
  private stateValue: OwnshipState = initialOwnshipState();
  private tracking = false;
  private subscription: LocationSubscription | null = null;
  private noFixTimer: unknown = null;
  private restartTimer: unknown = null;
  private restartAttempt = 0;
  private readonly vsi = new VsiDifferencer();
  private readonly noFixGraceMs: number;
  private readonly restartBaseDelayMs: number;
  private readonly restartMaxDelayMs: number;
  private readonly clock: () => number;
  private readonly timers: Timers;

  constructor(
    private readonly source: LocationSource,
    private readonly options: LocationServiceOptions = {},
  ) {
    this.noFixGraceMs = options.noFixGraceMs ?? GPS_NO_FIX_GRACE_S * 1000;
    this.restartBaseDelayMs = options.restartBaseDelayMs ?? 1000;
    this.restartMaxDelayMs = options.restartMaxDelayMs ?? 30_000;
    this.clock = options.clock ?? Date.now;
    this.timers = options.timers ?? globalTimers;
  }

  get isTracking(): boolean {
    return this.tracking;
  }

  /** A copy of the current state. */
  get state(): OwnshipState {
    return { ...this.stateValue };
  }

  /** Starts tracking (background-capable, per NAV-07). A second start while tracking is a no-op. */
  start(): void {
    if (this.tracking) return;
    this.vsi.reset();
    this.tracking = true;
    this.restartAttempt = 0;
    // Cold start with no fix and no explicit failure: say so after the grace period.
    this.noFixTimer = this.timers.setTimeout(() => {
      this.noFixTimer = null;
      const s = this.stateValue;
      if (!this.tracking || s.firstLocationReceived || s.gpsFailure !== null) return;
      this.patch({ gpsFailure: 'noFixYet' });
    }, this.noFixGraceMs);
    this.subscribe();
  }

  stop(): void {
    this.tracking = false;
    this.subscription?.stop();
    this.subscription = null;
    for (const t of [this.noFixTimer, this.restartTimer]) if (t !== null) this.timers.clearTimeout(t);
    this.noFixTimer = null;
    this.restartTimer = null;
  }

  /** Delay before restart attempt (0-based): base doubling, capped. */
  restartDelayMs(attempt: number): number {
    return Math.min(this.restartBaseDelayMs * 2 ** Math.min(attempt, 5), this.restartMaxDelayMs);
  }

  private subscribe(): void {
    let live = true; // drops anything a source delivers after stop or failure
    const sub = this.source.subscribe(
      { activity: 'otherNavigation', background: true },
      {
        onUpdate: (u) => {
          if (live && this.tracking) this.apply(u);
        },
        onError: () => {
          if (!live) return;
          live = false;
          if (this.tracking) this.handleStreamFailure();
        },
      },
    );
    this.subscription = {
      stop: () => {
        live = false;
        sub.stop();
      },
    };
  }

  /** A failed stream is not terminal: report GPS lost, back off, and subscribe again until stop(). */
  private handleStreamFailure(): void {
    this.subscription = null;
    this.patch({ gpsAvailable: false, gpsFailure: 'streamFailed' });
    const delay = this.restartDelayMs(this.restartAttempt);
    this.restartAttempt += 1;
    this.restartTimer = this.timers.setTimeout(() => {
      this.restartTimer = null;
      if (!this.tracking) return;
      this.vsi.reset(); // a restarted stream has no previous altitude sample
      this.subscribe();
    }, delay);
  }

  private apply(update: LocationUpdate): void {
    const fix = update.fix;
    const stationary = update.stationary ?? false;
    if (!fix) {
      // No position: a stationary notice keeps the last fix; a failure flag means the stream is not usable.
      if (stationary) {
        this.patch({ gpsStationary: true });
        return;
      }
      const reason = gpsFailureFromFlags({
        authorizationDenied: (update.authorizationDenied ?? false) || (update.authorizationDeniedGlobally ?? false),
        authorizationRestricted: update.authorizationRestricted ?? false,
        locationUnavailable: update.locationUnavailable ?? false,
      });
      if (reason) this.patch({ gpsAvailable: false, gpsFailure: reason });
      return;
    }
    this.restartAttempt = 0; // a real fix: the next failure backs off from the start
    const verticalSpeedFpm = this.vsi.update(altitudeFeet(fix), fix.timestampMs);
    this.stateValue = {
      ...this.stateValue,
      ownshipPosition: fix,
      groundSpeedKt: speedKnots(fix),
      altitudeFt: displayAltitudeFeet(fix),
      verticalSpeedFpm,
      trackDeg: trackDegrees(fix),
      gpsAvailable: true,
      gpsFailure: null,
      gpsStationary: stationary,
    };
    this.options.onFix?.(this.clock());
    this.patch({ firstLocationReceived: true });
  }

  private patch(change: Partial<OwnshipState>): void {
    this.stateValue = { ...this.stateValue, ...change };
    this.options.onChange?.(this.state);
  }
}
