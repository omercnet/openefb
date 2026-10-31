//
//  NearestAirportViewModel.swift
//  efb-212
//
//  Nearest landable airport computation using R-tree spatial queries from
//  AviationDatabase. Asks for a generous candidate set, drops anything a fixed-wing
//  aircraft cannot land at (heliports, seaplane bases, short or soft runways; see
//  LandableAirportFilter), then keeps the closest 10. Re-queries when ownship moves
//  more than 0.5 NM.
//

import Foundation
import Observation
import CoreLocation

// MARK: - NearestAirportEntry

/// A single entry in the nearest airports list with precomputed distance and bearing.
struct NearestAirportEntry: Identifiable, Sendable {
    let airport: Airport
    let distance: Double   // nautical miles
    let bearing: Double    // degrees true

    var id: String { airport.icao }

    /// Longest usable runway, for the HUD and list rows.
    var longestRunway: Runway? { LandableAirportFilter.longestRunway(airport) }

    /// Private-use field: landing needs prior permission.
    var isPrivateUse: Bool { LandableAirportFilter.isPrivateUse(airport) }

    /// Compact runway summary, e.g. "2441' ASPH". Nil when the airport has no runway data.
    var runwaySummary: String? {
        guard let runway = longestRunway else { return nil }
        return "\(runway.length)' \(runway.surface.abbreviation)"   // feet
    }
}

// MARK: - NearestAirportViewModel

@Observable
@MainActor
final class NearestAirportViewModel {

    // MARK: - Constants

    /// Entries kept for the list.
    static let listCount = 10
    /// Candidates requested from the database before landability filtering. Roughly a third
    /// of US facilities are heliports, and short private strips are common, so ask for
    /// several times what the list shows.
    static let candidateCount = 40
    /// Minimum runway for the active aircraft. The aircraft profile has no runway field yet,
    /// so this is the shared default.
    static let minimumRunwayLengthFeet = LandableAirportFilter.defaultMinimumRunwayLengthFeet  // feet
    /// Ownship must move this far before the database is queried again.
    static let requeryDistanceNM = 0.5   // nautical miles

    // MARK: - Dependencies

    let databaseService: any DatabaseServiceProtocol
    private let appState: AppState

    // MARK: - Published State

    /// The single closest landable airport to ownship.
    var nearestAirport: Airport?

    /// Distance to nearest airport in nautical miles.
    var nearestDistance: Double?

    /// Bearing to nearest airport in degrees true.
    var nearestBearing: Double?

    /// Closest entry, for the NRST button.
    var nearestEntry: NearestAirportEntry? { nearestAirports.first }

    /// Full sorted list of nearest landable airports (up to `listCount`).
    var nearestAirports: [NearestAirportEntry] = []

    /// Loading indicator for async queries.
    var isLoading: Bool = false

    // MARK: - Private

    /// Last position used for nearest airport query.
    private var lastQueryPosition: CLLocation?

    // MARK: - Init

    init(appState: AppState, databaseService: any DatabaseServiceProtocol) {
        self.appState = appState
        self.databaseService = databaseService
    }

    // MARK: - Update Nearest

    /// Recompute nearest landable airports from the given ownship position.
    /// Skips the query if the position moved less than `requeryDistanceNM` since the last one.
    func updateNearest(from position: CLLocation) {
        if let lastPosition = lastQueryPosition,
           position.distanceInNM(to: lastPosition) < Self.requeryDistanceNM {
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let candidates = try databaseService.nearestAirports(
                to: position.coordinate,
                count: Self.candidateCount
            )
            let entries = Self.rankLandable(
                candidates,
                from: position,
                minimumRunwayLengthFeet: Self.minimumRunwayLengthFeet,
                limit: Self.listCount
            )

            nearestAirports = entries
            nearestAirport = entries.first?.airport
            nearestDistance = entries.first?.distance
            nearestBearing = entries.first?.bearing
            lastQueryPosition = position
        } catch {
            // Non-critical -- nearest airport is informational.
            // Keep stale data rather than clearing it.
        }
    }

    /// Filter candidates to landable fields and sort by distance from `position`.
    static func rankLandable(
        _ candidates: [Airport],
        from position: CLLocation,
        minimumRunwayLengthFeet: Int,
        limit: Int
    ) -> [NearestAirportEntry] {
        LandableAirportFilter.landable(candidates, minimumRunwayLengthFeet: minimumRunwayLengthFeet)
            .map { airport in
                let airportLocation = CLLocation(latitude: airport.latitude, longitude: airport.longitude)
                return NearestAirportEntry(
                    airport: airport,
                    distance: position.distanceInNM(to: airportLocation),   // nautical miles
                    bearing: position.bearing(to: airportLocation)          // degrees true
                )
            }
            .sorted { $0.distance < $1.distance }
            .prefix(limit)
            .map { $0 }
    }

    // MARK: - Direct-To

    /// Set direct-to navigation to the specified airport. Updates AppState
    /// with distance and ETE computed from current ownship position and ground speed.
    func setDirectTo(airport: Airport) {
        appState.directToAirport = airport
        appState.activeFlightPlan = true

        // Compute distance from ownship to target airport
        if let ownship = appState.ownshipPosition {
            let targetLocation = CLLocation(
                latitude: airport.latitude,
                longitude: airport.longitude
            )
            let distanceNM = ownship.distanceInNM(to: targetLocation)
            appState.distanceToNext = distanceNM

            // Compute ETE from distance and ground speed
            let gs = appState.groundSpeed  // knots
            if gs > 10 {
                // ETE in seconds = (distance NM / speed knots) * 3600
                appState.estimatedTimeEnroute = (distanceNM / gs) * 3600
            } else {
                appState.estimatedTimeEnroute = nil
            }
        }
    }
}
