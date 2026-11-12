// AirportLookup for FlightPersistenceService on the aviation database: nearestAirports returns full Airport rows (with
// runways and frequencies), the persistence service only needs identity and kind.
import type { AviationDatabase } from '../data/aviation';
import type { AirportLookup } from '../domain/recording/flightPersistence';

export function createAirportLookup(database: Pick<AviationDatabase, 'nearestAirports'>): AirportLookup {
  return {
    async nearestAirports(center, count) {
      const airports = await database.nearestAirports(center, count);
      return airports.map(({ icao, name, type }) => ({ icao, name, type }));
    },
  };
}
