//
//  FlightPhaseDetectorTests.swift
//  efb-212Tests
//
//  Unit tests for FlightPhaseDetector state machine.
//  Tests all 8 phase transitions with 30-second hysteresis enforcement.
//  Uses synthetic TrackPointRecord sequences.
//

import Testing
import Foundation
@testable import efb_212

@Suite("FlightPhaseDetector Tests")
struct FlightPhaseDetectorTests {

    // MARK: - Helpers

    static let testFlightID = UUID()

    /// Create a synthetic TrackPointRecord for testing.
    static func makePoint(
        speed: Double,
        altitude: Double,
        vsi: Double,
        secondsFromStart: TimeInterval,
        flightID: UUID = testFlightID
    ) -> TrackPointRecord {
        TrackPointRecord(
            id: UUID(),
            flightID: flightID,
            timestamp: Date(timeIntervalSince1970: secondsFromStart),
            latitude: 37.46,
            longitude: -122.12,
            altitudeFeet: altitude,
            groundSpeedKnots: speed,
            verticalSpeedFPM: vsi,
            courseDegrees: 270
        )
    }

    /// Feed a sequence of identical points to the detector for a given duration.
    static func feedPoints(
        to detector: inout FlightPhaseDetector,
        speed: Double,
        altitude: Double,
        vsi: Double,
        fromSecond start: Int,
        toSecond end: Int
    ) -> FlightPhaseType {
        var phase: FlightPhaseType = detector.currentPhase
        for i in start...end {
            let point = makePoint(speed: speed, altitude: altitude, vsi: vsi, secondsFromStart: Double(i))
            phase = detector.process(point)
        }
        return phase
    }

    // MARK: - Initial State

    @Test func initialPhaseIsPreflight() {
        let detector = FlightPhaseDetector()
        #expect(detector.currentPhase == .preflight)
    }

    @Test func hysteresisIsThirtySeconds() {
        let detector = FlightPhaseDetector()
        #expect(detector.hysteresisSeconds == 30)
    }

    // MARK: - Taxi Detection

    @Test func taxiTransitionAfterHysteresis() {
        var detector = FlightPhaseDetector()
        // Feed 31 points at 1s intervals, speed=10kts (taxi range: 5-15 kts)
        let phase = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                                    fromSecond: 0, toSecond: 30)
        #expect(phase == .taxi)
    }

    @Test func noTransitionBeforeHysteresis() {
        var detector = FlightPhaseDetector()
        // Feed 25 points at speed=10kts -- should stay in .preflight (< 30s)
        let phase = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                                    fromSecond: 0, toSecond: 24)
        #expect(phase == .preflight)
    }

    // MARK: - Takeoff Detection

    @Test func takeoffRequiresSpeedAndClimb() {
        var detector = FlightPhaseDetector()
        // Phase 1: Taxi for 31 seconds
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        #expect(detector.currentPhase == .taxi)

        // Phase 2: Accelerate with climb for 31 seconds -> takeoff
        let phase = Self.feedPoints(to: &detector, speed: 40, altitude: 200, vsi: 500,
                                    fromSecond: 31, toSecond: 61)
        #expect(phase == .takeoff)
    }

    // MARK: - Cruise Detection

    @Test func cruiseDetection() {
        var detector = FlightPhaseDetector()
        // Taxi
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        // Takeoff
        _ = Self.feedPoints(to: &detector, speed: 40, altitude: 200, vsi: 500,
                           fromSecond: 31, toSecond: 61)
        // Departure (fast, high, climbing)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 1000, vsi: 500,
                           fromSecond: 62, toSecond: 92)
        #expect(detector.currentPhase == .departure)

        // Level flight at altitude for 31 seconds -> cruise
        let phase = Self.feedPoints(to: &detector, speed: 100, altitude: 3000, vsi: 0,
                                    fromSecond: 93, toSecond: 123)
        #expect(phase == .cruise)
    }

    // MARK: - Approach Detection

    @Test func approachDetection() {
        var detector = FlightPhaseDetector()
        // Fast-forward to cruise (taxi -> takeoff -> departure -> cruise)
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        _ = Self.feedPoints(to: &detector, speed: 40, altitude: 200, vsi: 500,
                           fromSecond: 31, toSecond: 61)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 1000, vsi: 500,
                           fromSecond: 62, toSecond: 92)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 3000, vsi: 0,
                           fromSecond: 93, toSecond: 123)
        #expect(detector.currentPhase == .cruise)

        // Descending for 31 seconds -> approach
        let phase = Self.feedPoints(to: &detector, speed: 90, altitude: 2000, vsi: -500,
                                    fromSecond: 124, toSecond: 154)
        #expect(phase == .approach)
    }

    // MARK: - Landing Detection

    @Test func landingAfterApproach() {
        var detector = FlightPhaseDetector()
        // Fast-forward to approach
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        _ = Self.feedPoints(to: &detector, speed: 40, altitude: 200, vsi: 500,
                           fromSecond: 31, toSecond: 61)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 1000, vsi: 500,
                           fromSecond: 62, toSecond: 92)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 3000, vsi: 0,
                           fromSecond: 93, toSecond: 123)
        _ = Self.feedPoints(to: &detector, speed: 90, altitude: 2000, vsi: -500,
                           fromSecond: 124, toSecond: 154)
        #expect(detector.currentPhase == .approach)

        // Speed drops below 15 kts for 31 seconds -> landing
        let phase = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: -50,
                                    fromSecond: 155, toSecond: 185)
        #expect(phase == .landing)
    }

    // MARK: - Postflight Detection

    @Test func postflightAfterLanding() {
        var detector = FlightPhaseDetector()
        // Fast-forward to landing
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        _ = Self.feedPoints(to: &detector, speed: 40, altitude: 200, vsi: 500,
                           fromSecond: 31, toSecond: 61)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 1000, vsi: 500,
                           fromSecond: 62, toSecond: 92)
        _ = Self.feedPoints(to: &detector, speed: 100, altitude: 3000, vsi: 0,
                           fromSecond: 93, toSecond: 123)
        _ = Self.feedPoints(to: &detector, speed: 90, altitude: 2000, vsi: -500,
                           fromSecond: 124, toSecond: 154)
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: -50,
                           fromSecond: 155, toSecond: 185)
        #expect(detector.currentPhase == .landing)

        // Speed drops below 5 kts for 31 seconds -> postflight
        let phase = Self.feedPoints(to: &detector, speed: 2, altitude: 100, vsi: 0,
                                    fromSecond: 186, toSecond: 216)
        #expect(phase == .postflight)
    }

    // MARK: - Smoothing

    @Test func smoothingHandlesOutlier() {
        var detector = FlightPhaseDetector()
        // 4 points at 3 kts (preflight range), then 1 spike at 50 kts
        // Smoothed average: (3+3+3+3+50)/5 = 12.4 kts -- still in preflight->taxi range
        // But since only 5 seconds have passed, hysteresis prevents transition anyway
        for i in 0...3 {
            _ = detector.process(Self.makePoint(speed: 3, altitude: 100, vsi: 0, secondsFromStart: Double(i)))
        }
        let phase = detector.process(Self.makePoint(speed: 50, altitude: 100, vsi: 0, secondsFromStart: 4))
        // Should still be preflight (not enough time for hysteresis)
        #expect(phase == .preflight)
    }

    // MARK: - Phase Markers

    @Test func phaseMarkersCreatedOnTransition() {
        var detector = FlightPhaseDetector()
        // Transition from preflight to taxi
        _ = Self.feedPoints(to: &detector, speed: 10, altitude: 100, vsi: 0,
                           fromSecond: 0, toSecond: 30)
        #expect(detector.currentPhase == .taxi)
        #expect(detector.phaseMarkers.count == 1)
        #expect(detector.phaseMarkers.first?.phase == FlightPhaseType.taxi.rawValue)
    }

    // MARK: - Realistic Track (VSI from altitude, not hand-set)

    @Test func realisticTrackReachesTakeoffAndDeparture() {
        var detector = FlightPhaseDetector()
        var estimator = VerticalSpeedEstimator()
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        var second = 0
        var altitude = 100.0  // feet MSL, field elevation

        func feed(speed: Double) -> FlightPhaseType {
            let vsi = estimator.update(altitudeFeet: altitude,
                                       timestamp: t0.addingTimeInterval(Double(second)),
                                       verticalAccuracyMeters: 3)
            let point = TrackPointRecord(
                flightID: Self.testFlightID,
                timestamp: t0.addingTimeInterval(Double(second)),
                latitude: 37.46, longitude: -122.12,
                altitudeFeet: altitude, groundSpeedKnots: speed,
                verticalSpeedFPM: vsi, courseDegrees: 270
            )
            second += 1
            return detector.process(point)
        }

        // Taxi 40 s at 10 kt, level
        var phase: FlightPhaseType = .preflight
        for _ in 0..<40 { phase = feed(speed: 10) }
        #expect(phase == .taxi)

        // Accelerate to 50 kt on the ground over 15 s (below rotation speed)
        for i in 0..<15 { phase = feed(speed: 10 + Double(i + 1) * (40.0 / 15.0)) }
        #expect(phase == .taxi)  // not climbing yet, below rotation speed

        // Rotate and climb at 600 fpm (10 ft/s), accelerating through 55 kt to 70 kt
        var reachedTakeoff = false
        for k in 0..<90 {
            altitude += 10
            phase = feed(speed: min(70, 50 + Double(k)))
            if phase == .takeoff { reachedTakeoff = true }
        }
        #expect(reachedTakeoff)
        #expect(phase == .departure)
        #expect(abs(estimator.verticalSpeedFPM - 600) < 20)
    }
}
