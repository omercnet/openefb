import { distanceNm, type Coordinate } from './geo';

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
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 3440.0695, 3);
  });
});
