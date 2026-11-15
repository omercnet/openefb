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
  const metersPerPoint = (z: number) => (2 * Math.PI) / (512 * 2 ** z); // world radians per point

  it('zooms out for a narrow map so the whole box and its padding fit', () => {
    const wide = frameFor(box, { width: 1000, height: 800 });
    const narrow = frameFor(box, { width: 400, height: 800 });
    expect(narrow.zoom).toBeLessThan(wide.zoom);
    expect((Math.PI / 180) * 1).toBeLessThanOrEqual((400 - 200 + 0.5) * metersPerPoint(narrow.zoom));
  });

  it('fits the height with the projected (mercator) extent', () => {
    const tall = { south: 31, west: 35, north: 33, east: 35.1 };
    const z = frameFor(tall, { width: 1000, height: 400 }).zoom;
    const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    expect(y(33) - y(31)).toBeLessThanOrEqual((400 - 200 + 0.5) * metersPerPoint(z));
    // and it is the binding side: one more zoom step would not fit
    expect(y(33) - y(31)).toBeGreaterThan((400 - 200) * metersPerPoint(z + 0.01) - 1e-9);
  });

  it('fits a rotated map: a wide box turned 90 degrees needs its length on the short screen side', () => {
    const wideBox = { south: 32, west: 34, north: 32.05, east: 36 }; // about 2 degrees wide
    const north = frameFor(wideBox, { width: 1000, height: 600 }, 0);
    const east = frameFor(wideBox, { width: 1000, height: 600 }, 90);
    expect(east.zoom).toBeLessThan(north.zoom);
    expect((Math.PI / 180) * 2).toBeLessThanOrEqual((600 - 200 + 0.5) * metersPerPoint(east.zoom));
  });

  it('reads the viewport back from a camera report, height from the projected corners', () => {
    const v = viewportOf({ zoom: 10, northEast: { lat: 32.1, lon: 35.1 }, southWest: { lat: 32, lon: 35 } });
    expect(v.width).toBeCloseTo((0.1 * 512 * 2 ** 10) / 360, 5);
    expect(v.height).toBeGreaterThan(v.width); // 1 / cos(32 deg): a degree of latitude covers more points
  });
});
