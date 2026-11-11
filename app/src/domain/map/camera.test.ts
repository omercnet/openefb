// Camera reducer: ports the follow/first-fix/recenter/map-mode rules of MapViewModel (onOwnshipUpdated, recenter,
// setMapMode, onUserMovedMap, onMapDirectionChanged). No Swift test covers them directly (MapViewModelTests exercise
// the view model against MapService), so these cases are written from the Swift control flow.
import {
  cameraReducer,
  FIRST_FIX_ZOOM,
  gestureSuspendsFollow,
  initialCameraState,
  type CameraAction,
  type CameraState,
} from './camera';

const here = { lat: 32.0, lon: 34.8 };
const there = { lat: 32.1, lon: 34.9 };
const fix = (over: Partial<Extract<CameraAction, { type: 'fix' }>> = {}): CameraAction => ({
  type: 'fix',
  timestamp: 1000,
  position: here,
  trackDeg: 90,
  inRegion: true,
  ...over,
});
const run = (s: CameraState, ...actions: CameraAction[]) => {
  let state = s;
  let command = null as ReturnType<typeof cameraReducer>['command'];
  for (const a of actions) ({ state, command } = cameraReducer(state, a));
  return { state, command };
};

describe('camera reducer', () => {
  it('first fix jumps to the aircraft at the first-fix zoom without animation', () => {
    const { command, state } = run(initialCameraState(), fix());
    expect(command).toEqual({ center: here, zoom: FIRST_FIX_ZOOM, direction: 0, animated: false });
    expect(state.hasCenteredOnFirstFix).toBe(true);
  });

  it('first fix outside the region is drawn but never moves the camera, and does not consume the first-fix jump', () => {
    const outside = run(initialCameraState(), fix({ inRegion: false }));
    expect(outside.command).toBeNull();
    expect(outside.state.hasCenteredOnFirstFix).toBe(false);
    expect(outside.state.lastFixTimestamp).toBe(1000);
  });

  it('while following, later fixes re-centre at the current zoom', () => {
    const { command } = run(initialCameraState(), fix(), fix({ timestamp: 2000, position: there }));
    expect(command).toEqual({ center: there, zoom: null, direction: 0, animated: false });
  });

  it('a duplicate fix (same timestamp) is ignored', () => {
    const { command } = run(initialCameraState(), fix(), fix({ position: there }));
    expect(command).toBeNull();
  });

  it('a user pan suspends follow: later fixes do not move the camera', () => {
    const { command, state } = run(
      initialCameraState(),
      fix(),
      { type: 'userMoved' },
      fix({ timestamp: 2000, position: there }),
    );
    expect(command).toBeNull();
    expect(state.follow.mode).toBe('suspended');
  });

  it('recenter re-engages follow and animates to the ownship at the current zoom', () => {
    const { command, state } = run(
      initialCameraState(),
      fix(),
      { type: 'userMoved' },
      { type: 'recenter', position: there, trackDeg: 10 },
    );
    expect(command).toEqual({ center: there, zoom: null, direction: 0, animated: true });
    expect(state.follow.mode).toBe('following');
  });

  it('recenter without a fix re-engages follow but issues no camera command', () => {
    const { command, state } = run(
      initialCameraState(),
      { type: 'userMoved' },
      { type: 'recenter', position: null, trackDeg: 0 },
    );
    expect(command).toBeNull();
    expect(state.follow.mode).toBe('following');
  });

  it('track-up rotates the camera to the GPS track, north-up keeps it at 0', () => {
    const tu = run(initialCameraState(), { type: 'setMode', mode: 'trackUp', position: here, trackDeg: 123 });
    expect(tu.command).toEqual({ center: here, zoom: null, direction: 123, animated: true });
    const fixed = run(tu.state, fix({ trackDeg: 130 }));
    expect(fixed.command?.direction).toBe(130);
  });

  it('setMode while suspended rotates but does not re-centre', () => {
    const { command } = run(
      initialCameraState(),
      { type: 'userMoved' },
      { type: 'setMode', mode: 'trackUp', position: here, trackDeg: 45 },
    );
    expect(command).toEqual({ center: null, zoom: null, direction: 45, animated: true });
  });

  it('setMode while following without a fix still rotates', () => {
    const { command } = run(initialCameraState(), { type: 'setMode', mode: 'trackUp', position: null, trackDeg: 45 });
    expect(command).toEqual({ center: null, zoom: null, direction: 45, animated: true });
  });

  it('direction changes under 0.1 degrees are ignored (north indicator)', () => {
    const a = run(initialCameraState(), { type: 'directionChanged', direction: 0.05 });
    expect(a.state.mapDirection).toBe(0);
    const b = run(a.state, { type: 'directionChanged', direction: 12 });
    expect(b.state.mapDirection).toBe(12);
    expect(b.command).toBeNull();
  });

  it('NaN track falls back to north (JS-only guard)', () => {
    const { command } = run({ ...initialCameraState(), mode: 'trackUp' }, fix({ trackDeg: Number.NaN }));
    expect(command?.direction).toBe(0);
  });
});

describe('gestureSuspendsFollow', () => {
  const prev = { center: { lat: 32, lon: 34.8 }, bearing: 0, spanDeg: 0.4 };
  it('programmatic moves never suspend, and neither does the first sample', () => {
    expect(gestureSuspendsFollow(prev, { ...prev, center: { lat: 33, lon: 35 } }, false)).toBe(false);
    expect(gestureSuspendsFollow(null, prev, true)).toBe(false);
  });
  it('a pan beyond 2% of the span suspends; a pinch around the centre does not', () => {
    expect(gestureSuspendsFollow(prev, { ...prev, center: { lat: 32.05, lon: 34.8 } }, true)).toBe(true);
    expect(gestureSuspendsFollow(prev, { ...prev, spanDeg: 0.2 }, true)).toBe(false);
    expect(gestureSuspendsFollow(prev, { ...prev, center: { lat: 32.001, lon: 34.8 } }, true)).toBe(false);
  });
  it('a rotation over 1 degree suspends, including across north', () => {
    expect(gestureSuspendsFollow(prev, { ...prev, bearing: 5 }, true)).toBe(true);
    expect(gestureSuspendsFollow({ ...prev, bearing: 359.5 }, { ...prev, bearing: 0.2 }, true)).toBe(false);
    expect(gestureSuspendsFollow({ ...prev, bearing: 350 }, { ...prev, bearing: 10 }, true)).toBe(true);
  });
  it('handles the antimeridian and NaN without suspending on garbage', () => {
    const a = { center: { lat: 0, lon: 179.99 }, bearing: 0, spanDeg: 10 };
    expect(gestureSuspendsFollow(a, { ...a, center: { lat: 0, lon: -179.99 } }, true)).toBe(false);
    expect(gestureSuspendsFollow(a, { ...a, bearing: Number.NaN }, true)).toBe(false);
  });
});
