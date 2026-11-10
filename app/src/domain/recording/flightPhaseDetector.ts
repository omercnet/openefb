// Port of efb-212/Services/Recording/FlightPhaseDetector.swift.
// Speed + altitude state machine with 30 second hysteresis and a 5-point rolling average.
//
//   preflight (<5kts) -> taxi (5-15kts) -> takeoff (>15kts + climbing, or >55kts) ->
//   departure (>55kts, or >60kts + >500ft + climbing) -> cruise (level >500ft) ->
//   approach (descending) -> landing (<15kts after descent) -> postflight (<5kts sustained)

import { randomUUID, type FlightPhaseType, type PhaseMarker, type TrackPoint } from './types';

export class FlightPhaseDetector {
  currentPhase: FlightPhaseType = 'preflight';
  /** Minimum seconds in a phase before a transition. */
  readonly hysteresisSeconds = 30;
  /** Ground speed above which the aircraft is no longer taxiing. */
  static readonly taxiMaxSpeedKts = 15;
  /** Ground speed above which the aircraft is treated as airborne whatever the altitude trend. */
  static readonly rotationSpeedKts = 55;

  currentPhaseMarkerID: string | null = null;
  phaseMarkers: PhaseMarker[] = [];

  private recentPoints: TrackPoint[] = [];
  private phaseEnteredAt = 0; // epoch ms
  // Swift tracks this but never reads it for a decision; kept for fidelity.
  private maxCruiseAltitude = 0;

  constructor(private readonly newId: () => string = randomUUID) {}

  /** Process a new track point (1 Hz) and return the current flight phase. */
  process(point: TrackPoint, hasAltitude = true): FlightPhaseType {
    this.recentPoints.push(point);
    if (this.recentPoints.length > 5) this.recentPoints.shift();

    const n = this.recentPoints.length;
    const mean = (f: (p: TrackPoint) => number): number => this.recentPoints.reduce((s, p) => s + f(p), 0) / n;
    const smoothedSpeed = mean((p) => p.groundSpeedKnots);
    const smoothedAlt = mean((p) => p.altitudeFeet);
    const smoothedVSI = mean((p) => p.verticalSpeedFPM);

    const candidate = this.detectPhase(smoothedSpeed, smoothedAlt, smoothedVSI, hasAltitude);

    if (this.currentPhase === 'cruise') {
      this.maxCruiseAltitude = Math.max(this.maxCruiseAltitude, smoothedAlt);
    }

    if (candidate !== this.currentPhase) {
      const elapsedSeconds = (point.timestamp - this.phaseEnteredAt) / 1000;
      if (elapsedSeconds < this.hysteresisSeconds) return this.currentPhase;

      if (this.currentPhaseMarkerID !== null) {
        const idx = this.phaseMarkers.findIndex((m) => m.id === this.currentPhaseMarkerID);
        if (idx >= 0) {
          this.phaseMarkers[idx] = { ...this.phaseMarkers[idx]!, endTimestamp: point.timestamp };
        }
      }

      this.currentPhase = candidate;
      this.phaseEnteredAt = point.timestamp;

      const marker: PhaseMarker = {
        id: this.newId(),
        flightID: point.flightID,
        phase: candidate,
        startTimestamp: point.timestamp,
        endTimestamp: null,
        latitude: point.latitude,
        longitude: point.longitude,
      };
      this.phaseMarkers.push(marker);
      this.currentPhaseMarkerID = marker.id;
    }

    return this.currentPhase;
  }

  /** Candidate phase from smoothed data; hysteresis is applied by process(). */
  private detectPhase(speed: number, altitude: number, vsi: number, hasAltitude: boolean): FlightPhaseType {
    const rotation = FlightPhaseDetector.rotationSpeedKts;
    const taxiMax = FlightPhaseDetector.taxiMaxSpeedKts;
    switch (this.currentPhase) {
      case 'preflight':
        if (speed > rotation) return 'departure';
        if (speed >= 5) return 'taxi';
        return 'preflight';

      case 'taxi':
        if (speed < 5) return 'preflight';
        if (!hasAltitude) {
          if (speed > rotation) return 'departure';
          if (speed > taxiMax) return 'takeoff';
          return 'taxi';
        }
        if (speed > 15 && vsi > 200) return 'takeoff';
        if (speed > rotation) return 'departure';
        return 'taxi';

      case 'takeoff':
        if (speed > rotation) return 'departure';
        if (hasAltitude && speed > 60 && altitude > 500 && vsi > 200) return 'departure';
        if (speed < 15) return 'taxi';
        return 'takeoff';

      case 'departure':
        if (hasAltitude && altitude > 500 && Math.abs(vsi) < 200) return 'cruise';
        if (!hasAltitude && speed < taxiMax) return 'landing';
        return 'departure';

      case 'cruise':
        if (vsi < -200) return 'approach';
        return 'cruise';

      case 'approach':
        if (speed < 15) return 'landing';
        if (vsi > 200 && altitude > 500) return 'cruise';
        return 'approach';

      case 'landing':
        if (speed < 5) return 'postflight';
        return 'landing';

      case 'postflight':
        return 'postflight';
    }
  }
}
