//
//  LocationServiceCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization tests (docs/TESTING.md, CQ-1): pin what LocationService does today with a
//  location update stream, through the `updates:` seam. LocationManagerTests never called the
//  service; these drive the real tracking loop and read the AppState it writes.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("LocationService characterization", .serialized)
@MainActor
struct LocationServiceCharacterizationTests {

    // MARK: - Harness

    typealias Updates = AsyncThrowingStream<LocationUpdateSnapshot, Error>

    struct Harness {
        let appState: AppState
        let service: LocationService
        let feed: Updates.Continuation
    }

    static func makeHarness(noFixGrace: Duration = .seconds(60)) -> Harness {
        let appState = AppState()
        let (stream, feed) = Updates.makeStream()
        let service = LocationService(appState: appState, updates: { stream }, noFixGrace: noFixGrace)
        return Harness(appState: appState, service: service, feed: feed)
    }

    static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    /// A fix with explicit units: meters, meters per second, degrees true.
    static func fix(
        altitudeMeters: Double = 100,
        speedMS: Double = 0,
        course: Double = 0,
        timestamp: Date = t0
    ) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150),
            altitude: altitudeMeters,
            horizontalAccuracy: 5,
            verticalAccuracy: 8,
            course: course,
            speed: speedMS,
            timestamp: timestamp
        )
    }

    /// Hands out the given streams one per `next()`; extra requests get an already-finished stream.
    final class StreamQueue: @unchecked Sendable {
        private let lock = NSLock()
        private var streams: [Updates]
        private(set) var requestedCount = 0
        init(_ streams: [Updates]) { self.streams = streams }
        func next() -> Updates {
            lock.lock(); defer { lock.unlock() }
            requestedCount += 1
            return streams.isEmpty ? Updates { $0.finish() } : streams.removeFirst()
        }
        var requested: Int { lock.lock(); defer { lock.unlock() }; return requestedCount }
    }

    /// Poll until `condition` holds; the tracking loop hops to the main actor per update. 30 s, not 10: the first
    /// update has missed 10 s on loaded CI runners while the rest of the suite starts up.
    static func waitUntil(
        _ timeout: Duration = .seconds(30),
        _ condition: @MainActor () -> Bool
    ) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    // MARK: - Unit conversion of a fix

    @Test func fixIsConvertedToKnotsFeetAndDegrees() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        // 10 m/s, 1000 m, course 90.
        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 1000, speedMS: 10, course: 90)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })

        #expect(abs(h.appState.groundSpeed - 19.4384) < 0.0001)   // knots
        #expect(h.appState.altitude == 3280)                       // feet MSL, 3280.84 rounded to 10
        #expect(h.appState.track == 90)                            // degrees true
        #expect(h.appState.gpsAvailable)
        #expect(h.appState.gpsFailure == nil)
        #expect(h.appState.ownshipPosition?.coordinate.latitude == 37.4611)
    }

    @Test func invalidCourseBecomesZeroAndNegativeSpeedBecomesZero() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        // CoreLocation reports course -1 and speed -1 when invalid. The service shows 0 / 0,
        // not "unknown": the instrument strip cannot tell "north, 0 kt" from "no data".
        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(speedMS: -1, course: -1)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })

        #expect(h.appState.groundSpeed == 0)   // knots
        #expect(h.appState.track == 0)         // degrees true
    }

    @Test func altitudeRoundsToNearestTenFeet() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        // 100 m = 328.08 ft, shown rounded to the nearest 10 ft.
        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 100)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })
        #expect(h.appState.altitude == 330)    // feet MSL
    }

    // MARK: - Vertical speed

    @Test func verticalSpeedIsDerivedFromFixTimestampsNotArrivalTime() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 100, timestamp: Self.t0)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })
        #expect(h.appState.verticalSpeed == 0)   // feet per minute

        // efb-hql: 100 ft climb over 60 s of fix time arrives immediately; VSI is 100 fpm,
        // not the huge value the arrival-time (Date()) difference would give.
        h.feed.yield(LocationUpdateSnapshot(
            location: Self.fix(altitudeMeters: 130.48, timestamp: Self.t0.addingTimeInterval(60))
        ))
        #expect(await Self.waitUntil { h.appState.altitude != 330 })
        #expect(abs(h.appState.verticalSpeed - 100) < 0.5)   // feet per minute
    }

    @Test func identicalFixTimestampsGiveZeroVerticalSpeed() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 100, timestamp: Self.t0)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })
        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 130.48, timestamp: Self.t0)))
        #expect(await Self.waitUntil { h.appState.altitude != 330 })
        #expect(h.appState.verticalSpeed == 0)   // feet per minute
    }

    // MARK: - GPS failure flags on updates with no position

    @Test(arguments: [
        (true, false, false, false, GPSFailureReason.authorizationDenied),
        (false, true, false, false, GPSFailureReason.authorizationDenied),   // denied globally
        (false, false, true, false, GPSFailureReason.authorizationRestricted),
        (false, false, false, true, GPSFailureReason.locationUnavailable),
    ] as [(Bool, Bool, Bool, Bool, GPSFailureReason)])
    func updateWithoutPositionMarksGPSUnavailableWithTheMatchingReason(
        denied: Bool, deniedGlobally: Bool, restricted: Bool, unavailable: Bool, expected: GPSFailureReason
    ) async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(
            location: nil,
            authorizationDenied: denied,
            authorizationDeniedGlobally: deniedGlobally,
            authorizationRestricted: restricted,
            locationUnavailable: unavailable
        ))
        #expect(await Self.waitUntil { h.appState.gpsFailure != nil })

        #expect(h.appState.gpsFailure == expected)
        #expect(!h.appState.gpsAvailable)
    }

    @Test func aFixAfterAFailureClearsTheFailureAndRestoresAvailability() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: nil, locationUnavailable: true))
        #expect(await Self.waitUntil { h.appState.gpsFailure == .locationUnavailable })

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix()))
        #expect(await Self.waitUntil { h.appState.gpsAvailable })
        #expect(h.appState.gpsFailure == nil)
    }

    @Test func stationaryNoticeKeepsTheLastFixAvailableAndOnlySetsTheStationaryFlag() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 1000, speedMS: 10)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })

        h.feed.yield(LocationUpdateSnapshot(location: nil, stationary: true))
        #expect(await Self.waitUntil { h.appState.gpsStationary })

        // The last speed stays on screen; GPSStatus will not age the fix out while stationary.
        #expect(h.appState.gpsAvailable)
        #expect(h.appState.gpsFailure == nil)
        #expect(abs(h.appState.groundSpeed - 19.4384) < 0.0001)   // knots
    }

    @Test func updateWithNoPositionAndNoFlagsIsIgnored() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: nil, authorizationDenied: true))
        #expect(await Self.waitUntil { h.appState.gpsFailure == .authorizationDenied })

        // A bare update changes nothing; the stationary notice after it proves it was consumed.
        h.feed.yield(LocationUpdateSnapshot(location: nil))
        h.feed.yield(LocationUpdateSnapshot(location: nil, stationary: true))
        #expect(await Self.waitUntil { h.appState.gpsStationary })

        #expect(h.appState.gpsFailure == .authorizationDenied)
        #expect(!h.appState.gpsAvailable)
    }

    // MARK: - Stream end

    @Test func streamErrorMarksGPSLostThenRestartsTrackingAndARestartedFixRecoversIt() async throws {
        let appState = AppState()
        let (first, firstFeed) = Updates.makeStream()
        let (second, secondFeed) = Updates.makeStream()
        let streams = StreamQueue([first, second])
        let service = LocationService(
            appState: appState, updates: { streams.next() },
            noFixGrace: .seconds(60), restartBaseDelay: .milliseconds(20)
        )
        await service.startTracking()
        defer { service.stopTracking() }

        firstFeed.yield(LocationUpdateSnapshot(location: Self.fix()))
        #expect(await Self.waitUntil { appState.gpsAvailable })

        firstFeed.finish(throwing: URLError(.cancelled))
        #expect(await Self.waitUntil { appState.gpsFailure == .streamFailed })
        #expect(!appState.gpsAvailable)
        #expect(service.isTracking)

        // efb-71b: the service asks for a fresh stream; a fix on it clears the failure.
        #expect(await Self.waitUntil { streams.requested == 2 })
        secondFeed.yield(LocationUpdateSnapshot(location: Self.fix(speedMS: 10)))
        #expect(await Self.waitUntil { appState.gpsAvailable })
        #expect(appState.gpsFailure == nil)
        #expect(abs(appState.groundSpeed - 19.4384) < 0.0001)   // knots
    }

    @Test func stopTrackingDuringBackoffPreventsARestart() async throws {
        let appState = AppState()
        let (first, firstFeed) = Updates.makeStream()
        let (second, _) = Updates.makeStream()
        let streams = StreamQueue([first, second])
        let service = LocationService(
            appState: appState, updates: { streams.next() },
            noFixGrace: .seconds(60), restartBaseDelay: .milliseconds(200)
        )
        await service.startTracking()

        firstFeed.finish(throwing: URLError(.cancelled))
        #expect(await Self.waitUntil { appState.gpsFailure == .streamFailed })
        service.stopTracking()

        try await Task.sleep(for: .milliseconds(400))
        #expect(streams.requested == 1)
        #expect(!service.isTracking)
    }

    // MARK: - No fix yet

    @Test func noFixWithinTheGraceDelayRaisesNoFixYet() async throws {
        let h = Self.makeHarness(noFixGrace: .milliseconds(40))
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        #expect(await Self.waitUntil { h.appState.gpsFailure == .noFixYet })
        #expect(!h.appState.gpsAvailable)
    }

    @Test func aFixBeforeTheGraceDelayPreventsNoFixYet() async throws {
        let h = Self.makeHarness(noFixGrace: .milliseconds(250))
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix()))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })

        try await Task.sleep(for: .milliseconds(400))
        #expect(h.appState.gpsFailure == nil)
    }

    @Test func explicitFailureBeforeTheGraceDelayIsNotOverwrittenByNoFixYet() async throws {
        let h = Self.makeHarness(noFixGrace: .milliseconds(250))
        await h.service.startTracking()
        defer { h.service.stopTracking() }

        h.feed.yield(LocationUpdateSnapshot(location: nil, authorizationDenied: true))
        #expect(await Self.waitUntil { h.appState.gpsFailure == .authorizationDenied })

        try await Task.sleep(for: .milliseconds(400))
        #expect(h.appState.gpsFailure == .authorizationDenied)
    }

    // MARK: - Stop

    @Test func stopTrackingEndsTrackingAndLaterUpdatesAreNotApplied() async throws {
        let h = Self.makeHarness()
        await h.service.startTracking()
        #expect(h.service.isTracking)

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 1000, speedMS: 10)))
        #expect(await Self.waitUntil { h.appState.firstLocationReceived })

        h.service.stopTracking()
        #expect(!h.service.isTracking)

        h.feed.yield(LocationUpdateSnapshot(location: Self.fix(altitudeMeters: 2000, speedMS: 50)))
        try await Task.sleep(for: .milliseconds(100))

        #expect(abs(h.appState.groundSpeed - 19.4384) < 0.0001)   // knots, unchanged
        #expect(h.appState.altitude == 3280)                       // feet MSL, unchanged
    }
}
