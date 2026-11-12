// Pure camera reducer for the map screen: follow ownship, first-fix jump, recenter and map mode. Ports the control
// flow of MapViewModel.onOwnshipUpdated / recenter / setMapMode / onUserMovedMap / onMapDirectionChanged. The reducer
// returns the new state and the camera command to apply (or null); applying it to MapLibre is the surface's job.
import type { Coordinate, MapMode } from '../core';
import { followModeState, isFollowing, recenter, userMovedMap, type FollowModeState } from './followMode';

/** Zoom used when the first fix arrives and the map jumps from the region view to the aircraft. */
export const FIRST_FIX_ZOOM = 10;

export interface CameraState {
  readonly follow: FollowModeState;
  readonly mode: MapMode;
  /** Live camera rotation, degrees clockwise from north (drives the north indicator). */
  readonly mapDirection: number;
  readonly hasCenteredOnFirstFix: boolean;
  readonly lastFixTimestamp: number | null;
}

/** `center`/`zoom` null mean "leave as is" (Swift nil). */
export interface CameraCommand {
  readonly center: Coordinate | null;
  readonly zoom: number | null;
  readonly direction: number;
  readonly animated: boolean;
}

export type CameraAction =
  | { type: 'fix'; timestamp: number; position: Coordinate; trackDeg: number; inRegion: boolean }
  | { type: 'userMoved' }
  | { type: 'recenter'; position: Coordinate | null; trackDeg: number }
  | { type: 'setMode'; mode: MapMode; position: Coordinate | null; trackDeg: number }
  | { type: 'directionChanged'; direction: number };

export const initialCameraState = (mode: MapMode = 'northUp'): CameraState => ({
  follow: followModeState(),
  mode,
  mapDirection: 0,
  hasCenteredOnFirstFix: false,
  lastFixTimestamp: null,
});

/** GPS track for track-up, north otherwise. A non-finite track falls back to north (JS-only guard). */
const directionFor = (mode: MapMode, trackDeg: number): number =>
  mode === 'trackUp' && Number.isFinite(trackDeg) ? trackDeg : 0;

export function cameraReducer(
  state: CameraState,
  action: CameraAction,
): { state: CameraState; command: CameraCommand | null } {
  switch (action.type) {
    case 'fix': {
      if (action.timestamp === state.lastFixTimestamp) return { state, command: null };
      const next = { ...state, lastFixTimestamp: action.timestamp };
      // A fix outside the selected region is drawn but never pulls the camera away from the home view.
      if (!action.inRegion) return { state: next, command: null };
      const direction = directionFor(state.mode, action.trackDeg);
      if (!state.hasCenteredOnFirstFix) {
        return {
          state: { ...next, hasCenteredOnFirstFix: true },
          command: { center: action.position, zoom: FIRST_FIX_ZOOM, direction, animated: false },
        };
      }
      if (!isFollowing(state.follow)) return { state: next, command: null };
      return { state: next, command: { center: action.position, zoom: null, direction, animated: false } };
    }
    case 'userMoved':
      return {
        state: isFollowing(state.follow) ? { ...state, follow: userMovedMap(state.follow) } : state,
        command: null,
      };
    case 'recenter': {
      const next = { ...state, follow: recenter(state.follow) };
      if (!action.position) return { state: next, command: null };
      return {
        state: next,
        command: {
          center: action.position,
          zoom: null,
          direction: directionFor(state.mode, action.trackDeg),
          animated: true,
        },
      };
    }
    case 'setMode':
      return {
        state: { ...state, mode: action.mode },
        command: {
          center: isFollowing(state.follow) ? action.position : null,
          zoom: null,
          direction: directionFor(action.mode, action.trackDeg),
          animated: true,
        },
      };
    case 'directionChanged':
      if (!(Math.abs(action.direction - state.mapDirection) > 0.1)) return { state, command: null };
      return { state: { ...state, mapDirection: action.direction }, command: null };
  }
}

export interface ViewSample {
  center: Coordinate;
  bearing: number;
  /** Larger of the visible latitude and longitude spans, degrees. */
  spanDeg: number;
}

/** Fraction of the visible span the centre must move, or degrees the bearing must change, to count as a pan or rotate. */
export const PAN_FRACTION = 0.02;
export const ROTATE_DEGREES = 1;

/**
 * Whether a finger gesture was a pan or rotate (suspends follow) rather than a pinch-zoom (the next fix re-centres
 * anyway). MapLibre RN reports one `userInteraction` flag for every gesture, so the kind is inferred from how far the
 * centre and bearing moved between two samples. Programmatic moves (`userInteraction` false) never suspend.
 * JS-only: Swift received the gesture kind from the MapLibre delegate.
 */
export function gestureSuspendsFollow(prev: ViewSample | null, next: ViewSample, userInteraction: boolean): boolean {
  if (!userInteraction || !prev) return false;
  const dLat = Math.abs(next.center.lat - prev.center.lat);
  let dLon = Math.abs(next.center.lon - prev.center.lon);
  if (dLon > 180) dLon = 360 - dLon; // across the antimeridian
  const moved = Math.max(dLat, dLon) > PAN_FRACTION * Math.max(next.spanDeg, 1e-9);
  let dBearing = Math.abs(next.bearing - prev.bearing) % 360;
  if (dBearing > 180) dBearing = 360 - dBearing;
  const bad = !Number.isFinite(dLat + dLon + dBearing);
  return !bad && (moved || dBearing > ROTATE_DEGREES);
}
