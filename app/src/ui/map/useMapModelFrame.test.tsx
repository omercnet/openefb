import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { MapDataController } from '../../domain/map/mapDataController';
import { frameFor, useMapController, useMapModel } from './useMapData';

const db = {
  airportsNear: async () => [],
  toweredAirportsNear: async () => [],
  airspacesNear: async () => [],
  navaidsNear: async () => [],
};
const appState = {
  region: 'israel' as const,
  visibleLayers: new Set<never>(),
  mapCenter: { lat: 32, lon: 35 },
  mapZoom: 8,
  mapVisibleBounds: null,
};
const BOX = { south: 32, west: 34, north: 32.05, east: 36 }; // about 2 degrees wide

let model: ReturnType<typeof useMapModel> | null = null;
function Probe() {
  const controller = useMapController({ appState: { ...appState, visibleLayers: new Set() }, db });
  const m = useMapModel({
    controller: controller as MapDataController,
    ownship: { position: null, trackDeg: 0, groundSpeedKt: 0, timestamp: null, stale: false },
    ownshipInRegion: false,
  });
  // eslint-disable-next-line react-hooks/globals -- the test reads the latest model
  model = m;
  return null;
}

// A 1000 x 600 map turned 90 degrees: MapLibre reports the bounds of the turned screen, so they are 600 wide and 1000 tall
// in the north-up frame. The framing must still use the 1000 x 600 screen, not the 1000 x 1000 box that contains it.
const view = (bearing: number, zoom = 8) => ({
  center: { lat: 32, lon: 35 },
  zoom,
  bearing,
  northEast: { lat: 32 + 0.5, lon: 35 + 1 },
  southWest: { lat: 32 - 0.5, lon: 35 - 1 },
  userInteraction: false,
});

describe('useMapModel framing', () => {
  it('frames with the measured map size even when the map is rotated and its reported bounds are larger', async () => {
    await render(<Probe />);
    await act(async () => model!.onMapLayout({ width: 1000, height: 600 }));
    await act(async () => model!.onViewChange(view(90) as never));
    await act(async () => model!.frame(BOX));
    const command = model!.camera.command!;
    const expected = frameFor(BOX, { width: 1000, height: 600 }, 90);
    expect(command.zoom).toBeCloseTo(expected.zoom, 6);
    // The inflated bounds would have allowed a higher zoom (the box turned onto the long side of a 1000 x 1000 square).
    const inflated = frameFor(BOX, { width: 1000, height: 1000 }, 90);
    expect(command.zoom).toBeLessThan(inflated.zoom);
  });

  it('north up needs no measurement: the camera bounds are the screen', async () => {
    await render(<Probe />);
    await act(async () => model!.onViewChange(view(0) as never));
    await act(async () => model!.frame(BOX));
    expect(model!.camera.command!.zoom).not.toBeNull();
  });
});
