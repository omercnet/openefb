import { frameFor, viewportOf } from './useMapData';

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

describe('frameFor with the real viewport', () => {
  const box = { south: 32, west: 34.5, north: 32.4, east: 35.5 }; // 1 degree wide
  it('zooms out for a narrow map so the whole box and its padding fit', () => {
    const wide = frameFor(box, { width: 1000, height: 800 });
    const narrow = frameFor(box, { width: 400, height: 800 });
    expect(narrow.zoom).toBeLessThan(wide.zoom);
    // At the returned zoom the box (1 degree) is no wider than the usable width.
    const pxPerDegree = (512 * 2 ** narrow.zoom) / 360;
    expect(1 * pxPerDegree).toBeLessThanOrEqual(400 - 200 + 0.5);
  });

  it('fits the height too', () => {
    const tall = { south: 31, west: 35, north: 33, east: 35.1 };
    const z = frameFor(tall, { width: 1000, height: 400 }).zoom;
    const pxPerDegree = (512 * 2 ** z) / 360;
    expect(2 * Math.cos((32 * Math.PI) / 180) * pxPerDegree).toBeLessThanOrEqual(400 - 200 + 0.5);
  });

  it('reads the viewport back from a camera report', () => {
    const v = viewportOf({ zoom: 10, northEast: { lat: 32.1, lon: 35.1 }, southWest: { lat: 32, lon: 35 } });
    expect(v.width).toBeCloseTo((0.1 * 512 * 2 ** 10) / 360, 5);
    expect(v.height).toBeLessThan(v.width);
  });
});
