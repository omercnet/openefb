//
//  IsraelFlightPlanViewModelTests.swift
//  efb-212Tests
//
//  IL-PLAN: routing with a NOTAM detour, the no-route message, the return flight, activation
//  into navigation state, and the filing block.
//

import Testing
import Foundation
import CoreLocation
import SwiftData
@testable import efb_212

@MainActor
@Suite("Israel flight plan view model")
struct IsraelFlightPlanViewModelTests {

    private static func point(_ id: Int, _ code: String, _ kind: IsraelPointKind = .compulsory, lat: Double, lon: Double) -> IsraelReportingPoint {
        IsraelReportingPoint(id: id, code: code, nameEnglish: code, nameHebrew: nil, kind: kind, latitude: lat, longitude: lon)
    }

    private static let pts = [
        point(1, "LLHZ", .arp, lat: 32.18, lon: 34.83), point(2, "MIDAA", lat: 32.3, lon: 34.9),
        point(3, "LLIB", .arp, lat: 32.98, lon: 35.57), point(4, "MIDBB", lat: 32.4, lon: 35.2)
    ]

    private static func segment(_ id: Int, _ a: Int, _ b: Int, nm: Double, reverse: String? = "2000") -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: pts[a].code, toCode: pts[b].code, fromPointID: pts[a].id, toPointID: pts[b].id,
            nameEnglish: nil, nameHebrew: nil, lengthNM: nm, isCivil: true, isMilitary: false, isByRequest: false,
            bearingTrue: 0, altitudeForward: IsraelRouteAltitude(published: "1500", feet: 1500),
            altitudeReverse: reverse.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            lowerAltitudeFeet: nil, mapSheet: nil, polyline: [pts[a].coordinate, pts[b].coordinate]
        )
    }

    /// LLHZ-MIDAA-LLIB (short) and LLHZ-MIDBB-LLIB (long).
    private static let segs = [
        segment(1, 0, 1, nm: 10), segment(2, 1, 2, nm: 40), segment(3, 0, 3, nm: 25), segment(4, 3, 2, nm: 30)
    ]

    private static func database() -> MockIsraelAviationDatabase {
        var db = MockIsraelAviationDatabase()
        db.points = pts
        db.segments = segs
        db.aerodromeList = [
            IsraelNearestAndSearchTests.aerodrome("LLHZ", lat: 32.18, lon: 34.83),
            IsraelNearestAndSearchTests.aerodrome("LLIB", lat: 32.98, lon: 35.57)
        ]
        return db
    }

    private static func closureReport(_ now: Date) -> IsraelNotamReport {
        let closure = IsraelRouteClosure(notamId: "C1/26", routeKind: "CVFR", routeName: nil, chain: ["MIDAA", "LLIB"],
                                         validFrom: nil, validTo: nil, schedule: nil)
        return IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: now, items: [], closures: [closure]),
                                 fetchedAt: now, refreshFailed: false)
    }

    private static func viewModel(report: IsraelNotamReport? = nil) -> (IsraelFlightPlanViewModel, AppState) {
        let state = AppState()
        let db = database()
        let vm = IsraelFlightPlanViewModel(
            appState: state, databaseProvider: { db },
            notamFetcher: report.map { r in { @Sendable in r } }
        )
        return (vm, state)
    }

    /// A view model whose aircraft and pilot profiles carry what filing needs. The container must outlive the model.
    private static func fileableViewModel(report: IsraelNotamReport? = nil) throws -> (IsraelFlightPlanViewModel, AppState, ModelContainer) {
        let container = try ModelContainer(
            for: SchemaV1.AircraftProfile.self, SchemaV1.PilotProfile.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let aircraft = SchemaV1.AircraftProfile(nNumber: "4X-CXA")
        aircraft.isActive = true
        let pilot = SchemaV1.PilotProfile()
        pilot.name = "Israel Israeli"
        pilot.isActive = true
        container.mainContext.insert(aircraft)
        container.mainContext.insert(pilot)
        let (vm, state) = viewModel(report: report)
        vm.configure(mapService: nil, modelContext: container.mainContext)
        return (vm, state, container)
    }

    private static func pick(_ vm: IsraelFlightPlanViewModel, from: String = "LLHZ", to: String = "LLIB") async throws {
        vm.selectDeparture(try #require(try database().aerodrome(code: from)))
        vm.selectDestination(try #require(try database().aerodrome(code: to)))
        await vm.computeRoute()
    }

    @Test func routesTheShortPathWithoutAFeed() async throws {
        let (vm, _) = Self.viewModel()
        try await Self.pick(vm)
        #expect(vm.plan?.pointCodes == ["LLHZ", "MIDAA", "LLIB"])
        #expect(vm.closuresChecked == false)  // no feed: the pilot is told closures were not applied
    }

    @Test func fullClosureDetoursAndReturnReversesTheRoute() async throws {
        let now = Date()
        let (vm, _) = Self.viewModel(report: Self.closureReport(now))
        try await Self.pick(vm)
        #expect(vm.plan?.pointCodes == ["LLHZ", "MIDBB", "LLIB"])
        #expect(vm.closuresChecked)
        await vm.planReturn()
        #expect(vm.plan?.pointCodes == ["LLIB", "MIDBB", "LLHZ"])
        #expect(vm.departure?.code == "LLIB")
    }

    @Test func bothWaysClosedGivesNoRouteWithClosureReason() async throws {
        let now = Date()
        func closure(_ id: String, _ chain: [String]) -> IsraelRouteClosure {
            IsraelRouteClosure(notamId: id, routeKind: "CVFR", routeName: nil, chain: chain, validFrom: nil, validTo: nil, schedule: nil)
        }
        let report = IsraelNotamReport(
            feed: IsraelNotamFeed(generatedAt: now, items: [], closures: [closure("C1/26", ["MIDAA", "LLIB"]), closure("C2/26", ["MIDBB", "LLIB"])]),
            fetchedAt: now, refreshFailed: false
        )
        let (vm, _) = Self.viewModel(report: report)
        try await Self.pick(vm)
        #expect(vm.plan == nil)
        #expect(vm.routeError == .noRoute(from: "LLHZ", to: "LLIB", reason: .closed))
        #expect(!vm.canFile)
    }

    @Test func closureNamingAnUnknownPointBlocksFilingWithAnUnresolvedIssue() async throws {
        let now = Date()
        let unknown = IsraelRouteClosure(notamId: "C5/26", routeKind: "CVFR", routeName: nil, chain: ["MIDAA", "ZZZZZ"],
                                         validFrom: nil, validTo: nil, schedule: nil)
        let report = IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: now, items: [], closures: [unknown]),
                                       fetchedAt: now, refreshFailed: false)
        let (vm, _, container) = try Self.fileableViewModel(report: report)
        defer { withExtendedLifetime(container) {} }
        try await Self.pick(vm)
        #expect(vm.plan != nil)
        #expect(vm.issues.contains { $0.kind == .unresolvedClosure("C5/26") && $0.blocksFiling })
        #expect(!vm.canFile)
    }

    @Test func unknownViaPointIsRefused() async throws {
        let (vm, _) = Self.viewModel()
        vm.addVia(code: "NOPE")
        #expect(vm.viaError != nil)
        #expect(vm.viaCodes.isEmpty)
    }

    @Test func activateFeedsNavigationStateAndClearResetsIt() async throws {
        let (vm, state, container) = try Self.fileableViewModel()
        defer { withExtendedLifetime(container) {} }
        try await Self.pick(vm)
        vm.activate()
        #expect(state.activeFlightPlan)
        #expect(state.activeRoute?.current?.toCode == "MIDAA")
        #expect(state.activeRoute?.current?.altitudeText == "1500")
        #expect(state.activePlanDestination == "LLIB")
        #expect(FlightLogStrip.routeTitle(for: state)?.contains("MIDAA") == true)
        vm.clear()
        #expect(!state.activeFlightPlan)
        #expect(state.activeRoute == nil)
    }

    @Test func activateIsRefusedWithoutAircraftAndPilotProfiles() async throws {
        let (vm, state) = Self.viewModel()
        try await Self.pick(vm)
        #expect(vm.plan != nil)
        #expect(!vm.canFile)  // no registration, no pilot name
        vm.activate()
        #expect(!state.activeFlightPlan)
        #expect(state.activeRoute == nil)
    }

    @Test func routeProgressAdvancesToTheNextLegNearThePoint() async throws {
        let (vm, state, container) = try Self.fileableViewModel()
        defer { withExtendedLifetime(container) {} }
        try await Self.pick(vm)
        vm.activate()
        state.ownshipPosition = CLLocation(latitude: 32.3, longitude: 34.9)  // over MIDAA
        state.groundSpeed = 90
        state.updateActiveRouteProgress()
        #expect(state.activeRoute?.current?.toCode == "LLIB")
        #expect(state.distanceToNext.map { $0 > 40 } == true)
    }
}
