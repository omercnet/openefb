// Port of Services/IsraelAlertEvaluator.swift: pure evaluators behind the Israel in-flight alerts. Closed legs ahead,
// P/R/D areas and CTRs on the 2-minute projected track, the border buffers and the CVFR squawk reminder. No state, no
// clock, no I/O: positions, altitude and `now` come in, alerts go out.
// Colours: 'warning' = red, 'caution' = amber, nothing else.
// Units: degrees WGS-84, nautical miles, feet MSL, knots, seconds (times are epoch ms).
import {
  airspaceContainsAltitude,
  airspaceContainsLaterally,
  type IsraelAerodrome,
  type IsraelAirspace,
} from '../../data/aviation/israelTypes';
import type { Coordinate } from '../core/geometry';
import { distanceNmToRing } from '../core/polygon';
import type { ActiveRoute } from '../route/activeRoute';
import { limitsText as chartLimitsText, type IsraelChartClosureMark } from './l3bStandIns';
import { crossTrack } from './routeFollowing';
export type { IsraelChartClosureMark } from './l3bStandIns';

// MARK: - Alert model

export type IsraelAlertSeverity = 'caution' | 'warning';
const SEVERITY_RANK: Record<IsraelAlertSeverity, number> = { caution: 1, warning: 2 };

/** Display order inside one severity: earlier first. */
export type IsraelAlertKind = 'border' | 'prohibited' | 'closure' | 'restricted' | 'ctr' | 'northOf33' | 'squawk';
const KIND_RANK: Record<IsraelAlertKind, number> = {
  border: 0,
  prohibited: 1,
  closure: 2,
  restricted: 3,
  ctr: 4,
  northOf33: 5,
  squawk: 6,
};

export interface IsraelAlert {
  id: string;
  severity: IsraelAlertSeverity;
  kind: IsraelAlertKind;
  /** One short line: "Inside Gaza border buffer". */
  title: string;
  /** Optional second line: the data or the action. */
  detail: string | null;
}

/** Highest priority first: red before amber, then the kind order, then the id (a stable tiebreak). Returns a copy. */
export function sortAlerts(alerts: readonly IsraelAlert[]): IsraelAlert[] {
  return [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

// MARK: - Border buffers

/**
 * The border lines the buffers are built from: Natural Earth 1:10m admin-0 boundary lines (public domain), plus the
 * Gaza buffer from the CAAI P-area LLP19 polygon. Accurate to about 1 km; the alert text never claims more.
 */
export interface IsraelBorder {
  /** "Egypt" */
  name: string;
  /** kilometres either side of the line */
  bufferKm: number;
  /** [line][vertex][lat, lon] */
  lines: number[][][];
}

export interface IsraelBorderBuffers {
  source: string;
  borders: IsraelBorder[];
}

export const borderBufferNM = (border: IsraelBorder): number => border.bufferKm / 1.852;

/** Gaza Strip buffer: CAAI P-area LLP19 itself, which is published as the no-flight area. */
export const GAZA_AREA_CODE = 'LLP19';
export const GAZA_BUFFER_KM = 6.0;
/** Bundled resource name (israel-border-lines.json); loading it is the platform adapter's job. */
export const BORDER_LINES_RESOURCE_NAME = 'israel-border-lines';

const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');

/**
 * Swift IsraelBorderBuffers(data:): decodes israel-border-lines.json. Throws on malformed JSON or a field of the wrong
 * type (Swift JSONDecoder does the same); extra keys such as `accuracy` are ignored.
 */
export function parseBorderBuffers(json: string): IsraelBorderBuffers {
  const file: unknown = JSON.parse(json);
  if (typeof file !== 'object' || file === null || !('source' in file) || !('borders' in file)) {
    throw new Error('israel-border-lines: missing source or borders');
  }
  const { source, borders } = file;
  if (typeof source !== 'string' || !Array.isArray(borders))
    throw new Error('israel-border-lines: bad source or borders');
  return {
    source,
    borders: borders.map((b: unknown, index): IsraelBorder => {
      if (typeof b !== 'object' || b === null || !('name' in b) || !('bufferKm' in b) || !('lines' in b)) {
        throw new Error(`israel-border-lines: border ${index} incomplete`);
      }
      const { name, bufferKm, lines } = b;
      if (
        typeof name !== 'string' ||
        typeof bufferKm !== 'number' ||
        !Array.isArray(lines) ||
        !lines.every((line: unknown) => Array.isArray(line) && line.every(isNumberArray))
      ) {
        throw new Error(`israel-border-lines: border ${index} malformed`);
      }
      // JS-only guard: a line needs two vertices of [lat, lon], or it can never produce a distance (silent no-alert).
      if (
        !lines.every(
          (line: number[][]) => line.length >= 2 && line.every((v) => v.length >= 2 && v.every(Number.isFinite)),
        )
      ) {
        throw new Error(`israel-border-lines: border ${index} malformed`);
      }
      return { name, bufferKm, lines: lines as number[][][] };
    }),
  };
}

// MARK: - Evaluator

/** Projection distance for "entering": 2 minutes ahead of the current track (seconds). */
export const PROJECTION_SECONDS = 120;
/** Below this ground speed the track is not trustworthy and nothing is projected (knots). */
export const MINIMUM_PROJECTION_SPEED_KNOTS = 20.0;
/** Caution distance outside a border buffer (NM). */
export const BORDER_CAUTION_MARGIN_NM = 1.0;
/** Latitude north of which two-way radio and a working transponder are required (degrees north, A-17 §4a). */
export const NORTHERN_LIMIT_LATITUDE = 33.0;

/** The position `seconds` ahead on the current track at the current ground speed; null when too slow to project. */
export function projectedPosition(
  position: Coordinate,
  trackTrue: number,
  groundSpeedKnots: number,
  seconds: number = PROJECTION_SECONDS,
): Coordinate | null {
  if (!(groundSpeedKnots >= MINIMUM_PROJECTION_SPEED_KNOTS && trackTrue >= 0)) return null;
  const distanceNM = (groundSpeedKnots * seconds) / 3600;
  const radians = (trackTrue * Math.PI) / 180;
  const lat = position.lat + (Math.cos(radians) * distanceNM) / 60;
  const cosLat = Math.max(0.01, Math.cos((position.lat * Math.PI) / 180));
  const lon = position.lon + (Math.sin(radians) * distanceNM) / (60 * cosLat);
  return { lat, lon };
}

// MARK: Closed legs ahead

/**
 * Closures on the current leg and the legs after it. Full = red, partial and unread = amber. One alert per leg and
 * NOTAM. `marks` (by segment id) is empty for a stale feed, so an old closure never reads as current.
 */
export function closureAlerts(
  route: ActiveRoute | null,
  marks: ReadonlyMap<number, IsraelChartClosureMark>,
): IsraelAlert[] {
  if (route === null || marks.size === 0) return [];
  const alerts: IsraelAlert[] = [];
  // Swift traps when currentLeg > legs.count (invalid range); here the loop simply does not run.
  for (let index = Math.max(0, route.currentLeg); index < route.legs.length; index += 1) {
    const leg = route.legs[index];
    const mark = leg.segmentID !== 0 ? marks.get(leg.segmentID) : undefined;
    if (mark === undefined) continue;
    const label = `${leg.fromCode} \u2192 ${leg.toCode}`;
    const id = `closure-${mark.notamID}-${leg.segmentID}`;
    switch (mark.severity) {
      case 'full':
        alerts.push({
          id,
          severity: 'warning',
          kind: 'closure',
          title: `Route closed ahead: ${label}`,
          detail: `${mark.text} \u00B7 NOTAM ${mark.notamID}`,
        });
        break;
      case 'partial':
        alerts.push({
          id,
          severity: 'caution',
          kind: 'closure',
          title: `Route partly closed ahead: ${label}`,
          detail: `${mark.text} \u00B7 NOTAM ${mark.notamID}`,
        });
        break;
      case 'check':
        alerts.push({
          id,
          severity: 'caution',
          kind: 'closure',
          title: `Check NOTAM for ${label}`,
          detail: `NOTAM ${mark.notamID} could not be read in full`,
        });
        break;
    }
  }
  return alerts;
}

// MARK: P / R / D areas and CTRs

/** Name and tower line ("TWR 122.2") of a CTR's aerodrome. */
export interface CtrContact {
  name: string;
  twr: string | null;
}

export interface AirspaceAlertInput {
  position: Coordinate;
  /** feet MSL; null without a vertical fix */
  altitudeFeet: number | null;
  /** degrees true */
  trackTrue: number;
  /** knots */
  groundSpeedKnots: number;
  airspaces: readonly IsraelAirspace[];
  /** Contact for a CTR code when the aerodrome table knows it; default knows none. */
  ctrContact?: (code: string) => CtrContact | null;
}

/**
 * Alerts for the P/R/D areas and CTRs around the aircraft.
 * - Inside a prohibited area (lateral and vertical): red. Projected into one: amber.
 * - Restricted / danger / CTR: amber, inside or projected. A CTR alert is a reminder: clearance is unknown.
 * - Unknown altitude never produces a red inside alert.
 */
export function airspaceAlerts(input: AirspaceAlertInput): IsraelAlert[] {
  const { position, altitudeFeet, trackTrue, groundSpeedKnots, airspaces } = input;
  const ctrContact = input.ctrContact ?? (() => null);
  const ahead = projectedPosition(position, trackTrue, groundSpeedKnots);
  const alerts: IsraelAlert[] = [];
  for (const area of airspaces) {
    // The Gaza buffer is raised by the border evaluator (one alert, not two).
    if (area.code === GAZA_AREA_CODE) continue;
    if (area.kind !== 'P' && area.kind !== 'R' && area.kind !== 'D' && area.kind !== 'CTR') continue;

    const lateralNow = airspaceContainsLaterally(area, position);
    const lateralAhead = ahead !== null && airspaceContainsLaterally(area, ahead);
    if (!lateralNow && !lateralAhead) continue;
    // Vertical: compared at the current altitude (the projection keeps level flight). Unknown = may apply.
    const verticalKnown = altitudeFeet !== null;
    const withinVertical = altitudeFeet === null || airspaceContainsAltitude(area, altitudeFeet);
    if (!withinVertical) continue;

    const inside = lateralNow && verticalKnown;
    const limits = airspaceLimitsText(area);
    const name = area.nameEnglish ?? area.code ?? 'area';
    const code = area.code ?? 'area';
    const milSuffix = area.authority === 'military' ? ' \u00B7 MIL' : '';
    const id = `area-${area.id}`;

    switch (area.kind) {
      case 'P': {
        const where = inside ? 'Inside' : lateralNow ? 'Near' : 'Entering';
        alerts.push({
          id,
          severity: inside ? 'warning' : 'caution',
          kind: 'prohibited',
          title: `${where} prohibited area ${code} ${name}`,
          detail: limits + milSuffix,
        });
        break;
      }
      case 'R':
      case 'D': {
        const word = area.kind === 'R' ? 'restricted' : 'danger';
        const verb = lateralNow ? 'Inside' : 'Entering';
        alerts.push({
          id,
          severity: 'caution',
          kind: 'restricted',
          title: `${verb} ${word} area ${code} ${name}`,
          detail: limits + milSuffix,
        });
        break;
      }
      case 'CTR': {
        const contact = area.code === null ? null : ctrContact(area.code);
        const ctrName = contact?.name ?? area.nameEnglish ?? area.code ?? 'CTR';
        let title = `${lateralNow ? 'In' : 'Entering'} ${ctrName} CTR`;
        title += contact !== null && contact.twr !== null ? `: contact ${contact.twr}` : ': get clearance';
        alerts.push({ id, severity: 'caution', kind: 'ctr', title, detail: limits + milSuffix });
        break;
      }
    }
  }
  return alerts;
}

/** "SFC–3000 FT": the chart's own limits text. " FT" alone when neither limit is published (Swift parity). */
export const airspaceLimitsText = (area: IsraelAirspace): string => `${chartLimitsText(area.floor, area.ceiling)} FT`;

/** Swift trimmingCharacters(in: .whitespaces): spaces (Unicode Zs) and tab, not newlines. */
const trimWhitespaces = (text: string): string => text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '');

/** "Herzliya (Modi Alon) Airport" -> "Herzliya": the pilot says the town, not the register entry. */
export function shortAerodromeName(name: string): string {
  let short = name;
  const paren = short.indexOf('(');
  if (paren >= 0) short = short.slice(0, paren);
  // Each suffix is tested against the result of the previous ones, in this order (Swift `for ... where`).
  for (const suffix of [' Airport', ' Airfield', ' Airstrip', ' Aerodrome']) {
    const trimmed = trimWhitespaces(short);
    if (trimmed.endsWith(suffix)) short = trimmed.slice(0, trimmed.length - suffix.length);
  }
  const trimmed = trimWhitespaces(short);
  return trimmed === '' ? name : trimmed;
}

/** "122.200" -> "TWR 122.2" for the first tower frequency; null without one. */
export function towerContact(aerodrome: IsraelAerodrome): string | null {
  const tower = aerodrome.frequencies.find((f) => f.service.toUpperCase().startsWith('TWR'));
  if (tower === undefined) return null;
  let mhz = tower.mhz;
  if (mhz.includes('.')) {
    while (mhz.endsWith('0')) mhz = mhz.slice(0, -1);
    if (mhz.endsWith('.')) mhz = mhz.slice(0, -1);
  }
  return `TWR ${mhz}`;
}

// MARK: Border buffers

/**
 * printf("%.1f"): JS toFixed rounds exact binary ties (x.25, x.75) up, C rounds them half to even. Only multiples of
 * 0.25 can be exact ties at one decimal.
 */
export function formatOneDecimal(x: number): string {
  const quarters = x * 4;
  if (Number.isFinite(x) && Number.isInteger(quarters) && quarters % 2 !== 0) {
    const tenths = Math.floor(x * 10); // exact for these values
    const rounded = tenths % 2 === 0 ? tenths : tenths + 1;
    return (rounded / 10).toFixed(1);
  }
  return x.toFixed(1);
}

export interface BorderAlertInput {
  position: Coordinate;
  trackTrue: number;
  groundSpeedKnots: number;
  buffers: IsraelBorderBuffers | null;
  /** Outer rings of CAAI LLP19 as [lat, lon] vertices. */
  gazaRings: readonly number[][][];
}

const minOrNull = (values: readonly number[]): number | null => (values.length === 0 ? null : Math.min(...values));

/**
 * Border buffer alerts: red inside a buffer, amber within 1 NM of one or when the 2-minute projection enters it, plus
 * the 33°00'N reminder (amber: allowed with two-way radio and a working transponder).
 */
export function borderAlerts(input: BorderAlertInput): IsraelAlert[] {
  const { position, trackTrue, groundSpeedKnots, buffers, gazaRings } = input;
  const ahead = projectedPosition(position, trackTrue, groundSpeedKnots);
  const alerts: IsraelAlert[] = [];
  const accuracy = 'Border from public-domain data, about 1 km accurate';

  const raise = (
    name: string,
    bufferKm: number,
    distanceNM: number | null,
    aheadNM: number | null,
    bufferNM: number,
  ) => {
    if (distanceNM === null) return;
    const id = `border-${name}`;
    if (distanceNM <= bufferNM) {
      alerts.push({
        id,
        severity: 'warning',
        kind: 'border',
        title: `Inside ${name} border buffer (${Math.trunc(bufferKm)} km)`,
        detail: `No flight allowed \u00B7 ${accuracy}`,
      });
    } else if (aheadNM !== null && aheadNM <= bufferNM) {
      alerts.push({
        id,
        severity: 'caution',
        kind: 'border',
        title: `Track enters ${name} border buffer in 2 min`,
        detail: accuracy,
      });
    } else if (distanceNM <= bufferNM + BORDER_CAUTION_MARGIN_NM) {
      alerts.push({
        id,
        severity: 'caution',
        kind: 'border',
        title: `${formatOneDecimal(distanceNM - bufferNM)} NM from ${name} border buffer`,
        detail: accuracy,
      });
    }
  };

  const lineDistance = (point: Coordinate, lines: readonly number[][][]): number | null =>
    minOrNull(lines.flatMap((line) => crossTrack(point, line)?.distanceNM ?? []));

  for (const border of buffers?.borders ?? []) {
    raise(
      border.name,
      border.bufferKm,
      lineDistance(position, border.lines),
      ahead === null ? null : lineDistance(ahead, border.lines),
      borderBufferNM(border),
    );
  }

  // Gaza: the CAAI P-area polygon is the published no-flight area (LLP19).
  if (gazaRings.length > 0) {
    const gazaDistance = (point: Coordinate): number | null =>
      minOrNull(gazaRings.flatMap((ring) => distanceNmToRing(point, ring) ?? []));
    raise('Gaza', GAZA_BUFFER_KM, gazaDistance(position), ahead === null ? null : gazaDistance(ahead), 0);
  }

  // 33°00'N: not a buffer, an equipment rule, so it never goes red.
  const northNow = position.lat > NORTHERN_LIMIT_LATITUDE;
  const northAhead = ahead !== null && ahead.lat > NORTHERN_LIMIT_LATITUDE;
  if (northNow || northAhead) {
    alerts.push({
      id: 'north-33',
      severity: 'caution',
      kind: 'northOf33',
      title: northNow ? 'North of 33\u00B000\u2032N' : 'Track crosses 33\u00B000\u2032N in 2 min',
      detail: 'Two-way radio and a working transponder required',
    });
  }
  return alerts;
}

// MARK: - Squawk reminder

/**
 * One reminder per departure: the CVFR squawk (domestic AIP B-03 §2f: transponder on for the whole flight, code 5100
 * unless the AIP or ATC says otherwise). Armed once the aircraft has been on the ground; fires when the ground speed
 * passes 40 kt; re-armed by the next landing or stop. Immutable: update returns the next state.
 */
export interface SquawkReminderState {
  armed: boolean;
  /** epoch ms */
  shownAt: number | null;
}

/** At or below this the aircraft counts as on the ground (knots). */
export const SQUAWK_GROUND_SPEED_KNOTS = 15.0;
/** Departure threshold (knots). */
export const SQUAWK_DEPARTURE_SPEED_KNOTS = 40.0;
/** How long the reminder stays up (seconds). */
export const SQUAWK_DISPLAY_SECONDS = 60;
/** The CVFR code, verified in the domestic AIP B-03 §2f text. */
export const CVFR_SQUAWK_CODE = '5100';

export const initialSquawkReminder = (): SquawkReminderState => ({ armed: false, shownAt: null });

/** Feed a ground speed; `fired` is true exactly once per departure. */
export function updateSquawkReminder(
  state: SquawkReminderState,
  groundSpeedKnots: number,
  now: number,
): { state: SquawkReminderState; fired: boolean } {
  if (groundSpeedKnots <= SQUAWK_GROUND_SPEED_KNOTS) return { state: { armed: true, shownAt: null }, fired: false };
  if (state.armed && groundSpeedKnots > SQUAWK_DEPARTURE_SPEED_KNOTS) {
    return { state: { armed: false, shownAt: now }, fired: true };
  }
  return { state, fired: false };
}

/** The reminder alert while it is on display. */
export function squawkReminderAlert(state: SquawkReminderState, now: number): IsraelAlert | null {
  if (state.shownAt === null || (now - state.shownAt) / 1000 > SQUAWK_DISPLAY_SECONDS) return null;
  return {
    id: 'squawk',
    severity: 'caution',
    kind: 'squawk',
    title: `Squawk ${CVFR_SQUAWK_CODE} (CVFR)`,
    detail: 'Transponder on for the whole flight, unless the AIP or ATC says otherwise',
  };
}
