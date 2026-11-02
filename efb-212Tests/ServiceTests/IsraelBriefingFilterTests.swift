//
//  IsraelBriefingFilterTests.swift
//  efb-212Tests
//
//  Flight window, distance, aerodrome filters and the closures-first order of the Israel NOTAM briefing.
//

import Foundation
import Testing
@testable import efb_212

enum BriefingFixtures {
    nonisolated static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    nonisolated static func hours(_ h: Double) -> Date { t0.addingTimeInterval(h * 3600) }

    nonisolated static func closure(
        _ id: String, chain: [String] = ["GALIM", "DAROM"], partial: Bool? = nil, parsed: Bool? = nil
    ) -> IsraelRouteClosure {
        IsraelRouteClosure(
            notamId: id, routeKind: "CVFR", routeName: nil, chain: chain,
            validFrom: nil, validTo: nil, schedule: nil, partial: partial, parsed: parsed)
    }

    nonisolated static func notam(
        _ id: String, location: String = "LLLL", type: String = "NOTAMN", created: Date? = hours(-48),
        from: Date? = hours(-1), to: Date? = hours(2), permanent: Bool = false,
        e: String = "TEXT", circle: (IsraelLatLon, Double)? = nil, polygon: [IsraelLatLon]? = nil,
        closures: [IsraelRouteClosure] = [], cancelledBy: String? = nil
    ) -> IsraelNotam {
        IsraelNotam(
            rowId: "row-\(id)", id: id, type: type, references: nil, location: location, locationDescription: nil,
            created: created, q: nil, a: location, validFrom: from, validTo: to, permanent: permanent, estimated: false,
            d: nil, e: e, f: nil, g: nil,
            geometry: IsraelNotamGeometry(polygon: polygon, circle: circle.map { IsraelNotamCircle(centre: $0.0, radiusNM: $0.1) }),
            closures: closures, parsed: true, cancelledBy: cancelledBy, replacedBy: nil, raw: "RAW \(id)")
    }

    nonisolated static func query(
        window: BriefingWindow = BriefingWindow(start: t0, end: hours(3)),
        reference: BriefingReference = .none, corridor: Double = 25, aerodrome: String = "", route: Set<String> = []
    ) -> BriefingQuery {
        BriefingQuery(window: window, reference: reference, corridorNM: corridor, aerodrome: aerodrome, routeAerodromes: route)
    }
}

@Suite("Israel briefing filter")
struct IsraelBriefingFilterTests {
    private typealias F = BriefingFixtures

    // MARK: Window

    @Test func windowIsDeparturePlusETEWhenPlanned() {
        let route = BriefingRoute(codes: [], points: [], departure: F.hours(5), eteSeconds: 5400)
        let window = BriefingWindow.flight(route: route, now: F.t0)
        #expect(window.start == F.hours(5))
        #expect(window.end == F.hours(6.5))
    }

    @Test func windowDefaultsToNowPlusThreeHoursWithoutAPlan() {
        let noDeparture = BriefingRoute(codes: [], points: [], departure: nil, eteSeconds: nil)
        for route in [nil, noDeparture] {
            let window = BriefingWindow.flight(route: route, now: F.t0)
            #expect(window.start == F.t0)
            #expect(window.end == F.hours(3))
        }
    }

    @Test func validityTouchingTheWindowEdgesCounts() {
        let window = BriefingWindow(start: F.t0, end: F.hours(3))
        #expect(window.includes(F.notam("A", from: F.hours(-5), to: F.t0)))            // ends exactly at start
        #expect(window.includes(F.notam("B", from: F.hours(3), to: F.hours(9))))       // starts exactly at end
        #expect(!window.includes(F.notam("C", from: F.hours(-5), to: F.hours(-0.01)))) // ended before
        #expect(!window.includes(F.notam("D", from: F.hours(3.01), to: F.hours(9))))   // starts after
    }

    @Test func permanentNotamsAreAlwaysIncludedAndOpenEndsAreTreatedAsOpen() {
        let window = BriefingWindow(start: F.t0, end: F.hours(3))
        #expect(window.includes(F.notam("P", from: F.hours(-900), to: F.hours(-800), permanent: true)))
        #expect(window.includes(F.notam("O", from: F.hours(-1), to: nil)))
    }

    // MARK: Order

    @Test func closuresComeFirstFullThenPartialThenCheckThenRouteAerodromesThenTheRest() {
        let notams = [
            F.notam("OTHER", location: "LLBG"),
            F.notam("ROUTE-AD", location: "LLHZ"),
            F.notam("UNDRAWN", e: "ATS RTE J14 CLSD"),
            F.notam("UNPARSED", closures: [F.closure("UNPARSED", parsed: false)]),
            F.notam("PARTIAL", closures: [F.closure("PARTIAL", partial: true)]),
            F.notam("FULL", closures: [F.closure("FULL")]),
        ]
        let rows = IsraelBriefingFilter.rows(from: notams, query: F.query(route: ["LLHZ"]))
        #expect(rows.map(\.notam.id) == ["FULL", "PARTIAL", "UNDRAWN", "UNPARSED", "ROUTE-AD", "OTHER"])
        #expect(rows.map(\.section) == [.closures, .closures, .closures, .closures, .routeAerodromes, .other])
    }

    @Test func aClosureWithNothingDrawableIsMarkedCheckNotam() {
        let rows = IsraelBriefingFilter.rows(from: [F.notam("J14", e: "ATS RTE J14 CLSD")], query: F.query())
        #expect(rows.first?.needsCheck == true)
        #expect(rows.first?.closure == BriefingClosureClass.none)
    }

    @Test func aPlainNotamIsNotMarkedCheck() {
        let rows = IsraelBriefingFilter.rows(from: [F.notam("X", e: "RWY 12 CLSD")], query: F.query())
        #expect(rows.first?.needsCheck == false)
    }

    @Test func supersededAndCancellationNotamsAreDropped() {
        let notams = [
            F.notam("OLD", cancelledBy: "C2/26"),
            F.notam("CANCEL", type: "NOTAMC"),
            F.notam("KEEP"),
        ]
        #expect(IsraelBriefingFilter.rows(from: notams, query: F.query()).map(\.notam.id) == ["KEEP"])
    }

    // MARK: Aerodrome

    @Test func aerodromeFilterMatchesLocationOrMentionInEText() {
        let notams = [
            F.notam("HZ", location: "LLHZ"),
            F.notam("FIR", location: "LLLL", e: "ARR LLHZ PROC CHANGED"),
            F.notam("BG", location: "LLBG"),
        ]
        let rows = IsraelBriefingFilter.rows(from: notams, query: F.query(aerodrome: " llhz "))
        #expect(Set(rows.map(\.notam.id)) == ["HZ", "FIR"])
    }

    // MARK: Distance

    private let ownship = IsraelLatLon(lat: 32.0, lon: 34.8)

    @Test func circleGapIsCentreDistanceMinusRadius() throws {
        // Centre 20 NM due north, radius 5 NM -> 15 NM gap.
        let north = IsraelLatLon(lat: 32.0 + 20.0 / 60.0, lon: 34.8)
        let notam = F.notam("N", circle: (north, 5))
        let gap = try #require(IsraelBriefingFilter.distanceNM(of: notam, from: .ownship(ownship)))
        #expect(abs(gap - 15) < 0.1)
    }

    @Test func corridorKeepsNotamsWithinItAndDropsTheRest() {
        let north = IsraelLatLon(lat: 32.0 + 20.0 / 60.0, lon: 34.8)
        let notams = [F.notam("N", circle: (north, 5))]
        let tight = IsraelBriefingFilter.rows(from: notams, query: F.query(reference: .ownship(ownship), corridor: 10))
        let wide = IsraelBriefingFilter.rows(from: notams, query: F.query(reference: .ownship(ownship), corridor: 20))
        #expect(tight.isEmpty)
        #expect(wide.map(\.notam.id) == ["N"])
        let gap = wide.first?.distanceNM ?? -1
        #expect(abs(gap - 15) < 0.1)
    }

    @Test func notamWithoutAnAreaIsKeptWhenFiltering() {
        let rows = IsraelBriefingFilter.rows(from: [F.notam("NOAREA")], query: F.query(reference: .ownship(ownship), corridor: 5))
        #expect(rows.map(\.notam.id) == ["NOAREA"])
        #expect(rows.first?.distanceNM == nil)
    }

    @Test func polygonCrossedByARouteLegIsInsideEvenWithNoRoutePointInIt() throws {
        let square = [
            IsraelLatLon(lat: 32.05, lon: 34.75), IsraelLatLon(lat: 32.05, lon: 34.85),
            IsraelLatLon(lat: 31.95, lon: 34.85), IsraelLatLon(lat: 31.95, lon: 34.75),
        ]
        let route = BriefingRoute(
            codes: ["A", "B"], points: [IsraelLatLon(lat: 32.0, lon: 34.5), IsraelLatLon(lat: 32.0, lon: 35.1)],
            departure: nil, eteSeconds: nil)
        let gap = try #require(IsraelBriefingFilter.distanceNM(of: F.notam("POLY", polygon: square), from: .route(route)))
        #expect(gap == 0)
    }

    @Test func polygonBesideARouteIsMeasuredToItsNearestEdge() throws {
        // Square 0.1 deg wide whose south edge sits 6 NM north of an east-west route.
        let square = [
            IsraelLatLon(lat: 32.2, lon: 34.75), IsraelLatLon(lat: 32.2, lon: 34.85),
            IsraelLatLon(lat: 32.1, lon: 34.85), IsraelLatLon(lat: 32.1, lon: 34.75),
        ]
        let route = BriefingRoute(
            codes: ["A", "B"], points: [IsraelLatLon(lat: 32.0, lon: 34.5), IsraelLatLon(lat: 32.0, lon: 35.1)],
            departure: nil, eteSeconds: nil)
        let gap = try #require(IsraelBriefingFilter.distanceNM(of: F.notam("POLY", polygon: square), from: .route(route)))
        #expect(abs(gap - 6) < 0.1)
    }

    // MARK: Time text

    @Test func validityShowsLocalAndZuluAndPerm() {
        // 2027-01-15 08:00Z is 10:00 in Israel (UTC+2 in winter).
        let from = Date(timeIntervalSince1970: 1_800_000_000)
        let notam = F.notam("T", from: from, to: from.addingTimeInterval(3600), permanent: false)
        let local = BriefingTimeFormat.validity(for: notam, local: true)
        let zulu = BriefingTimeFormat.validity(for: notam, local: false)
        #expect(local.hasPrefix("LT "))
        #expect(zulu.hasPrefix("UTC "))
        #expect(zulu.contains("Z"))
        #expect(BriefingTimeFormat.validity(for: F.notam("P", permanent: true), local: false).hasSuffix("to PERM"))
    }

    @Test func localTimeIsTwoHoursAheadOfZuluInWinter() {
        let date = Date(timeIntervalSince1970: 1_800_000_000) // 2027-01-15 08:00Z
        #expect(BriefingTimeFormat.zulu(date) == "15 Jan 08:00Z")
        #expect(BriefingTimeFormat.local(date) == "15 Jan 10:00")
    }

    // MARK: Route kind versus the pilot's network (UX-IL, efb-aac.20)

    private static func closure(kind: String, kinds: [String]? = nil) -> IsraelRouteClosure {
        IsraelRouteClosure(
            notamId: "X", routeKind: kind, routeName: nil, chain: ["GALIM", "DAROM"],
            validFrom: nil, validTo: nil, schedule: nil, routeKinds: kinds)
    }

    @Test func aHelOrUltralightRouteClosureIsNotAClosureForACvfrPilot() {
        let hel = F.notam("HEL", closures: [Self.closure(kind: "HEL")])
        let ultralight = F.notam("UL", closures: [Self.closure(kind: "ULTRALIGHT")])
        let ats = F.notam("ATS", closures: [Self.closure(kind: "ATS")])
        let rows = IsraelBriefingFilter.rows(from: [hel, ultralight, ats], query: F.query())

        #expect(rows.allSatisfy { $0.closure == .none && !$0.needsCheck && $0.section == .other })
        #expect(rows.first { $0.notam.id == "HEL" }?.otherRouteKinds == ["HEL"])
        #expect(rows.first { $0.notam.id == "UL" }?.otherRouteKinds == ["ULTRALIGHT"])
    }

    @Test func aClauseThatNamesCvfrAmongOthersStaysRedAndCarriesNoOtherKindLabel() {
        let both = F.notam("BOTH", closures: [Self.closure(kind: "CVFR", kinds: ["CVFR", "HEL"])])
        let row = IsraelBriefingFilter.rows(from: [both], query: F.query()).first
        #expect(row?.closure == .full)
        #expect(row?.section == .closures)
        #expect(row?.otherRouteKinds.isEmpty == true)
    }

    @Test func anUltralightClosureIsRedForAnLsaPilotAndACvfrClosureIsNot() {
        var query = F.query()
        query.network = .lsa
        let ultralight = F.notam("UL", closures: [Self.closure(kind: "ULTRALIGHT")])
        let cvfr = F.notam("CV", closures: [Self.closure(kind: "CVFR")])
        let rows = IsraelBriefingFilter.rows(from: [ultralight, cvfr], query: query)
        #expect(rows.first { $0.notam.id == "UL" }?.closure == .full)
        #expect(rows.first { $0.notam.id == "CV" }?.closure == BriefingClosureClass.none)
        #expect(rows.first { $0.notam.id == "CV" }?.otherRouteKinds == ["CVFR"])
    }

    @Test func aRouteClosureDrawsItsChainNotTheScopeCircleButAnAreaNotamKeepsItsCircle() {
        let lookup: (String) -> IsraelLatLon? = { $0 == "GALIM" ? IsraelLatLon(lat: 32.7, lon: 34.9) : IsraelLatLon(lat: 32.8, lon: 35.0) }
        let route = F.notam("RC", circle: (IsraelLatLon(lat: 32.7, lon: 34.9), 60), closures: [Self.closure(kind: "CVFR")])
        let shapes = IsraelBriefingGeometry.shapes(for: route, pointLookup: lookup)
        #expect(shapes.rings.isEmpty)      // a 60 NM filled disc read as "this whole area is closed"
        #expect(shapes.lines.count == 1)

        let area = F.notam("AR", circle: (IsraelLatLon(lat: 32.7, lon: 34.9), 5))
        #expect(IsraelBriefingGeometry.shapes(for: area, pointLookup: lookup).rings.count == 1)
    }
}
