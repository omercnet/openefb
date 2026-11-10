import {
  airportCoordinate,
  airportsEqual,
  chartRegionIsExpired,
  cycleIsExpired,
  makeAirport,
  makeFlightPlan,
  makeWaypoint,
  makeWeatherCache,
  tfrAltitudeDescription,
  tfrAltitudeDisplay,
  tfrAltitudeFeet,
  tfrCoordinate,
  tfrDetailUrl,
  tfrIsActive,
  waypointCoordinate,
  weatherCacheAge,
  weatherCacheIsStale,
  type Tfr,
} from './models';
import {
  AIRPORT_TYPES,
  AIRSPACE_CLASSES,
  boundingBoxContains,
  decodeAirspaceGeometry,
  encodeAirspaceGeometry,
  FLIGHT_CATEGORIES,
  flightCategoryColorName,
  MAP_MODES,
  OWNERSHIP_TYPES,
  tfrTypeDisplayName,
  tfrTypeFromFaa,
  weatherRefreshInterval,
} from './types';

const airport = (icao = 'KPAO', name = 'Palo Alto') =>
  makeAirport({
    icao,
    faaID: 'PAO',
    name,
    latitude: 37.4611,
    longitude: -122.115,
    elevation: 4,
    type: 'airport',
    ownership: 'public',
    ctafFrequency: 118.6,
    patternAltitude: 800,
    fuelTypes: ['100LL'],
    hasBeaconLight: true,
  });

describe('Aviation Model Tests', () => {
  it('airportIdentity / airportProperties', () => {
    const a = airport();
    expect([a.icao, a.name]).toEqual(['KPAO', 'Palo Alto']);
    expect(a.type).toBe('airport');
    expect(a.ownership).toBe('public');
    expect(a.ctafFrequency).toBe(118.6);
    expect(a.elevation).toBe(4);
    expect(a.patternAltitude).toBe(800);
    expect(a.fuelTypes).toEqual(['100LL']);
    expect(a.hasBeaconLight).toBe(true);
  });
  it('airportCoordinate', () => {
    expect(airportCoordinate(airport())).toEqual({ lat: 37.4611, lon: -122.115 });
  });
  it('airportEquality is by ICAO only', () => {
    expect(airportsEqual(airport('KPAO'), airport('KPAO', 'Different Name'))).toBe(true);
    expect(airportsEqual(airport('KPAO'), airport('KSQL'))).toBe(false);
  });
  it('flightPlanCreation', () => {
    const p = makeFlightPlan({ id: 'a', departure: 'KPAO', destination: 'KSQL', createdAt: 0 });
    expect(p).toMatchObject({ cruiseAltitude: 3000, cruiseSpeed: 100, totalDistance: 0, estimatedTime: 0 });
    expect(p.waypoints).toEqual([]);
  });
  it('flightPlanCustomValues', () => {
    const p = makeFlightPlan({
      id: 'a',
      departure: 'KPAO',
      destination: 'KOAK',
      createdAt: 0,
      cruiseAltitude: 5500,
      cruiseSpeed: 120,
      fuelBurnRate: 8.5,
      notes: 'Bay tour',
    });
    expect([p.cruiseAltitude, p.cruiseSpeed, p.fuelBurnRate, p.notes]).toEqual([5500, 120, 8.5, 'Bay tour']);
  });
  it('weatherCacheFreshness / staleness / age / boundary', () => {
    const now = 1_800_000_000_000;
    const at = (secAgo: number) => makeWeatherCache({ id: 'w', stationID: 'KPAO', fetchedAt: now - secAgo * 1000 });
    expect(weatherCacheIsStale(at(0), now)).toBe(false);
    expect(weatherCacheIsStale(at(7200), now)).toBe(true);
    expect(weatherCacheAge(at(7200), now)).toBe(7200);
    expect(weatherCacheIsStale(at(3599), now)).toBe(false);
    expect(weatherCacheIsStale(at(3601), now)).toBe(true);
  });
  it('weatherCacheDefaults', () => {
    const c = makeWeatherCache({ id: 'w', stationID: 'KPAO', fetchedAt: 0 });
    expect(c.flightCategory).toBe('vfr');
    expect(c.rawMETAR).toBeUndefined();
    expect(c.windDirection).toBeUndefined();
  });
  it('flightCategory colors and cases', () => {
    expect(['vfr', 'mvfr', 'ifr', 'lifr'].map((c) => flightCategoryColorName(c as never))).toEqual([
      'green',
      'blue',
      'red',
      'magenta',
    ]);
    expect(FLIGHT_CATEGORIES).toHaveLength(4);
  });
  it('boundingBox contains / edge / outside longitude', () => {
    const box = { minLatitude: 37, maxLatitude: 38, minLongitude: -123, maxLongitude: -122 };
    expect(boundingBoxContains(box, { lat: 37.5, lon: -122.5 })).toBe(true);
    expect(boundingBoxContains(box, { lat: 36, lon: -122.5 })).toBe(false);
    expect(boundingBoxContains(box, { lat: 37, lon: -123 })).toBe(true);
    expect(boundingBoxContains(box, { lat: 37.5, lon: -121 })).toBe(false);
  });
  it('waypointCreation', () => {
    const w = makeWaypoint({ id: 'x', identifier: 'KPAO', name: 'Palo Alto', latitude: 37.4611, longitude: -122.115 });
    expect(w.type).toBe('airport');
    expect(w.altitude).toBeUndefined();
    expect(waypointCoordinate(w).lat).toBe(37.4611);
  });
  it('raw values are the persisted Swift strings', () => {
    expect(AIRPORT_TYPES).toEqual(['airport', 'heliport', 'seaplane', 'ultralight']);
    expect(OWNERSHIP_TYPES).toEqual(['public', 'private', 'military']);
    expect(AIRSPACE_CLASSES).toHaveLength(11);
    expect(MAP_MODES).toEqual(['northUp', 'trackUp']);
  });
  it('cycle and chart expiry', () => {
    expect(cycleIsExpired({ source: 's', effective: 0, expires: 10 }, 10)).toBe(true);
    expect(cycleIsExpired({ source: 's', effective: 0, expires: 10 }, 9)).toBe(false);
    const box = { minLatitude: 0, maxLatitude: 1, minLongitude: 0, maxLongitude: 1 };
    const c = {
      id: 'c',
      name: 'c',
      effectiveDate: 0,
      expirationDate: 10,
      boundingBox: box,
      fileSizeMB: 1,
      isDownloaded: false,
    };
    expect(chartRegionIsExpired(c, 11)).toBe(true);
    expect(chartRegionIsExpired(c, 10)).toBe(false);
  });
});

describe('TFR and type helpers', () => {
  const tfr: Tfr = {
    id: '1',
    notamID: '6/1234',
    type: 'VIP',
    title: 't',
    boundaries: [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
      [0, 0],
    ],
    effectiveDate: 100,
    expirationDate: 200,
    floor: { value: 0, reference: 'agl' },
    ceiling: { value: 180, reference: 'flightLevel' },
  };
  it('isActive follows the dates', () => {
    expect(tfrIsActive(tfr, 99)).toBe(false);
    expect(tfrIsActive(tfr, 100)).toBe(true);
    expect(tfrIsActive(tfr, 200)).toBe(true);
    expect(tfrIsActive(tfr, 201)).toBe(false);
    expect(tfrIsActive({ ...tfr, effectiveDate: null, expirationDate: null }, 1e15)).toBe(true);
  });
  it('altitudes', () => {
    expect(tfrAltitudeDescription(tfr)).toBe('SFC-FL180');
    expect(tfrAltitudeDescription({ ...tfr, floor: null })).toBe('See NOTAM');
    expect(tfrAltitudeDisplay({ value: 5, reference: 'flightLevel' })).toBe('FL005');
    expect(tfrAltitudeDisplay({ value: 3000, reference: 'msl' })).toBe("3000' MSL");
    expect(tfrAltitudeDisplay({ value: 400, reference: 'agl' })).toBe("400' AGL");
    expect(tfrAltitudeFeet({ value: 180, reference: 'flightLevel' })).toBe(18000);
  });
  it('coordinate and detail URL', () => {
    expect(tfrCoordinate(tfr)).toEqual({ lat: 1, lon: 1 });
    expect(tfrCoordinate({ ...tfr, boundaries: [] })).toEqual({ lat: 0, lon: 0 });
    expect(tfrDetailUrl(tfr)).toBe('https://tfr.faa.gov/tfr3/?page=detail_6_1234');
  });
  it('TFRType parsing and names', () => {
    expect(tfrTypeFromFaa(' air shows/sports ')).toBe('AIR SHOWS/SPORTS');
    expect(tfrTypeFromFaa('nonsense')).toBe('OTHER');
    expect(tfrTypeDisplayName('AIR SHOWS/SPORTS')).toBe('Air Show / Sports');
  });
  it('AirspaceGeometry round-trips the Swift JSON shape', () => {
    const poly = {
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    };
    const circle = { center: [1, 2], radiusNM: 5 };
    expect(encodeAirspaceGeometry(decodeAirspaceGeometry(poly))).toEqual(poly);
    expect(encodeAirspaceGeometry(decodeAirspaceGeometry(circle))).toEqual(circle);
    expect(() => decodeAirspaceGeometry({})).toThrow('Invalid AirspaceGeometry');
  });
  it('power state intervals', () => {
    expect(weatherRefreshInterval('emergency')).toBe(Infinity);
    expect(weatherRefreshInterval('normal')).toBe(900);
  });
});
