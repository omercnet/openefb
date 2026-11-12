// The nearest-airports slice: the list the Nearest column shows and the footer's NRST cell reads, the ownship it was
// computed for, and the refresh state. useNearestAirports (refresh.ts) keeps it current; I1 feeds `ownship` from the
// location service and `directTo` from AppState's Direct-To.
import type { Airport, Coordinate } from '../../../domain/core';
import { createStoreContext } from '../../state/storeContext';
import { FIXTURE_AIRPORTS, FIXTURE_OWNSHIP } from './fixture';
import { LIST_COUNT, MINIMUM_RUNWAY_LENGTH_FEET, rankLandable, type NearestAirportEntry } from './logic';

export type { IsraelAerodromeFlags, NearestAirportEntry } from './logic';

export interface NearestData {
  /** Nearest first, at most LIST_COUNT. Kept across failed refreshes (stale beats empty). */
  entries: NearestAirportEntry[];
  /** A refresh is in flight. */
  loading: boolean;
  /** Why the last refresh failed; cleared by the next success. The list then still shows the previous entries. */
  error: string | null;
  /** Ownship position (degrees); null until the first fix. */
  ownship: Coordinate | null;
  /** Start Direct-To to an airport (NearestAirportViewModel.setDirectTo). No-op until I1 wires AppState. */
  directTo: (airport: Airport) => void;
}

/** FAKE: the reference's ownship and its ten airports, ranked the way a refresh would rank them. */
export const nearest = createStoreContext<NearestData>({
  entries: rankLandable(FIXTURE_AIRPORTS, FIXTURE_OWNSHIP, MINIMUM_RUNWAY_LENGTH_FEET, LIST_COUNT),
  loading: false,
  error: null,
  ownship: FIXTURE_OWNSHIP,
  directTo: () => {},
});

/** The closest landable airport, for the footer's NRST cell; null while there is none. */
export const useNearestEntry = (): NearestAirportEntry | null => nearest.useData((s) => s.entries[0] ?? null);
