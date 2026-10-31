//
//  MapLoadingFlowTests.swift
//  efb-212Tests
//
//  MapViewModel data-loading flow against a recording database service: debounced region
//  changes, the "requery only when the view moved enough" rule, layer-gated queries, and
//  failure handling. MapService is constructed without a map view, so its style/source calls
//  are inert; only view-model state and database traffic are asserted.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

/// Database service that records every query so tests can assert when the database was hit.
final class RecordingDatabaseService: DatabaseServiceProtocol, @unchecked Sendable {
    var airportList: [Airport] = []
    var navaidList: [Navaid] = []
    var failAirportQueries = false

    private(set) var airportQueries: [(center: CLLocationCoordinate2D, radiusNM: Double)] = []
    private(set) var navaidQueryCount = 0
    private(set) var airspaceQueryCount = 0

    func airport(byICAO icao: String) throws -> Airport? { airportList.first { $0.icao == icao } }

    func airports(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        airportQueries.append((coordinate, radiusNM))
        if failAirportQueries { throw EFBError.databaseCorrupted }
        return airportList
    }

    func nearestAirports(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [Airport] {
        Array(airportList.prefix(count))
    }

    func searchAirports(query: String, limit: Int) throws -> [Airport] { [] }

    func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airspace] {
        airspaceQueryCount += 1
        return []
    }

    func navaids(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Navaid] {
        navaidQueryCount += 1
        return navaidList
    }
}

@Suite("Map Loading Flow Integration Tests")
@MainActor
struct MapLoadingFlowTests {

    static let kpao = FlightPlanViewModelTests.kpao
    static let ksql = FlightPlanViewModelTests.ksql

    static let kpaoCoord = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

    struct Harness {
        let vm: MapViewModel
        let appState: AppState
        let db: RecordingDatabaseService
    }

    static func makeHarness(airports: [Airport] = [kpao, ksql]) -> Harness {
        let db = RecordingDatabaseService()
        db.airportList = airports
        let appState = AppState()
        let vm = MapViewModel(appState: appState, mapService: MapService(), databaseService: db)
        return Harness(vm: vm, appState: appState, db: db)
    }

    /// Re-enable the airports layer, which loads data for the current region (the same path
    /// the app uses after the layer picker toggles it).
    static func loadViaLayerToggle(_ h: Harness) {
        h.vm.toggleLayer(.airports)   // off
        h.vm.toggleLayer(.airports)   // on -> loadDataForRegion
    }

    /// Bounds 0.2 deg tall and wide around `center` (about 12 NM per side).
    static func bounds(around c: CLLocationCoordinate2D) -> (ne: CLLocationCoordinate2D, sw: CLLocationCoordinate2D) {
        (CLLocationCoordinate2D(latitude: c.latitude + 0.1, longitude: c.longitude + 0.1),
         CLLocationCoordinate2D(latitude: c.latitude - 0.1, longitude: c.longitude - 0.1))
    }

    func changeRegion(_ h: Harness, to center: CLLocationCoordinate2D, zoom: Double = 11) {
        let b = Self.bounds(around: center)
        h.vm.onRegionChanged(center: center, zoom: zoom, northEast: b.ne, southWest: b.sw, direction: 0)
    }

    /// Wait past the 500 ms region-change debounce.
    func settleDebounce() async throws {
        try await Task.sleep(for: .milliseconds(800))
    }

    // MARK: - Initial / layer-driven load

    @Test func enablingAirportsLayerLoadsAirportsForCurrentRegionAtMaxRadius() {
        let h = Self.makeHarness()
        h.appState.mapCenter = Self.kpaoCoord

        Self.loadViaLayerToggle(h)

        #expect(h.vm.visibleAirports.map(\.icao) == ["KPAO", "KSQL"])
        #expect(h.vm.isLoadingAirports == false)
        #expect(h.vm.lastError == nil)
        let query = h.db.airportQueries.last
        #expect(query?.center.latitude == Self.kpaoCoord.latitude)
        #expect(query?.radiusNM == MapQueryRegion.maxRadiusNM)
    }

    @Test func emptyRegionIsNotAnError() {
        let h = Self.makeHarness(airports: [])

        Self.loadViaLayerToggle(h)

        #expect(h.vm.visibleAirports.isEmpty)
        #expect(h.vm.lastError == nil)
    }

    @Test func disablingALayerDoesNotQueryTheDatabase() {
        let h = Self.makeHarness()

        h.vm.toggleLayer(.airports)

        #expect(h.appState.visibleLayers.contains(.airports) == false)
        #expect(h.db.airportQueries.isEmpty)
    }

    // MARK: - Layer-gated queries

    @Test func navaidsAndAirspacesAreOnlyQueriedWhileTheirLayersAreVisible() {
        let h = Self.makeHarness()
        Self.loadViaLayerToggle(h)
        #expect(h.db.navaidQueryCount == 0)
        #expect(h.db.airspaceQueryCount == 0)
        #expect(h.vm.visibleNavaids.isEmpty)

        h.db.navaidList = [Navaid(id: "SJC", name: "San Jose", type: .vorDme,
                                  latitude: 37.36, longitude: -121.93, frequency: 114.1,
                                  magneticVariation: nil, elevation: nil)]
        h.vm.toggleLayer(.navaids)
        h.vm.toggleLayer(.airspace)

        #expect(h.db.navaidQueryCount == 1)
        #expect(h.vm.visibleNavaids.map(\.id) == ["SJC"])
        #expect(h.db.airspaceQueryCount == 1)
    }

    // MARK: - Failure

    @Test func airportQueryFailureSetsErrorAndClearsLoadingFlag() {
        let h = Self.makeHarness()
        h.db.failAirportQueries = true

        Self.loadViaLayerToggle(h)

        if case .databaseCorrupted? = h.vm.lastError {} else {
            Issue.record("expected databaseCorrupted, got \(String(describing: h.vm.lastError))")
        }
        #expect(h.vm.isLoadingAirports == false)   // never stuck on the spinner
        #expect(h.vm.visibleAirports.isEmpty)
    }

    // MARK: - Debounced region changes

    @Test func regionChangeIsDebouncedAndOnlyTheLastOneQueries() async throws {
        let h = Self.makeHarness()
        let first = CLLocationCoordinate2D(latitude: 37.0, longitude: -122.0)
        let last = CLLocationCoordinate2D(latitude: 38.0, longitude: -122.0)

        changeRegion(h, to: first)
        changeRegion(h, to: CLLocationCoordinate2D(latitude: 37.5, longitude: -122.0))
        changeRegion(h, to: last)
        #expect(h.db.airportQueries.isEmpty, "nothing may query before the debounce elapses")

        try await settleDebounce()

        #expect(h.db.airportQueries.count == 1)
        #expect(h.db.airportQueries.first?.center.latitude == last.latitude)
        #expect(h.appState.mapCenter.latitude == last.latitude)
        #expect(h.appState.mapZoom == 11)
    }

    @Test func smallPanAtSameZoomUpdatesAppStateButDoesNotRequery() async throws {
        let h = Self.makeHarness()
        changeRegion(h, to: Self.kpaoCoord)
        try await settleDebounce()
        #expect(h.db.airportQueries.count == 1)

        // About 1 NM north: well inside the 5 NM requery threshold.
        let nudged = CLLocationCoordinate2D(latitude: Self.kpaoCoord.latitude + 1.0 / 60.0, longitude: Self.kpaoCoord.longitude)
        changeRegion(h, to: nudged)
        try await settleDebounce()

        #expect(h.db.airportQueries.count == 1)
        #expect(h.appState.mapCenter.latitude == nudged.latitude)
    }

    @Test func panningFarEnoughRequeriesAtTheNewCenter() async throws {
        let h = Self.makeHarness()
        changeRegion(h, to: Self.kpaoCoord)
        try await settleDebounce()

        let farther = CLLocationCoordinate2D(latitude: Self.kpaoCoord.latitude + 0.5, longitude: Self.kpaoCoord.longitude)  // ~30 NM
        changeRegion(h, to: farther)
        try await settleDebounce()

        #expect(h.db.airportQueries.count == 2)
        #expect(h.db.airportQueries.last?.center.latitude == farther.latitude)
    }

    // MARK: - Airport tap

    @Test func tappingAirportOpensItsInfoSheet() {
        let h = Self.makeHarness()

        h.vm.onAirportTapped(icao: "KSQL")

        #expect(h.appState.selectedAirportID == "KSQL")
        #expect(h.appState.isPresentingAirportInfo)
    }
}
