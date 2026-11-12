import { makeDatabase } from '../../tests/data/aviation/fixtures';
import { createAirportLookup } from './airportLookup';

const kpao = { icao: 'KPAO', name: 'Palo Alto', lat: 37.4611, lon: -122.115 };
const ksql = { icao: 'KSQL', name: 'San Carlos', lat: 37.5119, lon: -122.2494 };
const helipad = { icao: 'CA01', name: 'Stanford Hospital Helipad', lat: 37.4419, lon: -122.1745, type: 'heliport' };

describe('createAirportLookup', () => {
  test('returns the nearest airports from the aviation database as icao, name and type, nearest first', async () => {
    const lookup = createAirportLookup(makeDatabase({ airports: [ksql, helipad, kpao] }));

    const nearby = await lookup.nearestAirports({ lat: 37.4611, lon: -122.115 }, 8);

    // toStrictEqual: nothing but the three fields (runways, frequencies and the rest are dropped).
    expect(nearby).toStrictEqual([
      { icao: 'KPAO', name: 'Palo Alto', type: 'airport' },
      { icao: 'CA01', name: 'Stanford Hospital Helipad', type: 'heliport' },
      { icao: 'KSQL', name: 'San Carlos', type: 'airport' },
    ]);
  });

  test('asks for as many airports as the caller wants', async () => {
    const lookup = createAirportLookup(makeDatabase({ airports: [kpao, helipad, ksql] }));
    expect(await lookup.nearestAirports({ lat: 37.4611, lon: -122.115 }, 2)).toHaveLength(2);
  });

  test('passes the position and count to the database unchanged', async () => {
    const nearestAirports = jest.fn().mockResolvedValue([]);
    const center = { lat: 32.0114, lon: 34.8867 };

    expect(await createAirportLookup({ nearestAirports }).nearestAirports(center, 8)).toEqual([]);

    expect(nearestAirports).toHaveBeenCalledWith(center, 8);
  });

  test('is empty when the database has no airports', async () => {
    const lookup = createAirportLookup(makeDatabase());
    expect(await lookup.nearestAirports({ lat: 37.4611, lon: -122.115 }, 8)).toStrictEqual([]);
  });

  test('rejects when the database fails (FlightPersistenceService reads that as no airports, like Swift try?)', async () => {
    const lookup = createAirportLookup({ nearestAirports: () => Promise.reject(new Error('database is locked')) });
    await expect(lookup.nearestAirports({ lat: 0, lon: 0 }, 8)).rejects.toThrow('database is locked');
  });
});
