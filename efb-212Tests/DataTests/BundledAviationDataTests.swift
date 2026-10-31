//
//  BundledAviationDataTests.swift
//  efb-212Tests
//
//  Guards the contract between the bundled aviation.sqlite (written by tools/nasr-importer)
//  and the app's enums. AviationDatabase silently falls back to a default when a raw value
//  is unknown, so a vocabulary mismatch shows wrong data instead of failing.
//

import Testing
import Foundation
import SQLite3
@testable import efb_212

@Suite("Bundled Aviation Data Tests")
struct BundledAviationDataTests {

    /// Distinct values of `column` in `table` of the bundled database, with row counts.
    static func distinctValues(table: String, column: String) throws -> [String: Int] {
        let bundle = Bundle(for: BundleToken.self)
        let url = try #require(
            Bundle.main.url(forResource: "aviation", withExtension: "sqlite")
                ?? bundle.url(forResource: "aviation", withExtension: "sqlite"),
            "aviation.sqlite is not bundled"
        )

        // immutable=1: read without needing the -wal/-shm sidecar files.
        var db: OpaquePointer?
        let uri = "file:\(url.path)?immutable=1"
        #expect(sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) == SQLITE_OK)
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        let sql = "SELECT \(column), COUNT(*) FROM \(table) GROUP BY \(column)"
        try #require(sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK)
        defer { sqlite3_finalize(stmt) }

        var result: [String: Int] = [:]
        while sqlite3_step(stmt) == SQLITE_ROW {
            let value = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "<NULL>"
            result[value] = Int(sqlite3_column_int(stmt, 1))
        }
        return result
    }

    @Test func everyFrequencyTypeInBundledDBIsAKnownEnumCase() throws {
        let values = try Self.distinctValues(table: "frequencies", column: "type")
        let unmapped = values.keys.filter { FrequencyType(rawValue: $0) == nil }
        #expect(!values.isEmpty)
        #expect(unmapped.isEmpty, "Unmapped frequency types (decode as fallback): \(unmapped.sorted())")
    }

    @Test func everyNavaidTypeInBundledDBIsAKnownEnumCase() throws {
        let values = try Self.distinctValues(table: "navaids", column: "type")
        let unmapped = values.keys.filter { NavaidType(rawValue: $0) == nil }
        #expect(!values.isEmpty)
        #expect(unmapped.isEmpty, "Unmapped navaid types (decode as fallback): \(unmapped.sorted())")
    }

    @Test func everyAirportRunwayTypeInBundledDBIsAKnownEnumCase() throws {
        let airportTypes = try Self.distinctValues(table: "airports", column: "type")
        #expect(airportTypes.keys.allSatisfy { AirportType(rawValue: $0) != nil })

        let surfaces = try Self.distinctValues(table: "runways", column: "surface")
        #expect(surfaces.keys.allSatisfy { SurfaceType(rawValue: $0) != nil })

        let lighting = try Self.distinctValues(table: "runways", column: "lighting")
        #expect(lighting.keys.allSatisfy { LightingType(rawValue: $0) != nil })
    }
}

private final class BundleToken {}
