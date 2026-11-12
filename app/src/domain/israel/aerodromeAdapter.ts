// Port of Services/IsraelAerodromeAdapter.swift: maps the Israel database's aerodromes onto the app's Airport model and
// derives the pilot-facing flags (PPR, NOTAM closure, reviewed). Pure.
// The NOTAM report type belongs to the NOTAM service ticket (S1); `AerodromeNotamReport` is the structural slice this
// adapter reads. Swift's `report.freshness(now:)` level is passed in by the caller as `freshnessLevel`.
import type { FreshnessLevel } from '../core/freshness';
import { makeAirport, type Airport, type Frequency, type Runway } from '../core/models';
import type { FrequencyType, SurfaceType } from '../core/types';
import {
  runwayLengthFeet,
  runwayWidthFeet,
  type IsraelAerodrome,
  type IsraelAerodromeFrequency,
  type IsraelAerodromeRunway,
  type IsraelAerodromeUse,
} from '../../data/aviation/israelTypes';

/** What the pilot must know about an Israeli field beyond what `Airport` carries. */
export interface IsraelAerodromeFlags {
  /** The AIP says prior permission is required (PPR), or the field is an operator-run strip. */
  requiresPPR: boolean;
  /** Ids of current NOTAMs that name this field closed (empty when none found or the feed is unusable). */
  closureNotamIDs: string[];
  /** The owner has checked the data against the AIP. */
  isReviewed: boolean;
}

export const isClosedByNotam = (flags: IsraelAerodromeFlags): boolean => flags.closureNotamIDs.length > 0;

/** The slice of a NOTAM the aerodrome-closure match reads. */
export interface AerodromeNotamLike {
  id: string;
  /** cancelledBy or replacedBy is set. */
  isSuperseded: boolean;
  /** Route closures parsed from the NOTAM; a NOTAM with any is a route closure, not a field closure. */
  closures: readonly unknown[];
  /** Epoch ms. */
  validFrom: number | null;
  validTo: number | null;
  /** The E) text. */
  e: string | null;
}

/** The slice of a NOTAM report the adapter reads. */
export interface AerodromeNotamReport<N extends AerodromeNotamLike = AerodromeNotamLike> {
  freshnessLevel: FreshnessLevel;
  items: readonly N[];
}

/**
 * Fields NRST never offers: unmanned-aircraft strips, ultralight-only strips (LLRS Rishon LeZion, LLEV Ein Vered) and
 * fields outside Israel. Heliports are dropped by the landable-airport filter; fields with no runway data and
 * military fields with unpublished surfaces fall out of it as well.
 */
export const NOT_LANDABLE_USES: readonly IsraelAerodromeUse[] = ['uas', 'ultralight', 'foreign'];

/** Swift's `Double(mhz)`: the whole string must be a decimal number. */
export function megahertz(f: IsraelAerodromeFrequency): number | null {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(f.mhz) ? Number(f.mhz) : null;
}

export function surface(text: string): SurfaceType {
  // Composite surfaces as published ("concrete+asphalt", "asphalt/concrete") map to their first part.
  const first = text.split(/[+/]/).find((part) => part !== '') ?? text;
  switch (first) {
    case 'asphalt':
      return 'asphalt';
    case 'concrete':
      return 'concrete';
    case 'grass':
      return 'turf';
    case 'gravel':
      return 'gravel';
    case 'dirt':
      return 'dirt';
    default:
      return 'other';
  }
}

/** The AIP gives no runway-end coordinates, so both ends sit on the reference point; nothing draws them. */
export function runway(source: IsraelAerodromeRunway, aerodrome: IsraelAerodrome): Runway {
  // Swift split(separator: "/", maxSplits: 1) drops empty pieces.
  const slash = source.designator.indexOf('/');
  const pieces =
    slash < 0 ? [source.designator] : [source.designator.slice(0, slash), source.designator.slice(slash + 1)];
  const ends = pieces.filter((piece) => piece !== '');
  return {
    id: source.designator,
    length: runwayLengthFeet(source),
    width: runwayWidthFeet(source),
    surface: surface(source.surface),
    lighting: 'none',
    baseEndID: ends[0] ?? source.designator,
    reciprocalEndID: ends[1] ?? '',
    baseEndLatitude: aerodrome.latitude,
    baseEndLongitude: aerodrome.longitude,
    reciprocalEndLatitude: aerodrome.latitude,
    reciprocalEndLongitude: aerodrome.longitude,
  };
}

export function frequencyType(service: string): FrequencyType {
  const s = service.toLowerCase();
  if (s.includes('atis')) return 'atis';
  if (s.startsWith('twr') || s.includes('tower')) return 'tower';
  if (s.startsWith('gnd') || s.includes('ground')) return 'ground';
  if (s.startsWith('clr') || s.includes('clearance')) return 'clearance';
  if (s.startsWith('app') || s.includes('approach') || s.startsWith('tma')) return 'approach';
  if (s.includes('operator') || s.includes('a/g') || s.includes('helipad frequency')) return 'ctaf';
  return 'other';
}

/**
 * Frequencies with a MHz value; the role comes from the AIP's wording ("TWR primary", "Airstrip operator channel").
 * Swift's Frequency gets a fresh UUID; the domain generates none, so the id here is derived from the source row.
 */
export function frequency(source: IsraelAerodromeFrequency): Frequency | null {
  const mhz = megahertz(source);
  if (mhz === null) return null;
  const name = source.callsignHebrew !== null ? `${source.service} (${source.callsignHebrew})` : source.service;
  return { id: `israel-frequency-${source.id}`, type: frequencyType(source.service), frequency: mhz, name };
}

export function airport(aerodrome: IsraelAerodrome): Airport {
  return makeAirport({
    icao: aerodrome.code,
    name: aerodrome.nameEnglish,
    latitude: aerodrome.latitude,
    longitude: aerodrome.longitude,
    elevation: aerodrome.elevationFeet ?? 0, // feet MSL; the sheet shows "unpublished" via the aerodrome
    type: aerodrome.type === 'heliport' ? 'heliport' : 'airport',
    ownership: aerodrome.use === 'military' ? 'military' : 'public',
    runways: aerodrome.runways.map((r) => runway(r, aerodrome)),
    frequencies: aerodrome.frequencies.flatMap((f) => frequency(f) ?? []),
  });
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * NOTAMs in a usable feed that close the field itself: not superseded, valid at `atMs`, not a route closure, and E)
 * saying the aerodrome is closed ("LLBO AIRSTRIP CLSD TO ALL FLT", "LLHZ AD CLSD", "AD LLHZ CLSD"). The code must be
 * the subject of CLSD: area, runway and taxiway closures that merely mention it do not match. A feed that is expired,
 * unsafe by age or of unknown age yields nothing: an old closure set never reads as current.
 */
export function closingNotams<N extends AerodromeNotamLike>(
  code: string,
  report: AerodromeNotamReport<N>,
  atMs: number,
): N[] {
  if (report.freshnessLevel !== 'fresh' && report.freshnessLevel !== 'old') return [];
  const c = escapeRegExp(code);
  const kind = '(?:AD|AIRSTRIP|AERODROME|AIRPORT|HELIPORT|HELIPAD)';
  const closed = '(?:IS\\s+)?(?:CLSD|CLOSED)';
  const patterns = [
    new RegExp(`\\b${c}\\s+(?:${kind}\\s+)?${closed}\\b`), // LLBO AIRSTRIP CLSD, LLHZ CLSD
    new RegExp(`\\b${kind}\\s+${c}\\s+${closed}\\b`), // AD LLHZ CLSD
  ];
  return report.items.filter((notam) => {
    if (notam.isSuperseded || notam.closures.length > 0) return false;
    if (notam.validFrom !== null && atMs < notam.validFrom) return false;
    if (notam.validTo !== null && atMs > notam.validTo) return false;
    if (notam.e === null) return false;
    const text = notam.e.toUpperCase();
    return patterns.some((p) => p.test(text));
  });
}

export function flags(
  aerodrome: IsraelAerodrome,
  report: AerodromeNotamReport | null,
  nowMs: number,
): IsraelAerodromeFlags {
  const closureNotamIDs = report ? closingNotams(aerodrome.code, report, nowMs).map((n) => n.id) : [];
  return { requiresPPR: aerodrome.ppr === 'yes', closureNotamIDs, isReviewed: aerodrome.reviewStatus === 'reviewed' };
}
