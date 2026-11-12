// Ports efb-212Tests/ServiceTests/MapQueryRegionTests.swift (17 cases, same names, inputs, expectations).
import { type Airport, type AirportType, type Coordinate, makeAirport } from '../core';
import {
  haversineNM,
  isLowZoom,
  lowZoomRadiusNM,
  LOW_ZOOM_THRESHOLD,
  MARGIN_FACTOR,
  MAX_LOW_ZOOM_RADIUS_NM,
  MAX_RADIUS_NM,
  MIN_RADIUS_NM,
  priorityRank,
  radiusNM,
  shouldRequery,
  thin,
  thinSpatially,
} from './mapQueryRegion';

const kpao: Coordinate = { lat: 37.4611, lon: -122.115 };

function bounds(center: Coordinate, halfLatDeg: number, halfLonDeg: number) {
  return {
    ne: { lat: center.lat + halfLatDeg, lon: center.lon + halfLonDeg },
    sw: { lat: center.lat - halfLatDeg, lon: center.lon - halfLonDeg },
  };
}

function airport(icao: string, lat: number, lon: number, type: AirportType = 'airport'): Airport {
  return makeAirport({ icao, name: icao, latitude: lat, longitude: lon, elevation: 0, type, ownership: 'public' });
}

describe('Map Query Region', () => {
  describe('radius', () => {
    it('radiusCoversTheFarthestVisibleCornerWithMargin', () => {
      const b = bounds(kpao, 0.5, 0.5);
      const radius = radiusNM(kpao, b.ne, b.sw);
      const corners = [b.ne, b.sw, { lat: b.ne.lat, lon: b.sw.lon }, { lat: b.sw.lat, lon: b.ne.lon }];
      const farthestNM = Math.max(...corners.map((c) => haversineNM(kpao, c)));
      expect(farthestNM).toBeGreaterThan(haversineNM(kpao, b.ne));
      expect(Math.abs(radius - farthestNM * MARGIN_FACTOR)).toBeLessThan(0.01);
      expect(radius).toBeGreaterThan(38);
      expect(radius).toBeLessThan(43);
    });

    it('zoomedInViewUsesMinimumRadius', () => {
      const b = bounds(kpao, 0.008, 0.01);
      expect(radiusNM(kpao, b.ne, b.sw)).toBe(MIN_RADIUS_NM);
    });

    it('conusViewIsCappedAtMaximumRadius', () => {
      const conus = { lat: 39, lon: -98 };
      const b = bounds(conus, 15, 30);
      expect(radiusNM(conus, b.ne, b.sw)).toBe(MAX_RADIUS_NM);
    });

    it('spatialThinningKeepsOnePerCellAndEverySparseField', () => {
      const bay = [airport('KSFO', 37.62, -122.38), airport('KOAK', 37.72, -122.22), airport('KSQL', 37.51, -122.25)];
      const denver = airport('KDEN', 39.86, -104.67);
      const result = thinSpatially([...bay, denver], { south: 25, west: -125, north: 50, east: -97 });
      expect(result.map((a) => a.icao)).toEqual(['KDEN', 'KOAK']);
    });
  });

  describe('low zoom', () => {
    it('lowZoomBelowSevenOnly', () => {
      expect(isLowZoom(5.0)).toBe(true);
      expect(isLowZoom(6.99)).toBe(true);
      expect(isLowZoom(LOW_ZOOM_THRESHOLD)).toBe(false);
      expect(isLowZoom(11)).toBe(false);
    });

    it('lowZoomRadiusCoversConusPastTheDiscCap', () => {
      const conus = { lat: 39, lon: -98 };
      const b = bounds(conus, 15, 30);
      const capped = radiusNM(conus, b.ne, b.sw);
      const low = lowZoomRadiusNM(conus, b.ne, b.sw);
      expect(capped).toBe(MAX_RADIUS_NM);
      expect(low).toBeGreaterThan(capped);
      expect(low).toBeLessThanOrEqual(MAX_LOW_ZOOM_RADIUS_NM);
    });

    it('lowZoomRadiusAgreesWithCappedRadiusBelowTheCap', () => {
      const b = bounds(kpao, 0.5, 0.5);
      expect(lowZoomRadiusNM(kpao, b.ne, b.sw)).toBe(radiusNM(kpao, b.ne, b.sw));
    });

    it('wideScreenUsesTheWideAxis', () => {
      const b = bounds(kpao, 0.2, 0.6);
      const radius = radiusNM(kpao, b.ne, b.sw);
      const halfHeightNM = haversineNM(kpao, { lat: kpao.lat + 0.2, lon: kpao.lon });
      expect(radius).toBeGreaterThan(halfHeightNM * 2);
    });

    it('radiusGrowsWhenZoomingOutAtTheSameCentre', () => {
      const near = bounds(kpao, 0.1, 0.15);
      const far = bounds(kpao, 0.4, 0.6);
      const r1 = radiusNM(kpao, near.ne, near.sw);
      const r2 = radiusNM(kpao, far.ne, far.sw);
      expect(r2).toBeGreaterThan(r1 * 3);
    });
  });

  describe('requery decision', () => {
    it('firstQueryAlwaysRuns', () => {
      expect(shouldRequery(null, null, kpao, 20)).toBe(true);
    });

    it('smallPanAtSameZoomDoesNotRequery', () => {
      expect(shouldRequery(kpao, 20, { lat: kpao.lat + 0.02, lon: kpao.lon }, 21)).toBe(false);
    });

    it('zoomOutInPlaceRequeries', () => {
      expect(shouldRequery(kpao, 20, kpao, 40)).toBe(true);
    });

    it('largePanRequeries', () => {
      expect(shouldRequery(kpao, 20, { lat: kpao.lat + 0.2, lon: kpao.lon }, 20)).toBe(true);
    });
  });

  describe('thinning', () => {
    it('smallResultIsReturnedUntouched', () => {
      const list = [airport('KPAO', 37.46, -122.11), airport('KSQL', 37.51, -122.25)];
      expect(thin(list, kpao, 10).map((a) => a.icao)).toEqual(['KPAO', 'KSQL']);
    });

    it('thinningKeepsICAOAirportsOverHeliportsAndNearerOverFarther', () => {
      const list = [
        airport('15CA', 37.44, -122.17, 'heliport'),
        airport('1CA9', 38.0, -122.0),
        airport('KSJC', 37.36, -121.93),
        airport('KPAO', 37.46, -122.11),
        airport('KSQL', 37.51, -122.25),
      ];
      expect(thin(list, kpao, 3).map((a) => a.icao)).toEqual(['KPAO', 'KSQL', 'KSJC']);
    });

    it('priorityRanks', () => {
      expect(priorityRank(airport('KPAO', 0, 0))).toBe(0);
      expect(priorityRank(airport('1CA9', 0, 0))).toBe(1);
      expect(priorityRank(airport('US-2776', 0, 0, 'heliport'))).toBe(2);
      expect(priorityRank(airport('S00', 0, 0, 'seaplane'))).toBe(2);
    });

    it('haversineMatchesKnownDistance', () => {
      const nm = haversineNM(kpao, { lat: 37.5119, lon: -122.2494 });
      expect(Math.abs(nm - 7.1)).toBeLessThan(0.2);
    });
  });
});
