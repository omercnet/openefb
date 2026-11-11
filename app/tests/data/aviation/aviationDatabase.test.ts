// Port of efb-212Tests/DataTests/AviationDatabaseTests.swift: query behaviour against a temporary database carrying the
// full bundled schema.
import type { AirportRow, AirspaceRow } from './fixtures';
import { makeDatabase } from './fixtures';

const kpao: AirportRow = {
  icao: 'KPAO',
  name: 'Palo Alto',
  lat: 37.4611,
  lon: -122.115,
  fuelTypes: '["100LL","Jet-A"]',
  hasBeacon: 1,
};
const ksql: AirportRow = { icao: 'KSQL', name: 'San Carlos', lat: 37.5119, lon: -122.2494 };
const paoCoord = { lat: 37.4611, lon: -122.115 };

const sjcClassC: AirspaceRow = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'SJC Class C',
  classification: 'charlie',
  ceiling: 4000,
  center: { lat: 37.3626, lon: -121.9291 },
  radiusNM: 5.0,
  box: { minLat: 37.27, maxLat: 37.45, minLon: -122.04, maxLon: -121.82 },
};

/** Square roughly 8 NM on a side around SFO. */
const sfoClassB: AirspaceRow = {
  id: 'a0000000-0000-4000-8000-000000000002',
  name: 'SFO Class B Inner',
  classification: 'bravo',
  ceiling: 10000,
  coordinatesJSON: '[[37.55,-122.45],[37.55,-122.30],[37.68,-122.30],[37.68,-122.45],[37.55,-122.45]]',
  box: { minLat: 37.55, maxLat: 37.68, minLon: -122.45, maxLon: -122.3 },
};

describe('AviationDatabase Query Tests', () => {
  describe('airport detail lookup', () => {
    test('airportByICAOLoadsRunwaysFrequenciesAndDecodesJSONFields', async () => {
      const db = makeDatabase({
        airports: [kpao, ksql],
        runways: [
          { airport: 'KPAO', id: '13/31', length: 2443 },
          { airport: 'KSQL', id: '12/30', length: 2600 },
        ],
        frequencies: [
          {
            airport: 'KPAO',
            id: 'b0000000-0000-4000-8000-000000000001',
            type: 'tower',
            name: 'Palo Alto Tower',
            frequency: 118.6,
          },
          {
            airport: 'KSQL',
            id: 'b0000000-0000-4000-8000-000000000002',
            type: 'tower',
            name: 'San Carlos Tower',
            frequency: 119.0,
          },
        ],
      });
      const airport = await db.airport('KPAO');
      expect(airport).not.toBeNull();
      expect(airport?.fuelTypes).toEqual(['100LL', 'Jet-A']);
      expect(airport?.hasBeaconLight).toBe(true);
      // Only KPAO's own rows, not KSQL's.
      expect(airport?.runways.map((r) => r.id)).toEqual(['13/31']);
      expect(airport?.runways[0]?.length).toBe(2443); // feet
      expect(airport?.runways[0]?.lighting).toBe('fullTime');
      expect(airport?.frequencies.map((f) => f.frequency)).toEqual([118.6]); // MHz
      expect(airport?.frequencies[0]?.type).toBe('tower');
    });

    test('airportByICAOIsExactMatchAndNilWhenMissing', async () => {
      const db = makeDatabase({ airports: [kpao] });
      expect(await db.airport('KPA')).toBeNull();
      expect(await db.airport('KXYZ')).toBeNull();
      expect((await db.airport('KPAO'))?.icao).toBe('KPAO');
    });

    test('unknownEnumRawValuesDecodeToFallbacksInsteadOfFailing', async () => {
      const weird: AirportRow = { ...kpao, type: 'spaceport', ownership: 'coop', fuelTypes: 'not json' };
      const db = makeDatabase({
        airports: [weird],
        runways: [{ airport: 'KPAO', id: '13/31', length: 2443, surface: 'lava', lighting: 'disco' }],
        frequencies: [{ airport: 'KPAO', id: 'not-a-uuid', type: 'telepathy', name: 'X', frequency: 1 }],
      });
      const airport = await db.airport('KPAO');
      expect(airport?.type).toBe('airport');
      expect(airport?.ownership).toBe('public');
      expect(airport?.fuelTypes).toEqual([]);
      expect(airport?.runways[0]?.surface).toBe('other');
      expect(airport?.runways[0]?.lighting).toBe('none');
      expect(airport?.frequencies[0]?.type).toBe('other');
    });
  });

  describe('bounding-box queries', () => {
    // 1 NM of latitude is 1/60 degree; the box edge is inclusive.
    test('airportsNearIncludesBoxEdgeAndExcludesJustOutside', async () => {
      const onEdge: AirportRow = { icao: 'EDGE', name: 'On Edge', lat: 37.0 + 10.0 / 60.0, lon: -122.0 };
      const outside: AirportRow = { icao: 'OUTS', name: 'Outside', lat: 37.0 + 10.001 / 60.0, lon: -122.0 };
      const db = makeDatabase({ airports: [onEdge, outside] });

      const found = await db.airportsNear({ lat: 37.0, lon: -122.0 }, 10.0);
      expect(found.map((a) => a.icao)).toEqual(['EDGE']);
    });

    test('airportsNearWidensLongitudeBoxWithLatitude', async () => {
      // At 60N one degree of longitude is only 30 NM, so a 20 NM box spans 2/3 of a degree.
      const center = { lat: 60.0, lon: -150.0 };
      const inside: AirportRow = { icao: 'INSD', name: 'Inside', lat: 60.0, lon: -150.0 - 0.6 };
      const outside: AirportRow = { icao: 'OUTS', name: 'Outside', lat: 60.0, lon: -150.0 - 0.7 };
      const db = makeDatabase({ airports: [inside, outside] });

      const found = await db.airportsNear(center, 20.0);
      expect(found.map((a) => a.icao)).toEqual(['INSD']);
    });

    test('airportsNearReturnsNoRunwaysAndEmptyForEmptyRegion', async () => {
      const db = makeDatabase({
        airports: [kpao],
        runways: [{ airport: 'KPAO', id: '13/31', length: 2443 }],
      });
      const nearby = await db.airportsNear(paoCoord, 5);
      expect(nearby).toHaveLength(1);
      expect(nearby[0]?.runways).toEqual([]); // list query skips runway loading

      const farAway = { lat: 40.6413, lon: -73.7781 };
      expect(await db.airportsNear(farAway, 50)).toEqual([]);
    });

    test('navaidsNearFiltersByBoxAndDecodesOptionalElevation', async () => {
      const db = makeDatabase({
        navaids: [
          { id: 'SJC', name: 'San Jose', type: 'vor_dme', lat: 37.3626, lon: -121.9291, elevation: 56 },
          { id: 'OAK', name: 'Oakland', type: 'vortac', lat: 37.7213, lon: -122.2208 },
        ],
      });
      const sjc = { lat: 37.3626, lon: -121.9291 };

      const close = await db.navaidsNear(sjc, 5);
      expect(close.map((n) => n.id)).toEqual(['SJC']);
      expect(close[0]?.type).toBe('vor_dme');
      expect(close[0]?.elevation).toBe(56); // feet MSL

      const wide = await db.navaidsNear(sjc, 40);
      expect(new Set(wide.map((n) => n.id))).toEqual(new Set(['SJC', 'OAK']));
      expect(wide.find((n) => n.id === 'OAK')?.elevation).toBeNull();
    });
  });

  describe('airspace geometry', () => {
    test('circleAirspaceContainsPointsInsideRadiusOnly', async () => {
      const db = makeDatabase({ airspaces: [sjcClassC] });
      const center = { lat: 37.3626, lon: -121.9291 };

      expect((await db.airspacesContaining(center)).map((a) => a.name)).toEqual(['SJC Class C']);

      // 4.9 NM north: inside. 5.1 NM north: outside, even though the R-tree box still matches.
      const inside = { lat: 37.3626 + 4.9 / 60.0, lon: -121.9291 };
      const outside = { lat: 37.3626 + 5.1 / 60.0, lon: -121.9291 };
      expect(await db.airspacesContaining(inside)).toHaveLength(1);
      expect(await db.airspacesContaining(outside)).toEqual([]);
    });

    test('polygonAirspaceUsesRayCastingNotBoundingBox', async () => {
      // Triangle: the bounding box covers the whole square, the polygon only its lower-left half.
      const triangle: AirspaceRow = {
        id: 'a0000000-0000-4000-8000-000000000003',
        name: 'Tri',
        classification: 'delta',
        coordinatesJSON: '[[37.0,-122.0],[37.0,-121.0],[38.0,-122.0],[37.0,-122.0]]',
        box: { minLat: 37.0, maxLat: 38.0, minLon: -122.0, maxLon: -121.0 },
      };
      const db = makeDatabase({ airspaces: [triangle] });

      const inTriangle = { lat: 37.2, lon: -121.8 };
      const inBoxOnly = { lat: 37.8, lon: -121.2 };
      expect((await db.airspacesContaining(inTriangle)).map((a) => a.name)).toEqual(['Tri']);
      expect(await db.airspacesContaining(inBoxOnly)).toEqual([]);
    });

    test('overlappingAirspacesAreAllReported', async () => {
      const paoClassD: AirspaceRow = {
        id: 'a0000000-0000-4000-8000-000000000004',
        name: 'PAO Class D',
        classification: 'delta',
        ceiling: 2500,
        center: { lat: 37.4611, lon: -122.115 },
        radiusNM: 4.0,
        box: { minLat: 37.39, maxLat: 37.53, minLon: -122.2, maxLon: -122.03 },
      };
      const overlappingC: AirspaceRow = {
        id: 'a0000000-0000-4000-8000-000000000005',
        name: 'Big Class C',
        classification: 'charlie',
        center: { lat: 37.4611, lon: -122.115 },
        radiusNM: 10.0,
        box: { minLat: 37.29, maxLat: 37.63, minLon: -122.33, maxLon: -121.9 },
      };
      const db = makeDatabase({ airspaces: [paoClassD, overlappingC, sfoClassB] });

      const names = new Set((await db.airspacesContaining(paoCoord)).map((a) => a.name));
      expect(names).toEqual(new Set(['PAO Class D', 'Big Class C']));
    });

    test('airspaceRowsDecodeClassFloorCeilingAndPreferCircleOverPolygon', async () => {
      const both: AirspaceRow = { ...sjcClassC, coordinatesJSON: sfoClassB.coordinatesJSON, floor: 1500 };
      const db = makeDatabase({ airspaces: [both] });

      const [airspace] = await db.airspacesNear(paoCoord, 30);
      expect(airspace?.classification).toBe('charlie');
      expect(airspace?.floor).toBe(1500); // feet MSL
      expect(airspace?.ceiling).toBe(4000); // feet MSL
      expect(airspace?.geometry.kind).toBe('circle');
      if (airspace?.geometry.kind === 'circle') expect(airspace.geometry.radiusNM).toBe(5.0); // nautical miles
    });

    test('airspaceRowsWithoutUsableGeometryAreDropped', async () => {
      const noGeometry: AirspaceRow = {
        id: 'a0000000-0000-4000-8000-000000000006',
        name: 'Broken',
        classification: 'delta',
        box: { minLat: 37.0, maxLat: 38.0, minLon: -123.0, maxLon: -122.0 },
      };
      const zeroRadiusBadJSON: AirspaceRow = {
        id: 'a0000000-0000-4000-8000-000000000007',
        name: 'Broken2',
        classification: 'delta',
        center: { lat: 37.5, lon: -122.5 },
        radiusNM: 0,
        coordinatesJSON: '[]',
        box: { minLat: 37.0, maxLat: 38.0, minLon: -123.0, maxLon: -122.0 },
      };
      const db = makeDatabase({ airspaces: [noGeometry, zeroRadiusBadJSON, sfoClassB] });

      const found = await db.airspacesNear({ lat: 37.6, lon: -122.4 }, 30);
      expect(found.map((a) => a.name)).toEqual(['SFO Class B Inner']);
    });
  });

  describe('towered airports (low-zoom layer)', () => {
    test('toweredAirportsReturnsOnlyPublicFixedWingFieldsWithATowerFrequency', async () => {
      const db = makeDatabase({
        airports: [
          { icao: 'KPAO', name: 'Palo Alto', lat: 37.46, lon: -122.11 }, // CTAF only
          { icao: 'KSFO', name: 'San Francisco Intl', lat: 37.62, lon: -122.38 }, // towered
          { icao: 'KSQL', name: 'San Carlos', lat: 37.51, lon: -122.25 }, // towered
          { icao: 'KNUQ', name: 'Moffett', lat: 37.42, lon: -122.05, ownership: 'military' },
          { icao: '4CA4', name: 'Private Tower', lat: 37.4, lon: -122.0, ownership: 'private' },
          { icao: 'CA01', name: 'Hospital', lat: 37.45, lon: -122.15, type: 'heliport' },
          { icao: 'KFAR', name: 'Far Away Towered', lat: 47.0, lon: -100.0 },
        ],
        frequencies: [
          { airport: 'KPAO', id: 'f1', type: 'ctaf', name: 'CTAF', frequency: 118.6 },
          { airport: 'KSFO', id: 'f2', type: 'tower', name: 'Tower', frequency: 120.5 },
          { airport: 'KSQL', id: 'f3', type: 'tower', name: 'Tower', frequency: 119.0 },
          { airport: 'KNUQ', id: 'f4', type: 'tower', name: 'Tower', frequency: 126.0 },
          { airport: '4CA4', id: 'f5', type: 'tower', name: 'Tower', frequency: 121.0 },
          { airport: 'CA01', id: 'f6', type: 'tower', name: 'Tower', frequency: 122.0 },
          { airport: 'KFAR', id: 'f7', type: 'tower', name: 'Tower', frequency: 123.0 },
        ],
      });
      const center = { lat: 37.5, lon: -122.2 };

      const near = await db.toweredAirportsNear(center, 100);
      expect(new Set(near.map((a) => a.icao))).toEqual(new Set(['KSFO', 'KSQL']));

      const wide = await db.toweredAirportsNear(center, 1500);
      expect(new Set(wide.map((a) => a.icao))).toEqual(new Set(['KSFO', 'KSQL', 'KFAR']));
    });
  });
});
