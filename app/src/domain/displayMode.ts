// Port of efb-212/Core/DisplayMode.swift (mode enum, resolver, solar elevation). Pure math, no platform imports.
// `auto` is offline-safe: with a position it follows the sun (night past civil twilight), without one it follows the
// system appearance. Time is epoch ms.
import { type Coordinate } from './geo';

/** User-selected display mode. Persisted under `DISPLAY_MODE_DEFAULTS_KEY` (UserDefaults key in the Swift app). */
export type DisplayMode = 'day' | 'night' | 'auto';
export const DISPLAY_MODES: readonly DisplayMode[] = ['day', 'night', 'auto'];
export const DISPLAY_MODE_DEFAULTS_KEY = 'displayMode';

export function displayModeTitle(mode: DisplayMode): string {
  switch (mode) {
    case 'day':
      return 'Day';
    case 'night':
      return 'Night';
    case 'auto':
      return 'Auto';
  }
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
/** Swift `truncatingRemainder` is the C fmod, which is JavaScript's `%`. */
const normalizeDegrees = (value: number): number => {
  const r = value % 360;
  return r < 0 ? r + 360 : r;
};

/** CLLocationCoordinate2DIsValid: finite and within [-90, 90] x [-180, 180]. */
const isValidCoordinate = (c: Coordinate): boolean => c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180;

/** Low-precision solar elevation (NOAA simplified algorithm, about 0.5 degree accuracy, no network). */
export const SolarPosition = {
  /** Sun elevation above the horizon in degrees (negative = below the horizon), ignoring refraction. */
  elevationDegrees(coordinate: Coordinate, dateMs: number): number {
    const seconds = dateMs / 1000;
    const julianDay = seconds / 86_400 + 2_440_587.5;
    const t = (julianDay - 2_451_545.0) / 36_525; // Julian centuries since J2000.0

    const meanLongitude = normalizeDegrees(280.46646 + t * (36_000.76983 + t * 0.0003032));
    const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
    const m = toRad(meanAnomaly);
    const equationOfCenter =
      Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
      Math.sin(3 * m) * 0.000289;
    const trueLongitude = meanLongitude + equationOfCenter;
    const omega = toRad(125.04 - 1_934.136 * t);
    const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega);

    const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const obliquity = meanObliquity + 0.00256 * Math.cos(omega);

    const declination = Math.asin(Math.sin(toRad(obliquity)) * Math.sin(toRad(apparentLongitude)));

    // Equation of time in minutes
    const y = Math.tan(toRad(obliquity) / 2) ** 2;
    const l0 = toRad(meanLongitude);
    const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const equationOfTime =
      4 *
      toDeg(
        y * Math.sin(2 * l0) -
          2 * eccentricity * Math.sin(m) +
          4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
          0.5 * y * y * Math.sin(4 * l0) -
          1.25 * eccentricity * eccentricity * Math.sin(2 * m),
      );

    // Minutes past UTC midnight -> true solar time at this longitude
    const utcMinutes = (((seconds % 86_400) + 86_400) % 86_400) / 60;
    const trueSolarMinutes = (utcMinutes + equationOfTime + 4 * coordinate.lon + 1_440) % 1_440;
    let hourAngle = trueSolarMinutes / 4 - 180;
    if (hourAngle < -180) hourAngle += 360;

    const latitude = toRad(coordinate.lat);
    const cosZenith =
      Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(toRad(hourAngle));
    return 90 - toDeg(Math.acos(Math.max(-1, Math.min(1, cosZenith))));
  },
};

export interface IsNightInput {
  mode: DisplayMode;
  /** Current system appearance, used when no position is known. */
  systemIsDark: boolean;
  /** Current ownship position (null before the first fix). */
  coordinate: Coordinate | null;
  /** Evaluation time, epoch ms. */
  date: number;
}

/** Decides whether the night palette is active for a display mode. */
export const DisplayModeResolver = {
  /** Sun elevation below which `auto` switches to night: end of civil twilight. */
  nightSunElevationDegrees: -6,

  isNight({ mode, systemIsDark, coordinate, date }: IsNightInput): boolean {
    switch (mode) {
      case 'day':
        return false;
      case 'night':
        return true;
      case 'auto':
        if (!coordinate || !isValidCoordinate(coordinate)) return systemIsDark;
        return SolarPosition.elevationDegrees(coordinate, date) < DisplayModeResolver.nightSunElevationDegrees;
    }
  },
};

/** Color scheme to force (null = let the system decide). */
export type ColorSchemeOverride = 'light' | 'dark' | null;

/**
 * DisplayModeModifier.scheme: day and night force a scheme; auto follows the sun at ownship once there is a fix
 * (re-evaluated every minute and on position change by the view) and is null (system) before that.
 */
export function colorSchemeFor(mode: DisplayMode, ownship: Coordinate | null, nowMs: number): ColorSchemeOverride {
  switch (mode) {
    case 'day':
      return 'light';
    case 'night':
      return 'dark';
    case 'auto':
      if (!ownship) return null;
      return DisplayModeResolver.isNight({ mode: 'auto', systemIsDark: false, coordinate: ownship, date: nowMs })
        ? 'dark'
        : 'light';
  }
}
