import type { Airport } from '../../domain/core';
import { makeActiveRoute, makeLeg } from '../../domain/route/activeRoute';
import { NO_NAVIGATION } from '../../domain/route/navigation';
import { navigationRoute } from './navigationRoute';

const OWN = { lat: 37.5, lon: -122.25 };
const KOAK = { icao: 'KOAK', latitude: 37.72, longitude: -122.22 } as unknown as Airport;

describe('navigationRoute', () => {
  it('draws nothing without navigation', () => {
    expect(navigationRoute(NO_NAVIGATION, OWN)).toBeNull();
  });

  it('Direct-To is a great circle from ownship to the airport, and nothing without a fix', () => {
    const nav = { ...NO_NAVIGATION, directTo: KOAK, activeFlightPlan: true };
    expect(navigationRoute(nav, OWN)).toEqual({
      kind: 'greatCircle',
      points: [OWN, { lat: 37.72, lon: -122.22 }],
    });
    expect(navigationRoute(nav, null)).toBeNull();
  });

  it('a US direct plan runs from ownship to its destination', () => {
    const nav = { ...NO_NAVIGATION, activeFlightPlan: true, planDestinationCoordinate: { lat: 38, lon: -121 } };
    expect(navigationRoute(nav, OWN)).toEqual({ kind: 'greatCircle', points: [OWN, { lat: 38, lon: -121 }] });
  });

  it('a multi-leg route is the path through its legs, each joint once', () => {
    const route = makeActiveRoute([
      makeLeg({ fromCode: 'A', toCode: 'B', fromLatitude: 32, fromLongitude: 34, toLatitude: 32.1, toLongitude: 34.1, altitudeText: '', distanceNM: 5 }),
      makeLeg({ fromCode: 'B', toCode: 'C', fromLatitude: 32.1, fromLongitude: 34.1, toLatitude: 32.2, toLongitude: 34.3, altitudeText: '', distanceNM: 5 }),
    ]);
    const nav = { ...NO_NAVIGATION, activeFlightPlan: true, activeRoute: route };
    expect(navigationRoute(nav, OWN)).toEqual({
      kind: 'path',
      points: [
        { lat: 32, lon: 34 },
        { lat: 32.1, lon: 34.1 },
        { lat: 32.2, lon: 34.3 },
      ],
    });
  });
});
