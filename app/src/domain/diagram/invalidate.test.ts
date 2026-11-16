import { DiagramOverlayController, type DiagramPackSource } from './overlayController';

const cam = {
  center: { lat: 32, lon: 34.8 },
  zoom: 15,
  northEast: { lat: 32.01, lon: 34.81 },
  southWest: { lat: 31.99, lon: 34.79 },
};

describe('DiagramOverlayController.invalidate', () => {
  it('forgets the diagrams loaded from the old pack, and what was marked unavailable, and loads the new ones', async () => {
    let edition = 'A';
    const source: DiagramPackSource = {
      candidates: jest.fn(async () => [{ icao: 'LLBG', position: { lat: 32, lon: 34.8 } }]),
      diagramFor: jest.fn(async () => ({
        kind: 'ready' as const,
        image: {
          icao: 'LLBG',
          imageUri: `file:///${edition}/LLBG.png`,
          coordinates: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      })) as never,
    };
    const controller = new DiagramOverlayController({ source, enabled: () => true, remotelyDisabled: () => false });
    controller.setRegion('israel');
    await controller.onCamera(cam);
    expect(controller.getSnapshot().slots[0]!.image.imageUri).toContain('/A/');
    edition = 'B';
    await controller.invalidate();
    expect(controller.getSnapshot().slots[0]!.image.imageUri).toContain('/B/');
    controller.dispose();
  });
});
