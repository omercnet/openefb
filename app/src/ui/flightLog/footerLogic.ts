// Pure parts of efb-212/Views/Log/FlightLogFooter.swift: ZoomStepper, the static gpsText / gpsTint and the NRST cell
// text (nearestIdent, nearestAccessibilityText).
import type { GpsStatus } from '../../domain/location/gpsStatus';
import type { NearestAirportEntry } from '../columns/nearest/store';
import type { Theme } from '../tokens';
import { printfFixed, threeDigits } from './logic';

/**
 * The zoom level the footer last asked for. The map's zoom updates only after the camera settles (debounced), so two
 * quick taps would otherwise request the same level twice.
 */
export class ZoomStepper {
  static readonly min = 2;
  static readonly max = 18;
  private target: number | null = null;

  /** The level for one tap of `step` from `current` (the camera's last reported zoom), clamped. */
  step(step: number, current: number): number {
    const next = Math.min(Math.max((this.target ?? current) + step, ZoomStepper.min), ZoomStepper.max);
    this.target = next;
    return next;
  }

  /** Forget the pending target once the camera reports a new zoom. */
  reset(): void {
    this.target = null;
  }
}

/** IBM Plex Mono advance width, em (every glyph). */
export const PLEX_ADVANCE = 0.6;

/**
 * SwiftUI lineLimit(1) + minimumScaleFactor(minScale) for monospaced text: the scale at which `glyphs` Plex glyphs of
 * `size` pt fit in `room` pt, never above 1 nor below `minScale`.
 */
export function monoFitScale(glyphs: number, size: number, room: number, minScale: number): number {
  const need = glyphs * PLEX_ADVANCE * size;
  return need > 0 ? Math.max(minScale, Math.min(1, room / need)) : 1;
}

/**
 * Run a map action from a tap. A throw or a rejection (map not ready) must not escape the press handler (fatal in an
 * RN release build); `onFail` undoes what the tap assumed.
 */
export function runMapAction(action: () => void | Promise<void>, onFail: () => void = () => {}): void {
  try {
    const result = action();
    if (result instanceof Promise) result.catch(onFail);
  } catch {
    onFail();
  }
}

/** "GPS 3D", "GPS DEGR", "GPS LOST 14 S". */
export function gpsText(status: GpsStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'GPS 3D';
    case 'degraded':
      return 'GPS DEGR';
    case 'lost':
      return status.ageSeconds === null ? 'GPS LOST' : `GPS LOST ${status.ageSeconds} S`;
  }
}

export function gpsTint(status: GpsStatus, t: Theme): string {
  switch (status.kind) {
    case 'ok':
      return t.ok;
    case 'degraded':
      return t.caution;
    case 'lost':
      return t.warning;
  }
}

/**
 * The entry as the NRST cell reads it. The spoken extras are optional until the Nearest column's entry carries them
 * (NearestAirportEntry in Swift has runwaySummary, isPrivateUse, isMilitary, requiresPPR, isClosedByNotam).
 */
export type NrstEntry = NearestAirportEntry &
  Partial<{
    runwaySummary: string | null;
    isPrivateUse: boolean;
    isMilitary: boolean;
    requiresPPR: boolean;
    isClosedByNotam: boolean;
  }>;

/** String(format: "%.1f NM"), nautical miles. */
export const nrstDistance = (nm: number): string => `${printfFixed(nm, 1)} NM`;
/** String(format: "%03.0f\u00B0"), degrees true. */
export const nrstBearing = (deg: number): string => `${threeDigits(deg)}\u00B0`;

/** `gpsAvailable` false (no fix ever) says NO GPS rather than NONE. */
export function nearestIdent(hasAirportData: boolean, entry: NrstEntry | null, gpsAvailable: boolean): string {
  if (!hasAirportData) return 'NO DATA';
  if (!entry) return gpsAvailable ? 'NONE' : 'NO GPS';
  return entry.airport.icao;
}

export function nearestAccessibilityText(hasAirportData: boolean, entry: NrstEntry | null): string {
  if (!hasAirportData) return 'Nearest airports. No airport data for this region yet.';
  if (!entry) return 'Nearest airports. No landable airport yet.';
  let text = `Nearest airport ${entry.airport.icao}, ${printfFixed(entry.distance, 1)} nautical miles, bearing ${nrstBearing(entry.bearing).slice(0, -1)} degrees`;
  if (entry.runwaySummary) text += `, runway ${entry.runwaySummary}`;
  if (entry.isPrivateUse) text += ', private use';
  if (entry.isMilitary) text += ', military, emergency use only';
  if (entry.requiresPPR) text += ', prior permission required';
  if (entry.isClosedByNotam) text += ', a NOTAM names this field closed';
  return text;
}
