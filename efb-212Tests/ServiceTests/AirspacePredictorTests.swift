//
//  AirspacePredictorTests.swift
//  efb-212Tests
//
//  What a pilot would notice from the ten-minute airspace prediction: the right entry at the right
//  time, nothing when nothing is ahead, and nothing at all when the fix cannot be trusted.
//  Geometry near 32N 35E; 120 kt east = 2 NM per minute; 0.1 degree of longitude there is about 5.09 NM.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("AirspacePredictor Tests")
struct AirspacePredictorTests {

    static let origin = CLLocationCoordinate2D(latitude: 32, longitude: 35)

    /// Rectangle as an outer ring of [lat, lon] vertices.
    static func box(lat: ClosedRange<Double>, lon: ClosedRange<Double>) -> [[Double]] {
        [[lat.lowerBound, lon.lowerBound], [lat.lowerBound, lon.upperBound],
         [lat.upperBound, lon.upperBound], [lat.upperBound, lon.lowerBound]]
    }

    static func input(
        position: CLLocationCoordinate2D = origin,
        altitude: Double? = 2_450,   // feet MSL
        track: Double = 90,          // degrees true
        groundSpeed: Double = 120,   // knots
        verticalSpeed: Double = 0,   // feet per minute
        isStale: Bool = false
    ) -> PredictionInput {
        PredictionInput(position: position, altitudeFeetMSL: altitude, trackTrue: track,
                        groundSpeedKnots: groundSpeed, verticalSpeedFPM: verticalSpeed, isStale: isStale)
    }

    static func volume(
        _ id: String = "B1", name: String = "B",
        rings: [[[Double]]], floor: Int?, ceiling: Int?,
        severity: PredictedEvent.Severity = .caution
    ) -> PredictableVolume {
        PredictableVolume(id: id, shortName: name, shape: .polygon(rings: rings),
                          floorFeetMSL: floor, ceilingFeetMSL: ceiling, severity: severity)
    }

    /// Class B shelf 3,000 to 10,000 ft MSL directly over the airplane.
    static let shelfOverhead = volume(rings: [box(lat: 31.5...32.5, lon: 34.5...35.5)], floor: 3_000, ceiling: 10_000)

    // MARK: - Entries

    @Test func climbingUnderShelfPredictsFloorAtTheRightTime() throws {
        // 550 ft to go at 300 fpm = 110 s
        let events = AirspacePredictor.events(input: Self.input(verticalSpeed: 300), volumes: [Self.shelfOverhead])
        let event = try #require(events.first)
        #expect(events.count == 1)
        #expect(event.kind == .floor)
        #expect(event.secondsAhead == 110)
        #expect(event.limitFeetMSL == 3_000)
        #expect(event.title == "B floor 3,000")
        #expect(event.assumption == "at 090\u{00B0}, +300 fpm")
        #expect(event.id == "B1/floor")
    }

    @Test func levelUnderShelfPredictsNothing() {
        #expect(AirspacePredictor.events(input: Self.input(), volumes: [Self.shelfOverhead]).isEmpty)
    }

    @Test func levelTowardLowerShelfPredictsLateralEntry() throws {
        // Shelf edge 0.1 degree east, about 5.09 NM at 2 NM/min: about 153 s, first sample inside 155 s.
        let lower = Self.volume("B2", rings: [Self.box(lat: 31.5...32.5, lon: 35.1...35.5)], floor: 1_500, ceiling: 10_000)
        let events = AirspacePredictor.events(input: Self.input(altitude: 2_900), volumes: [Self.shelfOverhead, lower])
        let event = try #require(events.first)
        #expect(events.count == 1)
        #expect(event.kind == .lateral)
        #expect(event.title == "B floor 1,500")
        #expect(event.limitFeetMSL == 1_500)
        #expect((150...160).contains(event.secondsAhead))
        #expect(event.coordinate.longitude > 35.1)
    }

    @Test func descendingOntoCeilingPredictsCeiling() throws {
        // 500 ft to lose at 500 fpm = 60 s
        let delta = Self.volume("D1", name: "D", rings: [Self.box(lat: 31.5...32.5, lon: 34.5...35.5)], floor: nil, ceiling: 2_500)
        let events = AirspacePredictor.events(input: Self.input(altitude: 3_000, verticalSpeed: -500), volumes: [delta])
        let event = try #require(events.first)
        #expect(event.kind == .ceiling)
        #expect(event.secondsAhead == 60)
        #expect(event.limitFeetMSL == 2_500)
        #expect(event.title == "D ceiling 2,500")
    }

    @Test func alreadyInsidePredictsNothing() {
        let delta = Self.volume("D1", name: "D", rings: [Self.box(lat: 31.5...32.5, lon: 34.5...35.5)], floor: nil, ceiling: 4_000)
        #expect(AirspacePredictor.events(input: Self.input(verticalSpeed: 300), volumes: [delta]).isEmpty)
    }

    @Test func eventsAreSoonestFirst() {
        let lower = Self.volume("B2", rings: [Self.box(lat: 31.5...32.5, lon: 35.1...35.5)], floor: 1_500, ceiling: 10_000)
        let events = AirspacePredictor.events(input: Self.input(altitude: 2_900, verticalSpeed: 300), volumes: [lower, Self.shelfOverhead])
        #expect(events.map(\.volumeID) == ["B1", "B2"])
    }

    // MARK: - Nothing to trust, nothing to show

    @Test func staleFixPredictsNothing() {
        #expect(AirspacePredictor.events(input: Self.input(verticalSpeed: 300, isStale: true), volumes: [Self.shelfOverhead]).isEmpty)
    }

    @Test func noAltitudePredictsNothing() {
        #expect(AirspacePredictor.events(input: Self.input(altitude: nil, verticalSpeed: 300), volumes: [Self.shelfOverhead]).isEmpty)
    }

    @Test func slowGroundSpeedPredictsNothing() {
        #expect(AirspacePredictor.events(input: Self.input(groundSpeed: 20, verticalSpeed: 300), volumes: [Self.shelfOverhead]).isEmpty)
    }

    @Test func entryBeyondTenMinutesPredictsNothing() {
        // Edge about 25 NM east; 10 minutes at 120 kt covers 20 NM.
        let far = Self.volume("B3", rings: [Self.box(lat: 31.5...32.5, lon: 35.5...36.0)], floor: 1_500, ceiling: 10_000)
        #expect(AirspacePredictor.events(input: Self.input(altitude: 2_900), volumes: [far]).isEmpty)
    }

    // MARK: - Shapes

    @Test func holeInPolygonIsNotEntered() {
        // Starts inside the hole and stays in it for the whole 20 NM (hole ends about 23 NM east).
        let start = CLLocationCoordinate2D(latitude: 32, longitude: 35.3)
        let ringed = Self.volume("C1", name: "C", rings: [
            Self.box(lat: 31.5...32.5, lon: 35.1...35.8),
            Self.box(lat: 31.9...32.1, lon: 35.15...35.75)
        ], floor: nil, ceiling: 5_000)
        #expect(AirspacePredictor.events(input: Self.input(position: start), volumes: [ringed]).isEmpty)
    }

    @Test func circleVolumeIsEntered() throws {
        // Center about 10.2 NM east, radius 3 NM: edge about 7.2 NM, about 216 s.
        let prohibited = PredictableVolume(
            id: "P4", shortName: "P 4",
            shape: .circle(center: [32, 35.2], radiusNM: 3),
            floorFeetMSL: nil, ceilingFeetMSL: 4_000, severity: .warning
        )
        let events = AirspacePredictor.events(input: Self.input(), volumes: [prohibited])
        let event = try #require(events.first)
        #expect(event.kind == .lateral)
        #expect(event.severity == .warning)
        #expect(event.title == "P 4")
        #expect((210...225).contains(event.secondsAhead))
    }

    // MARK: - Stabilizer

    static func event(_ volumeID: String, seconds: TimeInterval) -> PredictedEvent {
        PredictedEvent(volumeID: volumeID, kind: .lateral, severity: .caution, secondsAhead: seconds,
                       coordinate: origin, limitFeetMSL: nil, title: volumeID, assumption: "at 090\u{00B0}, level")
    }

    @Test func stabilizerHidesOneOffEvent() {
        var stabilizer = PredictionStabilizer()
        #expect(stabilizer.update([Self.event("A", seconds: 100)]).isEmpty)
        #expect(stabilizer.update([]).isEmpty)
        #expect(stabilizer.update([]).isEmpty)
        #expect(stabilizer.update([]).isEmpty)
    }

    @Test func stabilizerShowsRepeatedEventWithLatestTime() {
        var stabilizer = PredictionStabilizer()
        #expect(stabilizer.update([Self.event("A", seconds: 100)]).isEmpty)
        let shown = stabilizer.update([Self.event("A", seconds: 95)])
        #expect(shown.map(\.secondsAhead) == [95])
        // Two of the last three: a single gap does not hide it on the next appearance.
        #expect(stabilizer.update([]).isEmpty)
        #expect(stabilizer.update([Self.event("A", seconds: 85)]).map(\.secondsAhead) == [85])
    }

    @Test func stabilizerResetForgetsHistory() {
        var stabilizer = PredictionStabilizer()
        _ = stabilizer.update([Self.event("A", seconds: 100)])
        stabilizer.reset()
        #expect(stabilizer.update([Self.event("A", seconds: 95)]).isEmpty)
    }

    // MARK: - Assumption text

    @Test func assumptionTextFormats() {
        #expect(AirspacePredictor.assumptionText(trackTrue: 312, verticalSpeedFPM: 300) == "at 312\u{00B0}, +300 fpm")
        #expect(AirspacePredictor.assumptionText(trackTrue: 45, verticalSpeedFPM: -500) == "at 045\u{00B0}, -500 fpm")
        #expect(AirspacePredictor.assumptionText(trackTrue: 7, verticalSpeedFPM: 60) == "at 007\u{00B0}, level")
    }
}
