//
//  BundledAirportQueriesTests.swift
//  efb-212Tests
//
//  Queries the real bundled aviation.sqlite (installed into a temp directory exactly as the app
//  does) to catch importer regressions the synthetic-schema tests cannot: missing airports,
//  broken runway joins, search that no longer finds a well-known identifier.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Bundled Airport Queries Tests")
struct BundledAirportQueriesTests {

    private final class BundleToken {}

    static func makeDatabase() throws -> AviationDatabase {
        let url = try #require(
            Bundle.main.url(forResource: "aviation", withExtension: "sqlite")
                ?? Bundle(for: BundleToken.self).url(forResource: "aviation", withExtension: "sqlite"),
            "aviation.sqlite is not bundled"
        )
        let installDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("efb-bundled-\(UUID().uuidString)", isDirectory: true)
        return try AviationDatabase(bundledURL: url, installDirectory: installDir,
                                    dataVersion: AviationDatabase.bundledDataVersion)
    }

    static let kpaoCoord = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

    @Test func kpaoHasRunwaysAndPlausibleFields() throws {
        let kpao = try #require(try Self.makeDatabase().airport(byICAO: "KPAO"))
        #expect(!kpao.runways.isEmpty)
        #expect(kpao.runways.allSatisfy { $0.length > 0 })   // feet
        #expect(abs(kpao.latitude - 37.46) < 0.05)
        #expect(abs(kpao.longitude + 122.11) < 0.05)
        #expect(abs(kpao.elevation - 4) < 10)                // feet MSL
    }

    @Test func nearestToKPAOStartsWithKPAOThenAscendsInDistance() throws {
        let nearest = try Self.makeDatabase().nearestAirports(to: Self.kpaoCoord, count: 6)
        #expect(nearest.count == 6)
        #expect(nearest.first?.icao == "KPAO")

        let origin = CLLocation(latitude: Self.kpaoCoord.latitude, longitude: Self.kpaoCoord.longitude)
        let distances = nearest.map { origin.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude)) }
        #expect(distances == distances.sorted())
    }

    @Test func searchFindsWellKnownAirportsByIdentifierAndName() throws {
        let db = try Self.makeDatabase()
        #expect(try db.searchAirports(query: "KSQL", limit: 5).map(\.icao).contains("KSQL"))
        #expect(try db.searchAirports(query: "San Carlos", limit: 10).map(\.icao).contains("KSQL"))
    }

    @Test func everyAirportInAPacificBoxIsInsideValidCoordinateRanges() throws {
        // Whole-world box via the R-tree: every returned row must have legal coordinates.
        let all = try Self.makeDatabase().airports(
            near: CLLocationCoordinate2D(latitude: 37.5, longitude: -122.0), radiusNM: 300)
        #expect(all.count > 50)
        #expect(all.allSatisfy { (-90.0...90.0).contains($0.latitude) && (-180.0...180.0).contains($0.longitude) })
        #expect(all.allSatisfy { (-300.0...15000.0).contains($0.elevation) })   // feet MSL
        #expect(Set(all.map(\.icao)).count == all.count)
    }
}
