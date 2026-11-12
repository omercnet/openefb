// Port of Services/Prediction/PredictionService.swift.
// Platform and store dependencies become injected interfaces; the clock never appears (timestamps arrive with the fix).
import { distanceNm, type Coordinate } from '../core/geometry';
import type { Airspace } from '../core/models';
import type { Region } from '../core/region';
import type { IsraelAirspace, IsraelAirspaceKind } from '../../data/aviation/israelTypes';
import { PredictionStabilizer, predictEvents } from './airspacePredictor';
import type { PredictableVolume, PredictedEvent, PredictedSeverity } from './predictedEvent';
import { predictedEventsEqual } from './predictedEvent';

export const QUERY_INTERVAL_SECONDS = 10;
export const QUERY_DISTANCE_NM = 2;
const FEET_PER_METRE = 3.28084;

// ---- Israel airspace input: the data layer's model (L3 replaced the structural stand-in) ----

// ---- Mappers ----

const US_SHORT_NAMES: Partial<Record<Airspace['classification'], string>> = {
  bravo: 'B',
  charlie: 'C',
  delta: 'D',
  restricted: 'R',
  prohibited: 'P',
  moa: 'MOA',
  alert: 'A',
  warning: 'W',
  tfr: 'TFR',
};

/** Class E and G are not predicted (null). A ceiling of 99999 ft or more means unlimited. */
export function volumeFromAirspace(airspace: Airspace): PredictableVolume | null {
  const shortName = US_SHORT_NAMES[airspace.classification];
  if (shortName === undefined) return null;
  const severity: PredictedSeverity =
    airspace.classification === 'prohibited' ||
    airspace.classification === 'restricted' ||
    airspace.classification === 'tfr'
      ? 'warning'
      : 'caution';
  const g = airspace.geometry;
  return {
    id: `us-${airspace.id}`,
    shortName,
    shape:
      g.kind === 'polygon'
        ? { kind: 'polygon', rings: [g.coordinates] }
        : { kind: 'circle', center: g.center, radiusNM: g.radiusNM },
    floorFeetMSL: airspace.floor,
    ceilingFeetMSL: airspace.ceiling >= 99999 ? null : airspace.ceiling,
    severity,
  };
}

/** "P 4" for code LLP04, "CTR LLHA" for non-numbered kinds, bare kind when there is no code. */
export function israelShortName(kind: IsraelAirspaceKind, code: string | null): string {
  if (code === null || code === '') return kind;
  if (kind === 'P' || kind === 'R' || kind === 'D') {
    const digits = code.replace(/^[^0-9]*/, '');
    if (!/^[0-9]+$/.test(digits)) return `${kind} ${code}`;
    return `${kind} ${Number(digits)}`;
  }
  return `${kind} ${code}`;
}

/** One volume per polygon; FIR is skipped; only SFC and MSL floors and MSL ceilings are usable. */
export function volumesFromIsraelAirspace(a: IsraelAirspace): PredictableVolume[] {
  if (a.kind === 'FIR') return [];
  const shortName = israelShortName(a.kind, a.code);
  let floor: number | null;
  if (a.floor.reference === 'SFC') floor = 0;
  else if (a.floor.reference === 'MSL') floor = a.floor.feet;
  else floor = null;
  const ceiling = a.ceiling.reference === 'MSL' ? a.ceiling.feet : null;
  const severity: PredictedSeverity = a.kind === 'P' || a.kind === 'R' ? 'warning' : 'caution';
  return a.polygons.map((rings, index) => ({
    id: a.polygons.length === 1 ? `il-${a.id}` : `il-${a.id}-${index}`,
    shortName,
    shape: { kind: 'polygon', rings: rings.map((ring) => ring.map((v) => [v.lat, v.lon])) },
    floorFeetMSL: floor,
    ceilingFeetMSL: ceiling,
    severity,
  }));
}

// ---- Service ----

/** A GPS fix; altitude in metres, accuracy in metres (negative = invalid), course in degrees true (negative = unknown). */
export interface PredictionFix {
  coordinate: Coordinate;
  altitudeMeters: number;
  verticalAccuracyMeters: number;
  course: number;
  timestampMs: number;
}

/** The slice of AppState the service reads and writes. */
export interface PredictionState {
  region: Region;
  track: number;
  groundSpeed: number;
  predictedEvents: PredictedEvent[];
}

export interface VerticalSpeedSource {
  update(altitudeFeet: number, timestampMs: number, verticalAccuracyMeters: number): number;
}

export interface PredictionAirspaceSources {
  usAirspaces(near: Coordinate, radiusNM: number): Airspace[];
  /** The caller owns the Israel source's lifecycle (opening, caching). A throw is caught and yields no Israel volumes for that query. */
  israelAirspaces(near: Coordinate, radiusNM: number): IsraelAirspace[];
}

export class PredictionService {
  private readonly stabilizer = new PredictionStabilizer();
  private cachedVolumes: PredictableVolume[] = [];
  private lastQuery: { coordinate: Coordinate; timeMs: number; radiusNM: number; region: Region } | null = null;

  constructor(
    private readonly sources: PredictionAirspaceSources,
    private readonly verticalSpeed: VerticalSpeedSource,
  ) {}

  update(fix: PredictionFix, state: PredictionState, isStale: boolean, enabled: boolean): void {
    if (!enabled || isStale) {
      this.clear(state);
      return;
    }
    const altitudeFeet = fix.altitudeMeters * FEET_PER_METRE;
    const verticalSpeedFPM = this.verticalSpeed.update(altitudeFeet, fix.timestampMs, fix.verticalAccuracyMeters);
    if (!(fix.course >= 0)) {
      this.clear(state);
      return;
    }
    const input = {
      position: fix.coordinate,
      altitudeFeetMSL: fix.verticalAccuracyMeters >= 0 ? altitudeFeet : null,
      trackTrue: state.track,
      groundSpeedKnots: state.groundSpeed,
      verticalSpeedFPM,
      isStale: false,
    };
    const radiusNM = (state.groundSpeed * 10) / 60 + 5;
    const nearby = this.volumesNear(fix, radiusNM, state.region);
    const events = this.stabilizer.update(predictEvents(input, nearby));
    if (!predictedEventsEqual(state.predictedEvents, events)) state.predictedEvents = events;
  }

  clear(state: PredictionState): void {
    this.stabilizer.reset();
    if (state.predictedEvents.length > 0) state.predictedEvents = [];
  }

  private volumesNear(fix: PredictionFix, radiusNM: number, region: Region): PredictableVolume[] {
    const last = this.lastQuery;
    if (
      last &&
      last.region === region &&
      radiusNM <= last.radiusNM &&
      (fix.timestampMs - last.timeMs) / 1000 < QUERY_INTERVAL_SECONDS &&
      distanceNm(fix.coordinate, last.coordinate) < QUERY_DISTANCE_NM
    ) {
      return this.cachedVolumes;
    }
    try {
      if (region === 'us') {
        this.cachedVolumes = this.sources
          .usAirspaces(fix.coordinate, radiusNM)
          .flatMap((a) => volumeFromAirspace(a) ?? []);
      } else {
        this.cachedVolumes = this.sources.israelAirspaces(fix.coordinate, radiusNM).flatMap(volumesFromIsraelAirspace);
      }
    } catch {
      // Swift: try? -> empty. Unlike Swift, a failed query is not cached, so the next fix retries immediately.
      this.cachedVolumes = [];
      this.lastQuery = null;
      return this.cachedVolumes;
    }
    this.lastQuery = { coordinate: fix.coordinate, timeMs: fix.timestampMs, radiusNM, region };
    return this.cachedVolumes;
  }
}
