// Pure parts of NearestAirportViewModel.swift (NearestAirportEntry, rankLandable) and the row text of
// NearestColumnView.swift. Distances in nautical miles, bearings in degrees true, runway lengths in feet.
import {
  DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET,
  bearingDeg,
  distanceNm,
  isMilitary,
  isPrivateUse,
  landableAirports,
  longestRunway,
  surfaceAbbreviation,
  type Airport,
  type Coordinate,
} from '../../../domain/core';
import { printfFixed } from '../../flightLog/logic';

/** What the pilot must know about an Israeli field beyond what `Airport` carries (IsraelAerodromeFlags). */
export interface IsraelAerodromeFlags {
  /** The AIP says prior permission is required (PPR), or the field is an operator-run strip. */
  requiresPPR: boolean;
  /** Ids of current NOTAMs that name this field closed (empty when none found or the feed is unusable). */
  closureNotamIDs: string[];
  /** The owner has checked the data against the AIP. */
  isReviewed: boolean;
}

/** One nearby airport with its range and bearing from ownship (NearestAirportViewModel.swift NearestAirportEntry). */
export interface NearestAirportEntry {
  airport: Airport;
  /** Nautical miles. */
  distance: number;
  /** Degrees true. */
  bearing: number;
  /** Israel only (IL-4): PPR, NOTAM closure and review status. Absent for US airports. */
  israel?: IsraelAerodromeFlags | null;
}

/** Entries kept for the list. */
export const LIST_COUNT = 10;
/** Candidates asked from the database before landability filtering (a third of US facilities are heliports). */
export const CANDIDATE_COUNT = 40;
/** Minimum runway for the active aircraft: the shared default until the aircraft profile has a runway field. */
export const MINIMUM_RUNWAY_LENGTH_FEET = DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET;
/** Ownship must move this far (NM) before the database is queried again. */
export const REQUERY_DISTANCE_NM = 0.5;
/** The NOTAM relay caches 5 minutes; asking more often only costs battery (ms). */
export const NOTAM_REFRESH_INTERVAL_MS = 300_000;

export const entryId = (e: NearestAirportEntry): string => e.airport.icao;
export const entryLongestRunway = (e: NearestAirportEntry) => longestRunway(e.airport);
export const entryIsPrivateUse = (e: NearestAirportEntry): boolean => isPrivateUse(e.airport);
export const entryIsMilitary = (e: NearestAirportEntry): boolean => isMilitary(e.airport);
export const requiresPPR = (e: NearestAirportEntry): boolean => e.israel?.requiresPPR ?? false;
export const isClosedByNotam = (e: NearestAirportEntry): boolean => (e.israel?.closureNotamIDs.length ?? 0) > 0;

/** Compact runway summary for the HUD, e.g. "2441' ASPH" (String interpolation: no grouping). Null without runway data. */
export function runwaySummary(e: NearestAirportEntry): string | null {
  const runway = entryLongestRunway(e);
  return runway ? `${runway.length}' ${surfaceAbbreviation(runway.surface)}` : null;
}

/** SwiftUI Text interpolation of an Int: grouped with the en-US separator ("11,870"). */
export const groupedInt = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The row's runway line, "13/31  2,441' ASPH" (two spaces), or "no runway data". */
export function rowRunwayText(e: NearestAirportEntry): string {
  const runway = entryLongestRunway(e);
  if (!runway) return 'no runway data';
  return `${runway.id}  ${groupedInt(runway.length)}' ${surfaceAbbreviation(runway.surface)}`;
}

/** "2.0 NM" (String(format: "%.1f NM")). */
export const distanceText = (nm: number): string => `${printfFixed(nm, 1)} NM`;

/** "116\u00B0" (String(format: "%03.0f\u00B0")). 359.6 prints "360\u00B0" as in the Swift. */
export function bearingText(deg: number): string {
  const whole = printfFixed(deg, 0);
  return `${whole.startsWith('-') ? `-${whole.slice(1).padStart(2, '0')}` : whole.padStart(3, '0')}\u00B0`;
}

/** Filter candidates to landable fields and sort by distance from `position` (NearestAirportViewModel.rankLandable). */
export function rankLandable(
  candidates: readonly Airport[],
  position: Coordinate,
  minimumRunwayLengthFeet: number,
  limit: number,
): NearestAirportEntry[] {
  return landableAirports([...candidates], minimumRunwayLengthFeet)
    .map((airport) => {
      const at = { lat: airport.latitude, lon: airport.longitude };
      return { airport, distance: distanceNm(position, at), bearing: bearingDeg(position, at) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/** The caution tags a row shows, in the Swift order, with their spoken text. */
export function cautionTags(e: NearestAirportEntry): { text: string; spoken: string; isWarning: boolean }[] {
  const tags = [];
  if (entryIsPrivateUse(e)) tags.push({ text: 'PVT', spoken: 'Private use', isWarning: false });
  if (entryIsMilitary(e)) tags.push({ text: 'MIL', spoken: 'Military field, emergency use only', isWarning: false });
  if (requiresPPR(e)) tags.push({ text: 'PPR', spoken: 'Prior permission required', isWarning: false });
  if (isClosedByNotam(e)) tags.push({ text: 'NOTAM CLSD', spoken: 'A NOTAM names this field closed', isWarning: true });
  return tags;
}

/** The NearestAirportEntry computed properties the footer's NRST cell speaks (its `NrstEntry` extras). */
export function entryExtras(e: NearestAirportEntry) {
  return {
    runwaySummary: runwaySummary(e),
    isPrivateUse: entryIsPrivateUse(e),
    isMilitary: entryIsMilitary(e),
    requiresPPR: requiresPPR(e),
    isClosedByNotam: isClosedByNotam(e),
  };
}
