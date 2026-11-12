// FAKE airport data that reproduces reference/ipad-nearest.png until I1 feeds the bundled aviation database in: the ten
// landable airports the reference lists (identity, position, ownership and runways from efb-212/Resources/aviation.sqlite)
// plus a nearby hospital heliport the landable filter drops. Runway-end positions are the airport reference point.
import type { AviationDatabase } from '../../../data/aviation/aviationDatabase';
import type { Airport, OwnershipType, SurfaceType } from '../../../data/aviation/types';
import { distanceNm, type Coordinate } from '../../../domain/core';

type RunwayRow = [id: string, length: number, width: number, surface: SurfaceType];

function airport(
  icao: string,
  name: string,
  latitude: number,
  longitude: number,
  elevation: number,
  ownership: OwnershipType,
  runways: RunwayRow[],
  type: Airport['type'] = 'airport',
): Airport {
  return {
    icao,
    faaID: icao.startsWith('K') ? icao.slice(1) : icao,
    name,
    latitude,
    longitude,
    elevation,
    type,
    ownership,
    ctafFrequency: null,
    unicomFrequency: null,
    artccID: null,
    fssID: null,
    magneticVariation: null,
    patternAltitude: null,
    fuelTypes: [],
    hasBeaconLight: false,
    frequencies: [],
    runways: runways.map(([id, length, width, surface]) => {
      const [base, reciprocal] = id.split('/');
      return {
        id,
        length,
        width,
        surface,
        lighting: 'fullTime',
        baseEndID: base ?? id,
        reciprocalEndID: reciprocal ?? '',
        baseEndLatitude: latitude,
        baseEndLongitude: longitude,
        reciprocalEndLatitude: latitude,
        reciprocalEndLongitude: longitude,
        baseEndElevation: null,
        reciprocalEndElevation: null,
      };
    }),
  };
}

export const FIXTURE_AIRPORTS: Airport[] = [
  airport('KPAO', 'Palo Alto Airport', 37.46112138, -122.11504666, 6.7, 'public', [['13/31', 2441, 70, 'asphalt']]),
  airport('KSQL', 'San Carlos Airport', 37.51186111, -122.24953111, 5.5, 'public', [['12/30', 2621, 75, 'asphalt']]),
  airport('KNUQ', 'Moffett Federal Airfield', 37.41614388, -122.04912916, 36.9, 'private', [
    ['14L/32R', 9197, 200, 'concrete'],
    ['14R/32L', 8121, 200, 'asphalt'],
  ]),
  airport('KHWD', 'Hayward Executive Airport', 37.65893166, -122.12173888, 52.1, 'public', [
    ['10L/28R', 3108, 75, 'asphalt'],
    ['10R/28L', 5694, 150, 'asphalt'],
  ]),
  airport('KSJC', 'Mineta San Jose International Airport', 37.36299472, -121.92862055, 62.3, 'public', [
    ['12L/30R', 11000, 150, 'concrete'],
    ['12R/30L', 11000, 150, 'concrete'],
  ]),
  airport('KSFO', 'San Francisco International Airport', 37.61880555, -122.37541666, 13.1, 'public', [
    ['01L/19R', 7650, 200, 'asphalt'],
    ['01R/19L', 8650, 200, 'asphalt'],
    ['10L/28R', 11870, 200, 'asphalt'],
    ['10R/28L', 11381, 200, 'asphalt'],
  ]),
  airport('KOAK', 'Oakland San Francisco Bay Airport', 37.72126138, -122.22115055, 9, 'public', [
    ['10L/28R', 5457, 150, 'asphalt'],
    ['10R/28L', 6213, 150, 'asphalt'],
    ['12/30', 10520, 150, 'asphalt'],
    ['15/33', 3376, 75, 'asphalt'],
  ]),
  airport('KHAF', 'Half Moon Bay Airport', 37.51344444, -122.50116666, 66.3, 'public', [
    ['12/30', 5000, 150, 'asphalt'],
  ]),
  airport('KRHV', 'Reid-Hillview Airport of Santa Clara County', 37.33286111, -121.81980555, 135.4, 'public', [
    ['13L/31R', 3100, 75, 'asphalt'],
    ['13R/31L', 3099, 75, 'asphalt'],
  ]),
  airport('KLVK', 'Livermore Municipal Airport', 37.69338888, -121.82036111, 399.9, 'public', [
    ['07L/25R', 5253, 100, 'asphalt'],
    ['07R/25L', 2699, 75, 'asphalt'],
    ['H1', 24, 22, 'asphalt'],
  ]),
  airport(
    '15CA',
    'Stanford Health Care East Heliport',
    37.4337,
    -122.1741,
    120,
    'private',
    [['H1', 48, 48, 'asphalt']],
    'heliport',
  ),
];

/**
 * Ownship where the reference was taken (degrees). Found by search: from here the spherical (haversine) range and
 * bearing to every fixture airport print as the reference shows (2.0 NM 116 ... 20.6 NM 050).
 */
export const FIXTURE_OWNSHIP: Coordinate = { lat: 37.47578, lon: -122.15374 };

/** Tokens for the fake prefix search: letters, marks and digits (the FTS5 tokenizer splits on everything else). */
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length > 0);

/**
 * In-memory FAKE of the two AviationDatabase queries the strip columns use. `nearestAirports` sorts by great-circle
 * distance; `searchAirports` matches like the FTS5 prefix query (every query token prefixes a token of the ICAO, name
 * or FAA id; symbol-only input finds nothing).
 */
export function createFakeAviationDatabase(
  airports: readonly Airport[] = FIXTURE_AIRPORTS,
): Pick<AviationDatabase, 'nearestAirports' | 'searchAirports'> {
  return {
    nearestAirports: async (center, count) =>
      [...airports]
        .sort(
          (a, b) =>
            distanceNm(center, { lat: a.latitude, lon: a.longitude }) -
            distanceNm(center, { lat: b.latitude, lon: b.longitude }),
        )
        .slice(0, count),
    searchAirports: async (query, limit = 20) => {
      const wanted = tokens(query);
      if (wanted.length === 0) return [];
      return airports
        .filter((a) => {
          const have = tokens(`${a.icao} ${a.name} ${a.faaID ?? ''}`);
          return wanted.every((w) => have.some((h) => h.startsWith(w)));
        })
        .slice(0, limit);
    },
  };
}
