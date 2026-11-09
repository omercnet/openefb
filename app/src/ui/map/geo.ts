// Great-circle helpers and the track-ruler geometry (port of MapService.updateTrackRuler).
// Units: distances in NM, bearings in degrees true, speeds in knots, positions [lon, lat] degrees.

const EARTH_RADIUS_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Point reached from `from` after `distanceNm` on initial bearing `bearingDeg` (spherical earth). */
export function destination(from: [number, number], distanceNm: number, bearingDeg: number): [number, number] {
  const [lon1, lat1] = [rad(from[0]), rad(from[1])];
  const d = distanceNm / EARTH_RADIUS_NM;
  const b = rad(bearingDeg);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lon2), deg(lat2)];
}

/**
 * Line from ownship along `trackDeg` to the last minute mark at `gsKt`, plus one tick per minute mark
 * ("1 min", then bare minutes). Below 30 kt the ruler is cleared, as in the SwiftUI app.
 */
export function trackRuler(origin: [number, number], trackDeg: number, gsKt: number, minutes: readonly number[], mapBearingDeg = 0) {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (gsKt < 30 || minutes.length === 0) return { line: empty, ticks: empty };
  // Labels sit beside the ruler: below a line running across the screen, right of one running up/down.
  const anchor = Math.abs(Math.sin(rad(trackDeg - mapBearingDeg))) > 0.707 ? 'top' : 'left';
  const ticks: GeoJSON.Feature<GeoJSON.Point>[] = minutes.map((m) => ({
    type: 'Feature',
    // NM = knots * minutes / 60
    geometry: { type: 'Point', coordinates: destination(origin, (gsKt * m) / 60, trackDeg) },
    properties: { track: trackDeg, anchor, label: m === 1 ? '1 min' : String(m) },
  }));
  const end = ticks[ticks.length - 1].geometry.coordinates;
  return {
    line: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [origin, end] }, properties: {} }] } as GeoJSON.FeatureCollection,
    ticks: { type: 'FeatureCollection', features: ticks } as GeoJSON.FeatureCollection,
  };
}

/** p50 / p95 / max of a sample set (milliseconds), rounded to 0.1 ms. */
export function pacing(samples: number[]) {
  if (samples.length === 0) return { n: 0, p50: null, p95: null, max: null };
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1] * 10) / 10 };
}
