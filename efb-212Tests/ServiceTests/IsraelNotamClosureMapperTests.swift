//
//  IsraelNotamClosureMapperTests.swift
//  efb-212Tests
//
//  Closure chains → route segments, against a mock network. IL-1's IsraelAviationDatabase
//  conforms to IsraelRouteSegmentLookup later; these tests pin the mapping rules.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Israel NOTAM Closure Mapper Tests")
struct IsraelNotamClosureMapperTests {

    /// A small network: GALIM → DAROM → HOTRM, stored in one direction only, plus ATLIT.
    nonisolated struct MockNetwork: IsraelRouteSegmentLookup {
        let points: Set<String>
        let segments: [String: String]  // "FROM>TO" → segment id

        func knowsPoint(_ code: String) -> Bool { points.contains(code) }
        func segment(from: String, to: String) -> String? { segments["\(from)>\(to)"] }
    }

    static let network = MockNetwork(
        points: ["GALIM", "DAROM", "HOTRM", "ATLIT", "FRDIS"],
        segments: ["GALIM>DAROM": "S1", "DAROM>HOTRM": "S2", "HOTRM>FRDIS": "S3"]
    )

    static func closure(_ chain: [String], id: String = "C2267/26", from: TimeInterval? = nil, to: TimeInterval? = nil) -> IsraelRouteClosure {
        IsraelRouteClosure(
            notamId: id, routeKind: "CVFR", routeName: nil, chain: chain,
            validFrom: from.map { Date(timeIntervalSince1970: $0) }, validTo: to.map { Date(timeIntervalSince1970: $0) }, schedule: nil)
    }

    @Test func mapsEveryLegOfAChainInOrder() {
        let match = IsraelNotamClosureMapper.match(Self.closure(["GALIM", "DAROM", "HOTRM", "FRDIS"]), using: Self.network)
        #expect(match.segments == ["S1", "S2", "S3"])
        #expect(match.isFullyMapped)
        #expect(match.unknownCodes.isEmpty)
        #expect(match.unmatchedLegs.isEmpty)
    }

    @Test func aClosureShutsTheRouteBothWaysSoAReversedStoredSegmentStillMatches() {
        // Chain written HOTRM-DAROM; the network stores DAROM>HOTRM.
        let match = IsraelNotamClosureMapper.match(Self.closure(["HOTRM", "DAROM"]), using: Self.network)
        #expect(match.segments == ["S2"])
        #expect(match.isFullyMapped)
    }

    @Test func unknownCodesAreReportedNotDropped() {
        let match = IsraelNotamClosureMapper.match(Self.closure(["GALIM", "DAROM", "ZZZZZ", "YYYYY", "ZZZZZ"]), using: Self.network)
        #expect(match.unknownCodes == ["ZZZZZ", "YYYYY"])  // once each, chain order
        #expect(match.segments == ["S1"])  // the leg that could be placed is still mapped
        #expect(match.isFullyMapped == false)
        #expect(match.closure.chain.count == 5)  // the closure itself is kept whole
    }

    @Test func knownPointsWithoutASegmentBetweenThemAreUnmatchedLegs() {
        // ATLIT and DAROM exist but no published segment joins them.
        let match = IsraelNotamClosureMapper.match(Self.closure(["DAROM", "ATLIT"]), using: Self.network)
        #expect(match.segments.isEmpty)
        #expect(match.unmatchedLegs == [IsraelClosureLeg(from: "DAROM", to: "ATLIT")])
        #expect(match.unknownCodes.isEmpty)
        #expect(match.isFullyMapped == false)
    }

    @Test func aLegWithAnUnknownEndIsReportedOnceAsUnknownNotAlsoAsUnmatched() {
        let match = IsraelNotamClosureMapper.match(Self.closure(["GALIM", "ZZZZZ"]), using: Self.network)
        #expect(match.unknownCodes == ["ZZZZZ"])
        #expect(match.unmatchedLegs.isEmpty)
    }

    @Test func aSinglePointChainHasNoLegs() {
        let match = IsraelNotamClosureMapper.match(Self.closure(["GALIM"]), using: Self.network)
        #expect(match.segments.isEmpty)
        #expect(match.isFullyMapped)
    }

    @Test func mappingAggregatesSegmentsAndUnresolvedClosuresAcrossNotams() {
        let closures = [
            Self.closure(["GALIM", "DAROM"], id: "C1111/26"),
            Self.closure(["GALIM", "DAROM", "HOTRM"], id: "C2222/26"),  // S1 closed twice
            Self.closure(["DAROM", "QQQQQ"], id: "C3333/26"),
        ]
        let mapping = IsraelNotamClosureMapper.map(closures, using: Self.network)
        #expect(mapping.matches.count == 3)
        #expect(mapping.closedSegments == ["S1", "S2"])
        #expect(mapping.unknownCodes == ["QQQQQ"])
        #expect(mapping.unresolved.map(\.closure.notamId) == ["C3333/26"])
    }

    @Test func dateFilterKeepsOnlyClosuresValidAtThatTime() {
        let closures = [
            Self.closure(["GALIM", "DAROM"], id: "C0001/26", from: 100, to: 200),  // over
            Self.closure(["DAROM", "HOTRM"], id: "C0002/26", from: 100, to: 400),  // active
            Self.closure(["HOTRM", "FRDIS"], id: "C0003/26", from: 500, to: 600),  // not yet
            Self.closure(["GALIM", "DAROM"], id: "C0004/26", from: 100, to: nil),  // permanent
        ]
        let at = Date(timeIntervalSince1970: 300)
        let mapping = IsraelNotamClosureMapper.map(closures, using: Self.network, at: at)
        #expect(mapping.matches.map(\.closure.notamId) == ["C0002/26", "C0004/26"])
        #expect(mapping.closedSegments == ["S1", "S2"])

        let all = IsraelNotamClosureMapper.map(closures, using: Self.network)
        #expect(all.matches.count == 4)
    }

    @Test func mappingNothingGivesAnEmptyResult() {
        let mapping = IsraelNotamClosureMapper.map([], using: Self.network)
        #expect(mapping.matches.isEmpty)
        #expect(mapping.closedSegments.isEmpty)
        #expect(mapping.unresolved.isEmpty)
    }
}
