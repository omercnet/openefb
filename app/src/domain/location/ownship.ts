// Aviation-unit conversion of a fix and the vertical speed differencer of Services/LocationService.swift.
import type { LocationFix } from '../ports/location';

export const KNOTS_PER_MPS = 1.94384;
export const METERS_PER_FOOT = 0.3048;

/** Swift Double.rounded(): half away from zero. Math.round rounds -0.5 toward +infinity. */
export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Ground speed in knots; an invalid (negative) speed reads 0. */
export function speedKnots(fix: LocationFix): number {
  return Math.max(0, fix.speedMps * KNOTS_PER_MPS);
}

/** Altitude in feet MSL, unrounded. */
export function altitudeFeet(fix: LocationFix): number {
  return fix.altitudeM / METERS_PER_FOOT;
}

/** Track in degrees true; an invalid (negative) course reads 0. */
export function trackDegrees(fix: LocationFix): number {
  return fix.courseDeg >= 0 ? fix.courseDeg : 0;
}

/** Display altitude: feet MSL rounded to the nearest 10 ft. */
export function displayAltitudeFeet(fix: LocationFix): number {
  return roundHalfAwayFromZero(altitudeFeet(fix) / 10) * 10;
}

/**
 * Vertical speed (feet per minute) from successive altitude samples, differenced over the fixes' own timestamps so
 * delayed or batched delivery does not distort it. Unsmoothed, as the moving-map instrument strip shows it. Out-of-order
 * or near-identical timestamps (<= 0.1 s apart) give 0.
 */
export class VsiDifferencer {
  private previous: { altitudeFt: number; timeMs: number } | null = null;

  /** Feed one sample; returns fpm (0 for the first sample). */
  update(altitudeFt: number, timeMs: number): number {
    let vsi = 0;
    if (this.previous) {
      const dt = (timeMs - this.previous.timeMs) / 1000; // seconds
      if (dt > 0.1) vsi = ((altitudeFt - this.previous.altitudeFt) / dt) * 60;
    }
    this.previous = { altitudeFt, timeMs };
    return vsi;
  }

  /** Forget the previous sample (new or restarted stream). */
  reset(): void {
    this.previous = null;
  }
}
