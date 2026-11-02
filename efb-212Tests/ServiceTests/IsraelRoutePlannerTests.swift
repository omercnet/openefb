//
//  IsraelRoutePlannerTests.swift
//  efb-212Tests
//
//  IL-PLAN: shortest path over the CVFR network, direction, by-request and military rules,
//  NOTAM closures (full detour, partial caution, no route), via points and the return route.
//  Pure logic on hand-made networks, plus the bundled network for the LLHZ -> LLIB route.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel route planner")
struct IsraelRoutePlannerTests {

    // MARK: Fixtures

    private static let codes = ["A", "B", "C", "D", "E", "F", "Z"]

    private static func points() -> [IsraelReportingPoint] {
        codes.enumerated().map { index, code in
            IsraelReportingPoint(id: index + 1, code: code, nameEnglish: code, nameHebrew: nil, kind: .compulsory,
                                 latitude: 32.0 + Double(index) * 0.01, longitude: 34.8)
        }
    }

    private static func id(_ code: String) -> Int { (codes.firstIndex(of: code) ?? 0) + 1 }

    private static func segment(
        _ id: Int, _ from: String, _ to: String, nm: Double,
        forward: String? = "1500", reverse: String? = "2000",
        military: Bool = false, byRequest: Bool = false
    ) -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: from, toCode: to, fromPointID: Self.id(from), toPointID: Self.id(to),
            nameEnglish: nil, nameHebrew: nil, lengthNM: nm, isCivil: !military, isMilitary: military,
            isByRequest: byRequest, bearingTrue: 90,
            altitudeForward: forward.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            altitudeReverse: reverse.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            lowerAltitudeFeet: nil, mapSheet: nil,
            polyline: [CLLocationCoordinate2D(latitude: 32.0, longitude: 34.8), CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)]
        )
    }

    /// A-B-C is the short way (20 NM); A-D-C is the detour (30 NM).
    private static let diamond = [
        segment(1, "A", "B", nm: 10), segment(2, "B", "C", nm: 10),
        segment(3, "A", "D", nm: 15), segment(4, "D", "C", nm: 15)
    ]

    private static func planner(_ segments: [IsraelRouteSegment], closures: [Int: IsraelSegmentClosure] = [:]) -> IsraelRoutePlanner {
        IsraelRoutePlanner(points: points(), segments: segments, closures: closures)
    }

    private static func noRoute(_ planner: IsraelRoutePlanner, _ from: String, _ to: String,
                                options: IsraelRouteOptions = IsraelRouteOptions()) -> IsraelRouteError? {
        do {
            _ = try planner.route(from: from, to: to, cruiseSpeedKnots: 90, options: options)
            return nil
        } catch {
            return error
        }
    }

    // MARK: Shortest path

    @Test func takesTheShortestOpenPathAndSumsDistanceAndEte() throws {
        let plan = try Self.planner(Self.diamond).route(from: "A", to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.totalDistanceNM == 20)
        // 20 NM at 90 kt = 800 s
        #expect(abs(plan.totalETESeconds - 800) < 0.001)
        #expect(plan.isFileable)
    }

    @Test func eachLegCarriesTheAltitudePublishedForTheDirectionFlown() throws {
        let planner = Self.planner([Self.segment(1, "A", "B", nm: 10, forward: "1500", reverse: "2000")])
        let out = try planner.route(from: "A", to: "B", cruiseSpeedKnots: 90)
        let back = try planner.route(from: "B", to: "A", cruiseSpeedKnots: 90)
        #expect(out.legs.first?.altitudeText == "1500")
        #expect(back.legs.first?.altitudeText == "2000")
        // Flown backwards, the leg's polyline and bearing run to -> from.
        #expect(back.legs.first?.bearingTrue == 270)
    }

    @Test func sameStartAndEndGivesAnEmptyRoute() throws {
        let plan = try Self.planner(Self.diamond).route(from: "A", to: "A", cruiseSpeedKnots: 90)
        #expect(plan.legs.isEmpty)
    }

    // MARK: Direction

    @Test func oneWaySegmentIsNotFlownAgainstItsPublishedDirection() throws {
        let planner = Self.planner([Self.segment(1, "E", "A", nm: 10, forward: "1500", reverse: nil)])
        #expect(try planner.route(from: "E", to: "A", cruiseSpeedKnots: 90).pointCodes == ["E", "A"])
        #expect(Self.noRoute(planner, "A", "E") == .noRoute(from: "A", to: "E", reason: .oneWay))
    }

    @Test func returnRouteDiffersWhenASegmentIsOneWay() throws {
        // A -> B is one-way (10 NM); B back to A has to go round through F (22 NM).
        let planner = Self.planner([
            Self.segment(1, "A", "B", nm: 10, forward: "1500", reverse: nil),
            Self.segment(2, "B", "F", nm: 10), Self.segment(3, "F", "A", nm: 12)
        ])
        let out = try planner.route(from: "A", to: "B", cruiseSpeedKnots: 90)
        let back = try planner.returnRoute(of: out)
        #expect(out.pointCodes == ["A", "B"])
        #expect(back.pointCodes == ["B", "F", "A"])
        #expect(back.totalDistanceNM == 22)
    }

    // MARK: By request and military

    @Test func byRequestSegmentsAreExcludedByDefault() throws {
        let planner = Self.planner(Self.diamond + [Self.segment(5, "A", "C", nm: 5, byRequest: true)])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "B", "C"])
    }

    @Test func byRequestOverrideTakesTheDashedShortcutButIsNotFileable() throws {
        let planner = Self.planner(Self.diamond + [Self.segment(5, "A", "C", nm: 5, byRequest: true)])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90, options: IsraelRouteOptions(allowByRequest: true))
        #expect(plan.pointCodes == ["A", "C"])
        #expect(plan.legs.first?.cautions == [.byRequest])
        #expect(!plan.isFileable)
    }

    @Test func militarySegmentsNeedTheirOwnOverrideAndAreNotFileable() throws {
        let planner = Self.planner([Self.segment(1, "A", "B", nm: 10, military: true)])
        #expect(Self.noRoute(planner, "A", "B") == .noRoute(from: "A", to: "B", reason: .restricted))
        let plan = try planner.route(from: "A", to: "B", cruiseSpeedKnots: 90, options: IsraelRouteOptions(allowMilitary: true))
        #expect(plan.legs.first?.cautions == [.military])
        #expect(!plan.isFileable)
    }

    // MARK: Closures

    @Test func fullClosureForcesTheDetour() throws {
        let planner = Self.planner(Self.diamond, closures: [2: .full(notamID: "C1/26")])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "D", "C"])
        #expect(plan.totalDistanceNM == 30)
    }

    @Test func partialClosureKeepsTheSegmentWithACautionThatDoesNotBlockFiling() throws {
        let planner = Self.planner(Self.diamond, closures: [2: .partial(notamID: "C2/26", text: "CLSD 2000 AVBL 3000")])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(plan.legs.last?.cautions == [.partialClosure(notamID: "C2/26", text: "CLSD 2000 AVBL 3000")])
        #expect(plan.isFileable)
    }

    @Test func unreadClosureKeepsTheSegmentButBlocksFiling() throws {
        let planner = Self.planner(Self.diamond, closures: [2: .check(notamID: "C3/26")])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "B", "C"])
        #expect(!plan.isFileable)
    }

    @Test func noRouteNamesClosureAsTheReason() {
        let planner = Self.planner(Self.diamond, closures: [2: .full(notamID: "C1/26"), 4: .full(notamID: "C4/26")])
        let error = Self.noRoute(planner, "A", "C")
        #expect(error == .noRoute(from: "A", to: "C", reason: .closed))
        #expect(error?.hebrewDescription == "לא נמצא נתיב פתוח בין A ל-C")
    }

    @Test func noRouteToAnIsolatedPointIsDisconnected() {
        #expect(Self.noRoute(Self.planner(Self.diamond), "A", "Z") == .noRoute(from: "A", to: "Z", reason: .disconnected))
    }

    @Test func unknownPointIsReported() {
        #expect(Self.noRoute(Self.planner(Self.diamond), "A", "NOWHERE") == .unknownPoint("NOWHERE"))
    }

    // MARK: Via points

    @Test func viaPointForcesThePathThroughIt() throws {
        let plan = try Self.planner(Self.diamond).route(from: "A", via: ["D"], to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "D", "C"])
    }

    @Test func viaPointOnTheShortPathAddsNothing() throws {
        let plan = try Self.planner(Self.diamond).route(from: "A", via: ["B"], to: "C", cruiseSpeedKnots: 90)
        #expect(plan.pointCodes == ["A", "B", "C"])
    }

    // MARK: Closures from the NOTAM feed

    private static func report(generated: Date, closures: [IsraelRouteClosure]) -> IsraelNotamReport {
        IsraelNotamReport(
            feed: IsraelNotamFeed(generatedAt: generated, items: [], closures: closures),
            fetchedAt: generated, refreshFailed: false
        )
    }

    private static func closure(validFrom: Date?, validTo: Date?, partial: Bool? = nil) -> IsraelRouteClosure {
        IsraelRouteClosure(notamId: "C9/26", routeKind: "CVFR", routeName: nil, chain: ["B", "C"],
                           validFrom: validFrom, validTo: validTo, schedule: nil, partial: partial)
    }

    private static func network() -> IsraelChartNetwork { IsraelChartNetwork(points: points(), segments: diamond) }

    @Test func closureOverlappingTheDepartureWindowMarksTheSegment() {
        let now = Date()
        let report = Self.report(generated: now, closures: [Self.closure(validFrom: now.addingTimeInterval(3600), validTo: nil)])
        let marks = IsraelRoutePlanner.closures(from: report, network: Self.network(), departure: now, window: 7200, now: now)
        #expect(marks.segments[2] == .full(notamID: "C9/26"))
        #expect(marks.unresolved.isEmpty)
    }

    @Test func closureThatStartsAfterTheWindowOrEndedBeforeIsIgnored() {
        let now = Date()
        let later = Self.report(generated: now, closures: [Self.closure(validFrom: now.addingTimeInterval(4 * 3600), validTo: nil)])
        let earlier = Self.report(generated: now, closures: [Self.closure(validFrom: nil, validTo: now.addingTimeInterval(-60))])
        #expect(IsraelRoutePlanner.closures(from: later, network: Self.network(), departure: now, window: 7200, now: now) == IsraelClosureMarks())
        #expect(IsraelRoutePlanner.closures(from: earlier, network: Self.network(), departure: now, window: 7200, now: now) == IsraelClosureMarks())
    }

    @Test func staleOrMissingFeedYieldsNoClosureMarks() {
        let now = Date()
        let stale = Self.report(generated: now.addingTimeInterval(-24 * 3600), closures: [Self.closure(validFrom: nil, validTo: nil)])
        #expect(IsraelRoutePlanner.closures(from: stale, network: Self.network(), departure: now, window: 7200, now: now) == IsraelClosureMarks())
        #expect(IsraelRoutePlanner.closures(from: nil, network: Self.network(), departure: now, window: 7200, now: now) == IsraelClosureMarks())
    }

    // MARK: Unresolved closures never fail open (efb-qpk)

    private static func chainClosure(_ id: String, _ chain: [String]) -> IsraelRouteClosure {
        IsraelRouteClosure(notamId: id, routeKind: "CVFR", routeName: nil, chain: chain,
                           validFrom: nil, validTo: nil, schedule: nil, partial: nil)
    }

    @Test func closureWithAnUnknownCodeIsReportedAsUnresolved() {
        let now = Date()
        let report = Self.report(generated: now, closures: [Self.chainClosure("C7/26", ["B", "NOWHERE"])])
        let marks = IsraelRoutePlanner.closures(from: report, network: Self.network(), departure: now, window: 7200, now: now)
        #expect(marks.segments.isEmpty)
        #expect(marks.unresolved == [IsraelUnresolvedClosure(notamID: "C7/26", unknownCodes: ["NOWHERE"], unmatchedLegs: [])])
    }

    @Test func closureLegWithNoPublishedSegmentIsReportedAsUnresolved() {
        let now = Date()
        // B and D are both on the network but no segment joins them.
        let report = Self.report(generated: now, closures: [Self.chainClosure("C8/26", ["B", "D"])])
        let marks = IsraelRoutePlanner.closures(from: report, network: Self.network(), departure: now, window: 7200, now: now)
        #expect(marks.unresolved == [IsraelUnresolvedClosure(notamID: "C8/26", unknownCodes: [], unmatchedLegs: [IsraelClosureLeg(from: "B", to: "D")])])
    }

    @Test func partlyPlacedClosureStillClosesWhatItCanAndStaysUnresolved() {
        let now = Date()
        let report = Self.report(generated: now, closures: [Self.chainClosure("C6/26", ["A", "B", "NOWHERE"])])
        let marks = IsraelRoutePlanner.closures(from: report, network: Self.network(), departure: now, window: 7200, now: now)
        #expect(marks.segments[1] == .full(notamID: "C6/26"))
        #expect(marks.unresolved.map(\.notamID) == ["C6/26"])
    }

    @Test func unresolvedClosureBlocksFilingEvenWhenTheRouteIsOtherwiseClean() throws {
        let plan = try Self.planner(Self.diamond).route(from: "A", to: "C", cruiseSpeedKnots: 90)
        let unresolved = [IsraelUnresolvedClosure(notamID: "C7/26", unknownCodes: ["NOWHERE"], unmatchedLegs: [])]
        let issues = IsraelFlightPlanValidator.validate(plan: plan, unresolved: unresolved)
        #expect(issues.map(\.kind) == [.unresolvedClosure("C7/26")])
        #expect(issues.first?.message.hasPrefix("Unresolved closure: check NOTAM C7/26") == true)
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }

    // MARK: Bundled network

    @Test func bundledNetworkRoutesHerzeliyaToRoshPinaOverCivilOpenSegments() throws {
        let database = try IsraelAviationDatabase.bundled()
        let planner = IsraelRoutePlanner(
            points: try database.reportingPoints(in: .wholeCountry),
            segments: try database.routeSegments(in: .wholeCountry)
        )
        let plan = try planner.route(from: "LLHZ", to: "LLIB", cruiseSpeedKnots: 100)
        #expect(plan.pointCodes.first == "LLHZ")
        #expect(plan.pointCodes.last == "LLIB")
        #expect(abs(plan.totalDistanceNM - 68.138) < 0.05)
        #expect(plan.isFileable)
        #expect(plan.legs.allSatisfy { $0.altitude != nil && !$0.segment.isByRequest && !$0.segment.isMilitary })
    }
}
