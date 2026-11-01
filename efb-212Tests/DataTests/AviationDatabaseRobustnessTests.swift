//
//  AviationDatabaseRobustnessTests.swift
//  efb-212Tests
//
//  Tests against a temporary GRDB database with the bundled schema (airports, R-tree, FTS5):
//  circle-based nearest-airport ordering, FTS5 query escaping, bundled-database refresh on a
//  data version change, and loud failure when the database cannot be opened.
//

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

@Suite("AviationDatabase Robustness Tests")
struct AviationDatabaseRobustnessTests {

    // MARK: - Helpers

    /// Unique temporary directory for one test.
    static func makeTempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("efb-db-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Create an on-disk database with the bundled aviation schema and the given airports,
    /// including R-tree and FTS5 rows (the bundled FTS table is external-content, so it must
    /// be rebuilt explicitly).
    static func makeDatabase(airports: [(icao: String, name: String, faaID: String?, lat: Double, lon: Double)]) throws -> AviationDatabase {
        let dir = try makeTempDirectory()
        let url = dir.appendingPathComponent("aviation.sqlite")
        return AviationDatabase(dbPool: try makeDatabasePool(at: url, airports: airports))
    }

    /// Create the schema and rows at `url` and return the open pool.
    static func makeDatabasePool(at url: URL, airports: [(icao: String, name: String, faaID: String?, lat: Double, lon: Double)]) throws -> DatabasePool {
        let pool = try DatabasePool(path: url.path)
        try pool.write { db in
            try db.execute(sql: """
                CREATE TABLE airports (
                    icao TEXT PRIMARY KEY,
                    faa_id TEXT,
                    name TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    elevation REAL NOT NULL DEFAULT 0,
                    type TEXT NOT NULL DEFAULT 'airport',
                    ownership TEXT NOT NULL DEFAULT 'public',
                    ctaf_frequency REAL,
                    unicom_frequency REAL,
                    artcc_id TEXT,
                    fss_id TEXT,
                    magnetic_variation REAL,
                    pattern_altitude INTEGER,
                    fuel_types TEXT DEFAULT '[]',
                    has_beacon_light INTEGER DEFAULT 0
                )
                """)
            try db.execute(sql: """
                CREATE TABLE runways (
                    id TEXT NOT NULL,
                    airport_icao TEXT NOT NULL,
                    length INTEGER NOT NULL,
                    width INTEGER NOT NULL,
                    surface TEXT NOT NULL DEFAULT 'asphalt',
                    lighting TEXT NOT NULL DEFAULT 'none',
                    base_end_id TEXT NOT NULL,
                    reciprocal_end_id TEXT NOT NULL,
                    base_end_latitude REAL NOT NULL DEFAULT 0,
                    base_end_longitude REAL NOT NULL DEFAULT 0,
                    reciprocal_end_latitude REAL NOT NULL DEFAULT 0,
                    reciprocal_end_longitude REAL NOT NULL DEFAULT 0
                )
                """)
            try db.execute(sql: """
                CREATE TABLE frequencies (
                    id TEXT NOT NULL,
                    airport_icao TEXT NOT NULL,
                    type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    frequency REAL NOT NULL
                )
                """)
            try db.execute(sql: "CREATE VIRTUAL TABLE airports_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon)")
            try db.execute(sql: """
                CREATE VIRTUAL TABLE airports_fts USING fts5(
                    icao, name, faa_id, content=airports, content_rowid=rowid
                )
                """)

            for airport in airports {
                try db.execute(
                    sql: "INSERT INTO airports (icao, faa_id, name, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
                    arguments: [airport.icao, airport.faaID, airport.name, airport.lat, airport.lon]
                )
                let rowID = db.lastInsertedRowID
                try db.execute(
                    sql: "INSERT INTO airports_rtree (rowid, min_lat, max_lat, min_lon, max_lon) VALUES (?, ?, ?, ?, ?)",
                    arguments: [rowID, airport.lat, airport.lat, airport.lon, airport.lon]
                )
            }
            try db.execute(sql: "INSERT INTO airports_fts(airports_fts) VALUES ('rebuild')")
        }
        return pool
    }

    static let bayArea: [(icao: String, name: String, faaID: String?, lat: Double, lon: Double)] = [
        ("KPAO", "Palo Alto", "PAO", 37.4611, -122.1150),
        ("KSQL", "San Carlos", "SQL", 37.5119, -122.2494),
        ("KSFO", "San Francisco Intl", "SFO", 37.6213, -122.3790),
        ("KSJC", "Norman Y Mineta San Jose Intl", "SJC", 37.3626, -121.9291),
    ]

    // MARK: - Nearest Airports (circle, not box)

    /// The first search box (25 NM half-side) contains a corner airport at ~35 NM and excludes an
    /// airport at 27 NM due east. The nearest airport must be the closer one outside the box.
    @Test func nearestPrefersCloserAirportOutsideFirstBoxOverCornerAirport() throws {
        // At latitude 0 the box is square in degrees: half-side 25/60 = 0.4167 deg.
        let corner = (icao: "CORN", name: "Corner Field", faaID: nil as String?, lat: 0.41, lon: 0.41)     // ~34.8 NM
        let closer = (icao: "EAST", name: "East Field", faaID: nil as String?, lat: 0.0, lon: 0.45)        // 27.0 NM
        let db = try Self.makeDatabase(airports: [corner, closer])
        let center = CLLocationCoordinate2D(latitude: 0, longitude: 0)

        let nearestOne = try db.nearestAirports(to: center, count: 1)
        #expect(nearestOne.map(\.icao) == ["EAST"])

        let nearestTwo = try db.nearestAirports(to: center, count: 2)
        #expect(nearestTwo.map(\.icao) == ["EAST", "CORN"])
    }

    @Test func nearestIsSortedByGreatCircleDistance() throws {
        let db = try Self.makeDatabase(airports: Self.bayArea)
        let paloAlto = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

        let nearest = try db.nearestAirports(to: paloAlto, count: 4)
        #expect(nearest.map(\.icao) == ["KPAO", "KSQL", "KSJC", "KSFO"])
    }

    @Test func nearestReturnsFewerThanRequestedWhenCircleIsExhausted() throws {
        let db = try Self.makeDatabase(airports: Self.bayArea)
        let newYork = CLLocationCoordinate2D(latitude: 40.6413, longitude: -73.7781)

        // Bay Area is >2,000 NM away; the search stops at the max radius and returns nothing.
        #expect(try db.nearestAirports(to: newYork, count: 3).isEmpty)
        // Count larger than the database: returns everything within the max radius, sorted.
        let paloAlto = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)
        #expect(try db.nearestAirports(to: paloAlto, count: 10).count == 4)
        #expect(try db.nearestAirports(to: paloAlto, count: 0).isEmpty)
    }

    // MARK: - FTS5 escaping

    @Test func ftsMatchExpressionQuotesEveryToken() {
        #expect(AviationDatabase.ftsMatchExpression(from: "KPAO") == "\"KPAO\"*")
        #expect(AviationDatabase.ftsMatchExpression(from: "KPAO-1") == "\"KPAO\"* \"1\"*")
        #expect(AviationDatabase.ftsMatchExpression(from: "\"Palo Alto\"") == "\"Palo\"* \"Alto\"*")
        #expect(AviationDatabase.ftsMatchExpression(from: "  san  carlos ") == "\"san\"* \"carlos\"*")
        #expect(AviationDatabase.ftsMatchExpression(from: "") == nil)
        #expect(AviationDatabase.ftsMatchExpression(from: "   ") == nil)
        #expect(AviationDatabase.ftsMatchExpression(from: "\"") == nil)
        #expect(AviationDatabase.ftsMatchExpression(from: "-") == nil)
        #expect(AviationDatabase.ftsMatchExpression(from: "(*) OR NOT") == "\"OR\"* \"NOT\"*")
    }

    @Test func searchDoesNotThrowOnQuotesDashesOrEmptyInput() throws {
        let db = try Self.makeDatabase(airports: Self.bayArea)

        #expect(try db.searchAirports(query: "", limit: 10).isEmpty)
        #expect(try db.searchAirports(query: "\"", limit: 10).isEmpty)
        #expect(try db.searchAirports(query: "-", limit: 10).isEmpty)
        #expect(try db.searchAirports(query: "KPAO-1", limit: 10).isEmpty)   // no airport matches "1"
        #expect(try db.searchAirports(query: "\"KPAO\"", limit: 10).map(\.icao) == ["KPAO"])
        #expect(try db.searchAirports(query: "san-carlos", limit: 10).map(\.icao) == ["KSQL"])
    }

    @Test func searchMatchesPrefixOfIdentifierNameAndFAAID() throws {
        let db = try Self.makeDatabase(airports: Self.bayArea)

        #expect(try db.searchAirports(query: "kpa", limit: 10).map(\.icao) == ["KPAO"])
        #expect(try db.searchAirports(query: "palo", limit: 10).map(\.icao) == ["KPAO"])
        #expect(try db.searchAirports(query: "SFO", limit: 10).map(\.icao) == ["KSFO"])
        #expect(try db.searchAirports(query: "san", limit: 10).count == 3)
        #expect(try db.searchAirports(query: "san", limit: 2).count == 2)
    }

    // MARK: - Bundled database refresh

    /// Write a small file standing in for the bundled aviation.sqlite.
    static func writeBundled(_ contents: String, in dir: URL, name: String = "bundled.sqlite") throws -> URL {
        let url = dir.appendingPathComponent(name)
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    @Test func installCopiesWhenMissingAndKeepsInstalledCopyForSameVersion() throws {
        let dir = try Self.makeTempDirectory()
        let install = dir.appendingPathComponent("install", isDirectory: true)
        let bundled = try Self.writeBundled("bundled-v1", in: dir)

        let installed = try AviationDatabase.installBundledDatabase(from: bundled, into: install, dataVersion: "1")
        #expect(try String(contentsOf: installed, encoding: .utf8) == "bundled-v1")
        let marker = install.appendingPathComponent(AviationDatabase.versionMarkerFileName)
        #expect(try String(contentsOf: marker, encoding: .utf8) == "1|10")

        // Simulate local state (e.g. a cache written by the app) in the installed copy.
        try "installed-local-state".write(to: installed, atomically: true, encoding: .utf8)
        // Same version and same bundled size: must not recopy.
        _ = try AviationDatabase.installBundledDatabase(from: bundled, into: install, dataVersion: "1")
        #expect(try String(contentsOf: installed, encoding: .utf8) == "installed-local-state")
    }

    @Test func installRecopiesOnVersionChangeAndRemovesSidecars() throws {
        let dir = try Self.makeTempDirectory()
        let install = dir.appendingPathComponent("install", isDirectory: true)
        let bundled = try Self.writeBundled("bundled-v1", in: dir)
        let installed = try AviationDatabase.installBundledDatabase(from: bundled, into: install, dataVersion: "1")

        // Stale WAL/SHM sidecars from the previous copy must not survive a refresh.
        let wal = install.appendingPathComponent(AviationDatabase.installedFileName + "-wal")
        let shm = install.appendingPathComponent(AviationDatabase.installedFileName + "-shm")
        try "wal".write(to: wal, atomically: true, encoding: .utf8)
        try "shm".write(to: shm, atomically: true, encoding: .utf8)

        let bundledV2 = try Self.writeBundled("bundled-v2", in: dir)
        let reinstalled = try AviationDatabase.installBundledDatabase(from: bundledV2, into: install, dataVersion: "2")
        #expect(reinstalled == installed)
        #expect(try String(contentsOf: installed, encoding: .utf8) == "bundled-v2")
        #expect(!FileManager.default.fileExists(atPath: wal.path))
        #expect(!FileManager.default.fileExists(atPath: shm.path))
        let marker = install.appendingPathComponent(AviationDatabase.versionMarkerFileName)
        #expect(try String(contentsOf: marker, encoding: .utf8) == "2|10")
    }

    @Test func installRecopiesWhenBundledSizeChangesWithSameVersion() throws {
        let dir = try Self.makeTempDirectory()
        let install = dir.appendingPathComponent("install", isDirectory: true)
        let bundled = try Self.writeBundled("bundled-v1", in: dir)
        let installed = try AviationDatabase.installBundledDatabase(from: bundled, into: install, dataVersion: "1")

        // Importer regenerated the file (different size) but nobody bumped the version constant.
        let regenerated = try Self.writeBundled("bundled-v1-regenerated", in: dir)
        _ = try AviationDatabase.installBundledDatabase(from: regenerated, into: install, dataVersion: "1")
        #expect(try String(contentsOf: installed, encoding: .utf8) == "bundled-v1-regenerated")
    }

    @Test func installThrowsDatabaseCorruptedWhenBundledFileIsMissing() throws {
        let dir = try Self.makeTempDirectory()
        let missing = dir.appendingPathComponent("missing.sqlite")
        #expect(throws: EFBError.self) {
            try AviationDatabase.installBundledDatabase(from: missing, into: dir, dataVersion: "1")
        }
    }

    @Test func initInstallsRealSQLiteAndOpensIt() throws {
        let dir = try Self.makeTempDirectory()
        let bundled = dir.appendingPathComponent("bundled.sqlite")
        do {
            // Build a real bundled database file; the pool closes when it leaves scope.
            let pool = try Self.makeDatabasePool(at: bundled, airports: Self.bayArea)
            _ = try pool.writeWithoutTransaction { db in try db.checkpoint(.truncate) }
        }

        let install = dir.appendingPathComponent("install", isDirectory: true)
        let db = try AviationDatabase(bundledURL: bundled, installDirectory: install, dataVersion: "test")
        #expect(try db.airport(byICAO: "KPAO")?.name == "Palo Alto")
        #expect(try db.nearestAirports(to: CLLocationCoordinate2D(latitude: 37.46, longitude: -122.11), count: 1).map(\.icao) == ["KPAO"])
        #expect(FileManager.default.fileExists(atPath: install.appendingPathComponent(AviationDatabase.versionMarkerFileName).path))
    }

    // MARK: - Failure surfaces loudly

    @Test func databaseManagerThrowsWhenBundledFileIsMissing() throws {
        let dir = try Self.makeTempDirectory()
        let missing = dir.appendingPathComponent("missing.sqlite")
        var thrown: EFBError?
        do {
            _ = try DatabaseManager(bundledURL: missing, installDirectory: dir)
        } catch let error as EFBError {
            thrown = error
        }
        #expect(thrown?.id == EFBError.databaseCorrupted.id)
    }

    @Test func unavailableDatabaseServiceThrowsOnEveryQuery() {
        let service = UnavailableDatabaseService()
        let here = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)
        #expect(throws: EFBError.self) { try service.airport(byICAO: "KPAO") }
        #expect(throws: EFBError.self) { try service.airports(near: here, radiusNM: 10) }
        #expect(throws: EFBError.self) { try service.nearestAirports(to: here, count: 3) }
        #expect(throws: EFBError.self) { try service.searchAirports(query: "KPAO", limit: 5) }
        #expect(throws: EFBError.self) { try service.airspaces(near: here, radiusNM: 10) }
        #expect(throws: EFBError.self) { try service.navaids(near: here, radiusNM: 10) }
    }

    @Test @MainActor func appStateRecordsDatabaseErrorAndSharesThrowingService() throws {
        let appState = AppState()
        #expect(appState.databaseError == nil)
        #expect(appState.sharedDatabaseService == nil)

        let service = appState.getOrCreateDatabaseService { throw EFBError.databaseCorrupted }
        #expect(service is UnavailableDatabaseService)
        #expect(appState.databaseError?.id == EFBError.databaseCorrupted.id)
        #expect(appState.sharedDatabaseService is UnavailableDatabaseService)

        // Later callers get the same failed service; the factory is not retried.
        var factoryCalls = 0
        let again = appState.getOrCreateDatabaseService {
            factoryCalls += 1
            return MockDatabaseManager()
        }
        #expect(again is UnavailableDatabaseService)
        #expect(factoryCalls == 0)
    }

    @Test @MainActor func appStateSharesOneDatabaseServiceOnSuccess() {
        let appState = AppState()
        let mock = MockDatabaseManager()
        var factoryCalls = 0

        let first = appState.getOrCreateDatabaseService { factoryCalls += 1; return mock }
        let second = appState.getOrCreateDatabaseService { factoryCalls += 1; return MockDatabaseManager() }
        #expect((first as? MockDatabaseManager) === mock)
        #expect((second as? MockDatabaseManager) === mock)
        #expect(factoryCalls == 1)
        #expect(appState.databaseError == nil)
        #expect((appState.sharedDatabaseService as? MockDatabaseManager) === mock)
    }

    @Test @MainActor func appStateWrapsNonEFBErrorsAsDatabaseMigrationFailed() {
        struct Boom: Error {}
        let appState = AppState()
        _ = appState.getOrCreateDatabaseService { throw Boom() }
        #expect(appState.databaseError?.id == "databaseMigrationFailed")
    }
}
