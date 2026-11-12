// Pure builders from domain objects to GeoJSON for the map sources. Port of the MapService.update* methods
// (updateAirports, updateNavaids, updateAirspaces, updateWeatherDots, updateTFRs, updateAdvisories).
import {
  tfrAltitudeDescription,
  tfrIsActive,
  type Airport,
  type Airspace,
  type Coordinate,
  type Navaid,
  type Tfr,
  type WeatherCache,
} from '../core';
import { collection, point, polygonFeature, type Feature, type FeatureCollection } from './geojson';

/** Structural stand-in for Swift `AviationAdvisory` (not yet ported; plan section 7). Only what the map reads. */
export interface MapAdvisory {
  id: string;
  kind: string;
  hazardCode: string;
  colorHex: string;
  validFrom: number; // epoch ms
  validTo: number;
  boundaries: number[][]; // [lat, lon]
}

export const advisoryIsValid = (a: MapAdvisory, atMs: number): boolean => a.validFrom <= atMs && atMs <= a.validTo;

export function airportFeatures(airports: readonly Airport[]): FeatureCollection {
  return collection(
    airports.map((a) =>
      point(
        a.latitude,
        a.longitude,
        { icao: a.icao, name: a.name, type: a.type, isTowered: a.frequencies.some((f) => f.type === 'tower') },
        a.icao,
      ),
    ),
  );
}

export function navaidFeatures(navaids: readonly Navaid[]): FeatureCollection {
  return collection(navaids.map((n) => point(n.latitude, n.longitude, { id: n.id, name: n.name, type: n.type })));
}

/** Circle airspaces are approximated as a 36-point polygon, exactly as MapService did. */
function circleRing(center: number[], radiusNM: number): number[][] {
  const radiusMeters = radiusNM * 1852;
  const lat0 = center[0]!;
  const lon0 = center[1]!;
  const ring: number[][] = [];
  for (let i = 0; i < 36; i++) {
    const angle = (i * (360 / 36) * Math.PI) / 180;
    ring.push([
      lat0 + (radiusMeters / 111320) * Math.cos(angle),
      lon0 + (radiusMeters / (111320 * Math.cos((lat0 * Math.PI) / 180))) * Math.sin(angle),
    ]);
  }
  return ring;
}

export function airspaceFeatures(airspaces: readonly Airspace[]): FeatureCollection {
  const features: Feature[] = [];
  for (const a of airspaces) {
    let ring: number[][];
    if (a.geometry.kind === 'polygon') {
      if (a.geometry.coordinates.length < 3) continue;
      ring = a.geometry.coordinates;
    } else {
      if (a.geometry.center.length < 2) continue;
      ring = circleRing(a.geometry.center, a.geometry.radiusNM);
    }
    const f = polygonFeature(ring, {
      name: a.name,
      airspaceClass: a.classification,
      floorAltitude: a.floor,
      ceilingAltitude: a.ceiling,
      label: `${a.floor}/${a.ceiling}`,
    });
    if (f) features.push(f);
  }
  return collection(features);
}

/** Weather data without a matching station coordinate is skipped. */
export function weatherDotFeatures(
  weather: readonly WeatherCache[],
  stationCoordinates: ReadonlyMap<string, Coordinate>,
): FeatureCollection {
  const features: Feature[] = [];
  for (const wx of weather) {
    const c = stationCoordinates.get(wx.stationID);
    if (!c) continue;
    features.push(point(c.lat, c.lon, { stationID: wx.stationID, flightCategory: wx.flightCategory }));
  }
  return collection(features);
}

/**
 * In-effect TFRs get a stronger fill than upcoming ones; expired TFRs (possible from a stale cache) are skipped.
 * A stale snapshot is drawn fainter with a dashed border.
 */
export function tfrFeatures(tfrs: readonly Tfr[], nowMs: number, stale = false): FeatureCollection {
  const features: Feature[] = [];
  for (const t of tfrs) {
    if (t.expirationDate != null && t.expirationDate < nowMs) continue;
    const opacity = tfrIsActive(t, nowMs) ? 0.25 : 0.08;
    const f = polygonFeature(t.boundaries, {
      id: t.id,
      notam: t.notamID,
      type: t.type,
      altitudes: tfrAltitudeDescription(t),
      opacity: stale ? opacity * 0.5 : opacity,
      stale: stale ? 1 : 0,
    });
    if (f) features.push(f);
  }
  return collection(features);
}

/** Callers pass only currently valid advisories, and none once the snapshot is past its useful life. */
export function advisoryFeatures(advisories: readonly MapAdvisory[], stale = false): FeatureCollection {
  const features: Feature[] = [];
  for (const a of advisories) {
    const f = polygonFeature(a.boundaries, {
      id: a.id,
      kind: a.kind,
      hazard: a.hazardCode,
      color: a.colorHex,
      opacity: stale ? 0.06 : 0.15,
      stale: stale ? 1 : 0,
    });
    if (f) features.push(f);
  }
  return collection(features);
}
