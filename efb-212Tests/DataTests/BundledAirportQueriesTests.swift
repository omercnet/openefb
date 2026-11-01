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
@MainActor
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

    // MARK: - NASR data (efb-chx)

    @Test func ownershipAndMagneticVariationAreRealNotDefaults() throws {
        let db = try Self.makeDatabase()
        let kpao = try #require(try db.airport(byICAO: "KPAO"))
        #expect(kpao.ownership == .publicOwned)
        // NASR MAG_VARN 15E in 1995 epoch: east is positive.
        #expect(try #require(kpao.magneticVariation) == 15)
        #expect(try #require(try db.airport(byICAO: "KSQL")).patternAltitude == 800)   // feet AGL

        // The OurAirports import marked every field public: all three classes must now exist.
        let ownership = try BundledAviationDataTests.distinctValues(table: "airports", column: "ownership")
        #expect(ownership["public", default: 0] > 1000)
        #expect(ownership["private", default: 0] > 1000)
        #expect(ownership["military", default: 0] > 50)
        #expect(ownership.keys.allSatisfy { OwnershipType(rawValue: $0) != nil })

        // Nearest list flags private fields: the PVT tag keys off this predicate.
        let nearby = try db.airports(near: Self.kpaoCoord, radiusNM: 30)
        #expect(nearby.contains { LandableAirportFilter.isPrivateUse($0) })
    }

    @Test func kpaoRunwayEndsMatchNASRSurveyWithinAMeter() throws {
        let kpao = try #require(try Self.makeDatabase().airport(byICAO: "KPAO"))
        let runway = try #require(kpao.runways.first { $0.id == "13/31" })
        // FAA NASR APT_RWY_END, cycle 2026-10-29 (degrees).
        let nasr13 = CLLocation(latitude: 37.46375061, longitude: -122.11765513)
        let nasr31 = CLLocation(latitude: 37.45849213, longitude: -122.11243811)
        let base = CLLocation(latitude: runway.baseEndLatitude, longitude: runway.baseEndLongitude)
        let reciprocal = CLLocation(latitude: runway.reciprocalEndLatitude, longitude: runway.reciprocalEndLongitude)
        #expect(base.distance(from: nasr13) < 1)         // meters
        #expect(reciprocal.distance(from: nasr31) < 1)   // meters
    }

    @Test func dataCycleIsOneNASR28DayCycle() throws {
        let cycle = try #require(try Self.makeDatabase().dataCycle())
        #expect(cycle.source.contains("NASR"))
        let days = Calendar(identifier: .gregorian).dateComponents([.day], from: cycle.effective, to: cycle.expires).day
        #expect(days == 28)
        // Effective dates fall on the 28-day grid anchored at 2026-10-29 00:00 UTC.
        let anchor = Date(timeIntervalSince1970: 1_793_232_000)   // 2026-10-29T00:00:00Z
        let offset = cycle.effective.timeIntervalSince(anchor)
        #expect(offset.truncatingRemainder(dividingBy: 28 * 86_400) == 0)
    }

    @Test func airspaceIsRealClassBCDPolygonsNotCircles() throws {
        let db = try Self.makeDatabase()
        // Over San Francisco International: Class B, surface floor, polygon geometry.
        let sfo = try db.airspacesContaining(point: CLLocationCoordinate2D(latitude: 37.6213, longitude: -122.3790))
        let bravo = try #require(sfo.first { $0.classification == .bravo && $0.floor == 0 })
        #expect(bravo.ceiling == 10000)   // feet MSL
        if case .polygon(let ring) = bravo.geometry { #expect(ring.count >= 4) } else { Issue.record("expected a polygon") }

        // Palo Alto Class D surrounds KPAO.
        let pao = try db.airspacesContaining(point: Self.kpaoCoord)
        #expect(pao.contains { $0.classification == .delta && $0.name.contains("PALO ALTO") })

        let classes = try BundledAviationDataTests.distinctValues(table: "airspaces", column: "class")
        #expect(classes.keys.allSatisfy { AirspaceClass(rawValue: $0) != nil })
        #expect(Array(try BundledAviationDataTests.distinctValues(table: "airspaces", column: "radius_nm").keys) == ["<NULL>"])
    }

    @Test func spotCheckKPAOKSQLKSFOSearchAndNearest() throws {
        let db = try Self.makeDatabase()
        for (query, icao) in [("KPAO", "KPAO"), ("KSQL", "KSQL"), ("KSFO", "KSFO"), ("San Francisco", "KSFO")] {
            #expect(try db.searchAirports(query: query, limit: 10).map(\.icao).contains(icao), "search \(query)")
        }
        let nearest = try db.nearestAirports(to: Self.kpaoCoord, count: 12).map(\.icao)
        #expect(nearest.first == "KPAO")
        #expect(nearest.contains("KSQL"))
        let ksfo = try #require(try db.airport(byICAO: "KSFO"))
        #expect(ksfo.runways.count >= 4)
        #expect(ksfo.frequencies.contains { $0.type == .tower })
    }
}
