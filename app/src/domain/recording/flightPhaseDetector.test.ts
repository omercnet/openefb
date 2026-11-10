// Port of efb-212Tests/ServiceTests/FlightPhaseDetectorTests.swift (12 cases).
import { FlightPhaseDetector } from './flightPhaseDetector';
import type { FlightPhaseType, TrackPoint } from './types';
import { VerticalSpeedEstimator } from './verticalSpeedEstimator';

const FLIGHT_ID = '11111111-1111-4111-8111-111111111111';

function makePoint(speed: number, altitude: number, vsi: number, secondsFromStart: number): TrackPoint {
  return {
    id: `p-${secondsFromStart}`,
    flightID: FLIGHT_ID,
    timestamp: secondsFromStart * 1000,
    latitude: 37.46,
    longitude: -122.12,
    altitudeFeet: altitude,
    groundSpeedKnots: speed,
    verticalSpeedFPM: vsi,
    courseDegrees: 270,
  };
}

function feedPoints(
  detector: FlightPhaseDetector,
  speed: number,
  altitude: number,
  vsi: number,
  start: number,
  end: number,
): FlightPhaseType {
  let phase = detector.currentPhase;
  for (let i = start; i <= end; i++) phase = detector.process(makePoint(speed, altitude, vsi, i));
  return phase;
}

function toTaxi(d: FlightPhaseDetector): void {
  feedPoints(d, 10, 100, 0, 0, 30);
}
function toTakeoff(d: FlightPhaseDetector): void {
  toTaxi(d);
  feedPoints(d, 40, 200, 500, 31, 61);
}
function toDeparture(d: FlightPhaseDetector): void {
  toTakeoff(d);
  feedPoints(d, 100, 1000, 500, 62, 92);
}
function toCruise(d: FlightPhaseDetector): void {
  toDeparture(d);
  feedPoints(d, 100, 3000, 0, 93, 123);
}
function toApproach(d: FlightPhaseDetector): void {
  toCruise(d);
  feedPoints(d, 90, 2000, -500, 124, 154);
}
function toLanding(d: FlightPhaseDetector): void {
  toApproach(d);
  feedPoints(d, 10, 100, -50, 155, 185);
}

describe('FlightPhaseDetector Tests', () => {
  test('initialPhaseIsPreflight', () => {
    expect(new FlightPhaseDetector().currentPhase).toBe('preflight');
  });

  test('hysteresisIsThirtySeconds', () => {
    expect(new FlightPhaseDetector().hysteresisSeconds).toBe(30);
  });

  test('taxiTransitionAfterHysteresis', () => {
    const d = new FlightPhaseDetector();
    expect(feedPoints(d, 10, 100, 0, 0, 30)).toBe('taxi');
  });

  test('noTransitionBeforeHysteresis', () => {
    const d = new FlightPhaseDetector();
    expect(feedPoints(d, 10, 100, 0, 0, 24)).toBe('preflight');
  });

  test('takeoffRequiresSpeedAndClimb', () => {
    const d = new FlightPhaseDetector();
    toTaxi(d);
    expect(d.currentPhase).toBe('taxi');
    expect(feedPoints(d, 40, 200, 500, 31, 61)).toBe('takeoff');
  });

  test('cruiseDetection', () => {
    const d = new FlightPhaseDetector();
    toDeparture(d);
    expect(d.currentPhase).toBe('departure');
    expect(feedPoints(d, 100, 3000, 0, 93, 123)).toBe('cruise');
  });

  test('approachDetection', () => {
    const d = new FlightPhaseDetector();
    toCruise(d);
    expect(d.currentPhase).toBe('cruise');
    expect(feedPoints(d, 90, 2000, -500, 124, 154)).toBe('approach');
  });

  test('landingAfterApproach', () => {
    const d = new FlightPhaseDetector();
    toApproach(d);
    expect(d.currentPhase).toBe('approach');
    expect(feedPoints(d, 10, 100, -50, 155, 185)).toBe('landing');
  });

  test('postflightAfterLanding', () => {
    const d = new FlightPhaseDetector();
    toLanding(d);
    expect(d.currentPhase).toBe('landing');
    expect(feedPoints(d, 2, 100, 0, 186, 216)).toBe('postflight');
  });

  test('smoothingHandlesOutlier', () => {
    const d = new FlightPhaseDetector();
    for (let i = 0; i <= 3; i++) d.process(makePoint(3, 100, 0, i));
    expect(d.process(makePoint(50, 100, 0, 4))).toBe('preflight');
  });

  test('phaseMarkersCreatedOnTransition', () => {
    const d = new FlightPhaseDetector();
    feedPoints(d, 10, 100, 0, 0, 30);
    expect(d.currentPhase).toBe('taxi');
    expect(d.phaseMarkers).toHaveLength(1);
    expect(d.phaseMarkers[0]?.phase).toBe('taxi');
  });

  test('realisticTrackReachesTakeoffAndDeparture', () => {
    const d = new FlightPhaseDetector();
    const estimator = new VerticalSpeedEstimator();
    const t0 = 1_700_000_000_000;
    let second = 0;
    let altitude = 100;

    const feed = (speed: number): FlightPhaseType => {
      const ts = t0 + second * 1000;
      const vsi = estimator.update(altitude, ts, 3);
      second += 1;
      return d.process({
        id: `r-${second}`,
        flightID: FLIGHT_ID,
        timestamp: ts,
        latitude: 37.46,
        longitude: -122.12,
        altitudeFeet: altitude,
        groundSpeedKnots: speed,
        verticalSpeedFPM: vsi,
        courseDegrees: 270,
      });
    };

    let phase: FlightPhaseType = 'preflight';
    for (let i = 0; i < 40; i++) phase = feed(10);
    expect(phase).toBe('taxi');

    for (let i = 0; i < 15; i++) phase = feed(10 + (i + 1) * (40 / 15));
    expect(phase).toBe('taxi');

    let reachedTakeoff = false;
    for (let k = 0; k < 90; k++) {
      altitude += 10;
      phase = feed(Math.min(70, 50 + k));
      if (phase === 'takeoff') reachedTakeoff = true;
    }
    expect(reachedTakeoff).toBe(true);
    expect(phase).toBe('departure');
    expect(Math.abs(estimator.verticalSpeedFPM - 600)).toBeLessThan(20);
  });
});
