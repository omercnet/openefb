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

/** Greedy word wrap of monospaced text at `perLine` glyphs; a word longer than a line is broken (as Core Text does). */
export function wrapMono(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((w) => w.length > 0)) {
    if (word.length > perLine) {
      if (line) lines.push(line);
      let rest = word;
      while (rest.length > perLine) {
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      line = rest;
    } else if (!line) line = word;
    else if (line.length + 1 + word.length <= perLine) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * SwiftUI lineLimit(maxLines) + minimumScaleFactor(minScale) for monospaced text: wrapped at full size when the lines
 * fit, otherwise shrunk to the largest scale at which they do, never below `minScale`. Text that does not fit even then
 * keeps `maxLines` lines at `minScale` with the last one cut by an ellipsis (SwiftUI's tail truncation).
 */
export function monoWrapFit(
  text: string,
  size: number,
  room: number,
  maxLines: number,
  minScale: number,
): { scale: number; lines: string[] } {
  const advance = PLEX_ADVANCE * size; // points per glyph at full size
  // 1e-9: a line that fills the room exactly fits (no floating-point shortfall).
  const perLine = (scale: number) => Math.floor(room / (advance * scale) + 1e-9);
  // More glyphs per line means a smaller scale: the first count whose lines fit is the largest scale.
  const most = perLine(minScale);
  if (most < 1) return { scale: minScale, lines: [text] };
  for (let glyphs = Math.max(1, perLine(1)); glyphs <= most; glyphs++) {
    const lines = wrapMono(text, glyphs);
    if (lines.length <= maxLines) return { scale: Math.min(1, room / (glyphs * advance)), lines };
  }
  const lines = wrapMono(text, most);
  const kept = lines.slice(0, maxLines - 1);
  const last = lines.slice(maxLines - 1).join(' ');
  return { scale: minScale, lines: [...kept, `${last.slice(0, most - 1)}\u2026`] };
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
