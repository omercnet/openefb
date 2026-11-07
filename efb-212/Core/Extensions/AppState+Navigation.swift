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
        bearingToNext = nil             // degrees true
        activePlanDeparture = nil
        activePlanDestination = nil
        activePlanDestinationCoordinate = nil
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

    /// Refresh DTG/ETE/bearing to the next point from ownship, for whichever navigation is active:
    /// Direct-To (wins over a plan, it is the pilot's latest choice), an Israel multi-leg route (also
    /// advances the leg and the route-following status: cross-track, altitude deviation; sequences when
    /// within 0.5 NM of the TO point or abeam it), or a US direct plan's destination. No-op without a
    /// position or active navigation. Called on every location update.
    func updateActiveRouteProgress(now: Date = Date()) {
        guard let ownship = ownshipPosition else { return }
        let target: CLLocationCoordinate2D
        if let airport = directToAirport {
            target = CLLocationCoordinate2D(latitude: airport.latitude, longitude: airport.longitude)
        } else if let route = activeRoute {
            // No vertical fix (verticalAccuracy < 0): the altitude caution never runs on an unknown altitude.
            let altitudeFeet: Double? = ownship.verticalAccuracy >= 0 ? altitude : nil  // feet MSL
            let progress = IsraelRouteFollowing.progress(
                of: route, position: ownship.coordinate, altitudeFeet: altitudeFeet,
                groundSpeedKnots: groundSpeed, now: now
            )
            if progress.route != activeRoute { activeRoute = progress.route }
            guard let toNext = progress.distanceToNextNM, let leg = progress.route.current else { return }
            setProgress(distanceNM: toNext, bearing: ownship.bearing(to: CLLocation(
                latitude: leg.toLatitude, longitude: leg.toLongitude)))
            return
        } else if let destination = activePlanDestinationCoordinate {
            target = destination
        } else {
            return
        }
        let targetLocation = CLLocation(latitude: target.latitude, longitude: target.longitude)
        setProgress(distanceNM: ownship.distanceInNM(to: targetLocation), bearing: ownship.bearing(to: targetLocation))
    }

    /// DTG in NM, bearing in degrees true; ETE in seconds = NM / knots * 3600, unknown below 30 kt.
    private func setProgress(distanceNM: Double, bearing: Double) {
        distanceToNext = distanceNM
        bearingToNext = bearing
        estimatedTimeEnroute = groundSpeed > 30 ? distanceNM / groundSpeed * 3600 : nil
    }

    /// Manual "next" / "previous" leg for the active route, then refresh progress.
    func sequenceActiveRoute(forward: Bool) {
        guard var route = activeRoute else { return }
        if forward { route.advance() } else { route.goBack() }
        activeRoute = route
        if let leg = route.current, let ownship = ownshipPosition {
            distanceToNext = ownship.coordinate.distanceInNM(to: leg.toCoordinate)
        } else if let leg = route.current {
            distanceToNext = leg.distanceNM
        }
        updateActiveRouteProgress()
    }
}
