//
//  AppState+Navigation.swift
//  efb-212
//
//  Single place that clears the active Direct-To / route display state, so the map's
//  Clear button and the view models reset exactly the same fields (instrument strip DTG/ETE,
//  summary card).
//

import Foundation
import CoreLocation

extension AppState {
    /// Direct-To or a flight-plan route is currently shown (strip DTG/ETE, summary card).
    var hasActiveNavigation: Bool {
        directToAirport != nil || activeFlightPlan
    }

    /// Drop the active Direct-To and/or route. The pilot picked the wrong field or is done
    /// with the leg: DTG/ETE leave the instrument strip and the summary card goes away.
    func clearActiveNavigation() {
        directToAirport = nil
        activeFlightPlan = false
        distanceToNext = nil            // nautical miles
        estimatedTimeEnroute = nil      // seconds
        activePlanDeparture = nil
        activePlanDestination = nil
        activePlanFuelGallons = nil
        activeRoute = nil
    }

    /// Distance left along an active multi-leg route -- nautical miles; nil without one.
    var routeSummaryDistanceNM: Double? {
        guard let route = activeRoute, let toNext = distanceToNext else { return nil }
        return route.remainingNM(from: toNext)
    }

    /// Time left along an active multi-leg route at ground speed -- seconds; nil while stationary or without a route.
    var routeSummaryETE: TimeInterval? {
        guard let distance = routeSummaryDistanceNM, groundSpeed > 30 else { return nil }
        return distance / groundSpeed * 3600
    }

    /// Advance the active multi-leg route from ownship and refresh DTG/ETE (to the next point).
    /// No-op without a route or a position. Called on every location update.
    func updateActiveRouteProgress() {
        guard var route = activeRoute, let ownship = ownshipPosition else { return }
        var toNext: Double?  // nautical miles
        while let leg = route.current {
            let distance = ownship.coordinate.distanceInNM(to: leg.toCoordinate)
            toNext = distance
            if distance < ActiveRoute.arrivalRadiusNM, !route.isLastLeg {
                route.currentLeg += 1
            } else {
                break
            }
        }
        if route != activeRoute { activeRoute = route }
        guard let toNext else { return }
        distanceToNext = toNext
        // ETE in seconds = NM / knots * 3600; unknown while stationary.
        estimatedTimeEnroute = groundSpeed > 30 ? toNext / groundSpeed * 3600 : nil
    }
}
