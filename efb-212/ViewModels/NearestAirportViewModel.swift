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
nonisolated struct NearestAirportEntry: Identifiable, Sendable {
    let airport: Airport
    let distance: Double   // nautical miles
    let bearing: Double    // degrees true
    /// Israel only (IL-4): PPR, NOTAM closure and review status. nil for US airports.
    var israel: IsraelAerodromeFlags? = nil

    var id: String { airport.icao }

    /// Longest usable runway, for the HUD and list rows.
    var longestRunway: Runway? { LandableAirportFilter.longestRunway(airport) }

    /// Private-use field: landing needs prior permission.
    var isPrivateUse: Bool { LandableAirportFilter.isPrivateUse(airport) }

    /// Military field: emergency use only.
    var isMilitary: Bool { LandableAirportFilter.isMilitary(airport) }

    /// Compact runway summary, e.g. "2441' ASPH". Nil when the airport has no runway data.
    var runwaySummary: String? {
        guard let runway = longestRunway else { return nil }
        return "\(runway.length)' \(runway.surface.abbreviation)"   // feet
    }

    /// Israel: the AIP says prior permission is required.
    var requiresPPR: Bool { israel?.requiresPPR ?? false }

    /// Israel: a current NOTAM names the field closed.
    var isClosedByNotam: Bool { israel?.isClosedByNotam ?? false }
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

    /// Region the last query was for, so switching region re-queries even when ownship hasn't moved.
    private var lastQueryRegion: Region?

    /// Israel (IL-4): the curated aerodromes behind the current entries, for re-flagging when a NOTAM feed arrives.
    private var israelAerodromes: [String: IsraelAerodrome] = [:]
    private let israelDatabaseProvider: @Sendable () throws -> any IsraelAviationDatabaseProtocol
    private let notamFetcher: (@Sendable () async throws -> IsraelNotamReport)?
    private var notamReport: IsraelNotamReport?
    private var notamFetchedAt: Date?
    private var notamTask: Task<Void, Never>?
    /// The relay caches 5 minutes; asking more often only costs battery.
    static let notamRefreshInterval: TimeInterval = 300

    // MARK: - Init

    init(
        appState: AppState,
        databaseService: any DatabaseServiceProtocol,
        israelDatabaseProvider: @escaping @Sendable () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() },
        notamFetcher: (@Sendable () async throws -> IsraelNotamReport)? = nil
    ) {
        self.appState = appState
        self.databaseService = databaseService
        self.israelDatabaseProvider = israelDatabaseProvider
        self.notamFetcher = notamFetcher
    }

    // MARK: - Update Nearest

    /// Recompute nearest landable airports from the given ownship position.
    /// Skips the query if the position moved less than `requeryDistanceNM` since the last one.
    func updateNearest(from position: CLLocation) {
        let region = appState.region
        if let lastPosition = lastQueryPosition, lastQueryRegion == region,
           position.distanceInNM(to: lastPosition) < Self.requeryDistanceNM {
            return
        }
        if region == .israel {
            updateNearestIsrael(from: position)
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
            lastQueryRegion = region
        } catch {
            // Non-critical -- nearest airport is informational.
            // Keep stale data rather than clearing it.
        }
    }

    // MARK: - Israel (IL-4)

    /// Nearest landable Israeli aerodromes from the curated table. Heliports, unmanned-aircraft strips and
    /// fields with no usable runway data are not listed; PPR and NOTAM closures are flagged on each entry.
    private func updateNearestIsrael(from position: CLLocation) {
        isLoading = true
        defer { isLoading = false }
        do {
            let aerodromes = try israelDatabaseProvider()
                .nearestAerodromes(to: position.coordinate, count: Self.candidateCount)
                .filter { !IsraelAerodromeAdapter.notLandableUses.contains($0.use) }
            israelAerodromes = Dictionary(uniqueKeysWithValues: aerodromes.map { ($0.code, $0) })
            let entries = Self.rankLandable(
                aerodromes.map(IsraelAerodromeAdapter.airport),
                from: position,
                minimumRunwayLengthFeet: Self.minimumRunwayLengthFeet,
                limit: Self.listCount
            )
            publish(flagged(entries))
            lastQueryPosition = position
            lastQueryRegion = .israel
            refreshNotamsIfNeeded()
        } catch {
            // Keep stale data rather than clearing it.
        }
    }

    private func publish(_ entries: [NearestAirportEntry]) {
        nearestAirports = entries
        nearestAirport = entries.first?.airport
        nearestDistance = entries.first?.distance
        nearestBearing = entries.first?.bearing
    }

    private func flagged(_ entries: [NearestAirportEntry]) -> [NearestAirportEntry] {
        entries.map { entry in
            var copy = entry
            if let aerodrome = israelAerodromes[entry.airport.icao] {
                copy.israel = IsraelAerodromeAdapter.flags(for: aerodrome, report: notamReport)
            }
            return copy
        }
    }

    /// Fetch the NOTAM feed (when the app gave this view model a way to) and re-flag the list on arrival.
    /// No feed means no closure flags, never a "not closed" claim: the row just carries no NOTAM tag.
    private func refreshNotamsIfNeeded() {
        guard let notamFetcher, notamTask == nil else { return }
        if let fetched = notamFetchedAt, Date().timeIntervalSince(fetched) < Self.notamRefreshInterval { return }
        notamFetchedAt = Date()
        notamTask = Task { [weak self] in
            let report = try? await notamFetcher()
            guard let self else { return }
            self.notamTask = nil
            if let report {
                self.notamReport = report
                self.publish(self.flagged(self.nearestAirports))
            }
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

    /// Set direct-to navigation to the specified airport. Seeds DTG, bearing and ETE from the
    /// current ownship position and ground speed; every later fix refreshes them.
    func setDirectTo(airport: Airport) {
        appState.directToAirport = airport
        appState.activeFlightPlan = true
        appState.updateActiveRouteProgress()
    }

    /// Clear the active Direct-To (wrong field picked, or leg finished). DTG/ETE leave the
    /// instrument strip. A flight-plan route is cleared the same way: see
    /// `AppState.clearActiveNavigation()`.
    func clearDirectTo() {
        appState.clearActiveNavigation()
    }
}
