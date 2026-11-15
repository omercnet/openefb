// Hooks that connect the platform-free map logic to React: the data controller as an external store, the camera
// reducer with a command sequence number, and the composition of every source the surface draws. Real wiring (the app
// store, the aviation database, weather/TFR services) is I1; callers pass the controller dependencies in.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Coordinate, MapMode } from '../../domain/core';
import { cameraReducer, gestureSuspendsFollow, initialCameraState, type CameraAction, type CameraCommand, type CameraState, type ViewSample } from '../../domain/map/camera';
import { isFollowing } from '../../domain/map/followMode';
import { EMPTY_COLLECTION, type FeatureCollection } from '../../domain/map/geojson';
import { MapDataController, type MapDataDeps, type MapDataSnapshot } from '../../domain/map/mapDataController';
import { ownshipFeatures, routeLineGreatCircle, routeLinePath } from '../../domain/map/ownshipRoute';
import { trackRuler } from '../../domain/map/trackRuler';
import type { MapViewChange } from './MapSurface';

/** One controller per mounted map (`deps` are read once); disposed, and re-armed under strict mode, with the component. */
export function useMapController(deps: MapDataDeps): MapDataController {
  const [controller] = useState(() => new MapDataController(deps));
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  return controller;
}

export const useMapData = (controller: MapDataController): MapDataSnapshot =>
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

/** The map's size in points. */
export interface Viewport {
  width: number;
  height: number;
}

/** Web mercator y of a latitude, in radians of the world circumference (the vertical scale grows as 1/cos(lat)). */
const mercatorY = (latDeg: number): number => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));

/** Points per radian of the world at `zoom` (512 pt tiles: the world is 512 * 2^zoom points around). */
const pointsPerRadian = (zoom: number): number => (512 * 2 ** zoom) / (2 * Math.PI);

/** The viewport the camera's last report implies, from the projected corners of the reported bounds. */
export function viewportOf(view: { zoom: number; northEast: Coordinate; southWest: Coordinate }): Viewport {
  const scale = pointsPerRadian(view.zoom);
  return {
    width: Math.abs(view.northEast.lon - view.southWest.lon) * (Math.PI / 180) * scale,
    height: Math.abs(mercatorY(view.northEast.lat) - mercatorY(view.southWest.lat)) * scale,
  };
}

/** Swift framed the box with 100 pt of padding on each side (setVisibleCoordinateBounds edgePadding). */
export const FRAME_PADDING_PT = 100;

/**
 * The centre and web-mercator zoom that fit `box` in `viewport` with the padding on every side, for a map rotated by
 * `bearingDeg` (the screen shows the box turned the other way, so its extent on screen is that of the rotated corners).
 * Without a viewport (the map has not reported yet) a 600 pt square is assumed.
 */
export function frameFor(
  box: { south: number; west: number; north: number; east: number },
  viewport: Viewport = { width: 600, height: 600 },
  bearingDeg = 0,
): { center: Coordinate; zoom: number } {
  const center = { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 };
  const cy = mercatorY(center.lat);
  const turn = (bearingDeg * Math.PI) / 180;
  let halfX = 0;
  let halfY = 0;
  for (const lat of [box.south, box.north]) {
    for (const lon of [box.west, box.east]) {
      const x = ((lon - center.lon) * Math.PI) / 180;
      const y = mercatorY(lat) - cy;
      // Rotating the map by `bearing` turns the north-up box by -bearing on screen.
      halfX = Math.max(halfX, Math.abs(x * Math.cos(turn) - y * Math.sin(turn)));
      halfY = Math.max(halfY, Math.abs(x * Math.sin(turn) + y * Math.cos(turn)));
    }
  }
  const extentX = Math.max(2 * halfX, 0.0002);
  const extentY = Math.max(2 * halfY, 0.0002);
  const usable = (px: number) => Math.max(px - 2 * FRAME_PADDING_PT, 100);
  const fit = (px: number, extent: number) => Math.log2((usable(px) * 2 * Math.PI) / (512 * extent));
  const zoom = Math.min(14, Math.max(4, Math.min(fit(viewport.width, extentX), fit(viewport.height, extentY))));
  return { center, zoom };
}

export interface CameraModel {
  state: CameraState;
  camera: { seq: number; command: CameraCommand | null };
  dispatch: (action: CameraAction) => void;
}

/** The pure camera reducer behind a stable `dispatch`; every action bumps `seq` so the surface applies each command once. */
export function useCameraModel(initialMode: MapMode = 'northUp'): CameraModel {
  const [initial] = useState(() => initialCameraState(initialMode));
  const stateRef = useRef<CameraState>(initial);
  const [model, setModel] = useState<{ state: CameraState; camera: { seq: number; command: CameraCommand | null } }>({
    state: initial,
    camera: { seq: 0, command: null },
  });
  const dispatch = useCallback((action: CameraAction) => {
    const { state, command } = cameraReducer(stateRef.current, action);
    stateRef.current = state;
    setModel((m) => ({ state, camera: command ? { seq: m.camera.seq + 1, command } : m.camera }));
  }, []);
  return { state: model.state, camera: model.camera, dispatch };
}

export interface OwnshipInput {
  position: Coordinate | null;
  trackDeg: number;
  groundSpeedKt: number;
  /** Fix time (epoch ms); duplicates are ignored by the camera. */
  timestamp: number | null;
  stale: boolean;
}

export interface MapRoute {
  kind: 'greatCircle' | 'path';
  points: readonly Coordinate[];
}

/** Sources that do not come from the data controller: ownship, ruler and route, plus any extra (Israel) sources. */
export function composeSources(
  snapshot: MapDataSnapshot,
  ownship: OwnshipInput,
  mapDirection: number,
  route: MapRoute | null,
  extra: Readonly<Record<string, FeatureCollection>> = {},
  rulerMinutes?: readonly number[],
): Record<string, FeatureCollection> {
  const ruler = trackRuler(ownship.stale ? null : ownship.position, ownship.trackDeg, ownship.groundSpeedKt, mapDirection, rulerMinutes);
  let routeLine = EMPTY_COLLECTION;
  if (route?.kind === 'path') routeLine = routeLinePath(route.points);
  else if (route && route.points.length >= 2) routeLine = routeLineGreatCircle(route.points[0]!, route.points[route.points.length - 1]!);
  return {
    advisories: snapshot.sources.advisories,
    airports: snapshot.sources.airports,
    navaids: snapshot.sources.navaids,
    airspaces: snapshot.sources.airspaces,
    'weather-dots': snapshot.sources.weather,
    tfrs: snapshot.sources.tfrs,
    ownship: ownshipFeatures(ownship.position, ownship.trackDeg, ownship.stale),
    'track-ruler-line': ruler.line,
    'track-ruler-ticks': ruler.ticks,
    'route-line': routeLine,
    ...extra,
  };
}

export interface MapModelInput {
  controller: MapDataController;
  ownship: OwnshipInput;
  /** True when the fix is inside the selected region (a fix elsewhere never pulls the camera). */
  ownshipInRegion: boolean;
  initialMode?: MapMode;
  route?: MapRoute | null;
  extraSources?: Readonly<Record<string, FeatureCollection>>;
  rulerMinutes?: readonly number[];
}

/** Everything a map screen needs: snapshot, composed sources, camera, and handlers for the surface and the buttons. */
export function useMapModel(input: MapModelInput) {
  const { controller, ownship, ownshipInRegion } = input;
  const snapshot = useMapData(controller);
  const cam = useCameraModel(input.initialMode ?? 'northUp');
  const { dispatch } = cam;
  const lastView = useRef<ViewSample | null>(null);
  const viewport = useRef<Viewport | null>(null);

  // Every new fix goes through the reducer: first-fix jump, follow, duplicates ignored.
  useEffect(() => {
    if (!ownship.position || ownship.timestamp === null) return;
    dispatch({ type: 'fix', timestamp: ownship.timestamp, position: ownship.position, trackDeg: ownship.trackDeg, inRegion: ownshipInRegion });
  }, [dispatch, ownship.position, ownship.timestamp, ownship.trackDeg, ownshipInRegion]);

  const onViewChange = useCallback(
    (c: MapViewChange) => {
      const sample: ViewSample = {
        center: c.center,
        bearing: c.bearing,
        spanDeg: Math.max(c.northEast.lat - c.southWest.lat, Math.abs(c.northEast.lon - c.southWest.lon)),
      };
      if (gestureSuspendsFollow(lastView.current, sample, c.userInteraction)) dispatch({ type: 'userMoved' });
      lastView.current = sample;
      viewport.current = viewportOf(c);
      dispatch({ type: 'directionChanged', direction: c.bearing });
      controller.onRegionChanged(c.center, c.zoom, c.northEast, c.southWest);
    },
    [controller, dispatch],
  );

  const recenter = useCallback(
    () => dispatch({ type: 'recenter', position: ownship.position, trackDeg: ownship.trackDeg }),
    [dispatch, ownship.position, ownship.trackDeg],
  );
  const frame = useCallback(
    (box: { south: number; west: number; north: number; east: number }) =>
      dispatch({ type: 'frame', ...frameFor(box, viewport.current ?? undefined, lastView.current?.bearing ?? 0) }),
    [dispatch],
  );
  const zoomTo = useCallback((level: number) => dispatch({ type: 'zoomTo', level }), [dispatch]);
  const setMode = useCallback(
    (mode: MapMode) => dispatch({ type: 'setMode', mode, position: ownship.position, trackDeg: ownship.trackDeg }),
    [dispatch, ownship.position, ownship.trackDeg],
  );

  const sources = useMemo(
    () => composeSources(snapshot, ownship, cam.state.mapDirection, input.route ?? null, input.extraSources, input.rulerMinutes),
    [snapshot, ownship, cam.state.mapDirection, input.route, input.extraSources, input.rulerMinutes],
  );

  return {
    snapshot,
    sources,
    camera: cam.camera,
    isFollowing: isFollowing(cam.state.follow),
    mapMode: cam.state.mode,
    mapDirection: cam.state.mapDirection,
    onViewChange,
    onTileHealth: useCallback(
      (e: 'error' | 'ok') => (e === 'error' ? controller.noteTileError() : controller.noteTileLoadedFromNetwork()),
      [controller],
    ),
    onStyleLoaded: useCallback(() => void controller.onMapStyleLoaded(), [controller]),
    recenter,
    setMode,
    zoomTo,
    frame,
  };
}
