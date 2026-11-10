// Port of Services/Prediction/PredictedEvent.swift.
import type { Coordinate } from '../core/geometry';

export interface PredictionInput {
  position: Coordinate;
  altitudeFeetMSL: number | null;
  trackTrue: number;
  groundSpeedKnots: number;
  verticalSpeedFPM: number;
  isStale: boolean;
}

export type PredictedSeverity = 'caution' | 'warning';
/** Swift Severity raw values: caution = 1, warning = 2 (ordered). */
export const severityRank = (s: PredictedSeverity): number => (s === 'warning' ? 2 : 1);

export type PredictedKind = 'lateral' | 'floor' | 'ceiling';

export type PredictableShape =
  | { kind: 'polygon'; rings: number[][][] } // rings of [lat, lon]; the first is the outer ring, the rest are holes
  | { kind: 'circle'; center: number[]; radiusNM: number };

export interface PredictableVolume {
  id: string;
  shortName: string;
  shape: PredictableShape;
  floorFeetMSL: number | null;
  ceilingFeetMSL: number | null;
  severity: PredictedSeverity;
}

export interface PredictedEvent {
  volumeID: string;
  kind: PredictedKind;
  severity: PredictedSeverity;
  secondsAhead: number;
  coordinate: Coordinate;
  limitFeetMSL: number | null;
  title: string;
  assumption: string;
}

export const predictedEventId = (e: PredictedEvent): string => `${e.volumeID}/${e.kind}`;

export function predictedEventsEqual(a: readonly PredictedEvent[], b: readonly PredictedEvent[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.volumeID === y.volumeID &&
        x.kind === y.kind &&
        x.severity === y.severity &&
        x.secondsAhead === y.secondsAhead &&
        x.limitFeetMSL === y.limitFeetMSL &&
        x.title === y.title &&
        x.assumption === y.assumption &&
        x.coordinate.lat === y.coordinate.lat &&
        x.coordinate.lon === y.coordinate.lon
      );
    })
  );
}
