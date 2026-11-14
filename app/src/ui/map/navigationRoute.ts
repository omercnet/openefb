// The route line on the map for the active navigation (MapContainerView's route overlay): Direct-To is a great circle
// from ownship to the airport; an Israel multi-leg route is its legs' vertices; a US direct plan is the line from
// departure to destination, which the plan sheet (I1b) supplies. Null draws no line.
import type { Coordinate } from '../../domain/core';
import { legVertices } from '../../domain/route/activeRoute';
import type { ActiveNavigation } from '../../domain/route/navigation';
import type { MapRoute } from './useMapData';

export function navigationRoute(nav: ActiveNavigation, ownship: Coordinate | null): MapRoute | null {
  if (nav.directTo) {
    if (!ownship) return null;
    return { kind: 'greatCircle', points: [ownship, { lat: nav.directTo.latitude, lon: nav.directTo.longitude }] };
  }
  const route = nav.activeRoute;
  if (route && route.legs.length > 0) {
    const points = route.legs.flatMap((leg, i) =>
      (i === 0 ? legVertices(leg) : legVertices(leg).slice(1)).map(([lat, lon]) => ({ lat: lat!, lon: lon! })),
    );
    return { kind: 'path', points };
  }
  if (nav.activeFlightPlan && ownship && nav.planDestinationCoordinate) {
    return { kind: 'greatCircle', points: [ownship, nav.planDestinationCoordinate] };
  }
  return null;
}
