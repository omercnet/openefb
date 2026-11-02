//
//  IsraelRouteFollowingTests.swift
//  efb-212Tests
//
//  Route following for an active Israel CVFR route (IL-ALERTS): cross-track and side, auto-sequencing,
//  manual next/previous, off-route threshold, altitude deviation with its 30 s window and the 3 NM
//  suppression near the departure and destination.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

struct IsraelRouteFollowingTests {

    // Two legs: A (32.00N 34.80E) -> B (32.30N 34.80E), due north (18 NM), then B -> C (32.30N 35.10E), due east.
    private static func route(altitudeA: String = "2500", offRouteNM: Double = 1.0) -> ActiveRoute {
        let legs = [
            ActiveRouteLeg(
                segmentID: 1, fromCode: "AAAAA", toCode: "BBBBB",
                fromLatitude: 32.00, fromLongitude: 34.80, toLatitude: 32.30, toLongitude: 34.80,
                altitudeText: altitudeA, distanceNM: 18
            ),
            ActiveRouteLeg(
                segmentID: 2, fromCode: "BBBBB", toCode: "CCCCC",
                fromLatitude: 32.30, fromLongitude: 34.80, toLatitude: 32.30, toLongitude: 35.10,
                altitudeText: "3500", distanceNM: 15.2
            ),
        ]
        var route = ActiveRoute(legs: legs)
        route.offRouteThresholdNM = offRouteNM
        return route
    }

    private static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    /// 1 NM of longitude at latitude 32.15 in degrees.
    private static let degreesPerNMEast = 1.0 / (60 * cos(32.15 * .pi / 180))

    private static func progress(
        _ route: ActiveRoute, lat: Double, lon: Double, altitude: Double? = 2500,
        groundSpeed: Double = 100, at time: Date = t0
    ) -> IsraelRouteFollowing.Progress {
        IsraelRouteFollowing.progress(
            of: route, position: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            altitudeFeet: altitude, groundSpeedKnots: groundSpeed, now: time
        )
    }

    // MARK: Cross-track and side

    @Test func eastOfANorthboundLegIsRightAndWestIsLeft() throws {
        let east = try #require(IsraelRouteFollowing.crossTrack(
            of: CLLocationCoordinate2D(latitude: 32.15, longitude: 34.80 + 0.8 * Self.degreesPerNMEast),
            along: [[32.00, 34.80], [32.30, 34.80]]))
        #expect(east.side == .right)
        #expect(abs(east.distanceNM - 0.8) < 0.02)

        let west = try #require(IsraelRouteFollowing.crossTrack(
            of: CLLocationCoordinate2D(latitude: 32.15, longitude: 34.80 - 0.8 * Self.degreesPerNMEast),
            along: [[32.00, 34.80], [32.30, 34.80]]))
        #expect(west.side == .left)
        #expect(abs(west.distanceNM - 0.8) < 0.02)
    }

    @Test func crossTrackUsesTheNearestSegmentOfABentLeg() throws {
        // North then east: a point just north of the corner is 0.5 NM from the eastbound part (left of it).
        let bent: [[Double]] = [[32.00, 34.80], [32.30, 34.80], [32.30, 35.10]]
        let point = CLLocationCoordinate2D(latitude: 32.30 + 0.5 / 60, longitude: 34.95)
        let result = try #require(IsraelRouteFollowing.crossTrack(of: point, along: bent))
        #expect(abs(result.distanceNM - 0.5) < 0.02)
        #expect(result.side == .left)
    }

    @Test func offRouteCautionFollowsTheThreshold() {
        let beyond = Self.progress(Self.route(), lat: 32.15, lon: 34.80 + 1.5 * Self.degreesPerNMEast)
        #expect(beyond.route.following.isOffRoute)
        #expect(beyond.route.following.side == .right)

        let within = Self.progress(Self.route(), lat: 32.15, lon: 34.80 + 0.5 * Self.degreesPerNMEast)
        #expect(!within.route.following.isOffRoute)

        // The pilot's own threshold: 2 NM makes the 1.5 NM fix on-route.
        let relaxed = Self.progress(Self.route(offRouteNM: 2.0), lat: 32.15, lon: 34.80 + 1.5 * Self.degreesPerNMEast)
        #expect(!relaxed.route.following.isOffRoute)
    }

    // MARK: Sequencing

    @Test func staysOnTheLegAwayFromTheToPoint() {
        let result = Self.progress(Self.route(), lat: 32.15, lon: 34.80)
        #expect(result.route.currentLeg == 0)
        #expect(abs((result.distanceToNextNM ?? 0) - 9) < 0.1)
    }

    @Test func sequencesWithinHalfANauticalMileOfTheToPoint() {
        let result = Self.progress(Self.route(), lat: 32.30 - 0.4 / 60, lon: 34.80)
        #expect(result.route.currentLeg == 1)
        #expect(result.route.current?.toCode == "CCCCC")
    }

    @Test func doesNotSequenceJustOutsideHalfANauticalMile() {
        let result = Self.progress(Self.route(), lat: 32.30 - 0.6 / 60, lon: 34.80)
        #expect(result.route.currentLeg == 0)
    }

    @Test func sequencesWhenAbeamThePointOffToTheSide() {
        // Past the end of the northbound leg, 0.8 NM east of it, 0.6 NM beyond B: 1.0 NM from B, abeam passed.
        let result = Self.progress(Self.route(), lat: 32.30 + 0.6 / 60, lon: 34.80 + 0.8 * Self.degreesPerNMEast)
        #expect(result.route.currentLeg == 1)
    }

    @Test func doesNotSequenceAbeamWhenFarFromThePoint() {
        // Beyond the end of the leg but 4 NM from B: not a pass of B.
        let result = Self.progress(Self.route(), lat: 32.30 + 4.0 / 60, lon: 34.80)
        #expect(result.route.currentLeg == 0)
    }

    @Test func lastLegNeverSequencesPastTheEnd() {
        var route = Self.route()
        route.advance()
        let result = Self.progress(route, lat: 32.30, lon: 35.10)
        #expect(result.route.currentLeg == 1)
    }

    @Test func manualNextAndPreviousStayInBounds() {
        var route = Self.route()
        route.goBack()
        #expect(route.currentLeg == 0)
        route.advance()
        #expect(route.currentLeg == 1)
        route.advance()
        #expect(route.currentLeg == 1)
        route.goBack()
        #expect(route.currentLeg == 0)
    }

    @Test func manualSequenceResetsTheFollowingStatus() {
        var route = Self.progress(Self.route(), lat: 32.15, lon: 34.80 + 1.5 * Self.degreesPerNMEast).route
        #expect(route.following.isOffRoute)
        route.advance()
        #expect(!route.following.isOffRoute)
        #expect(route.following.crossTrackNM == nil)
    }

    // MARK: Altitude

    @Test func altitudeCautionNeedsMoreThan30SecondsOutsideTheBand() {
        var route = Self.route()
        // 2850 ft against 2500: +350, outside +/-300.
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0).route
        #expect(route.following.altitudeDeviationFeet == 350)
        #expect(!route.following.isAltitudeCaution)
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0.addingTimeInterval(29)).route
        #expect(!route.following.isAltitudeCaution)
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0.addingTimeInterval(31)).route
        #expect(route.following.isAltitudeCaution)
    }

    @Test func returningInsideTheBandResetsTheTimer() {
        var route = Self.route()
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0).route
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2700, at: Self.t0.addingTimeInterval(20)).route
        #expect(route.following.altitudeDeviationSince == nil)
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0.addingTimeInterval(40)).route
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 2850, at: Self.t0.addingTimeInterval(60)).route
        #expect(!route.following.isAltitudeCaution)  // only 20 s since the second excursion began
    }

    @Test func twoNumberAltitudeComparesAgainstBoth() {
        var route = Self.route(altitudeA: "2500/3500")
        // 3600 is 100 ft from 3500: fine. 3000 is 500 from both: caution once 30 s pass.
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 3600, at: Self.t0).route
        #expect(route.following.altitudeDeviationFeet == 100)
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 3000, at: Self.t0.addingTimeInterval(40)).route
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: 3000, at: Self.t0.addingTimeInterval(80)).route
        #expect(route.following.isAltitudeCaution)
    }

    @Test func noAltitudeCautionNearDepartureOrDestination() {
        var route = Self.route()
        // 2 NM north of A, 800 ft: far below 2500, but inside the 3 NM climb-out window.
        let nearDeparture = 32.00 + 2.0 / 60
        route = Self.progress(route, lat: nearDeparture, lon: 34.80, altitude: 800, at: Self.t0).route
        route = Self.progress(route, lat: nearDeparture, lon: 34.80, altitude: 800, at: Self.t0.addingTimeInterval(60)).route
        #expect(!route.following.isAltitudeCaution)
        #expect(route.following.altitudeDeviationFeet == nil)

        // The destination is the end of the last leg: 2 NM west of C on the last leg.
        var last = Self.route()
        last.advance()
        let nearDestination = 35.10 - 2.0 * Self.degreesPerNMEast
        last = Self.progress(last, lat: 32.30, lon: nearDestination, altitude: 1200, at: Self.t0).route
        last = Self.progress(last, lat: 32.30, lon: nearDestination, altitude: 1200, at: Self.t0.addingTimeInterval(60)).route
        #expect(!last.following.isAltitudeCaution)
    }

    @Test func cautionRunsOnceClearOfTheTerminalWindow() {
        var route = Self.route()
        let enRoute = 32.00 + 5.0 / 60  // 5 NM from A
        route = Self.progress(route, lat: enRoute, lon: 34.80, altitude: 1800, at: Self.t0).route
        route = Self.progress(route, lat: enRoute, lon: 34.80, altitude: 1800, at: Self.t0.addingTimeInterval(31)).route
        #expect(route.following.isAltitudeCaution)
        #expect(route.following.altitudeDeviationFeet == -700)
    }

    @Test func unknownAltitudeNeverRaisesTheCaution() {
        var route = Self.route()
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: nil, at: Self.t0).route
        route = Self.progress(route, lat: 32.15, lon: 34.80, altitude: nil, at: Self.t0.addingTimeInterval(120)).route
        #expect(!route.following.isAltitudeCaution)
        #expect(route.following.altitudeDeviationFeet == nil)
    }

    // MARK: ETA

    @Test func etaIsDistanceOverGroundSpeedAndNilWhenSlow() throws {
        let fast = Self.progress(Self.route(), lat: 32.15, lon: 34.80, groundSpeed: 90)  // 9 NM at 90 kt = 6 min
        let eta = try #require(fast.route.following.nextPointETA)
        #expect(abs(eta.timeIntervalSince(Self.t0) - 360) < 5)

        let slow = Self.progress(Self.route(), lat: 32.15, lon: 34.80, groundSpeed: 10)
        #expect(slow.route.following.nextPointETA == nil)
    }

    @Test func publishedAltitudesParseSingleAndTwoNumberText() {
        #expect(Self.route().legs[0].publishedAltitudesFeet == [2500])
        #expect(Self.route(altitudeA: "2500/3500").legs[0].publishedAltitudesFeet == [2500, 3500])
        #expect(Self.route(altitudeA: "---").legs[0].publishedAltitudesFeet.isEmpty)
    }
}
