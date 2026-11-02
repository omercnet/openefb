//
//  IsraelFlightPlanMessageTests.swift
//  efb-212Tests
//
//  IL-PLAN: golden FPL text (AIP A-11 appendix format), ZZZZ with DEP/ and DEST/, the 4X prefix,
//  the Hebrew summary, and the checks that block filing.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel flight plan message")
struct IsraelFlightPlanMessageTests {

    // MARK: Fixtures

    private static func point(_ id: Int, _ code: String, _ kind: IsraelPointKind = .compulsory, he: String? = nil) -> IsraelReportingPoint {
        IsraelReportingPoint(id: id, code: code, nameEnglish: code, nameHebrew: he, kind: kind,
                             latitude: 32.0 + Double(id) * 0.01, longitude: 34.8)
    }

    private static func segment(_ id: Int, _ from: IsraelReportingPoint, _ to: IsraelReportingPoint, nm: Double = 10,
                                forward: String? = "1500", reverse: String? = "2000",
                                byRequest: Bool = false, military: Bool = false) -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: from.code, toCode: to.code, fromPointID: from.id, toPointID: to.id,
            nameEnglish: nil, nameHebrew: nil, lengthNM: nm, isCivil: !military, isMilitary: military, isByRequest: byRequest,
            bearingTrue: 0,
            altitudeForward: forward.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            altitudeReverse: reverse.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            lowerAltitudeFeet: nil, mapSheet: nil, polyline: [from.coordinate, to.coordinate]
        )
    }

    /// 29 Sep 2022 11:00 UTC, the AIP's example departure.
    private static let departure = Date(timeIntervalSince1970: 1_664_449_200)

    private static func route(_ stops: [IsraelReportingPoint]) throws -> IsraelRoutePlan {
        let segments = zip(stops, stops.dropFirst()).enumerated().map { segment($0.offset + 1, $0.element.0, $0.element.1) }
        let planner = IsraelRoutePlanner(points: stops, segments: segments)
        return try planner.route(from: stops[0].code, to: stops[stops.count - 1].code, cruiseSpeedKnots: 90)
    }

    private static func input(registration: String = "HLH", type: String? = "ULAC", typeText: String? = nil) -> IsraelFlightPlanInput {
        IsraelFlightPlanInput(
            registration: registration, typeDesignator: type, typeDescription: typeText,
            cruiseSpeedKnots: 90, enduranceSeconds: 4 * 3600, personsOnBoard: 2, departure: departure,
            picName: "Israel Israeli", licenseNumber: "1234", phone: "054-123 4567"
        )
    }

    // MARK: FPL text

    @Test func goldenMessageMatchesTheAIPExampleLayout() throws {
        let plan = try Self.route([Self.point(1, "LLRS", .arp), Self.point(2, "NTAIM"), Self.point(3, "NSHRM"), Self.point(4, "LLMG", .arp)])
        let expected = """
        (FPL-4XHLH-VG
        -ULAC/L-S/C
        -LLRS1100
        -N0090VFR NTAIM NSHRM
        -LLMG0020
        -DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567
        -E/0400 P/002)
        """
        #expect(IsraelFlightPlanMessage.fpl(plan: plan, input: Self.input()) == expected)
    }

    @Test func nonICAOStripsUseZZZZWithDepAndDestInField18() throws {
        let plan = try Self.route([Self.point(1, "GVULT", .arp), Self.point(2, "NTAIM"), Self.point(3, "KKDEM", .arp)])
        let expected = """
        (FPL-4XABC-VG
        -C172/L-S/C
        -ZZZZ1100
        -N0090VFR NTAIM
        -ZZZZ0014
        -DEP/GVULT DEST/KKDEM DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567
        -E/0400 P/002)
        """
        #expect(IsraelFlightPlanMessage.fpl(plan: plan, input: Self.input(registration: "ABC", type: "C172")) == expected)
    }

    @Test func mixedICAOAndStripKeepsTheICAOCodeAndZZZZOnlyWhereNeeded() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "GVULT", .arp)])
        let text = IsraelFlightPlanMessage.fpl(plan: plan, input: Self.input())
        #expect(text.contains("\n-LLHZ1100\n"))
        #expect(text.contains("\n-N0090VFR DCT\n"))
        #expect(text.contains("\n-ZZZZ0007\n"))
        #expect(text.contains("-DEST/GVULT DOF/220929 RMK/"))
        #expect(!text.contains("DEP/"))
    }

    @Test func missingTypeDesignatorFallsBackToZZZZWithTYP() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        let text = IsraelFlightPlanMessage.fpl(plan: plan, input: Self.input(type: nil, typeText: "Cessna 172SP"))
        #expect(text.contains("\n-ZZZZ/L-S/C\n"))
        #expect(text.contains("-TYP/CESSNA 172SP DOF/220929 RMK/"))
    }

    @Test func missingEnduranceAndPersonsAreOmittedNotInvented() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        var input = Self.input()
        input.enduranceSeconds = nil
        input.personsOnBoard = nil
        let text = IsraelFlightPlanMessage.fpl(plan: plan, input: input)
        #expect(text.hasSuffix("CELL 0541234567)"))
        #expect(!text.contains("E/"))
        #expect(!text.contains("P/"))
    }

    @Test func registrationGetsThe4XPrefixOnlyWhenShort() {
        #expect(IsraelFlightPlanMessage.registrationField("HLH") == "4XHLH")
        #expect(IsraelFlightPlanMessage.registrationField("4X-HLH") == "4XHLH")
        #expect(IsraelFlightPlanMessage.registrationField("4xabc") == "4XABC")
        #expect(IsraelFlightPlanMessage.registrationField("N4543A") == "N4543A")
    }

    @Test func icaoLocationMeansFourLettersStartingLL() {
        #expect(IsraelFlightPlanMessage.isICAOLocation("LLHZ"))
        #expect(!IsraelFlightPlanMessage.isICAOLocation("GVULT"))
        #expect(!IsraelFlightPlanMessage.isICAOLocation("NAAN"))
        #expect(!IsraelFlightPlanMessage.isICAOLocation("KSQL"))
    }

    // MARK: Hebrew summary

    @Test func hebrewSummaryUsesLocalIsraelTimeAndHebrewNames() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp, he: "הרצליה"), Self.point(2, "NTAIM"), Self.point(3, "LLIB", .arp, he: "ראש פינה")])
        let text = IsraelFlightPlanMessage.hebrewSummary(plan: plan, input: Self.input())
        // 11:00 UTC on 29 Sep 2022 is 14:00 in Israel (IDT); 20 NM at 90 kt lands 14:13.
        let f = "\u{2068}", p = "\u{2069}"
        #expect(text == """
        תכנית טיסה בנתיבי התובלה הנמוכים
        המראה: \(f)הרצליה\(p), \(f)29.09.2022\(p) בשעה \(f)14:00\(p) זמן מקומי
        נתיב: \(f)הרצליה\(p) - \(f)NTAIM\(p) - \(f)ראש פינה\(p)
        נחיתה: \(f)ראש פינה\(p) בשעה \(f)14:13\(p) זמן מקומי
        """)
    }

    // MARK: Validation

    @Test func cleanRouteWithFullProfilesHasNoIssuesAndCanBeFiled() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        let issues = IsraelFlightPlanValidator.validate(plan: plan, input: Self.input())
        #expect(issues.isEmpty)
        #expect(IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func byRequestAndMilitarySegmentsBlockFiling() throws {
        let a = Self.point(1, "A"), b = Self.point(2, "B"), c = Self.point(3, "C")
        let planner = IsraelRoutePlanner(points: [a, b, c], segments: [
            Self.segment(1, a, b, byRequest: true), Self.segment(2, b, c, military: true)
        ])
        let plan = try planner.route(from: "A", to: "C", cruiseSpeedKnots: 90,
                                     options: IsraelRouteOptions(allowByRequest: true, allowMilitary: true))
        let issues = IsraelFlightPlanValidator.validate(plan: plan)
        #expect(issues.map(\.kind) == [.byRequestSegment("A-B"), .militarySegment("B-C")])
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func wrongWayLegBlocksFiling() {
        let a = Self.point(1, "A"), b = Self.point(2, "B")
        let oneWay = Self.segment(1, a, b, forward: "1500", reverse: nil)
        // A hand-built plan flying B -> A against the published direction.
        let leg = IsraelRouteLeg(segment: oneWay, from: b, to: a, forward: false, altitude: nil,
                                 distanceNM: 10, eteSeconds: 400, cautions: [])
        let issues = IsraelFlightPlanValidator.validate(plan: IsraelRoutePlan(legs: [leg], cruiseSpeedKnots: 90))
        #expect(issues.map(\.kind) == [.wrongWay("B-A")])
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func closedSegmentBlocksFilingEvenWhenThePlanWasBuiltBeforeTheNotam() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        let segmentID = try #require(plan.legs.first?.segment.id)
        let issues = IsraelFlightPlanValidator.validate(plan: plan, closures: [segmentID: .full(notamID: "C1/26")])
        #expect(issues.map(\.kind) == [.closedSegment("LLHZ-LLIB (C1/26)")])
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func partialClosureWarnsWithoutBlocking() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        let segmentID = try #require(plan.legs.first?.segment.id)
        let issues = IsraelFlightPlanValidator.validate(plan: plan, closures: [segmentID: .partial(notamID: "C2/26", text: "CLSD 2000")])
        #expect(issues.isEmpty)
    }

    @Test func uncheckedClosuresAndMissingProfileFieldsWarnButDoNotBlock() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        var input = Self.input()
        input.enduranceSeconds = nil
        input.phone = nil
        let issues = IsraelFlightPlanValidator.validate(plan: plan, closuresChecked: false, input: input)
        #expect(issues.map(\.kind) == [.closuresNotChecked, .missingAircraftField("endurance"), .missingPilotField("phone")])
        #expect(IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func missingRegistrationBlocksFilingBecauseTheMessageHasNoAircraftId() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        let issues = IsraelFlightPlanValidator.validate(plan: plan, input: Self.input(registration: ""))
        #expect(issues.map(\.kind) == [.missingAircraftField("registration")])
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }

    @Test func missingPilotNameBlocksFiling() throws {
        let plan = try Self.route([Self.point(1, "LLHZ", .arp), Self.point(2, "LLIB", .arp)])
        var input = Self.input()
        input.picName = "  "
        let issues = IsraelFlightPlanValidator.validate(plan: plan, input: input)
        #expect(issues.map(\.kind) == [.missingPilotField("name")])
        #expect(!IsraelFlightPlanValidator.canFile(issues))
    }
}
