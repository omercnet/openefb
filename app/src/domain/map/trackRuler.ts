// Port of MapService.updateTrackRuler / rulerLabelAnchor: a straight line from ownship along the track to the last
// minute mark at ground speed, ticked and labelled at 1, 2, 3, 5 and 10 minutes.
import { destinationPoint, type Coordinate } from '../core';
import { collection, EMPTY_COLLECTION, point, type Feature, type FeatureCollection } from './geojson';

/** Minutes ahead marked on the ruler; the line runs to the last one. */
export const TRACK_RULER_MINUTES: readonly number[] = [1, 2, 3, 5, 10];
/** Below this ground speed (knots) the ruler is cleared: a ruler from a taxiing position would mislead. */
export const TRACK_RULER_MIN_GROUND_SPEED_KT = 30;

/** Labels sit beside the ruler: right of a line running up/down the screen, below one running across it. */
export function rulerLabelAnchor(trackTrue: number, mapDirection = 0): 'top' | 'left' {
  const screenAngle = ((trackTrue - mapDirection) * Math.PI) / 180;
  return Math.abs(Math.sin(screenAngle)) > 0.707 ? 'top' : 'left';
}

export interface TrackRuler {
  line: FeatureCollection;
  ticks: FeatureCollection;
}

const CLEARED: TrackRuler = { line: EMPTY_COLLECTION, ticks: EMPTY_COLLECTION };

/**
 * A null origin (no fix or a stale fix) or a ground speed below 30 kt clears the ruler. `mapDirection` is the live
 * camera bearing, used only for the label anchor.
 */
export function trackRuler(
  origin: Coordinate | null,
  trackTrue: number,
  groundSpeedKnots: number,
  mapDirection = 0,
  minutes: readonly number[] = TRACK_RULER_MINUTES,
): TrackRuler {
  if (!origin || !(groundSpeedKnots >= TRACK_RULER_MIN_GROUND_SPEED_KT) || !Number.isFinite(trackTrue)) return CLEARED;
  const anchor = rulerLabelAnchor(trackTrue, mapDirection);
  const ticks: Feature[] = [];
  let end = origin;
  for (const m of minutes) {
    // NM = knots * minutes / 60
    const c = destinationPoint(origin, (groundSpeedKnots * m) / 60, trackTrue);
    end = c;
    ticks.push(
      point(c.lat, c.lon, {
        track: trackTrue,
        anchor,
        label: m === 1 ? '1 min' : m === 10 ? '10 min' : String(Math.trunc(m)),
      }),
    );
  }
  return {
    line: collection([
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [origin.lon, origin.lat],
            [end.lon, end.lat],
          ],
        },
        properties: {},
      },
    ]),
    ticks: collection(ticks),
  };
}
