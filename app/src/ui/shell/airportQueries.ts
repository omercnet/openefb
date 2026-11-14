import { AppFailure } from '../../domain/errors';
import type { AirportQueries } from '../columns/nearest/sources';
import { closureLookupFrom } from './israelFeed';
import type { AppRuntime } from './runtime';

const databaseClosed = async (): Promise<never> => {
  throw new AppFailure({ kind: 'databaseCorrupted' });
};

/** The queries the Nearest and Search columns run, on the databases the launch sequence opened. */
export function airportQueriesFor(runtime: Pick<AppRuntime, 'started' | 'israelNotam'>): AirportQueries {
  const { aviation, israel } = runtime.started;
  return {
    aviation: aviation ?? { nearestAirports: databaseClosed, searchAirports: databaseClosed },
    israel,
    // Only the Israel region has a field-closure feed; elsewhere no feed means no closure flags.
    fetchNotamClosures: runtime.started.region === 'israel' ? closureLookupFrom(runtime.israelNotam) : null,
    now: () => Date.now(),
  };
}
