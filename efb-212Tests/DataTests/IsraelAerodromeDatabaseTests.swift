//
//  IsraelAerodromeDatabaseTests.swift
//  efb-212Tests
//
//  The curated aerodromes in the bundled israel-aviation.sqlite (IL-4): every CAAI ARP point and runway
//  resolves to one, nearest and search (ICAO, English, Hebrew) behave, runways and frequencies come with
//  their units and sources, and nothing is marked reviewed before the owner has checked it.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel Aerodrome Database Tests")
struct IsraelAerodromeDatabaseTests {

    static func bundled() throws -> IsraelAviationDatabase {
        try IsraelAviationDatabase.bundled()
    }

    static let herzliya = CLLocationCoordinate2D(latitude: 32.1794, longitude: 34.8344)   // LLHZ ARP

    // MARK: - Coverage

    @Test func everyCAAIReferencePointAndRunwayResolvesToAnAerodrome() throws {
        let db = try Self.bundled()
        let points = try db.reportingPoints(in: .wholeCountry).filter { $0.kind == .arp }
        #expect(points.count == 25)
        for point in points {
            let aerodrome = try db.aerodrome(code: point.code)
            #expect(aerodrome != nil, "ARP point \(point.code) has no aerodrome")
        }
        for runway in try db.runways(in: .wholeCountry) {
            guard let code = runway.aerodrome else { continue }
            #expect(try db.aerodrome(code: code) != nil, "runway row of \(code) has no aerodrome")
        }
    }

    @Test func theTableHoldsAirportsAirstripsAndHeliports() throws {
        let all = try Self.bundled().aerodromes(in: .wholeCountry)
        #expect(all.count == 49)
        #expect(Set(all.map(\.type)) == [.airport, .airstrip, .heliport])
        #expect(Set(all.map(\.code)).count == all.count)
    }

    // MARK: - Nearest

    @Test func nearestFromHerzliyaIsHerzliyaThenTheCoastalFields() throws {
        // Every kind is returned: Herzliya, the Tel Aviv hospital pads and Rishon come before Ben Gurion.
        let nearest = try Self.bundled().nearestAerodromes(to: Self.herzliya, count: 10)
        #expect(nearest.count == 10)
        #expect(nearest.first?.code == "LLHZ")
        #expect(nearest.map(\.code).contains("LLBG"))
        #expect(!nearest.map(\.code).contains("LLHA"))
        let origin = CLLocation(latitude: Self.herzliya.latitude, longitude: Self.herzliya.longitude)
        let distances = nearest.map { CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: origin) }   // metres
        #expect(distances == distances.sorted())
    }

    @Test func nearestFromEilatFindsEilatAndHonoursTheCount() throws {
        let eilat = CLLocationCoordinate2D(latitude: 29.56, longitude: 34.95)
        let nearest = try Self.bundled().nearestAerodromes(to: eilat, count: 6)
        #expect(nearest.count == 6)
        #expect(nearest.map(\.code).contains("LLER"))
        #expect(try Self.bundled().nearestAerodromes(to: eilat, count: 0).isEmpty)
    }

    // MARK: - Search

    @Test func searchFindsByHebrewName() throws {
        let db = try Self.bundled()
        #expect(try db.searchAerodromes(query: "הרצליה", limit: 5).first?.code == "LLHZ")
        #expect(try db.searchAerodromes(query: "הבונים", limit: 5).map(\.code) == ["LLBO"])
        #expect(try db.searchAerodromes(query: "עין", limit: 10).map(\.code).contains("LLEY"))
    }

    @Test func searchFindsByEnglishNameAndIgnoresCase() throws {
        let db = try Self.bundled()
        #expect(try db.searchAerodromes(query: "herzliya", limit: 5).first?.code == "LLHZ")
        #expect(try db.searchAerodromes(query: "KIRYAT", limit: 5).first?.code == "LLKS")
    }

    @Test func searchByCodeRanksExactThenPrefix() throws {
        let db = try Self.bundled()
        let exact = try db.searchAerodromes(query: "llhz", limit: 5)
        #expect(exact.first?.code == "LLHZ")
        let prefix = try db.searchAerodromes(query: "LLH", limit: 10)
        #expect(prefix.map(\.code).contains("LLHA"))
        #expect(prefix.map(\.code).contains("LLHZ"))
        #expect(prefix.allSatisfy { $0.code.hasPrefix("LLH") || $0.nameEnglish.lowercased().contains("llh") || $0.nameHebrew.contains("LLH") })
    }

    @Test func searchTreatsWildcardsAsPlainText() throws {
        let db = try Self.bundled()
        #expect(try db.searchAerodromes(query: "%", limit: 50).isEmpty)
        #expect(try db.searchAerodromes(query: "_", limit: 50).isEmpty)
        #expect(try db.searchAerodromes(query: "   ", limit: 50).isEmpty)
        #expect(try db.searchAerodromes(query: "zzzz-no-such-field", limit: 50).isEmpty)
    }

    @Test func searchHonoursTheLimit() throws {
        #expect(try Self.bundled().searchAerodromes(query: "LL", limit: 3).count == 3)
    }

    // MARK: - Values with their units

    @Test func herzliyaCarriesRunwayFrequenciesCircuitAndSources() throws {
        let herzliya = try #require(try Self.bundled().aerodrome(code: "llhz"))
        #expect(herzliya.type == .airport && herzliya.use == .civil)
        #expect(herzliya.elevationFeet == 121)   // feet MSL
        #expect(abs(herzliya.latitude - 32.179444) < 1e-5 && abs(herzliya.longitude - 34.834444) < 1e-5)   // degrees
        let runway = try #require(herzliya.runways.first)
        #expect(herzliya.runways.count == 1)
        #expect(runway.designator == "10/28")
        #expect(runway.lengthMetres == 903 && runway.widthMetres == 18)   // metres
        #expect(runway.surface == "asphalt")
        #expect(runway.headingIsTrue == true && runway.headingA == 104.12)
        #expect(runway.lengthFeet == 2963)   // feet
        let tower = try #require(herzliya.frequencies.first { $0.mhz == "122.200" })
        #expect(tower.service.hasPrefix("TWR"))
        #expect(tower.callsignHebrew == "מגדל הרצליה")
        #expect(herzliya.circuitAltitudeFeet == 800)   // feet MSL (QNH)
        #expect(herzliya.sources.identity.contains("p209"))
        #expect(herzliya.sources.runways?.contains("p211") == true)
    }

    @Test func belowSeaLevelFieldsKeepNegativeElevationAndMagneticHeadings() throws {
        let db = try Self.bundled()
        let masada = try #require(try db.aerodrome(code: "LLMZ"))
        #expect(masada.elevationFeet == -1233)   // feet MSL
        #expect(masada.circuitAltitudeFeet == -400)   // feet MSL
        #expect(masada.runways.first?.headingIsTrue == false)
        #expect(masada.ppr == .yes)
        let yahav = try #require(try db.aerodrome(code: "LLEY"))
        #expect(yahav.elevationFeet == -177)
    }

    @Test func militaryFieldsAreMarkedAndHaveNoCivilData() throws {
        let tel = try #require(try Self.bundled().aerodrome(code: "LLEK"))
        #expect(tel.use == .military)
        #expect(tel.frequencies.isEmpty)
        #expect(tel.uncertainGroups.contains("runways"))
        #expect(tel.runways.allSatisfy { $0.designator == "?" })
    }

    @Test func agriculturalStripsHaveAPositionAndNoInventedRunway() throws {
        let gvulot = try #require(try Self.bundled().aerodrome(code: "GVULT"))
        #expect(gvulot.use == .agricultural && gvulot.type == .airstrip)
        #expect(gvulot.runways.isEmpty)
        #expect(gvulot.elevationFeet == nil)
        #expect(gvulot.ppr == .yes)
    }

    // MARK: - Review status

    @Test func nothingIsReviewedUntilTheOwnerChecksIt() throws {
        let all = try Self.bundled().aerodromes(in: .wholeCountry)
        #expect(all.allSatisfy { $0.reviewStatus == .unreviewed && !$0.isReviewed })
    }

    @Test func everyValueGroupNamesItsSource() throws {
        for aerodrome in try Self.bundled().aerodromes(in: .wholeCountry) {
            #expect(!aerodrome.sources.identity.isEmpty, "\(aerodrome.code) identity")
            if !aerodrome.runways.isEmpty { #expect(aerodrome.sources.runways != nil, "\(aerodrome.code) runways") }
            if !aerodrome.frequencies.isEmpty { #expect(aerodrome.sources.frequencies != nil, "\(aerodrome.code) frequencies") }
            if aerodrome.hours != nil { #expect(aerodrome.sources.hours != nil, "\(aerodrome.code) hours") }
            if aerodrome.circuitAltitudeFeet != nil { #expect(aerodrome.sources.circuit != nil, "\(aerodrome.code) circuit") }
        }
    }

    @Test func rtreeBoundsFindTheFieldsInsideTheBox() throws {
        let db = try Self.bundled()
        let box = IsraelGeoBounds(center: Self.herzliya, radiusNM: 3)
        #expect(try db.aerodromes(in: box).map(\.code).contains("LLHZ"))
        #expect(try db.aerodromes(in: IsraelGeoBounds(minLatitude: 0, maxLatitude: 1, minLongitude: 0, maxLongitude: 1)).isEmpty)
    }
}
