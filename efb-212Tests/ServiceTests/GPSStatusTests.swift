//
//  GPSStatusTests.swift
//  efb-212Tests
//
//  GPS status chip transitions (design finding F5): OK -> Degraded -> Lost with age.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("GPS Status")
struct GPSStatusTests {

    static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    static func fix(
        age: TimeInterval = 0,
        horizontal: Double = 5,
        vertical: Double = 8,
        stationary: Bool = false
    ) -> GPSFix {
        GPSFix(
            timestamp: t0.addingTimeInterval(-age),
            horizontalAccuracyMeters: horizontal,
            verticalAccuracyMeters: vertical,
            isStationary: stationary
        )
    }

    // MARK: - OK

    @Test func freshAccurateFixIsOK() {
        let status = GPSStatus.evaluate(fix: Self.fix(), gpsAvailable: true, now: Self.t0)
        #expect(status == .ok)
        #expect(status.isStale == false)
        #expect(status.label == "GPS OK")
    }

    @Test func fixAtExactlyFiveSecondsIsStillOK() {
        let status = GPSStatus.evaluate(fix: Self.fix(age: 5), gpsAvailable: true, now: Self.t0)
        #expect(status == .ok)
    }

    @Test func accuracyAtLimitIsOK() {
        let status = GPSStatus.evaluate(fix: Self.fix(horizontal: 50), gpsAvailable: true, now: Self.t0)
        #expect(status == .ok)
    }

    // MARK: - Degraded

    @Test func missingAltitudeIsDegraded() {
        let status = GPSStatus.evaluate(fix: Self.fix(vertical: -1), gpsAvailable: true, now: Self.t0)
        #expect(status == .degraded(.noAltitude))
        #expect(status.isStale == false)
        #expect(status.label == "GPS DEGR")
    }

    @Test func poorHorizontalAccuracyIsDegraded() {
        let status = GPSStatus.evaluate(fix: Self.fix(horizontal: 65), gpsAvailable: true, now: Self.t0)
        #expect(status == .degraded(.poorHorizontalAccuracy(meters: 65)))
    }

    @Test func invalidHorizontalAccuracyIsDegraded() {
        let status = GPSStatus.evaluate(fix: Self.fix(horizontal: -1), gpsAvailable: true, now: Self.t0)
        #expect(status == .degraded(.poorHorizontalAccuracy(meters: -1)))
    }

    @Test func noAltitudeTakesPrecedenceOverPoorAccuracy() {
        let status = GPSStatus.evaluate(fix: Self.fix(horizontal: 100, vertical: -1), gpsAvailable: true, now: Self.t0)
        #expect(status == .degraded(.noAltitude))
    }

    // MARK: - Lost

    @Test func noFixEverIsLostWithoutAge() {
        let status = GPSStatus.evaluate(fix: nil, gpsAvailable: true, now: Self.t0)
        #expect(status == .lost(ageSeconds: nil))
        #expect(status.isStale)
        #expect(status.label == "GPS LOST")
    }

    @Test func streamFailureIsLostEvenWithRecentFix() {
        let status = GPSStatus.evaluate(fix: Self.fix(), gpsAvailable: false, now: Self.t0)
        #expect(status == .lost(ageSeconds: nil))
    }

    @Test func staleFixIsLostWithAgeInSeconds() {
        let status = GPSStatus.evaluate(fix: Self.fix(age: 12.7), gpsAvailable: true, now: Self.t0)
        #expect(status == .lost(ageSeconds: 12))
        #expect(status.isStale)
        #expect(status.label == "GPS LOST 12s")
    }

    @Test func staleOverridesDegraded() {
        let status = GPSStatus.evaluate(fix: Self.fix(age: 30, vertical: -1), gpsAvailable: true, now: Self.t0)
        #expect(status == .lost(ageSeconds: 30))
    }

    @Test func stationaryFixDoesNotAgeOut() {
        // CoreLocation pauses updates while parked; the last fix stays valid.
        let status = GPSStatus.evaluate(fix: Self.fix(age: 120, stationary: true), gpsAvailable: true, now: Self.t0)
        #expect(status == .ok)
    }

    // MARK: - Transition sequence

    @Test func okThenDegradedThenLostAsTheSameFixAges() {
        let fix = Self.fix(vertical: -1)
        let fresh = GPSStatus.evaluate(fix: Self.fix(), gpsAvailable: true, now: Self.t0)
        let degraded = GPSStatus.evaluate(fix: fix, gpsAvailable: true, now: Self.t0.addingTimeInterval(2))
        let lost = GPSStatus.evaluate(fix: fix, gpsAvailable: true, now: Self.t0.addingTimeInterval(6))
        #expect(fresh == .ok)
        #expect(degraded == .degraded(.noAltitude))
        #expect(lost == .lost(ageSeconds: 6))
    }

    @Test func gpsFixFromCLLocationCopiesAccuracies() {
        let location = CLLocation(
            coordinate: .init(latitude: 37.4611, longitude: -122.1150),
            altitude: 2.0, horizontalAccuracy: 12, verticalAccuracy: -1,
            timestamp: Self.t0
        )
        let fix = GPSFix(location: location)
        #expect(fix.horizontalAccuracyMeters == 12)
        #expect(fix.verticalAccuracyMeters == -1)
        #expect(fix.timestamp == Self.t0)
        #expect(GPSStatus.evaluate(fix: fix, gpsAvailable: true, now: Self.t0) == .degraded(.noAltitude))
    }
}
