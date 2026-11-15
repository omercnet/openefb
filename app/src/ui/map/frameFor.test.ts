import { frameFor } from './useMapData';

describe('frameFor', () => {
  it('centres the box and zooms out for a larger one', () => {
    const small = frameFor({ south: 32, west: 34.8, north: 32.1, east: 34.9 });
    const large = frameFor({ south: 30, west: 34, north: 33, east: 36 });
    expect(small.center.lat).toBeCloseTo(32.05, 6);
    expect(small.center.lon).toBeCloseTo(34.85, 6);
    expect(small.zoom).toBeGreaterThan(large.zoom);
  });

  it('stays within the map zoom range for a point or the whole world', () => {
    expect(frameFor({ south: 32, west: 35, north: 32, east: 35 }).zoom).toBeLessThanOrEqual(14);
    expect(frameFor({ south: -80, west: -170, north: 80, east: 170 }).zoom).toBeGreaterThanOrEqual(4);
  });
});
