// The airport queries the Nearest and Search columns run, behind a context so tests and the app swap them. The app shell
// provides the bundled aviation and Israel databases; the default (nothing open yet) fails every query.
import { createContext } from 'react';
import type { AviationDatabase } from '../../../data/aviation/aviationDatabase';
import type { IsraelAviationDatabase } from '../../../data/aviation/israelDatabase';
import { AppFailure } from '../../../domain/errors';

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

const notOpen = async (): Promise<never> => {
  throw new AppFailure({ kind: 'databaseCorrupted' });
};

/** No database open: every query fails, which the columns show as unavailable (never as "no airports"). */
export const defaultAirportQueries: AirportQueries = {
  aviation: { nearestAirports: notOpen, searchAirports: notOpen },
  israel: null,
  fetchNotamClosures: null,
  now: () => Date.now(),
};

/**
 * Whether two values hold the same sources (shallow equality of the fields). Only a change of a field is a database
 * swap; a provider value rebuilt every render around the same databases is not.
 */
export const sameQueries = (a: Partial<AirportQueries>, b: Partial<AirportQueries>): boolean =>
  a.aviation === b.aviation &&
  a.israel === b.israel &&
  a.fetchNotamClosures === b.fetchNotamClosures &&
  a.now === b.now;

/**
 * A value whose fields differ (`sameQueries`) is a database swap: the Nearest refresher drops its in-flight answers and
 * requeries, and the search re-runs the current query on the new sources. Memoising the value is still cheaper (the
 * hooks' effects then do not run at all), but a fresh object around the same databases changes nothing.
 */
export const AirportQueriesContext = createContext<AirportQueries>(defaultAirportQueries);
