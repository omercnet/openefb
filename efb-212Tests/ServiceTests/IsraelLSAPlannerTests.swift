//
//  IsraelLSAPlannerTests.swift
//  efb-212Tests
//
//  Sport-aviation (LSA) planning: the weekend rule, routing on the LSA network with weekend-only routes,
//  closures that name LSA / ULTRALIGHT routes, the Hebrew FPL summary, the network choice in the view model
//  and the aircraft's usual network.
//

import Testing
import Foundation
import CoreLocation
import SwiftData
@testable import efb_212

// MARK: - Fixtures

private enum LSAFixture {

    /// Local Israel time (UTC+2 in November) as an absolute instant.
    static func israel(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Jerusalem") ?? .gmt
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute)) ?? .distantPast
    }

    // 2026-11-04 Wednesday, 06 Friday, 07 Saturday, 08 Sunday.
    static let wednesday = israel(2026, 11, 4, 10)
    static let fridayMorning = israel(2026, 11, 6, 10)
    static let fridayAfternoon = israel(2026, 11, 6, 15)
    static let saturday = israel(2026, 11, 7, 10)

    static let codes = ["A", "B", "C", "D"]

    static func points(network: IsraelRouteNetwork = .lsa) -> [IsraelReportingPoint] {
        codes.enumerated().map { index, code in
            IsraelReportingPoint(id: index + 1, code: code, nameEnglish: code, nameHebrew: nil, kind: .compulsory,
                                 latitude: 32.0 + Double(index) * 0.01, longitude: 34.8, network: network)
        }
    }

    static func segment(
        _ id: Int, _ from: String, _ to: String, nm: Double, activity: IsraelRouteActivity,
        network: IsraelRouteNetwork = .lsa, smallOnly: Bool = false, source: String? = nil
    ) -> IsraelRouteSegment {
        func index(_ code: String) -> Int { (codes.firstIndex(of: code) ?? 0) + 1 }
        return IsraelRouteSegment(
            id: id, fromCode: from, toCode: to, fromPointID: index(from), toPointID: index(to),
            nameEnglish: nil, nameHebrew: nil, lengthNM: nm, isCivil: true, isMilitary: false, isByRequest: false,
            bearingTrue: 90,
            altitudeForward: IsraelRouteAltitude(published: "1500", feet: 1500),
            altitudeReverse: IsraelRouteAltitude(published: "1500", feet: 1500),
            lowerAltitudeFeet: nil, mapSheet: nil,
            polyline: [CLLocationCoordinate2D(latitude: 32.0, longitude: 34.8), CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)],
            network: network, activity: activity, activitySource: source, smallOnly: smallOnly
        )
    }

    /// A-B-C is the short way (20 NM) and weekend-only; A-D-C is the longer way (30 NM) and open all week.
    static let diamond = [
        segment(1, "A", "B", nm: 10, activity: .weekend), segment(2, "B", "C", nm: 10, activity: .weekend),
        segment(3, "A", "D", nm: 15, activity: .allWeek), segment(4, "D", "C", nm: 15, activity: .allWeek)
    ]

    static func planner(_ segments: [IsraelRouteSegment], closures: [Int: IsraelSegmentClosure] = [:]) -> IsraelRoutePlanner {
        IsraelRoutePlanner(points: points(), segments: segments, closures: closures)
    }

    static func route(
        _ planner: IsraelRoutePlanner, at departure: Date?, speed: Double = 90, override: IsraelDayOverride = .none
    ) throws -> IsraelRoutePlan {
        try planner.route(
            from: "A", to: "C", cruiseSpeedKnots: speed,
            options: IsraelRouteOptions(departure: departure, dayOverride: override)
        )
    }
}

// MARK: - Weekend rule

@Suite("Israel LSA weekend rule")
struct IsraelLSATimeRulesTests {

    private func state(_ date: Date, _ override: IsraelDayOverride = .none) -> IsraelWeekendState {
        IsraelLSATimeRules.weekendState(at: date, override: override)
    }

    @Test func saturdayIsAWeekendAllDay() {
        #expect(state(LSAFixture.israel(2026, 11, 7, 0, 0)) == .inUse)
        #expect(state(LSAFixture.israel(2026, 11, 7, 23, 59)) == .inUse)
    }

    @Test func sundayThroughThursdayAreNotAWeekend() {
        for day in 1...5 {  // Sun 1 Nov ... Thu 5 Nov
            #expect(state(LSAFixture.israel(2026, 11, day, 12)) == .notInUse, "Nov \(day)")
        }
        #expect(state(LSAFixture.israel(2026, 11, 8, 0, 0)) == .notInUse)  // Saturday ends at midnight
    }

    @Test func fridayStartsUnconfirmedAtSixAndConfirmedAtFourteen() {
        #expect(state(LSAFixture.israel(2026, 11, 6, 5, 59)) == .notInUse)
        #expect(state(LSAFixture.israel(2026, 11, 6, 6, 0)) == .startUnconfirmed)
        #expect(state(LSAFixture.israel(2026, 11, 6, 13, 59)) == .startUnconfirmed)
        #expect(state(LSAFixture.israel(2026, 11, 6, 14, 0)) == .inUse)
    }

    @Test func aDeclaredHolidayCountsAsASaturdayAndAHolidayEveAsAFridayFromFourteen() {
        #expect(state(LSAFixture.wednesday, .holiday) == .inUse)
        #expect(state(LSAFixture.israel(2026, 11, 4, 13, 59), .holidayEve) == .notInUse)
        #expect(state(LSAFixture.israel(2026, 11, 4, 14, 0), .holidayEve) == .inUse)
    }
}

// MARK: - Planner

@Suite("Israel LSA planner")
struct IsraelLSAPlannerTests {

    @Test func aWeekdayDepartureLeavesOutTheWeekendOnlyRoutes() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.wednesday)
        #expect(plan.pointCodes == ["A", "D", "C"])
        #expect(plan.isFileable)
    }

    @Test func aSaturdayDepartureUsesTheShortWeekendRoute() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.saturday)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.isFileable)
        #expect(plan.legs.allSatisfy { $0.cautions.isEmpty })
    }

    @Test func fridayMorningKeepsTheRouteButBlocksFilingBecauseTheStartIsUnconfirmed() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.fridayMorning)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.legs.allSatisfy { $0.cautions == [.weekendStartUnconfirmed] })
        #expect(!plan.isFileable)
        let issues = IsraelFlightPlanValidator.validate(plan: plan)
        #expect(issues.contains { $0.kind == .weekendStartUnconfirmed("A-B") && $0.blocksFiling })
    }

    @Test func fridayAfternoonIsInUseByEveryPublishedRule() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.fridayAfternoon)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.isFileable)
    }

    @Test func aFlightThatCrossesTheEndOfSaturdayBlocksFilingOnTheLegAfterMidnight() throws {
        // 5 kt: each 10 NM leg takes 2 h. Departing Saturday 23:00, the second leg starts Sunday 01:00.
        let departure = LSAFixture.israel(2026, 11, 7, 23)
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: departure, speed: 5)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.legs[0].cautions.isEmpty)
        #expect(plan.legs[1].cautions == [.notInUse])
        #expect(!plan.isFileable)
        #expect(IsraelFlightPlanValidator.validate(plan: plan).contains { $0.kind == .notInUse("B-C") && $0.blocksFiling })
    }

    @Test func aDeclaredHolidayLetsAWeekdayDepartureUseTheWeekendRoutes() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.wednesday, override: .holiday)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.isFileable)
    }

    @Test func whenOnlyWeekendRoutesConnectThePointsTheReasonIsNotInUse() {
        let planner = LSAFixture.planner([
            LSAFixture.segment(1, "A", "B", nm: 10, activity: .weekend), LSAFixture.segment(2, "B", "C", nm: 10, activity: .weekend)
        ])
        do {
            _ = try LSAFixture.route(planner, at: LSAFixture.wednesday)
            Issue.record("expected no route")
        } catch {
            let routeError = error as? IsraelRouteError
            #expect(routeError == .noRoute(from: "A", to: "C", reason: .notInUse))
            #expect(routeError?.errorDescription?.contains("weekend") == true)
        }
    }

    @Test func withoutADepartureTheTimeRulesAreNotApplied() throws {
        let plan = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: nil)
        #expect(plan.pointCodes == ["A", "B", "C"])
    }

    @Test func specialAndUnspecifiedRoutesCarryANonBlockingCautionWithTheLayersText() throws {
        let planner = LSAFixture.planner([
            LSAFixture.segment(1, "A", "B", nm: 10, activity: .special, source: "מיוחד"),
            LSAFixture.segment(2, "B", "C", nm: 10, activity: .unspecified, source: "C")
        ])
        let plan = try LSAFixture.route(planner, at: LSAFixture.wednesday)
        #expect(plan.legs.map(\.cautions) == [[.specialConditions(text: "מיוחד")], [.specialConditions(text: "C")]])
        #expect(plan.isFileable)
        #expect(IsraelFlightPlanValidator.validate(plan: plan).allSatisfy { !$0.blocksFiling })
    }

    @Test func smallAircraftOnlyRoutesAreMarked() throws {
        let planner = LSAFixture.planner([
            LSAFixture.segment(1, "A", "B", nm: 10, activity: .allWeek, smallOnly: true),
            LSAFixture.segment(2, "B", "C", nm: 10, activity: .allWeek)
        ])
        let plan = try LSAFixture.route(planner, at: LSAFixture.wednesday)
        #expect(plan.legs.map(\.cautions) == [[.smallAircraftOnly], []])
        #expect(plan.isFileable)
    }

    @Test func cvfrSegmentsIgnoreTheWeekendRule() throws {
        let segments = LSAFixture.diamond.map { segment in
            LSAFixture.segment(segment.id, segment.fromCode, segment.toCode, nm: segment.lengthNM ?? 0,
                               activity: .weekend, network: .cvfr)
        }
        let planner = IsraelRoutePlanner(points: LSAFixture.points(network: .cvfr), segments: segments)
        let plan = try LSAFixture.route(planner, at: LSAFixture.wednesday)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.isFileable)
    }

    // MARK: Closures

    private static func report(_ kind: String, now: Date) -> IsraelNotamReport {
        let closure = IsraelRouteClosure(notamId: "C5/26", routeKind: kind, routeName: nil, chain: ["B", "C"],
                                         validFrom: nil, validTo: nil, schedule: nil)
        return IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: now, items: [], closures: [closure]), fetchedAt: now, refreshFailed: false)
    }

    private static func marks(_ kind: String, for network: IsraelRouteNetwork) -> IsraelClosureMarks {
        let now = Date()
        let chart = IsraelChartNetwork(points: LSAFixture.points(network: network), segments: LSAFixture.diamond)
        return IsraelRoutePlanner.closures(
            from: report(kind, now: now), network: chart, routeNetwork: network, departure: now, window: 3600, now: now
        )
    }

    @Test func anUltralightClosureCountsOnTheLSANetworkOnly() {
        #expect(Self.marks("ULTRALIGHT", for: .lsa).segments[2] == .full(notamID: "C5/26"))
        #expect(Self.marks("ULTRALIGHT", for: .cvfr).segments.isEmpty)
    }

    @Test func aCVFRClosureDoesNotCloseTheLSANetwork() {
        #expect(Self.marks("CVFR", for: .lsa).segments.isEmpty)
        #expect(Self.marks("CVFR", for: .cvfr).segments[2] == .full(notamID: "C5/26"))
    }

    @Test func anLSAClosureThatNamesAnUnknownPointStillBlocksFiling() {
        let now = Date()
        let closure = IsraelRouteClosure(notamId: "C6/26", routeKind: "LSA", routeName: nil, chain: ["B", "NOWHERE"],
                                         validFrom: nil, validTo: nil, schedule: nil)
        let report = IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: now, items: [], closures: [closure]), fetchedAt: now, refreshFailed: false)
        let chart = IsraelChartNetwork(points: LSAFixture.points(), segments: LSAFixture.diamond)
        let marks = IsraelRoutePlanner.closures(from: report, network: chart, routeNetwork: .lsa, departure: now, window: 3600, now: now)
        #expect(marks.unresolved.map(\.notamID) == ["C6/26"])
    }

    // MARK: FPL text

    @Test func theHebrewSummaryNamesTheNetworkTheRouteIsFlownOn() throws {
        let input = IsraelFlightPlanInput(registration: "4X-ABC", cruiseSpeedKnots: 90, departure: LSAFixture.saturday, picName: "Test Pilot")
        let lsa = try LSAFixture.route(LSAFixture.planner(LSAFixture.diamond), at: LSAFixture.saturday)
        #expect(IsraelFlightPlanMessage.hebrewSummary(plan: lsa, input: input).hasPrefix("תכנית טיסה בנתיבי התעופה הספורטיבית"))
        let cvfrPlanner = IsraelRoutePlanner(points: LSAFixture.points(network: .cvfr), segments: [
            LSAFixture.segment(1, "A", "B", nm: 10, activity: .unspecified, network: .cvfr),
            LSAFixture.segment(2, "B", "C", nm: 10, activity: .unspecified, network: .cvfr)
        ])
        let cvfr = try LSAFixture.route(cvfrPlanner, at: LSAFixture.saturday)
        #expect(IsraelFlightPlanMessage.hebrewSummary(plan: cvfr, input: input).hasPrefix("תכנית טיסה בנתיבי התובלה הנמוכים"))
    }
}

// MARK: - Bundled network

@Suite("Israel LSA bundled network")
struct IsraelLSABundledRouteTests {

    private static func lsaPlanner() throws -> IsraelRoutePlanner {
        let database = try IsraelAviationDatabase.bundled()
        return IsraelRoutePlanner(
            points: try database.reportingPoints(in: .wholeCountry, network: .lsa),
            segments: try database.routeSegments(in: .wholeCountry, network: .lsa)
        )
    }

    @Test func routesOverTheRealLSANetworkOnASaturdayAndKeepsWeekendRoutesOutOnAWeekday() throws {
        let planner = try Self.lsaPlanner()
        // Find a pair joined by a weekend-only route that is two-way and open (not by request).
        let database = try IsraelAviationDatabase.bundled()
        let weekend = try #require(try database.routeSegments(in: .wholeCountry, network: .lsa).first {
            $0.activity == .weekend && !$0.isByRequest && $0.altitudeReverse != nil
        })
        let saturday = try planner.route(
            from: weekend.fromCode, to: weekend.toCode, cruiseSpeedKnots: 90,
            options: IsraelRouteOptions(departure: LSAFixture.saturday)
        )
        #expect(saturday.network == .lsa)
        #expect(saturday.pointCodes.first == weekend.fromCode)
        #expect(saturday.pointCodes.last == weekend.toCode)
        #expect(saturday.legs.allSatisfy { $0.altitude != nil })

        let weekday = try? planner.route(
            from: weekend.fromCode, to: weekend.toCode, cruiseSpeedKnots: 90,
            options: IsraelRouteOptions(departure: LSAFixture.wednesday)
        )
        // Either no route or a route that avoids every weekend-only segment.
        #expect(weekday?.legs.contains { $0.segment.activity == .weekend } != true)
    }
}

// MARK: - View model

@MainActor
@Suite("Israel LSA view model")
struct IsraelLSAViewModelTests {

    private static func point(_ id: Int, _ code: String, _ kind: IsraelPointKind, _ network: IsraelRouteNetwork, lat: Double, lon: Double) -> IsraelReportingPoint {
        IsraelReportingPoint(id: id, code: code, nameEnglish: code, nameHebrew: nil, kind: kind,
                             latitude: lat, longitude: lon, network: network)
    }

    private static func segment(
        _ id: Int, _ a: IsraelReportingPoint, _ b: IsraelReportingPoint, nm: Double,
        network: IsraelRouteNetwork, activity: IsraelRouteActivity
    ) -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: a.code, toCode: b.code, fromPointID: a.id, toPointID: b.id,
            nameEnglish: nil, nameHebrew: nil, lengthNM: nm, isCivil: true, isMilitary: false, isByRequest: false,
            bearingTrue: 0,
            altitudeForward: IsraelRouteAltitude(published: "1500", feet: 1500),
            altitudeReverse: IsraelRouteAltitude(published: "1500", feet: 1500),
            lowerAltitudeFeet: nil, mapSheet: nil, polyline: [a.coordinate, b.coordinate],
            network: network, activity: activity
        )
    }

    /// CVFR: LLHZ-MIDCV-LLIB. LSA: LLHZ-MIDLS-LLIB, the first leg weekend-only. Different mid points per network.
    private static func database() -> MockIsraelAviationDatabase {
        let cvfr = [
            point(1, "LLHZ", .arp, .cvfr, lat: 32.18, lon: 34.83), point(2, "MIDCV", .compulsory, .cvfr, lat: 32.3, lon: 34.9),
            point(3, "LLIB", .arp, .cvfr, lat: 32.98, lon: 35.57)
        ]
        let lsa = [
            point(4, "LLHZ", .arp, .lsa, lat: 32.18, lon: 34.83), point(5, "MIDLS", .compulsory, .lsa, lat: 32.4, lon: 35.0),
            point(6, "LLIB", .arp, .lsa, lat: 32.98, lon: 35.57)
        ]
        var db = MockIsraelAviationDatabase()
        db.points = cvfr + lsa
        db.segments = [
            segment(1, cvfr[0], cvfr[1], nm: 10, network: .cvfr, activity: .unspecified),
            segment(2, cvfr[1], cvfr[2], nm: 40, network: .cvfr, activity: .unspecified),
            segment(3, lsa[0], lsa[1], nm: 12, network: .lsa, activity: .weekend),
            segment(4, lsa[1], lsa[2], nm: 42, network: .lsa, activity: .allWeek)
        ]
        db.aerodromeList = [
            IsraelNearestAndSearchTests.aerodrome("LLHZ", lat: 32.18, lon: 34.83),
            IsraelNearestAndSearchTests.aerodrome("LLIB", lat: 32.98, lon: 35.57)
        ]
        return db
    }

    private static func viewModel() -> IsraelFlightPlanViewModel {
        let db = database()
        let vm = IsraelFlightPlanViewModel(appState: AppState(), databaseProvider: { db }, notamFetcher: nil)
        vm.departureTime = LSAFixture.saturday
        return vm
    }

    private static func pick(_ vm: IsraelFlightPlanViewModel) async throws {
        let db = database()
        vm.selectDeparture(try #require(try db.aerodrome(code: "LLHZ")))
        vm.selectDestination(try #require(try db.aerodrome(code: "LLIB")))
        await vm.computeRoute()
    }

    @Test func theNetworkChoiceDecidesWhichRoutesArePlanned() async throws {
        let vm = Self.viewModel()
        try await Self.pick(vm)
        #expect(vm.plan?.pointCodes == ["LLHZ", "MIDCV", "LLIB"])
        vm.selectNetwork(.lsa)
        await vm.computeRoute()
        #expect(vm.plan?.pointCodes == ["LLHZ", "MIDLS", "LLIB"])
        #expect(vm.plan?.network == .lsa)
        #expect(vm.hebrewSummary.hasPrefix("תכנית טיסה בנתיבי התעופה הספורטיבית"))
    }

    @Test func aWeekdayDepartureOnTheLSANetworkHasNoRouteBecauseTheFirstLegIsWeekendOnly() async throws {
        let vm = Self.viewModel()
        vm.departureTime = LSAFixture.wednesday
        vm.selectNetwork(.lsa)
        try await Self.pick(vm)
        #expect(vm.plan == nil)
        #expect(vm.routeError == .noRoute(from: "LLHZ", to: "LLIB", reason: .notInUse))
        vm.dayOverride = .holiday
        await vm.computeRoute()
        #expect(vm.plan?.pointCodes == ["LLHZ", "MIDLS", "LLIB"])
    }

    @Test func switchingNetworkClearsViaPointsThatBelongToTheOtherNetwork() async throws {
        let vm = Self.viewModel()
        vm.addVia(code: "MIDCV")
        #expect(vm.viaCodes == ["MIDCV"])
        vm.selectNetwork(.lsa)
        #expect(vm.viaCodes.isEmpty)
        vm.addVia(code: "MIDCV")
        #expect(vm.viaError == "MIDCV is not a reporting point of the LSA network.")
    }

    @Test func theActiveAircraftsUsualNetworkPreselectsUntilThePilotChooses() throws {
        let container = try ModelContainer(
            for: SchemaV1.AircraftProfile.self, SchemaV1.PilotProfile.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let aircraft = SchemaV1.AircraftProfile(nNumber: "4X-LSA")
        aircraft.isActive = true
        container.mainContext.insert(aircraft)
        IsraelAircraftNetworkPreference.set(.lsa, for: aircraft.id)
        defer { IsraelAircraftNetworkPreference.set(nil, for: aircraft.id) }

        let vm = Self.viewModel()
        vm.configure(mapService: nil, modelContext: container.mainContext)
        #expect(vm.network == .lsa)
        #expect(!vm.networkChosenByPilot)

        vm.selectNetwork(.cvfr)
        vm.configure(mapService: nil, modelContext: container.mainContext)  // the pilot's choice stays
        #expect(vm.network == .cvfr)
    }

    @Test func anAircraftWithoutAPreferenceStartsOnCVFR() throws {
        let container = try ModelContainer(
            for: SchemaV1.AircraftProfile.self, SchemaV1.PilotProfile.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let aircraft = SchemaV1.AircraftProfile(nNumber: "4X-GA")
        aircraft.isActive = true
        container.mainContext.insert(aircraft)
        let vm = Self.viewModel()
        vm.configure(mapService: nil, modelContext: container.mainContext)
        #expect(vm.network == .cvfr)
    }
}
