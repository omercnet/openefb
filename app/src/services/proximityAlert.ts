// Port of ProximityAlert and the pure part of ProximityAlertService (Services/ProximityAlertService.swift): airspace and
// TFR proximity detection with distance-based alerts.
//
// An airspace alert is INSIDE only when the aircraft is laterally within the boundary AND the GPS altitude (feet MSL) is
// between the floor and ceiling. Laterally inside but below a shelf, above the ceiling, or with no usable altitude (GPS
// Degraded) is NEAR. Alert thresholds (lateral, outside the boundary): Class B 5 NM, Class C 3 NM, Class D 2 NM, TFR 3 NM.
import { tfrAltitudeDescription, tfrIsActive, type Airspace, type Tfr } from '../domain/core/models';
import { distanceNmToRing } from '../domain/core/polygon';
import type { AirspaceClass } from '../domain/core/types';
import { EARTH_RADIUS_NM } from './pirep';

export type ProximityAlertType = 'airspace' | 'tfr';
/** Aircraft altitude relative to an airspace's vertical limits. */
export type VerticalRelation = 'within' | 'below' | 'above' | 'unknown';

export interface ProximityAlert {
  id: string;
  type: ProximityAlertType;
  name: string;
  /** Nautical miles to the lateral boundary, 0 when laterally inside. */
  distance: number;
  /** Floor/ceiling info (e.g. "SFC-10000'"). */
  altitude: string;
  /** Where the aircraft sits relative to the floor/ceiling. 'unknown' for TFRs (AGL limits are not compared) and when GPS
   * altitude is unavailable. */
  vertical: VerticalRelation;
}

/** True when laterally inside and, for airspace, vertically within known limits. Never true for airspace without altitude:
 * "near", not "inside", is what the pilot sees when GPS altitude is missing. TFR altitudes are not compared, so lateral
 * inside suffices. */
export const alertIsInside = (a: ProximityAlert): boolean =>
  a.distance <= 0 && (a.type === 'tfr' || a.vertical === 'within');

/** Display word for the alert: "INSIDE" or "NEAR". */
export const alertRelationLabel = (a: ProximityAlert): string => (alertIsInside(a) ? 'INSIDE' : 'NEAR');

/** Alert thresholds per airspace class in nautical miles. */
export const ALERT_THRESHOLDS: Partial<Record<AirspaceClass, number>> = { bravo: 5, charlie: 3, delta: 2 };
export const TFR_ALERT_THRESHOLD_NM = 3;

/** Vertical relation of `altitude` (feet MSL) to an airspace's limits. SFC is 0. The airspace model has no AGL flag (the
 * NASR import stores B/C/D limits as MSL), so no field-elevation adjustment is applied. */
export function verticalRelation(altitude: number | null, floor: number, ceiling: number): VerticalRelation {
  if (altitude === null || !Number.isFinite(altitude)) return 'unknown';
  if (altitude < floor) return 'below';
  if (altitude > ceiling) return 'above';
  return 'within';
}

/** Haversine great-circle distance in nautical miles (atan2 form, as Swift). */
function haversineNm(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Lateral distance from position to the airspace boundary in nautical miles: 0 inside, positive outside. */
function lateralDistanceNm(position: { lat: number; lon: number }, airspace: Airspace): number {
  const g = airspace.geometry;
  if (g.kind === 'circle') {
    if (g.center.length < 2) return Number.MAX_VALUE;
    return Math.max(0, haversineNm(position, { lat: g.center[0], lon: g.center[1] }) - g.radiusNM);
  }
  // 0 inside the ring, else distance to the nearest edge (edges matter: a Class B ring has long sides with no vertex near
  // the aircraft).
  return distanceNmToRing(position, g.coordinates) ?? Number.MAX_VALUE;
}

/** Format altitude range string for display (e.g. "SFC-10000'" or "1200'-10000'"). */
function formatAltitude(floor: number, ceiling: number): string {
  return `${floor === 0 ? 'SFC' : `${floor}'`}-${ceiling >= 99999 ? 'UNL' : `${ceiling}'`}`;
}

/** Pure alert evaluation. Laterally inside airspaces always alert (INSIDE when the altitude is within limits, NEAR when
 * below/above/unknown). Laterally outside alerts within the class threshold. `nearestDistance` is the closest lateral
 * distance (0 when laterally inside any listed airspace). */
export function airspaceAlerts(
  position: { lat: number; lon: number },
  altitude: number | null,
  airspaces: readonly Airspace[],
): { alerts: ProximityAlert[]; nearestDistance: number | null } {
  const alerts: ProximityAlert[] = [];
  let closest: number | null = null;
  for (const airspace of airspaces) {
    const distance = lateralDistanceNm(position, airspace);
    const vertical = verticalRelation(altitude, airspace.floor, airspace.ceiling);
    const altitudeText = formatAltitude(airspace.floor, airspace.ceiling);
    if (distance <= 0) {
      alerts.push({
        id: `airspace-${airspace.id}`,
        type: 'airspace',
        name: airspace.name,
        distance: 0,
        altitude: altitudeText,
        vertical,
      });
      closest = 0;
      continue;
    }
    const threshold = ALERT_THRESHOLDS[airspace.classification];
    if (threshold !== undefined && distance <= threshold) {
      alerts.push({
        id: `airspace-${airspace.id}`,
        type: 'airspace',
        name: airspace.name,
        distance,
        altitude: altitudeText,
        vertical,
      });
    }
    if (closest === null || distance < closest) closest = distance;
  }
  return { alerts, nearestDistance: closest };
}

/** Alerts for TFRs in effect at `nowMs` whose boundary is within `TFR_ALERT_THRESHOLD_NM` (distance 0 inside the polygon),
 * nearest first. Altitudes are not compared: many TFR limits are AGL, so lateral proximity alone triggers the alert. */
export function tfrAlerts(
  position: { lat: number; lon: number },
  tfrs: readonly Tfr[],
  nowMs: number,
): ProximityAlert[] {
  const alerts: ProximityAlert[] = [];
  for (const tfr of tfrs) {
    if (!tfrIsActive(tfr, nowMs)) continue;
    const distanceNM = distanceNmToRing(position, tfr.boundaries);
    if (distanceNM === null || distanceNM > TFR_ALERT_THRESHOLD_NM) continue;
    alerts.push({
      id: `tfr-${tfr.id}`,
      type: 'tfr',
      name: `TFR ${tfr.notamID} \u2014 ${tfr.title}`,
      distance: distanceNM, // nautical miles to boundary, 0 inside
      altitude: tfrAltitudeDescription(tfr),
      vertical: 'unknown',
    });
  }
  return alerts.sort((a, b) => a.distance - b.distance);
}
