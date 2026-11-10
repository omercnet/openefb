// Port of Services/Prediction/AirspacePredictor.swift (engine and PredictionStabilizer).
import { destinationPoint, distanceNm, type Coordinate } from '../core/geometry';
import { ringContains } from '../core/polygon';
import {
  predictedEventId,
  type PredictableShape,
  type PredictableVolume,
  type PredictedEvent,
  type PredictedKind,
  type PredictionInput,
} from './predictedEvent';

export const HORIZON_SECONDS = 600;
export const STEP_SECONDS = 5;
export const MINIMUM_GROUND_SPEED_KNOTS = 30;

/** C printf("%.0f") rounding: half to even on exact halves. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Swift Double.rounded(): half away from zero. */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

export function assumptionText(trackTrue: number, verticalSpeedFPM: number): string {
  const track = ((trackTrue % 360) + 360) % 360;
  const trackText = `at ${String(roundHalfEven(track)).padStart(3, '0')}\u00B0`;
  if (!(Math.abs(verticalSpeedFPM) >= 100)) return `${trackText}, level`;
  const rate = roundHalfAway(verticalSpeedFPM / 10) * 10;
  return `${trackText}, ${rate >= 0 ? '+' : '-'}${Math.abs(rate)} fpm`;
}

const feet = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function containsLaterally(shape: PredictableShape, point: Coordinate): boolean {
  if (shape.kind === 'polygon') {
    const outer = shape.rings[0];
    if (!outer || !ringContains(point, outer)) return false;
    return !shape.rings.slice(1).some((hole) => ringContains(point, hole));
  }
  if (shape.center.length < 2) return false;
  return distanceNm(point, { lat: shape.center[0], lon: shape.center[1] }) <= shape.radiusNM;
}

function title(volume: PredictableVolume, kind: PredictedKind): string {
  if (kind === 'ceiling') {
    if (volume.ceilingFeetMSL !== null) return `${volume.shortName} ceiling ${feet(volume.ceilingFeetMSL)}`;
  } else if (volume.floorFeetMSL !== null && volume.floorFeetMSL > 0) {
    return `${volume.shortName} floor ${feet(volume.floorFeetMSL)}`;
  }
  return volume.shortName;
}

/** Projects the track ten minutes ahead in 5 s steps and reports when the airplane enters each volume. Soonest first. */
export function predictEvents(input: PredictionInput, volumes: readonly PredictableVolume[]): PredictedEvent[] {
  const altitude = input.altitudeFeetMSL;
  if (
    input.isStale ||
    altitude === null ||
    !(input.groundSpeedKnots >= MINIMUM_GROUND_SPEED_KNOTS) ||
    volumes.length === 0
  ) {
    return [];
  }
  const assumption = assumptionText(input.trackTrue, input.verticalSpeedFPM);
  const steps = Math.trunc(HORIZON_SECONDS / STEP_SECONDS);
  const samples = Array.from({ length: steps + 1 }, (_, k) => {
    const seconds = k * STEP_SECONDS;
    return {
      seconds,
      position: destinationPoint(input.position, (input.groundSpeedKnots * seconds) / 3600, input.trackTrue),
      altitude: altitude + (input.verticalSpeedFPM * seconds) / 60,
    };
  });

  const events: PredictedEvent[] = [];
  for (const volume of volumes) {
    const floor = volume.floorFeetMSL ?? 0;
    const ceiling = volume.ceilingFeetMSL ?? Infinity;
    let wasLateral = containsLaterally(volume.shape, samples[0].position);
    let previousAltitude = samples[0].altitude;
    if (wasLateral && floor <= previousAltitude && previousAltitude <= ceiling) continue;
    for (const sample of samples.slice(1)) {
      const lateral = containsLaterally(volume.shape, sample.position);
      const inside = lateral && floor <= sample.altitude && sample.altitude <= ceiling;
      if (inside) {
        let kind: PredictedKind;
        if (wasLateral && previousAltitude < floor) kind = 'floor';
        else if (wasLateral && previousAltitude > ceiling) kind = 'ceiling';
        else kind = 'lateral';
        events.push({
          volumeID: volume.id,
          kind,
          severity: volume.severity,
          secondsAhead: sample.seconds,
          coordinate: sample.position,
          limitFeetMSL: kind === 'ceiling' ? volume.ceilingFeetMSL : volume.floorFeetMSL,
          title: title(volume, kind),
          assumption,
        });
        break;
      }
      wasLateral = lateral;
      previousAltitude = sample.altitude;
    }
  }
  // Array.prototype.sort is stable, like the Swift sort for equal times in practice.
  return events.sort((a, b) => a.secondsAhead - b.secondsAhead);
}

/** Shows an event only once it appeared in at least 2 of the last 3 evaluations. */
export class PredictionStabilizer {
  private history: Set<string>[] = [];

  update(events: readonly PredictedEvent[]): PredictedEvent[] {
    this.history.push(new Set(events.map(predictedEventId)));
    if (this.history.length > 3) this.history = this.history.slice(-3);
    return events.filter((e) => this.history.filter((h) => h.has(predictedEventId(e))).length >= 2);
  }

  reset(): void {
    this.history = [];
  }
}
