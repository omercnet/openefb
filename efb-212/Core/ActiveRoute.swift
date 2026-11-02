//
//  ActiveRoute.swift
//  efb-212
//
//  The activated multi-leg route (Israel CVFR plan): which leg the pilot is on, the next reporting
//  point and its published altitude. Feeds the active-navigation bar and the instrument strip's
//  DTG/ETE (`AppState.updateActiveRouteProgress`).
//

import Foundation
import CoreLocation

nonisolated struct ActiveRouteLeg: Equatable, Sendable {
    let fromCode: String
    let toCode: String
    let toLatitude: Double      // degrees
    let toLongitude: Double     // degrees
    /// Published altitude for the direction flown: "2500", "2500/3500" -- feet MSL.
    let altitudeText: String
    let distanceNM: Double      // nautical miles

    var toCoordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: toLatitude, longitude: toLongitude) }
}

nonisolated struct ActiveRoute: Equatable, Sendable {
    let legs: [ActiveRouteLeg]
    /// The leg being flown; the next point is `legs[currentLeg].toCode`.
    var currentLeg: Int = 0

    /// Within this distance of the next point the route advances to the following leg -- nautical miles.
    static let arrivalRadiusNM = 1.0

    var current: ActiveRouteLeg? { legs.indices.contains(currentLeg) ? legs[currentLeg] : nil }
    var isLastLeg: Bool { currentLeg >= legs.count - 1 }
    var departureCode: String? { legs.first?.fromCode }
    var destinationCode: String? { legs.last?.toCode }

    /// Distance from `position` along the rest of the route -- nautical miles: to the next point, then the remaining legs.
    func remainingNM(from distanceToNext: Double) -> Double {
        distanceToNext + legs.dropFirst(currentLeg + 1).reduce(0) { $0 + $1.distanceNM }
    }
}
