// Port of the L4 suites in efb-212Tests/ServiceTests/MapGPSRecordingFixesTests.swift:
// AutoStartGate (3 pure cases; the coordinator case is in recordingCoordinator.test.ts) and
// "FlightPhaseDetector without altitude" (9 cases).
// Not ported here: GPSFailureReason, Clear Direct-To and Discard/debrief suites (other tickets, see L4 notes).
import { AutoStartGate } from './autoStartGate';
import { FlightPhaseDetector } from './flightPhaseDetector';
import type { FlightPhaseType, TrackPoint } from './types';

function makePoint(speed: number, altitude: number, vsi: number, secondsFromStart: number): TrackPoint {
  return {
    id: `p-${secondsFromStart}`,
    flightID: '11111111-1111-4111-8111-111111111111',
    timestamp: secondsFromStart * 1000,
    latitude: 37.46,
    longitude: -122.12,
    altitudeFeet: altitude,
    groundSpeedKnots: speed,
    verticalSpeedFPM: vsi,
    courseDegrees: 270,
  };
}

describe('AutoStartGate', () => {
  test('openGateAllowsArmingAtAnySpeed', () => {
    const gate = new AutoStartGate();
    expect(gate.update(97, 15)).toBe(true);
  });

  test('manualStopHoldsOffWhileStillMoving', () => {
    const gate = new AutoStartGate();
    gate.manualStop();
    const atCruise = gate.update(97, 15);
    const justAbove = gate.update(16, 15);
    expect(atCruise).toBe(false);
    expect(justAbove).toBe(false);
    expect(gate.isSuppressed).toBe(true);
  });

  test('gateReopensOnceBelowThresholdAndStaysOpen', () => {
    const gate = new AutoStartGate();
    gate.manualStop();
    expect(gate.update(15, 15)).toBe(true);
    expect(gate.update(60, 15)).toBe(true);
  });
});

describe('FlightPhaseDetector without altitude', () => {
  function feed(
    d: FlightPhaseDetector,
    speed: number,
    from: number,
    to: number,
    hasAltitude: boolean,
  ): FlightPhaseType {
    let phase = d.currentPhase;
    for (let i = from; i <= to; i++) phase = d.process(makePoint(speed, 0, 0, i), hasAltitude);
    return phase;
  }

  test('ninetySevenKnotsWithoutAltitudeIsAirborneNotTaxi', () => {
    const d = new FlightPhaseDetector();
    expect(feed(d, 10, 0, 30, false)).toBe('taxi');
    const phase = feed(d, 97, 31, 80, false);
    expect(phase).toBe('departure');
    expect(phase).not.toBe('taxi');
  });

  test('betweenTaxiAndRotationSpeedIsTakeoffRoll', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, false);
    expect(feed(d, 40, 31, 70, false)).toBe('takeoff');
  });

  test('atTaxiSpeedThresholdStaysTaxi', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, false);
    expect(feed(d, FlightPhaseDetector.taxiMaxSpeedKts, 31, 80, false)).toBe('taxi');
  });

  test('withAltitudeBelowRotationSpeedLevelStaysTaxi', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, true);
    expect(feed(d, 40, 31, 80, true)).toBe('taxi');
  });

  test('withAltitudeAboveRotationSpeedIsAirborneNotTaxiEvenWhenLevel', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, true);
    expect(feed(d, 97, 31, 80, true)).toBe('departure');
  });

  test('recordingStartedInCruiseAtConstantAltitudeNeverReadsTaxi', () => {
    const d = new FlightPhaseDetector();
    const seen = new Set<FlightPhaseType>();
    for (let i = 0; i <= 120; i++) seen.add(d.process(makePoint(97, 4500, 0, 1_700_000_000 + i), true));
    expect(seen.has('taxi')).toBe(false);
    expect(seen.has('preflight')).toBe(false);
    expect(d.currentPhase).toBe('cruise');
  });

  test('recordingStartedInCruiseWithoutAltitudeNeverReadsTaxi', () => {
    const d = new FlightPhaseDetector();
    const seen = new Set<FlightPhaseType>();
    for (let i = 0; i <= 120; i++) seen.add(d.process(makePoint(97, 0, 0, 1_700_000_000 + i), false));
    expect(seen.has('taxi')).toBe(false);
    expect(d.currentPhase).toBe('departure');
  });

  test('resumedInCruiseAfterTaxiLevelFixesLeavesTaxi', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, true);
    expect(d.currentPhase).toBe('taxi');
    feed(d, 110, 31, 130, true);
    expect(d.currentPhase).not.toBe('taxi');
    expect(['cruise', 'departure']).toContain(d.currentPhase);
  });

  test('departureWithoutAltitudeEndsAsLandingWhenSlow', () => {
    const d = new FlightPhaseDetector();
    feed(d, 10, 0, 30, false);
    feed(d, 97, 31, 80, false);
    expect(d.currentPhase).toBe('departure');
    expect(feed(d, 8, 81, 140, false)).toBe('landing');
  });
});
