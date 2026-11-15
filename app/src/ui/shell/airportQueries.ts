import { AppFailure } from '../../domain/errors';
import type { AirportQueries } from '../columns/nearest/sources';
import type { AppRuntime } from './runtime';

const databaseClosed = async (): Promise<never> => {
  throw new AppFailure({ kind: 'databaseCorrupted' });
};

/** The queries the Nearest and Search columns run, on the databases the launch sequence opened. */
export function airportQueriesFor(runtime: Pick<AppRuntime, 'started'>): AirportQueries {
  const { aviation, israel } = runtime.started;
  return {
    aviation: aviation ?? { nearestAirports: databaseClosed, searchAirports: databaseClosed },
    israel,
    // The NOTAM feed (IsraelNotamService and closingNotams) arrives with the briefing in I1b: no feed, no closure flags.
    fetchNotamClosures: null,
    now: () => Date.now(),
  };
}
