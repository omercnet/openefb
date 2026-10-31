//
//  FlightPlanViewModelTests.swift
//  efb-212Tests
//
//  FlightPlanViewModel behaviour: search thresholds and failure handling, route math with and
//  without an active aircraft profile, AppState summary propagation, SwiftData persistence,
//  and plan lifecycle (save / load / clear / delete). No MapService is attached (it needs a
//  live MLNMapView); map drawing is optional in the view model and is not covered here.
//

import Testing
import Foundation
import CoreLocation
import SwiftData
@testable import efb_212

@Suite("FlightPlanViewModel Tests")
@MainActor
struct FlightPlanViewModelTests {

    // MARK: - Fixtures

    static func airport(_ icao: String, _ name: String, _ lat: Double, _ lon: Double) -> Airport {
        Airport(
            icao: icao, faaID: nil, name: name,
            latitude: lat, longitude: lon, elevation: 5,
            type: .airport, ownership: .publicOwned,
            ctafFrequency: nil, unicomFrequency: nil,
            artccID: nil, fssID: nil, magneticVariation: nil,
            patternAltitude: nil, fuelTypes: [],
            hasBeaconLight: false, runways: [], frequencies: []
        )
    }

    static let kpao = airport("KPAO", "Palo Alto", 37.4611, -122.1150)
    static let ksql = airport("KSQL", "San Carlos", 37.5119, -122.2494)
    static let koak = airport("KOAK", "Oakland Intl", 37.7213, -122.2208)

    struct Harness {
        let vm: FlightPlanViewModel
        let appState: AppState
        let context: ModelContext
        let db: MockDatabaseManager
        let container: ModelContainer
    }

    static func makeHarness(configure: Bool = true) throws -> Harness {
        let container = try ModelContainer(
            for: SchemaV1.FlightPlanRecord.self, SchemaV1.AircraftProfile.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let db = MockDatabaseManager()
        db.airports = [kpao, ksql, koak]
        let appState = AppState()
        let vm = FlightPlanViewModel(databaseService: db, appState: appState)
        if configure {
            vm.configure(mapService: nil, modelContext: container.mainContext)
        }
        return Harness(vm: vm, appState: appState, context: container.mainContext, db: db, container: container)
    }

    /// Great-circle distance reference computed independently of the view model's helper.
    static func haversineNM(_ a: Airport, _ b: Airport) -> Double {
        let r = 3440.065  // Earth radius, nautical miles
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(a.latitude * .pi / 180) * cos(b.latitude * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(sqrt(h))
    }

    @discardableResult
    static func addActiveAircraft(_ context: ModelContext, speed: Double?, burn: Double?, active: Bool = true) -> SchemaV1.AircraftProfile {
        let aircraft = SchemaV1.AircraftProfile(nNumber: "N4543A")
        aircraft.cruiseSpeedKts = speed
        aircraft.fuelBurnGPH = burn
        aircraft.isActive = active
        context.insert(aircraft)
        return aircraft
    }

    // MARK: - Search

    @Test func searchRequiresAtLeastTwoCharacters() throws {
        let h = try Self.makeHarness()

        h.vm.departureQuery = "K"
        h.vm.searchDeparture()
        #expect(h.vm.departureResults.isEmpty)

        h.vm.departureQuery = "KP"
        h.vm.searchDeparture()
        #expect(h.vm.departureResults.map(\.icao) == ["KPAO"])

        // Shrinking the query again clears stale results instead of leaving them on screen.
        h.vm.departureQuery = "K"
        h.vm.searchDeparture()
        #expect(h.vm.departureResults.isEmpty)
    }

    @Test func destinationSearchIsIndependentOfDeparture() throws {
        let h = try Self.makeHarness()
        h.vm.departureQuery = "KPAO"
        h.vm.searchDeparture()

        h.vm.destinationQuery = "Oakland"
        h.vm.searchDestination()

        #expect(h.vm.destinationResults.map(\.icao) == ["KOAK"])
        #expect(h.vm.departureResults.map(\.icao) == ["KPAO"])
    }

    @Test func searchFailureYieldsEmptyResultsNotStaleOnes() throws {
        let appState = AppState()
        let vm = FlightPlanViewModel(databaseService: UnavailableDatabaseService(), appState: appState)
        vm.departureResults = [Self.kpao]
        vm.departureQuery = "KPAO"

        vm.searchDeparture()

        #expect(vm.departureResults.isEmpty)
    }

    // MARK: - Selection

    @Test func selectingAirportFillsQueryAndClearsResults() throws {
        let h = try Self.makeHarness()
        h.vm.departureResults = [Self.kpao, Self.ksql]

        h.vm.selectDeparture(Self.kpao)

        #expect(h.vm.selectedDeparture?.icao == "KPAO")
        #expect(h.vm.departureQuery == "KPAO")
        #expect(h.vm.departureResults.isEmpty)
        // Only one end chosen: nothing is calculated or published yet.
        #expect(h.vm.distanceNM == 0)
        #expect(h.appState.activeFlightPlan == false)
    }

    // MARK: - Route math

    @Test func selectingBothEndsComputesDistanceAndPublishesSummaryToAppState() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)

        let expected = Self.haversineNM(Self.kpao, Self.ksql)
        #expect(abs(h.vm.distanceNM - expected) < 0.1)   // nautical miles
        #expect(h.vm.distanceNM > 5 && h.vm.distanceNM < 9)

        #expect(h.appState.activeFlightPlan)
        #expect(h.appState.activePlanDeparture == "KPAO")
        #expect(h.appState.activePlanDestination == "KSQL")
        #expect(h.appState.distanceToNext == h.vm.distanceNM)
        #expect(h.appState.estimatedTimeEnroute == h.vm.estimatedTimeSeconds)
    }

    @Test func withoutAircraftProfileUsesDefault100KnotsAndNoFuel() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.koak)

        let expectedETE = Self.haversineNM(Self.kpao, Self.koak) / 100.0 * 3600  // seconds at 100 kt
        #expect(abs(h.vm.estimatedTimeSeconds - expectedETE) < 10)
        #expect(h.vm.estimatedFuelGallons == nil)
        #expect(h.appState.activePlanFuelGallons == nil)
    }

    @Test func activeAircraftSuppliesSpeedAndFuelBurn() throws {
        let h = try Self.makeHarness()
        Self.addActiveAircraft(h.context, speed: 120, burn: 9)

        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.koak)

        let distance = Self.haversineNM(Self.kpao, Self.koak)
        #expect(abs(h.vm.estimatedTimeSeconds - distance / 120 * 3600) < 10)
        let fuel = try #require(h.vm.estimatedFuelGallons)
        #expect(abs(fuel - distance / 120 * 9) < 0.05)   // gallons
        #expect(h.appState.activePlanFuelGallons == fuel)
    }

    @Test func inactiveAircraftIsIgnored() throws {
        let h = try Self.makeHarness()
        Self.addActiveAircraft(h.context, speed: 200, burn: 20, active: false)

        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.koak)

        let distance = Self.haversineNM(Self.kpao, Self.koak)
        #expect(abs(h.vm.estimatedTimeSeconds - distance / 100 * 3600) < 10)
        #expect(h.vm.estimatedFuelGallons == nil)
    }

    @Test func zeroOrMissingCruiseSpeedFallsBackToDefault() throws {
        let h = try Self.makeHarness()
        Self.addActiveAircraft(h.context, speed: 0, burn: 8)

        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.koak)

        // A zero cruise speed must not divide by zero or produce an infinite ETE.
        #expect(h.vm.estimatedTimeSeconds.isFinite)
        let distance = Self.haversineNM(Self.kpao, Self.koak)
        #expect(abs(h.vm.estimatedTimeSeconds - distance / 100 * 3600) < 10)
    }

    @Test func zeroBurnRateYieldsNoFuelEstimate() throws {
        let h = try Self.makeHarness()
        Self.addActiveAircraft(h.context, speed: 110, burn: 0)

        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.koak)

        #expect(h.vm.estimatedFuelGallons == nil)
    }

    @Test func sameAirportBothEndsGivesZeroDistanceWithoutCrashing() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.kpao)

        #expect(h.vm.distanceNM == 0)
        #expect(h.vm.estimatedTimeSeconds == 0)
        #expect(h.vm.formattedETE == "0:00")
    }

    // MARK: - ETE formatting

    @Test func formattedETETruncatesToWholeMinutes() throws {
        let h = try Self.makeHarness(configure: false)
        let cases: [(TimeInterval, String)] = [
            (0, "0:00"), (59, "0:00"), (60, "0:01"), (3599, "0:59"), (3600, "1:00"), (7500, "2:05"),
        ]
        for (seconds, text) in cases {
            h.vm.estimatedTimeSeconds = seconds
            #expect(h.vm.formattedETE == text, "\(seconds) s")
        }
    }

    // MARK: - Persistence

    @Test func savePlanPersistsRouteAndMarksItActive() throws {
        let h = try Self.makeHarness()
        Self.addActiveAircraft(h.context, speed: 120, burn: 9)
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)

        h.vm.savePlan()

        let record = try #require(h.vm.savedPlans.first)
        #expect(h.vm.savedPlans.count == 1)
        #expect(record.departureICAO == "KPAO")
        #expect(record.destinationICAO == "KSQL")
        #expect(record.destinationLatitude == Self.ksql.latitude)
        #expect(abs(record.cruiseSpeedKts - 120) < 0.01)   // knots, recovered from distance / ETE
        #expect(record.totalDistanceNM == h.vm.distanceNM)
        #expect(h.vm.activePlanID == record.id)
    }

    @Test func savePlanWithoutBothAirportsDoesNothing() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)

        h.vm.savePlan()

        #expect(h.vm.savedPlans.isEmpty)
        #expect(h.vm.activePlanID == nil)
    }

    @Test func savedPlansAreOrderedMostRecentlyUsedFirst() throws {
        let h = try Self.makeHarness()
        for (index, destination) in [Self.ksql, Self.koak].enumerated() {
            let record = SchemaV1.FlightPlanRecord()
            record.departureICAO = "KPAO"
            record.destinationICAO = destination.icao
            record.lastUsedAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index) * 100)
            h.context.insert(record)
        }

        h.vm.loadSavedPlans()

        #expect(h.vm.savedPlans.map(\.destinationICAO) == ["KOAK", "KSQL"])
    }

    @Test func configureRestoresMostRecentPlanFromDatabaseAirports() throws {
        let h = try Self.makeHarness(configure: false)
        let old = SchemaV1.FlightPlanRecord()
        old.departureICAO = "KPAO"; old.destinationICAO = "KSQL"
        old.lastUsedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let recent = SchemaV1.FlightPlanRecord()
        recent.departureICAO = "KSQL"; recent.destinationICAO = "KOAK"
        recent.lastUsedAt = Date(timeIntervalSince1970: 1_700_100_000)
        h.context.insert(old)
        h.context.insert(recent)

        h.vm.configure(mapService: nil, modelContext: h.context)

        #expect(h.vm.selectedDeparture?.icao == "KSQL")
        #expect(h.vm.selectedDestination?.icao == "KOAK")
        #expect(h.vm.activePlanID == recent.id)
        #expect(h.appState.activePlanDestination == "KOAK")
    }

    @Test func loadingPlanWhoseAirportIsGoneDoesNotPublishARoute() throws {
        let h = try Self.makeHarness()
        let record = SchemaV1.FlightPlanRecord()
        record.departureICAO = "KPAO"
        record.destinationICAO = "KGONE"   // removed from a newer aviation database
        h.context.insert(record)

        h.vm.loadPlan(record)

        #expect(h.vm.selectedDeparture?.icao == "KPAO")
        #expect(h.vm.selectedDestination == nil)
        #expect(h.appState.activeFlightPlan == false)
    }

    @Test func loadingPlanTouchesLastUsedAt() throws {
        let h = try Self.makeHarness()
        let record = SchemaV1.FlightPlanRecord()
        record.departureICAO = "KPAO"; record.destinationICAO = "KSQL"
        record.lastUsedAt = Date(timeIntervalSince1970: 1_000_000_000)
        h.context.insert(record)

        h.vm.loadPlan(record)

        #expect(record.lastUsedAt > Date(timeIntervalSinceNow: -60))
    }

    // MARK: - Clear / delete

    @Test func clearPlanResetsViewModelAndAppState() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)
        h.vm.savePlan()
        #expect(h.appState.activeFlightPlan)

        h.vm.clearPlan()

        #expect(h.vm.selectedDeparture == nil && h.vm.selectedDestination == nil)
        #expect(h.vm.departureQuery.isEmpty && h.vm.destinationQuery.isEmpty)
        #expect(h.vm.distanceNM == 0 && h.vm.estimatedTimeSeconds == 0)
        #expect(h.vm.estimatedFuelGallons == nil)
        #expect(h.vm.activePlanID == nil)
        #expect(h.appState.activeFlightPlan == false)
        #expect(h.appState.distanceToNext == nil)
        #expect(h.appState.estimatedTimeEnroute == nil)
        #expect(h.appState.activePlanDeparture == nil)
        #expect(h.appState.activePlanDestination == nil)
        #expect(h.appState.activePlanFuelGallons == nil)
        // Clearing the active plan does not delete it from storage.
        #expect(h.vm.savedPlans.count == 1)
    }

    @Test func deletingActivePlanAlsoClearsItWhileDeletingOtherPlanKeepsActive() throws {
        let h = try Self.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)
        h.vm.savePlan()
        let active = try #require(h.vm.savedPlans.first)

        let other = SchemaV1.FlightPlanRecord()
        other.departureICAO = "KPAO"; other.destinationICAO = "KOAK"
        other.lastUsedAt = Date(timeIntervalSince1970: 1)
        h.context.insert(other)
        h.vm.loadSavedPlans()
        #expect(h.vm.savedPlans.count == 2)

        h.vm.deletePlan(other)
        #expect(h.vm.savedPlans.map(\.id) == [active.id])
        #expect(h.vm.activePlanID == active.id)
        #expect(h.appState.activeFlightPlan)

        h.vm.deletePlan(active)
        #expect(h.vm.savedPlans.isEmpty)
        #expect(h.vm.activePlanID == nil)
        #expect(h.appState.activeFlightPlan == false)
    }
}
