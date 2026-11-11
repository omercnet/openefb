// The parts of Services/IsraelAerodromeAdapter.swift NRST and search need: the curated Israeli aerodromes (IL-4) mapped
// onto the `Airport` model, the uses NRST never offers, and the per-field flags.
// TODO(L3): IsraelAerodromeAdapter is an L3 domain file; move this to src/domain when L3 ports it, and add
// `closingNotams(naming:in:at:)` there (it needs the NOTAM feed types of IsraelNotamService, S1). Until then the
// closure ids come from an injected lookup (see NotamClosureLookup in sources.ts).
import type {
  IsraelAerodrome,
  IsraelAerodromeFrequency,
  IsraelAerodromeRunway,
  IsraelAerodromeUse,
} from '../../../data/aviation/israelTypes';
import { runwayLengthFeet, runwayWidthFeet } from '../../../data/aviation/israelTypes';
import {
  makeAirport,
  type Airport,
  type Frequency,
  type FrequencyType,
  type Runway,
  type SurfaceType,
} from '../../../domain/core';
import type { IsraelAerodromeFlags } from './logic';

/**
 * Fields NRST never offers: unmanned-aircraft strips, ultralight-only strips (LLRS Rishon LeZion, LLEV Ein Vered) and
 * fields outside Israel. Heliports, fields with no runway data and military fields with unpublished surfaces fall out
 * of the landable filter.
 */
export const NOT_LANDABLE_USES: ReadonlySet<IsraelAerodromeUse> = new Set<IsraelAerodromeUse>([
  'uas',
  'ultralight',
  'foreign',
]);

export function israelAirport(aerodrome: IsraelAerodrome): Airport {
  return makeAirport({
    icao: aerodrome.code,
    name: aerodrome.nameEnglish,
    latitude: aerodrome.latitude, // degrees
    longitude: aerodrome.longitude, // degrees
    elevation: aerodrome.elevationFeet ?? 0, // feet MSL; the sheet shows "unpublished" via the aerodrome
    type: aerodrome.type === 'heliport' ? 'heliport' : 'airport',
    ownership: aerodrome.use === 'military' ? 'military' : 'public',
    runways: aerodrome.runways.map((r) => israelRunway(r, aerodrome)),
    frequencies: aerodrome.frequencies.flatMap((f) => {
      const mapped = israelFrequency(f, aerodrome);
      return mapped ? [mapped] : [];
    }),
  });
}

/** The AIP gives no runway-end coordinates, so both ends sit on the reference point; nothing draws them. */
export function israelRunway(runway: IsraelAerodromeRunway, at: IsraelAerodrome): Runway {
  const ends = splitOnce(runway.designator);
  return {
    id: runway.designator,
    length: runwayLengthFeet(runway), // feet
    width: runwayWidthFeet(runway), // feet
    surface: israelSurface(runway.surface),
    lighting: 'none',
    baseEndID: ends[0] ?? runway.designator,
    reciprocalEndID: ends[1] ?? '',
    baseEndLatitude: at.latitude,
    baseEndLongitude: at.longitude,
    reciprocalEndLatitude: at.latitude,
    reciprocalEndLongitude: at.longitude,
  };
}

/** Composite surfaces as published ("concrete+asphalt", "asphalt/concrete") map to their first part. */
export function israelSurface(text: string): SurfaceType {
  switch (text.split(/[+/]/).find((part) => part.length > 0) ?? text) {
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

/**
 * Swift `split(separator: "/", maxSplits: 1)` (omittingEmptySubsequences: true): empty parts are dropped and do not count
 * as the split, so "/09" is ["09"], "09//27" is ["09", "/27"] and "/" is [].
 */
function splitOnce(text: string): string[] {
  const rest = text.replace(/^\/+/, '');
  if (rest === '') return [];
  const slash = rest.indexOf('/');
  if (slash < 0) return [rest];
  const tail = rest.slice(slash + 1);
  return tail === '' ? [rest.slice(0, slash)] : [rest.slice(0, slash), tail];
}

/**
 * The MHz text as a number, or null. JS-only: Swift's `Double(mhz)` also accepts hex floats ("0x1p3"), "inf" and "nan";
 * this accepts plain decimals only. All 68 bundled values are plain decimals, so the two agree on the shipped data.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Frequencies with a MHz value; the role comes from the AIP's wording ("TWR primary", "Airstrip operator channel"). */
export function israelFrequency(source: IsraelAerodromeFrequency, at: IsraelAerodrome): Frequency | null {
  if (!DECIMAL.test(source.mhz)) return null;
  const name = source.callsignHebrew != null ? `${source.service} (${source.callsignHebrew})` : source.service;
  // Swift makes a fresh UUID per mapping; a stable id keyed on the aerodrome row is enough for list keys.
  return { id: `${at.code}-${source.id}`, type: frequencyType(source.service), frequency: Number(source.mhz), name };
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

/** PPR from the AIP, review status, and the NOTAMs that close the field (`closureNotamIDs`, empty without a feed). */
export function israelFlags(aerodrome: IsraelAerodrome, closureNotamIDs: string[]): IsraelAerodromeFlags {
  return { requiresPPR: aerodrome.ppr === 'yes', closureNotamIDs, isReviewed: aerodrome.reviewStatus === 'reviewed' };
}
