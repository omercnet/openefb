//
//  AppState+Navigation.swift
//  efb-212
//
//  Single place that clears the active Direct-To / route display state, so the map's
//  Clear button and the view models reset exactly the same fields (instrument strip DTG/ETE,
//  summary card).
//

import Foundation

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
    }
}
