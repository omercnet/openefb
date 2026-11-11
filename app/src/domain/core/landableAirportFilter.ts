// Port of Services/LandableAirportFilter.swift (+ SurfaceType.abbreviation).
import type { Airport, Runway } from './models';
import type { SurfaceType } from './types';

export const DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET = 1_500;
const LANDABLE_SURFACES: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['asphalt', 'concrete', 'turf']);
const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['heliport', 'seaplane']);

export function isLandable(airport: Airport, minimumRunwayLengthFeet = DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET): boolean {
  if (EXCLUDED_TYPES.has(airport.type)) return false;
  return airport.runways.some((r) => LANDABLE_SURFACES.has(r.surface) && r.length >= minimumRunwayLengthFeet);
}

export function landableAirports(
  airports: Airport[],
  minimumRunwayLengthFeet = DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET,
): Airport[] {
  return airports.filter((a) => isLandable(a, minimumRunwayLengthFeet));
}

/** Longest runway on a landable surface, else the longest of any surface; the first wins ties like Swift's max. */
export function longestRunway(airport: Airport): Runway | null {
  const usable = airport.runways.filter((r) => LANDABLE_SURFACES.has(r.surface));
  const pool = usable.length === 0 ? airport.runways : usable;
  let best: Runway | null = null;
  for (const r of pool) if (best === null || r.length > best.length) best = r;
  return best;
}

export const isPrivateUse = (a: Airport): boolean => a.ownership === 'private';
export const isMilitary = (a: Airport): boolean => a.ownership === 'military';

const ABBREVIATIONS: Record<SurfaceType, string> = {
  asphalt: 'ASPH',
  concrete: 'CONC',
  turf: 'TURF',
  gravel: 'GRVL',
  dirt: 'DIRT',
  water: 'WATER',
  other: 'OTHER',
};
export const surfaceAbbreviation = (s: SurfaceType): string => ABBREVIATIONS[s];
