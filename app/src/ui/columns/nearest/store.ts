// STUB until the Nearest column is ported (U4a): the entry type and the store the footer already reads.
import { makeAirport, type Airport } from '../../../domain/core';
import { createStoreContext } from '../../state/storeContext';

/** One nearby airport with its range and bearing from ownship (NearestAirportViewModel.swift NearestAirportEntry). */
export interface NearestAirportEntry {
  airport: Airport;
  /** Nautical miles. */
  distance: number;
  /** Degrees true. */
  bearing: number;
}

export interface NearestData {
  /** Nearest first. */
  entries: NearestAirportEntry[];
}

/** FAKE: the nearest airport in the Swift captures (reference/ipad-*.png footer, NRST 2.0 NM KPAO 116). */
const KPAO = makeAirport({
  icao: 'KPAO',
  name: 'Palo Alto Airport',
  latitude: 37.4611,
  longitude: -122.115,
  elevation: 4,
  type: 'airport',
  ownership: 'public',
});

export const nearest = createStoreContext<NearestData>({ entries: [{ airport: KPAO, distance: 2.0, bearing: 116 }] });

/** The closest landable airport, for the footer's NRST cell; null while there is none. */
export const useNearestEntry = (): NearestAirportEntry | null => nearest.useData((s) => s.entries[0] ?? null);
