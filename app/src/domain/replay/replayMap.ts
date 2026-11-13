// What the replay map draws, as data (efb-212/Services/MapService.swift: addReplayLayers, updateReplayTrack,
// updateReplayMarker, fitMapToTrack). MapLibre React Native has no imperative addLayer or setShape: the screen renders
// these as GeoJSON sources with the layers nested in them.

/** MapColor.replay: UIColor.systemOrange, light and dark. */
export const REPLAY_COLOR = { day: '#FF9500', night: '#FF9F0A' } as const;

/** The inset fitMapToTrack leaves around the track -- points. */
export const FIT_PADDING = { top: 50, right: 50, bottom: 50, left: 50 } as const;

export interface TrackCoordinate {
  latitude: number;
  longitude: number;
}

const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

/** The whole track as one line. Fewer than two points draw nothing (a one-position line is not valid GeoJSON; Swift drew nothing visible). */
export function replayTrackData(points: readonly TrackCoordinate[]): GeoJSON.FeatureCollection {
  if (points.length < 2) return empty();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.longitude, p.latitude]) },
      },
    ],
  };
}

/** The marker at the replay position, with the heading as a property (the icon is a circle, so it does not turn on screen). */
export function replayMarkerData(coordinate: { lat: number; lon: number }, heading: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { heading },
        geometry: { type: 'Point', coordinates: [coordinate.lon, coordinate.lat] },
      },
    ],
  };
}

/** West, south, east, north of the track; null for an empty track (the camera stays where it is). A loop: a spread overflows the stack on a long track. */
export function trackBounds(points: readonly TrackCoordinate[]): [number, number, number, number] | null {
  const first = points[0];
  if (first === undefined) return null;
  let west = first.longitude;
  let east = first.longitude;
  let south = first.latitude;
  let north = first.latitude;
  for (const { latitude, longitude } of points) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [west, south, east, north];
}
