//
//  IsraelRouteFollowing.swift
//  efb-212
//
//  Pure route-following maths for an active Israel CVFR route (IL-ALERTS, efb-aac.8): cross-track
//  distance and side, auto-sequencing, altitude deviation with a persistence window. No state, no
//  clock: every function takes the position, the altitude and `now`, so tests are deterministic.
//
//  Units: degrees WGS-84, nautical miles, feet MSL, knots, seconds.
//

import Foundation
import CoreLocation

nonisolated enum IsraelRouteFollowing {

    // MARK: - Thresholds

    /// Off-route caution threshold -- nautical miles. The route is 2 km wide (1 km each side); 1 NM
    /// leaves room for the GPS and for the routes' by-the-feature flying.
    static let defaultOffRouteThresholdNM = 1.0
    /// UserDefaults key for the pilot's own threshold (nautical miles); unset = the default.
    static let offRouteThresholdDefaultsKey = "israelOffRouteThresholdNM"
    /// Altitude caution band around the published altitude -- feet.
    static let altitudeToleranceFeet = 300.0
    /// The deviation must last longer than this before the caution shows -- seconds.
    static let altitudeGraceSeconds: TimeInterval = 30
    /// No altitude caution within this distance of the departure or destination (climb, descent) -- nautical miles.
    static let terminalSuppressionNM = 3.0
    /// Passing abeam only counts when within this distance of the TO point -- nautical miles.
    static let abeamLimitNM = 2.0
    /// ETE is only meaningful above this ground speed -- knots.
    static let minimumGroundSpeedKnots = 30.0

    /// The pilot's configured off-route threshold, or the default.
    static func configuredOffRouteThresholdNM(_ defaults: UserDefaults = .standard) -> Double {
        let stored = defaults.double(forKey: offRouteThresholdDefaultsKey)
        return stored > 0 ? stored : defaultOffRouteThresholdNM
    }

    // MARK: - Geometry

    /// Great-circle distance -- nautical miles (haversine, 3440.065 NM earth radius).
    static func distanceNM(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = lat2 - lat1
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 3440.065 * 2 * atan2(h.squareRoot(), (1 - h).squareRoot())
    }

    /// Local flat projection of `point` relative to `origin` -- nautical miles (x east, y north).
    /// Accurate to well under 0.1% over the few NM this is used for.
    static func offsetNM(of point: CLLocationCoordinate2D, from origin: CLLocationCoordinate2D) -> (x: Double, y: Double) {
        let cosLat = cos(origin.latitude * .pi / 180)
        return ((point.longitude - origin.longitude) * 60 * cosLat, (point.latitude - origin.latitude) * 60)
    }

    /// Distance from `point` to the polyline (a list of [lat, lon]) and the side it lies on, looking along the
    /// direction of the polyline. The nearest segment decides. nil for fewer than two vertices.
    static func crossTrack(of point: CLLocationCoordinate2D, along vertices: [[Double]]) -> (distanceNM: Double, side: RouteSide)? {
        let usable = vertices.filter { $0.count >= 2 }
        guard usable.count >= 2 else { return nil }
        var best: (distance: Double, side: RouteSide)?
        for index in 0..<(usable.count - 1) {
            let a = CLLocationCoordinate2D(latitude: usable[index][0], longitude: usable[index][1])
            let b = CLLocationCoordinate2D(latitude: usable[index + 1][0], longitude: usable[index + 1][1])
            let ab = offsetNM(of: b, from: a)
            let ap = offsetNM(of: point, from: a)
            let lengthSquared = ab.x * ab.x + ab.y * ab.y
            let t = lengthSquared > 0 ? max(0, min(1, (ap.x * ab.x + ap.y * ab.y) / lengthSquared)) : 0
            let dx = ap.x - t * ab.x
            let dy = ap.y - t * ab.y
            let distance = (dx * dx + dy * dy).squareRoot()
            // Positive cross product (ab x ap) = the point lies counter-clockwise of the direction = left.
            let cross = ab.x * ap.y - ab.y * ap.x
            let side: RouteSide = cross > 0 ? .left : .right
            if best == nil || distance < best!.distance { best = (distance, side) }
        }
        return best.map { ($0.distance, $0.side) }
    }

    /// True when the aircraft has passed the leg's TO point: within `ActiveRoute.arrivalRadiusNM` of it, or
    /// abeam it (past the end of the last segment, within `abeamLimitNM`).
    static func hasReachedEnd(of leg: ActiveRouteLeg, position: CLLocationCoordinate2D) -> Bool {
        let toDistance = distanceNM(position, leg.toCoordinate)
        if toDistance <= ActiveRoute.arrivalRadiusNM { return true }
        guard toDistance <= abeamLimitNM else { return false }
        let vertices = leg.vertices.filter { $0.count >= 2 }
        guard vertices.count >= 2 else { return false }
        let a = CLLocationCoordinate2D(latitude: vertices[vertices.count - 2][0], longitude: vertices[vertices.count - 2][1])
        let ab = offsetNM(of: leg.toCoordinate, from: a)
        let ap = offsetNM(of: position, from: a)
        // Past the end of the last segment: the projection of the position lies beyond the TO point.
        return ap.x * ab.x + ap.y * ab.y > ab.x * ab.x + ab.y * ab.y
    }

    // MARK: - Altitude

    /// Signed feet from the nearest published altitude (+ above). Two-number text compares against both.
    /// nil when the leg publishes no altitude.
    static func altitudeDeviationFeet(altitudeFeet: Double, published: [Int]) -> Double? {
        published
            .map { altitudeFeet - Double($0) }
            .min { abs($0) < abs($1) }
    }

    /// Within `terminalSuppressionNM` of the departure or destination aerodrome.
    static func isNearTerminal(position: CLLocationCoordinate2D, route: ActiveRoute) -> Bool {
        if let departure = route.departureCoordinate, distanceNM(position, departure) <= terminalSuppressionNM { return true }
        if let destination = route.destinationCoordinate, distanceNM(position, destination) <= terminalSuppressionNM { return true }
        return false
    }

    // MARK: - Update

    /// Result of one fix: the route with its sequencing and following status, and the distance to the next point.
    struct Progress: Sendable {
        var route: ActiveRoute
        var distanceToNextNM: Double?   // nautical miles
    }

    /// Advance the route for a fix and refresh the following status.
    /// - Parameters:
    ///   - altitudeFeet: GPS altitude (feet MSL); nil when there is no vertical fix (no altitude caution then).
    ///   - groundSpeedKnots: knots; ETA needs more than `minimumGroundSpeedKnots`.
    static func progress(
        of route: ActiveRoute,
        position: CLLocationCoordinate2D,
        altitudeFeet: Double?,
        groundSpeedKnots: Double,
        now: Date
    ) -> Progress {
        var route = route
        // Auto-sequence: a fix can pass several short legs at once.
        while let leg = route.current, !route.isLastLeg, hasReachedEnd(of: leg, position: position) {
            route.advance()
        }
        guard let leg = route.current else { return Progress(route: route, distanceToNextNM: nil) }

        let toNext = distanceNM(position, leg.toCoordinate)  // nautical miles
        var following = route.following

        if let track = crossTrack(of: position, along: leg.vertices) {
            following.crossTrackNM = track.distanceNM
            following.side = track.side
            following.isOffRoute = track.distanceNM > route.offRouteThresholdNM
        } else {
            following.crossTrackNM = nil
            following.side = nil
            following.isOffRoute = false
        }

        following.nextPointETA = groundSpeedKnots > minimumGroundSpeedKnots
            ? now.addingTimeInterval(toNext / groundSpeedKnots * 3600)  // seconds = NM / knots * 3600
            : nil

        let published = leg.publishedAltitudesFeet
        if let altitudeFeet, !published.isEmpty, !isNearTerminal(position: position, route: route),
           let deviation = altitudeDeviationFeet(altitudeFeet: altitudeFeet, published: published) {
            following.altitudeDeviationFeet = deviation
            if abs(deviation) > altitudeToleranceFeet {
                let since = following.altitudeDeviationSince ?? now
                following.altitudeDeviationSince = since
                following.isAltitudeCaution = now.timeIntervalSince(since) > altitudeGraceSeconds
            } else {
                following.altitudeDeviationSince = nil
                following.isAltitudeCaution = false
            }
        } else {
            following.altitudeDeviationFeet = nil
            following.altitudeDeviationSince = nil
            following.isAltitudeCaution = false
        }

        route.following = following
        return Progress(route: route, distanceToNextNM: toNext)
    }
}
