//
//  IsraelAviationDatabaseTests.swift
//  efb-212Tests
//
//  The bundled israel-aviation.sqlite (tools/caai-importer, CAAI GIS layers, data of 25 Oct 2026):
//  counts against the AIP, known points, segments, airspace limits, the region gate, and the
//  NOTAM closure mapper running on the real network.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel Aviation Database Tests")
struct IsraelAviationDatabaseTests {

    static func bundled() throws -> IsraelAviationDatabase {
        try IsraelAviationDatabase.bundled()
    }

    static func closure(_ chain: [String], id: String) -> IsraelRouteClosure {
        IsraelRouteClosure(notamId: id, routeKind: "CVFR", routeName: nil, chain: chain, validFrom: nil, validTo: nil, schedule: nil)
    }

    // MARK: - Counts (AIP: 198 points, 275 segments, 39 CTR/ATZ, 113 P/R/D, 9 TMA, 42 runways)

    @Test func bundledDataMatchesTheAIPCounts() throws {
        let db = try Self.bundled()
        let whole = IsraelGeoBounds.wholeCountry
        #expect(try db.reportingPoints(in: whole).count == 198)
        #expect(try db.routeSegments(in: whole).count == 275)
        let ctrAtz = try [IsraelAirspaceKind.ctr, .atz, .cta].reduce(0) { $0 + (try db.airspaces(ofKind: $1).count) }
        #expect(ctrAtz == 39)
        let prd = try [IsraelAirspaceKind.prohibited, .restricted, .danger].reduce(0) { $0 + (try db.airspaces(ofKind: $1).count) }
        #expect(prd == 113)
        #expect(try db.airspaces(ofKind: .tma).count == 9)
        #expect(try db.airspaces(ofKind: .fir).count == 1)
        #expect(try db.runways(in: whole).count == 42)
    }

    @Test func everySegmentEndpointResolvesToAPoint() throws {
        let db = try Self.bundled()
        let segments = try db.routeSegments(in: .wholeCountry)
        for segment in segments {
            #expect(db.knowsPoint(segment.fromCode), "\(segment.fromCode) of \(segment.fromCode)-\(segment.toCode)")
            #expect(db.knowsPoint(segment.toCode), "\(segment.toCode) of \(segment.fromCode)-\(segment.toCode)")
        }
    }

    // MARK: - Points

    @Test func knownPointsKeepTheirCoordinatesAndKinds() throws {
        let db = try Self.bundled()
        let tavor = try #require(try db.reportingPoint(code: "TAVOR"))
        #expect(abs(tavor.latitude - 32.690278) < 1e-5)   // degrees
        #expect(abs(tavor.longitude - 35.42) < 1e-5)      // degrees
        #expect(tavor.kind == .onRequest)
        #expect(tavor.nameEnglish == "Kfar Tavor")
        #expect(try #require(try db.reportingPoint(code: "DESHE")).kind == .compulsory)
        let herzliya = try #require(try db.reportingPoint(code: "llhz"))   // lookups ignore case
        #expect(herzliya.kind == .arp)
        #expect(abs(herzliya.latitude - 32.179444) < 1e-5)
        #expect(try db.reportingPoint(code: "NOPE1") == nil)
    }

    @Test func pointsInARegionAreOnlyThoseInsideIt() throws {
        let db = try Self.bundled()
        // A box around Haifa bay: contains HAIFA-area points, not Eilat's.
        let north = IsraelGeoBounds(minLatitude: 32.6, maxLatitude: 33.0, minLongitude: 34.9, maxLongitude: 35.2)
        let points = try db.reportingPoints(in: north)
        #expect(!points.isEmpty)
        #expect(points.allSatisfy { $0.latitude >= 32.6 && $0.latitude <= 33.0 && $0.longitude >= 34.9 && $0.longitude <= 35.2 })
        #expect(points.count < 198)
    }

    @Test func theDuplicateLLNVCodeResolvesToThePointTheRoutesUse() throws {
        let db = try Self.bundled()
        let segment = try #require(try db.routeSegment(from: "LLNV", to: "ARRAD"))
        let point = try #require(try db.reportingPoint(code: "LLNV"))
        #expect(point.id == segment.fromPointID)
    }

    // MARK: - Segments

    @Test func aSegmentCarriesItsAltitudeForBothDirections() throws {
        let db = try Self.bundled()
        let segment = try #require(try db.routeSegment(from: "TAVOR", to: "DESHE"))   // Kfar Tavor - Karey Deshe
        #expect(segment.altitudeForward?.feet == 2500)    // feet MSL, Kfar Tavor -> Karey Deshe (northbound)
        #expect(segment.altitudeReverse?.feet == 3000)    // feet MSL, Karey Deshe -> Kfar Tavor (southbound)
        #expect(abs(segment.bearingTrue - 27.8) < 0.2)    // degrees true
        #expect(segment.isCivil && !segment.isMilitary && !segment.isByRequest)
        #expect(segment.polyline.count >= 2)
        #expect(segment.altitude(forward: false)?.published == "3000")
        // Stored in one direction only: the lookup does not invent the opposite segment.
        #expect(try db.routeSegment(from: "DESHE", to: "TAVOR") == nil)
    }

    @Test func aTwoNumberAltitudeIsKeptAsPublishedWithoutPickingOne() throws {
        let db = try Self.bundled()
        let segment = try #require(try db.routeSegment(from: "HOTRM", to: "DAROM"))
        #expect(segment.altitudeForward?.feet == 1500)
        #expect(segment.altitudeReverse?.published == "1000/2000")
        #expect(segment.altitudeReverse?.feet == nil)
    }

    @Test func theHazerimSegmentsUseTheHazerimCodeNotHazors() throws {
        let db = try Self.bundled()
        #expect(try db.routeSegment(from: "LLHB", to: "OFKIM") != nil)
        #expect(try db.routeSegment(from: "LLHS", to: "OFKIM") == nil)
    }

    @Test func segmentsInARegionIncludeOnlyThoseCrossingIt() throws {
        let db = try Self.bundled()
        let galilee = IsraelGeoBounds(minLatitude: 32.85, maxLatitude: 32.95, minLongitude: 35.50, maxLongitude: 35.56)
        let segments = try db.routeSegments(in: galilee)
        #expect(segments.contains { $0.toCode == "DESHE" || $0.fromCode == "DESHE" })
        #expect(segments.count < 275)
    }

    // MARK: - Airspace

    /// LLP07 Hadera Power Station: prohibited, surface to 2,000 ft MSL, 1 km circle around 322813N 0345311E.
    @Test func pointInAirspaceAtAndOutsideItsCeiling() throws {
        let db = try Self.bundled()
        let centre = CLLocationCoordinate2D(latitude: 32.470278, longitude: 34.886389)
        func codes(_ altitude: Double?) throws -> [String?] {
            try db.airspaces(containing: centre, altitudeFeetMSL: altitude).map(\.code)
        }
        #expect(try codes(0).contains("LLP07"))          // surface
        #expect(try codes(1_000).contains("LLP07"))
        #expect(try codes(2_000).contains("LLP07"))      // at the ceiling
        #expect(try !codes(2_001).contains("LLP07"))     // above it
        #expect(try codes(nil).contains("LLP07"))        // no altitude: lateral only
        let outside = CLLocationCoordinate2D(latitude: 32.52, longitude: 34.886389)   // ~3 NM north
        #expect(try !db.airspaces(containing: outside, altitudeFeetMSL: 1_000).contains { $0.code == "LLP07" })
    }

    /// Ben-Gurion TMA sector "LLBG TMA 6 000 - 9 000".
    @Test func pointInAirspaceAtAndOutsideItsFloor() throws {
        let db = try Self.bundled()
        let inside = CLLocationCoordinate2D(latitude: 32.00194, longitude: 35.08091)
        func inSector(_ altitude: Double) throws -> Bool {
            try db.airspaces(containing: inside, altitudeFeetMSL: altitude).contains { $0.label == "LLBG TMA 6 000 - 9 000" }
        }
        #expect(try !inSector(5_999))   // below the floor
        #expect(try inSector(6_000))    // at the floor
        #expect(try inSector(9_000))    // at the ceiling
        #expect(try !inSector(9_001))   // above it
        let tma = try #require(try db.airspaces(ofKind: .tma).first { $0.label == "LLBG TMA 6 000 - 9 000" })
        #expect(tma.floor.feet == 6000 && tma.floor.reference == .msl)
        #expect(tma.ceiling.feet == 9000 && tma.authority == .civil)
    }

    @Test func surfaceFloorsAndUnlimitedCeilingsAreExplicit() throws {
        let db = try Self.bundled()
        let fir = try #require(try db.airspaces(ofKind: .fir).first)
        #expect(fir.floor.reference == .surface)
        #expect(fir.ceiling.reference == .unlimited)
        #expect(fir.containsAltitude(feetMSL: 45_000))
        let haifaCTR = try #require(try db.airspaces(ofKind: .ctr).first { $0.code == "LLHA" })
        // CAAI publishes 3000/3500 (3500 at weekends): the larger volume is used, the text kept.
        #expect(haifaCTR.ceiling.feet == 3500)
        #expect(haifaCTR.ceiling.publishedText == "3000/3500")
    }

    @Test func nearbyAirspacesIncludeThoseWhoseBoxMeetsTheRadius() throws {
        let db = try Self.bundled()
        let hadera = CLLocationCoordinate2D(latitude: 32.470278, longitude: 34.886389)
        #expect(try db.airspaces(near: hadera, radiusNM: 1).contains { $0.code == "LLP07" })
        let eilat = CLLocationCoordinate2D(latitude: 29.55, longitude: 34.95)
        #expect(try !db.airspaces(near: eilat, radiusNM: 1).contains { $0.code == "LLP07" })
    }

    // MARK: - Runways

    @Test func runwaysCarryDesignatorsAndEnds() throws {
        let db = try Self.bundled()
        let herzliya = try #require(try db.runways(aerodrome: "LLHZ").first)
        #expect(herzliya.designatorA == "11" && herzliya.designatorB == "29")
        #expect(herzliya.lengthMetres == 903)   // metres
        // End A (runway 11) lies north-west of end B (runway 29).
        #expect(herzliya.endA.longitude < herzliya.endB.longitude)
        #expect(try db.runways(aerodrome: "LLBG").count == 3)
    }

    // MARK: - Metadata and attribution

    @Test func metadataNamesTheAmendmentAndCarriesTheAttribution() throws {
        let metadata = try Self.bundled().metadata()
        #expect(metadata.aipAmendment == nil)      // never guessed: the GDBs don't carry it
        #expect(metadata.effectiveDate == nil)
        #expect(metadata.sourceDataDate == "2026-10-25")   // newest GDB zip member timestamp
        #expect(metadata.downloadDate == "2026-11-02")   // the Sportiv zip was saved on 2 Nov
        #expect(metadata.schemaVersion == 3)
        #expect(metadata.attribution == "Aeronautical data: Civil Aviation Authority of Israel (CAAI), data of 25 Oct 2026")
        #expect(metadata.sourceURLs.contains("https://www.gov.il/he/pages/aip?chapterIndex=11"))
    }

    // MARK: - Opening

    @Test func aMissingFileIsReportedAsUnavailableRegionData() throws {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("no-such-\(UUID().uuidString).sqlite")
        do {
            _ = try IsraelAviationDatabase(url: missing)
            Issue.record("expected an error")
        } catch let error as EFBError {
            guard case .regionDataUnavailable(let region) = error else { Issue.record("wrong error \(error)"); return }
            #expect(region == "Israel")
        }
    }

    @Test func aFileThatIsNotTheDatabaseIsReportedAsCorrupted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("garbage-\(UUID().uuidString).sqlite")
        try Data("not a database".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            _ = try IsraelAviationDatabase(url: url)
            Issue.record("expected an error")
        } catch let error as EFBError {
            guard case .databaseCorrupted = error else { Issue.record("wrong error \(error)"); return }
        }
    }

    // MARK: - Region gate (Settings > Region and About)

    @Test func theIsraelGateOpensWithTheBundledDatabase() throws {
        #expect(Region.israel.dataUnavailableError == nil)
        #expect(Region.us.dataUnavailableError == nil)
        let metadata = try Self.bundled().metadata()
        #expect(Region.israel.dataAttribution == metadata.attribution)
        #expect(Region.israel.dataAttribution.contains("data of 25 Oct 2026"))
        #expect(!Region.israel.dataAttribution.contains("amendment"))
        #expect(Region.us.dataAttribution == Region.us.fallbackDataAttribution)
    }

    // MARK: - NOTAM closures on the real network (IL-6 mapper)

    /// "E) CVFR RTE CLSD TAVOR-DESHE" is a live IAA NOTAM line in
    /// docs/research/israel-cvfr-samples/iaa-notam.txt.
    @Test func aRealClosureChainMapsToTheRealSegment() throws {
        let db = try Self.bundled()
        let match = IsraelNotamClosureMapper.match(Self.closure(["TAVOR", "DESHE"], id: "C2251/26"), using: db)
        #expect(match.isFullyMapped)
        let expected = try #require(try db.routeSegment(from: "TAVOR", to: "DESHE"))
        #expect(match.segments == [expected])
        #expect(match.segments.first?.nameEnglish == "Kfar Tavor-Karey Deshe")
    }

    /// Research example "CVFR RTE CLSD GALIM-DAROM-HOTRM-BOREN-FRDIS": the network stores every one
    /// of these legs in the opposite direction, and a closure shuts the route both ways.
    @Test func aClosureChainStoredInTheOppositeDirectionStillMapsEveryLeg() throws {
        let db = try Self.bundled()
        let chain = ["GALIM", "DAROM", "HOTRM", "BOREN", "FRDIS"]
        let match = IsraelNotamClosureMapper.match(Self.closure(chain, id: "C0001/26"), using: db)
        #expect(match.isFullyMapped)
        #expect(match.segments.count == 4)
        #expect(match.segments.map(\.fromCode) == ["DAROM", "HOTRM", "BOREN", "FRDIS"])
    }

    @Test func aClosureWithAnUnpublishedCodeReportsItInsteadOfDroppingIt() throws {
        let db = try Self.bundled()
        let match = IsraelNotamClosureMapper.match(Self.closure(["TAVOR", "ZZZZZ"], id: "C0002/26"), using: db)
        #expect(match.unknownCodes == ["ZZZZZ"])
        #expect(!match.isFullyMapped)
    }
}
