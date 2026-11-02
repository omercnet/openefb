//
//  ActiveRoute.swift
//  efb-212
//
//  The activated multi-leg route (Israel CVFR plan): which leg the pilot is on, the next reporting
//  point and its published altitude. Feeds the active-navigation bar and the instrument strip's
//  DTG/ETE (`AppState.updateActiveRouteProgress`), and carries the route-following status
//  (cross-track, altitude deviation) computed by `IsraelRouteFollowing` on every fix.
//

import Foundation
import CoreLocation

nonisolated struct ActiveRouteLeg: Equatable, Sendable {
    /// The network segment this leg flies (for NOTAM closure marks); 0 when not from the network.
    let segmentID: Int
    let fromCode: String
    let toCode: String
    let fromLatitude: Double    // degrees
    let fromLongitude: Double   // degrees
    let toLatitude: Double      // degrees
    let toLongitude: Double     // degrees
    /// Published altitude for the direction flown: "2500", "2500/3500" -- feet MSL.
    let altitudeText: String
    let distanceNM: Double      // nautical miles
    /// The leg's polyline in the direction flown, [lat, lon] per vertex; from -> to when empty.
    let path: [[Double]]

    init(
        segmentID: Int = 0,
        fromCode: String, toCode: String,
        fromLatitude: Double = 0, fromLongitude: Double = 0,
        toLatitude: Double, toLongitude: Double,
        altitudeText: String, distanceNM: Double,
        path: [[Double]] = []
    ) {
        self.segmentID = segmentID
        self.fromCode = fromCode
        self.toCode = toCode
        self.fromLatitude = fromLatitude
        self.fromLongitude = fromLongitude
        self.toLatitude = toLatitude
        self.toLongitude = toLongitude
        self.altitudeText = altitudeText
        self.distanceNM = distanceNM
        self.path = path
    }

    var fromCoordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: fromLatitude, longitude: fromLongitude) }
    var toCoordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: toLatitude, longitude: toLongitude) }

    /// The polyline as [lat, lon] vertices: `path`, or the straight from -> to line.
    var vertices: [[Double]] {
        if path.count >= 2 { return path }
        return [[fromLatitude, fromLongitude], [toLatitude, toLongitude]]
    }

    /// Every number in the published altitude -- feet MSL. "2500/3500" -> [2500, 3500]; empty when unpublished.
    var publishedAltitudesFeet: [Int] {
        altitudeText.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
    }
}

/// Which side of the route the aircraft is on, looking along the direction flown.
nonisolated enum RouteSide: String, Equatable, Sendable {
    case left = "L"
    case right = "R"
}

/// Route-following status for the active leg, refreshed on every fix (`IsraelRouteFollowing`).
nonisolated struct ActiveRouteFollowing: Equatable, Sendable {
    /// Lateral distance from the leg's polyline -- nautical miles; nil before the first fix.
    var crossTrackNM: Double?
    var side: RouteSide?
    /// Beyond the off-route threshold.
    var isOffRoute: Bool = false
    /// Feet from the nearest published altitude for the leg (signed: + above); nil when unknown or unpublished.
    var altitudeDeviationFeet: Double?
    /// When the altitude first left the +/-300 ft band; nil while within it or suppressed.
    var altitudeDeviationSince: Date?
    /// The deviation has lasted longer than the grace period and is not suppressed near the aerodromes.
    var isAltitudeCaution: Bool = false
    /// Estimated time at the next point (local time is the display's job).
    var nextPointETA: Date?
}

nonisolated struct ActiveRoute: Equatable, Sendable {
    let legs: [ActiveRouteLeg]
    /// The leg being flown; the next point is `legs[currentLeg].toCode`.
    var currentLeg: Int = 0
    var following = ActiveRouteFollowing()
    /// Cross-track distance beyond which the off-route caution shows -- nautical miles. Configurable
    /// (`IsraelRouteFollowing.offRouteThresholdDefaultsKey`); default 1 NM.
    var offRouteThresholdNM: Double = IsraelRouteFollowing.defaultOffRouteThresholdNM

    /// Within this distance of the next point the route advances to the following leg -- nautical miles.
    static let arrivalRadiusNM = 0.5

    var current: ActiveRouteLeg? { legs.indices.contains(currentLeg) ? legs[currentLeg] : nil }
    /// The leg after the current one; nil on the last leg.
    var next: ActiveRouteLeg? { legs.indices.contains(currentLeg + 1) ? legs[currentLeg + 1] : nil }
    var isLastLeg: Bool { currentLeg >= legs.count - 1 }
    var departureCode: String? { legs.first?.fromCode }
    var destinationCode: String? { legs.last?.toCode }
    var departureCoordinate: CLLocationCoordinate2D? { legs.first?.fromCoordinate }
    var destinationCoordinate: CLLocationCoordinate2D? { legs.last?.toCoordinate }

    /// Manual sequencing: the pilot reports the point early or the auto-sequence missed it.
    mutating func advance() {
        guard !isLastLeg else { return }
        currentLeg += 1
        following = ActiveRouteFollowing()
    }

    mutating func goBack() {
        guard currentLeg > 0 else { return }
        currentLeg -= 1
        following = ActiveRouteFollowing()
    }

    /// Distance from `position` along the rest of the route -- nautical miles: to the next point, then the remaining legs.
    func remainingNM(from distanceToNext: Double) -> Double {
        distanceToNext + legs.dropFirst(currentLeg + 1).reduce(0) { $0 + $1.distanceNM }
    }
}
