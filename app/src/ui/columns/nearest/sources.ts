// The airport queries the Nearest and Search columns run, behind a context so tests and I1 swap them. The default is the
// in-memory FAKE with the reference's airports; I1 provides the bundled aviation and Israel databases.
import { createContext } from 'react';
import type { AviationDatabase } from '../../../data/aviation/aviationDatabase';
import type { IsraelAviationDatabase } from '../../../data/aviation/israelDatabase';
import { createFakeAviationDatabase } from './fixture';

/**
 * The NOTAM ids that name a field closed now. TODO(S1/L3): the feed is IsraelNotamService (S1) and the matching is
 * IsraelAerodromeAdapter.closingNotams (L3, which also drops expired, superseded and stale feeds); I1 wires both here.
 */
export type NotamClosureLookup = (code: string, nowMs: number) => string[];

export interface AirportQueries {
  aviation: Pick<AviationDatabase, 'nearestAirports' | 'searchAirports'>;
  /** The curated Israeli aerodromes (IL-4); null when not opened, which reads as a failed query in Israel. */
  israel: Pick<IsraelAviationDatabase, 'nearestAerodromes' | 'searchAerodromes'> | null;
  /** Fetches the NOTAM feed; null means no feed: no closure flags, never a "not closed" claim. */
  fetchNotamClosures: (() => Promise<NotamClosureLookup>) | null;
  /** Epoch ms. */
  now: () => number;
}

export const defaultAirportQueries: AirportQueries = {
  aviation: createFakeAviationDatabase(),
  israel: null,
  fetchNotamClosures: null,
  now: () => Date.now(),
};

export const AirportQueriesContext = createContext<AirportQueries>(defaultAirportQueries);
