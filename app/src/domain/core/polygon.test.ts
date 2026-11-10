import { distanceNmToRing, distanceToEdgeNm, ringCentroid, ringContains, type Ring } from './polygon';

const square: Ring = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

describe('PolygonGeometry', () => {
  it('pointInPolygon', () => {
    expect(ringContains({ lat: 0.5, lon: 0.5 }, square)).toBe(true);
    expect(ringContains({ lat: -0.05, lon: 0.5 }, square)).toBe(false);
    expect(ringContains({ lat: 0.5, lon: 1.2 }, square)).toBe(false);
    const ell: Ring = [
      [0, 0],
      [0, 2],
      [1, 2],
      [1, 1],
      [2, 1],
      [2, 0],
    ];
    expect(ringContains({ lat: 1.5, lon: 0.5 }, ell)).toBe(true);
    expect(ringContains({ lat: 1.5, lon: 1.5 }, ell)).toBe(false);
  });

  it('distanceToEdgeInNauticalMiles', () => {
    expect(distanceToEdgeNm({ lat: -0.05, lon: 0.5 }, square)).toBeCloseTo(3.0, 3);
    expect(distanceToEdgeNm({ lat: -0.03, lon: -0.04 }, square)).toBeCloseTo(3.0, 1);
    const center = { lat: 0.5, lon: 0.9 };
    expect(distanceNmToRing(center, square)).toBe(0);
    expect(distanceToEdgeNm(center, square)).toBeCloseTo(6.0, 3);
  });

  it('handles degenerate rings', () => {
    expect(
      ringContains({ lat: 0, lon: 0 }, [
        [0, 0],
        [1, 1],
      ]),
    ).toBe(false);
    expect(distanceToEdgeNm({ lat: 0, lon: 0 }, [[1, 1]])).toBeNull();
    expect(ringCentroid([])).toBeNull();
  });

  it('centroid drops the closing vertex', () => {
    expect(ringCentroid(square)).toEqual({ lat: 0.5, lon: 0.5 });
  });
});
