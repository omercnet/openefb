//
//  IsraelLSADatabaseTests.swift
//  efb-212Tests
//
//  The sport-aviation (LSA) network in the bundled israel-aviation.sqlite: CAAI "Sportiv 2026.zip" imports
//  215 points and 229 routes, kept apart from the CVFR network by the `network` column.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Israel LSA database")
struct IsraelLSADatabaseTests {

    private static func bundled() throws -> IsraelAviationDatabase { try IsraelAviationDatabase.bundled() }

    @Test func lsaNetworkHasTheCounts() throws {
        let db = try Self.bundled()
        let points = try db.reportingPoints(in: .wholeCountry, network: .lsa)
        let segments = try db.routeSegments(in: .wholeCountry, network: .lsa)
        #expect(segments.count == 229)
        #expect(points.count == 215 + 6)  // 215 published points + 6 route ends the points layer does not list
        #expect(points.filter { $0.kind == .unlisted }.map(\.code).sorted() == ["BKRML", "BSARN", "BSARS", "BSHAN", "BSVTA", "MACHR"])
    }

    @Test func theCVFRQueriesNeverSeeLSARows() throws {
        let db = try Self.bundled()
        #expect(try db.reportingPoints(in: .wholeCountry).count == 198)
        #expect(try db.routeSegments(in: .wholeCountry).count == 275)
        #expect(try db.routeSegment(from: "AAKKO", to: "GALIM") == nil)           // an LSA-only route
        #expect(try db.routeSegment(from: "AAKKO", to: "GALIM", network: .lsa) != nil)
        #expect(try db.reportingPoint(code: "AFULA", network: .lsa) == nil)        // a CVFR-only point
        #expect(try db.reportingPoint(code: "AFULA") != nil)
    }

    @Test func aCodeInBothNetworksResolvesToThatNetworksPoint() throws {
        let db = try Self.bundled()
        let cvfr = try #require(try db.reportingPoint(code: "LLRS", network: .cvfr))
        let lsa = try #require(try db.reportingPoint(code: "LLRS", network: .lsa))
        #expect(cvfr.network == .cvfr && lsa.network == .lsa)
        #expect(cvfr.id != lsa.id)
    }

    @Test func everyLSASegmentEndsAtPointsOfItsOwnNetwork() throws {
        let db = try Self.bundled()
        let points = Dictionary(uniqueKeysWithValues: try db.reportingPoints(in: .wholeCountry, network: .lsa).map { ($0.id, $0) })
        for segment in try db.routeSegments(in: .wholeCountry, network: .lsa) {
            #expect(segment.network == .lsa)
            #expect(points[segment.fromPointID]?.code == segment.fromCode, "\(segment.fromCode)-\(segment.toCode)")
            #expect(points[segment.toPointID]?.code == segment.toCode, "\(segment.fromCode)-\(segment.toCode)")
            #expect(segment.polyline.count >= 2)
        }
    }

    @Test func activityComesFromTheLayersLocalType() throws {
        let segments = try Self.bundled().routeSegments(in: .wholeCountry, network: .lsa)
        func count(_ activity: IsraelRouteActivity) -> Int { segments.filter { $0.activity == activity }.count }
        #expect(count(.allWeek) == 96)
        #expect(count(.weekend) == 92)
        #expect(count(.special) == 39)
        #expect(count(.unspecified) == 2)  // 'C' and 'AllWeek/Weekend': kept verbatim, never guessed
        let odd = segments.filter { $0.activity == .unspecified }.compactMap(\.activitySource).sorted()
        #expect(odd == ["AllWeek/Weekend", "C"])
    }

    @Test func oneWayRoutesPublishNoReverseAltitude() throws {
        let db = try Self.bundled()
        let oneWay = try #require(try db.routeSegment(from: "ESTOL", to: "LTRUN", network: .lsa))
        #expect(oneWay.altitudeForward?.feet == 2200)
        #expect(oneWay.altitudeReverse == nil)
        #expect(oneWay.activity == .weekend)
        #expect(oneWay.isByRequest)
        let twoWay = try #require(try db.routeSegment(from: "HADRA", to: "ORAKV", network: .lsa))
        #expect(twoWay.altitudeForward?.feet == 1000)
        #expect(twoWay.altitudeReverse?.feet == 400)
        #expect(twoWay.activity == .allWeek)
        #expect(try db.routeSegments(in: .wholeCountry, network: .lsa).filter { $0.altitudeReverse == nil }.count == 21)
    }

    @Test func weekendRuleIsStoredAsPublishedText() throws {
        let rule = try #require(try Self.bundled().metadata().lsaWeekendRule)
        #expect(rule.fridayStartDefault == "06:00")
        #expect(rule.fridayStartLatestPublished == "14:00")
        #expect(rule.holidayEveStart == "14:00")
        #expect(rule.textHebrew.contains("ימי שישי"))
        #expect(rule.source.contains("B-08"))
    }
}
