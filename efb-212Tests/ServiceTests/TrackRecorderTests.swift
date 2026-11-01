//
//  TrackRecorderTests.swift
//  efb-212Tests
//
//  Drives TrackRecorder.ingest with synthetic CLLocations (no CoreLocation stream)
//  and checks that the real vertical speed estimate carries the phase detector
//  through taxi -> takeoff -> departure.
//

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

@Suite("TrackRecorder Tests")
struct TrackRecorderTests {

    static func makeTempDB() throws -> RecordingDatabase {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("track-test-\(UUID().uuidString).sqlite").path
        return try RecordingDatabase(dbPool: try DatabasePool(path: path))
    }

    static let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    /// Synthetic fix. speed in knots, altitude in feet MSL.
    static func fix(second: Int, speedKnots: Double, altitudeFeet: Double) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 37.46, longitude: -122.12),
            altitude: altitudeFeet * 0.3048,
            horizontalAccuracy: 5,
            verticalAccuracy: 3,
            course: 270,
            speed: speedKnots / 1.94384,
            timestamp: t0.addingTimeInterval(Double(second))
        )
    }

    @Test func realisticDepartureReachesTakeoffThenDeparture() async throws {
        let db = try Self.makeTempDB()
        let recorder = TrackRecorder(recordingDB: db, flightID: UUID())

        let fieldElevation = 100.0  // feet MSL
        var second = 0

        // Taxi at 10 kt, level, 40 s
        for _ in 0..<40 {
            await recorder.ingest(Self.fix(second: second, speedKnots: 10, altitudeFeet: fieldElevation))
            second += 1
        }
        #expect(await recorder.currentPhase == .taxi)

        // Takeoff roll: accelerate 10 -> 50 kt over 15 s, still on the ground (below rotation speed)
        for i in 0..<15 {
            let speed = 10 + Double(i + 1) * (40.0 / 15.0)
            await recorder.ingest(Self.fix(second: second, speedKnots: speed, altitudeFeet: fieldElevation))
            second += 1
        }
        #expect(await recorder.currentPhase == .taxi)

        // Rotate and climb at 600 fpm (10 ft/s), accelerating through 55 kt to 70 kt, for 90 s -> ~1000 ft above field
        var altitude = fieldElevation
        var sawTakeoff = false
        for k in 0..<90 {
            altitude += 10
            await recorder.ingest(Self.fix(second: second, speedKnots: min(70, 50 + Double(k)), altitudeFeet: altitude))
            second += 1
            if await recorder.currentPhase == .takeoff { sawTakeoff = true }
        }

        let vsi = await recorder.verticalSpeedFPM
        #expect(abs(vsi - 600) < 20)
        #expect(sawTakeoff)
        #expect(await recorder.currentPhase == .departure)

        let summary = await recorder.stopTracking()
        #expect(summary.trackPointCount == second)
        #expect(summary.phaseMarkers.map(\.phase).contains(FlightPhaseType.takeoff.rawValue))
        #expect(summary.phaseMarkers.map(\.phase).contains(FlightPhaseType.departure.rawValue))
    }

    @Test func trackPointsCarryEstimatedVerticalSpeed() async throws {
        let db = try Self.makeTempDB()
        let flightID = UUID()
        let recorder = TrackRecorder(recordingDB: db, flightID: flightID)

        for i in 0..<20 {
            await recorder.ingest(Self.fix(second: i, speedKnots: 80, altitudeFeet: 1000 + Double(i) * 5))
        }

        let points = try db.trackPoints(forFlight: flightID)
        #expect(points.count == 20)
        // 5 ft/s = 300 fpm; the first point has no prior fix and stays at 0
        #expect(points.first?.verticalSpeedFPM == 0)
        if let last = points.last {
            #expect(abs(last.verticalSpeedFPM - 300) < 10)
        }
    }
}
