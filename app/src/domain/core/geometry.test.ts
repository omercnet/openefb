import {
  EARTH_RADIUS_NM,
  bearingDeg,
  destinationPoint,
  distanceNm,
  greatCirclePoints,
  type Coordinate,
} from './geometry';

const LLHZ: Coordinate = { lat: 32.1809, lon: 34.8319 };
const LLBG: Coordinate = { lat: 32.0114, lon: 34.8867 };

describe('distanceNm', () => {
  it('is zero for the same position', () => {
    expect(distanceNm(LLHZ, LLHZ)).toBe(0);
  });

  it('is symmetric', () => {
    expect(distanceNm(LLHZ, LLBG)).toBeCloseTo(distanceNm(LLBG, LLHZ), 9);
  });

  it('measures one degree of latitude as about 60 NM', () => {
    expect(distanceNm({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(60, 0);
  });

  it('shrinks a degree of longitude with latitude', () => {
    const equator = distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const north60 = distanceNm({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });
    expect(north60 / equator).toBeCloseTo(0.5, 2);
  });

  it('does not return NaN for antipodal positions', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_NM, 3);
  });
});

describe('bearingDeg', () => {
  it('points due north, east, south, west', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });
});

describe('destinationPoint', () => {
  it('round-trips with distanceNm and bearingDeg', () => {
    const d = destinationPoint(LLBG, 25, 45);
    expect(distanceNm(LLBG, d)).toBeCloseTo(25, 6);
    expect(bearingDeg(LLBG, d)).toBeCloseTo(45, 2);
  });
  it('normalises longitude across the antimeridian', () => {
    const d = destinationPoint({ lat: 0, lon: 179.5 }, 60, 90);
    expect(d.lon).toBeCloseTo(-179.5, 2);
  });
});

describe('greatCirclePoints', () => {
  it('returns count + 1 points with exact-ish endpoints', () => {
    const pts = greatCirclePoints(LLHZ, LLBG, 10);
    expect(pts).toHaveLength(11);
    expect(pts[0].lat).toBeCloseTo(LLHZ.lat, 9);
    expect(pts[10].lon).toBeCloseTo(LLBG.lon, 9);
  });
  it('defaults to 101 points', () => {
    expect(greatCirclePoints(LLHZ, LLBG)).toHaveLength(101);
  });
  it('returns just the start for coincident points', () => {
    expect(greatCirclePoints(LLHZ, LLHZ)).toEqual([LLHZ]);
  });
});
