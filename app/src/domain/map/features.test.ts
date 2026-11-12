// MapService.update* feature builders (Swift has no direct tests; MapLoadingFlowTests constructs MapService without a
// map view). Cases are written from the Swift attribute names and guards.
import { makeAirport, makeWeatherCache, type Airspace, type Tfr } from '../core';
import {
  airportFeatures,
  airspaceFeatures,
  advisoryFeatures,
  navaidFeatures,
  tfrFeatures,
  weatherDotFeatures,
} from './features';

const tfr = (over: Partial<Tfr> = {}): Tfr => ({
  id: 't1',
  notamID: '6/1234',
  type: 'HAZARDS',
  title: 'T',
  boundaries: [
    [37, -122],
    [37, -121],
    [38, -121],
  ],
  ...over,
});

describe('degenerate rings', () => {
  it('a ring that closes to three positions ([A, B, A]) is not an area', () => {
    const bad = tfr({
      id: 'd',
      boundaries: [
        [37, -122],
        [38, -121],
        [37, -122],
      ],
    });
    expect(tfrFeatures([bad], 0).features).toEqual([]);
    expect(
      advisoryFeatures([
        {
          id: 'x',
          kind: 'a',
          hazardCode: 'h',
          colorHex: '#fff',
          validFrom: 0,
          validTo: 1,
          boundaries: [
            [1, 1],
            [2, 2],
            [1, 1],
          ],
        },
      ]).features,
    ).toEqual([]);
  });
});

describe('airportFeatures', () => {
  it('maps icao, name, type and isTowered (a tower frequency)', () => {
    const a = makeAirport({
      icao: 'KPAO',
      name: 'Palo Alto',
      latitude: 37.46,
      longitude: -122.11,
      elevation: 4,
      type: 'airport',
      ownership: 'public',
      frequencies: [{ id: 'f', type: 'tower', frequency: 118.6, name: 'Tower' }],
    });
    const b = makeAirport({
      icao: 'KSQL',
      name: 'San Carlos',
      latitude: 37.5,
      longitude: -122.2,
      elevation: 5,
      type: 'airport',
      ownership: 'public',
    });
    const fc = airportFeatures([a, b]);
    expect(fc.features[0]).toMatchObject({
      id: 'KPAO',
      geometry: { type: 'Point', coordinates: [-122.11, 37.46] },
      properties: { icao: 'KPAO', name: 'Palo Alto', type: 'airport', isTowered: true },
    });
    expect(fc.features[1]!.properties.isTowered).toBe(false);
  });
});

describe('navaidFeatures', () => {
  it('maps id, name and type', () => {
    const fc = navaidFeatures([
      { id: 'SJC', name: 'San Jose', type: 'vor_dme', latitude: 37.36, longitude: -121.93, frequency: 114.1 },
    ]);
    expect(fc.features[0]!.properties).toEqual({ id: 'SJC', name: 'San Jose', type: 'vor_dme' });
  });
});

describe('airspaceFeatures', () => {
  const base = { id: 'a', classification: 'charlie' as const, name: 'SJC', floor: 0, ceiling: 4200 };
  it('polygons need 3+ points; the label is floor/ceiling', () => {
    const ok: Airspace = {
      ...base,
      geometry: {
        kind: 'polygon',
        coordinates: [
          [37, -122],
          [37, -121],
          [38, -121],
        ],
      },
    };
    const bad: Airspace = {
      ...base,
      id: 'b',
      geometry: {
        kind: 'polygon',
        coordinates: [
          [37, -122],
          [37, -121],
        ],
      },
    };
    const fc = airspaceFeatures([ok, bad]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).toEqual({
      name: 'SJC',
      airspaceClass: 'charlie',
      floorAltitude: 0,
      ceilingAltitude: 4200,
      label: '0/4200',
    });
  });

  it('circles become a closed 36-point ring, due north at index 0', () => {
    const c: Airspace = { ...base, geometry: { kind: 'circle', center: [37, -122], radiusNM: 5 } };
    const g = airspaceFeatures([c]).features[0]!.geometry;
    if (g.type !== 'Polygon') throw new Error('polygon expected');
    const ring = g.coordinates[0]!;
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    const radiusDeg = (5 * 1852) / 111320;
    expect(ring[0]![1]).toBeCloseTo(37 + radiusDeg, 6);
    expect(ring[0]![0]).toBeCloseTo(-122, 6);
  });

  it('a circle with a short centre is skipped', () => {
    const c: Airspace = { ...base, geometry: { kind: 'circle', center: [37], radiusNM: 5 } };
    expect(airspaceFeatures([c]).features).toHaveLength(0);
  });
});

describe('weatherDotFeatures', () => {
  it('skips stations without coordinates and carries the flight category', () => {
    const wx = [
      makeWeatherCache({ id: '1', stationID: 'KPAO', flightCategory: 'ifr', fetchedAt: 0 }),
      makeWeatherCache({ id: '2', stationID: 'KXXX', flightCategory: 'vfr', fetchedAt: 0 }),
    ];
    const fc = weatherDotFeatures(wx, new Map([['KPAO', { lat: 37.46, lon: -122.11 }]]));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).toEqual({ stationID: 'KPAO', flightCategory: 'ifr' });
  });
});

describe('tfrFeatures', () => {
  const now = 1_000_000;
  it('in-effect 0.25, upcoming 0.08, stale halves it, expired is skipped, degenerate ring skipped', () => {
    const active = tfr({ id: 'a', effectiveDate: now - 1, expirationDate: now + 1 });
    const upcoming = tfr({ id: 'u', effectiveDate: now + 100 });
    const expired = tfr({ id: 'e', expirationDate: now - 1 });
    const degenerate = tfr({ id: 'd', boundaries: [[1, 1]] });
    const fresh = tfrFeatures([active, upcoming, expired, degenerate], now, false);
    expect(fresh.features.map((f) => [f.properties.id, f.properties.opacity, f.properties.stale])).toEqual([
      ['a', 0.25, 0],
      ['u', 0.08, 0],
    ]);
    const stale = tfrFeatures([active], now, true);
    expect(stale.features[0]!.properties).toMatchObject({
      opacity: 0.125,
      stale: 1,
      notam: '6/1234',
      altitudes: 'See NOTAM',
    });
  });
});

describe('advisoryFeatures', () => {
  it('opacity 0.15 current, 0.06 stale; colour comes from the advisory', () => {
    const adv = {
      id: 'x',
      kind: 'sigmet',
      hazardCode: 'MTN OBSCN',
      colorHex: '#FF9500',
      validFrom: 0,
      validTo: 1,
      boundaries: [
        [1, 1],
        [1, 2],
        [2, 2],
      ],
    };
    expect(advisoryFeatures([adv], false).features[0]!.properties).toEqual({
      id: 'x',
      kind: 'sigmet',
      hazard: 'MTN OBSCN',
      color: '#FF9500',
      opacity: 0.15,
      stale: 0,
    });
    expect(advisoryFeatures([adv], true).features[0]!.properties).toMatchObject({ opacity: 0.06, stale: 1 });
  });
});
