//
//  AviationDatabaseInstallCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization: pins what installing and opening the bundled aviation.sqlite does today
//  when the installed copy is damaged or the bundled file changes without changing size, and
//  what `dataCycle()` returns for missing or malformed `metadata` rows. Real SQLite fixtures
//  built with GRDB in temp directories (schema from AviationDatabaseRobustnessTests).
//

import Testing
import Foundation
import GRDB
@testable import efb_212

@Suite("AviationDatabase Install Characterization", .serialized)
@MainActor
struct AviationDatabaseInstallCharacterizationTests {

    // MARK: - Helpers

    static func makeTempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("efb-db-install-char-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Real SQLite file with the bundled aviation schema and one airport, WAL checkpointed into
    /// the main file and the pool closed before returning.
    static func makeBundledDatabase(at url: URL, kpaoName: String) throws {
        do {
            let pool = try AviationDatabaseRobustnessTests.makeDatabasePool(
                at: url,
                airports: [("KPAO", kpaoName, "PAO", 37.4611, -122.1150)]
            )
            _ = try pool.writeWithoutTransaction { db in try db.checkpoint(.truncate) }
        }
    }

    /// 4 KiB of bytes that are not an SQLite header.
    static let garbage = Data(repeating: 0x47, count: 4096)

    /// Pre-populate `install` with a garbage aviation.sqlite and the given marker text.
    static func installGarbage(in install: URL, marker: String) throws -> URL {
        try FileManager.default.createDirectory(at: install, withIntermediateDirectories: true)
        let installed = install.appendingPathComponent(AviationDatabase.installedFileName)
        try garbage.write(to: installed)
        try marker.write(
            to: install.appendingPathComponent(AviationDatabase.versionMarkerFileName),
            atomically: true, encoding: .utf8
        )
        return installed
    }

    /// AviationDatabase over a temp pool whose only table is `metadata` (nil rows: no table).
    static func makeMetadataDatabase(_ rows: [(String, String)]?) throws -> (AviationDatabase, URL) {
        let dir = try makeTempDirectory()
        let pool = try DatabasePool(path: dir.appendingPathComponent("meta.sqlite").path)
        try pool.write { db in
            try db.execute(sql: "CREATE TABLE placeholder (id INTEGER)")
            if let rows {
                try db.execute(sql: "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)")
                for (key, value) in rows {
                    try db.execute(sql: "INSERT INTO metadata (key, value) VALUES (?, ?)", arguments: [key, value])
                }
            }
        }
        return (AviationDatabase(dbPool: pool), dir)
    }

    static func utcMidnight(_ y: Int, _ m: Int, _ d: Int) throws -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d
        c.timeZone = TimeZone(identifier: "UTC")
        return try #require(Calendar(identifier: .gregorian).date(from: c))
    }

    // MARK: - Damaged installed copy

    @Test func garbageInstalledCopyWithMatchingMarkerIsReplacedFromTheBundleAndOpens() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let bundled = dir.appendingPathComponent("bundled.sqlite")
        try Self.makeBundledDatabase(at: bundled, kpaoName: "Palo Alto")
        let install = dir.appendingPathComponent("install", isDirectory: true)
        let fingerprint = try AviationDatabase.installFingerprint(bundledURL: bundled, dataVersion: "v1")
        let installed = try Self.installGarbage(in: install, marker: fingerprint)

        // efb-91u: the marker matches but the file is not a database; open validates, discards
        // the damaged copy and re-installs from the intact bundle.
        let db = try AviationDatabase(bundledURL: bundled, installDirectory: install, dataVersion: "v1")
        #expect(try db.airport(byICAO: "KPAO")?.name == "Palo Alto")
        #expect(try Data(contentsOf: installed) != Self.garbage)
        #expect(try String(contentsOf: install.appendingPathComponent(AviationDatabase.versionMarkerFileName), encoding: .utf8)
                == fingerprint)
    }

    @Test func corruptBundleAndCorruptInstallThrowsMigrationFailed() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let bundled = dir.appendingPathComponent("bundled.sqlite")
        try Self.garbage.write(to: bundled)
        let install = dir.appendingPathComponent("install", isDirectory: true)

        var thrown: EFBError?
        do {
            _ = try AviationDatabase(bundledURL: bundled, installDirectory: install, dataVersion: "v1")
        } catch let error as EFBError {
            thrown = error
        }
        #expect(thrown?.id == "databaseMigrationFailed")
    }

    @Test func garbageInstalledCopyWithStaleMarkerIsReplacedFromTheBundleAndOpens() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let bundled = dir.appendingPathComponent("bundled.sqlite")
        try Self.makeBundledDatabase(at: bundled, kpaoName: "Palo Alto")
        let install = dir.appendingPathComponent("install", isDirectory: true)
        _ = try Self.installGarbage(in: install, marker: "v0|1")

        let db = try AviationDatabase(bundledURL: bundled, installDirectory: install, dataVersion: "v1")
        #expect(try db.airport(byICAO: "KPAO")?.name == "Palo Alto")
        let marker = try String(contentsOf: install.appendingPathComponent(AviationDatabase.versionMarkerFileName), encoding: .utf8)
        let expected = try AviationDatabase.installFingerprint(bundledURL: bundled, dataVersion: "v1")
        #expect(marker == expected)
        #expect(expected.hasPrefix("v1|"))
    }

    // MARK: - Same-size regeneration

    @Test func regeneratedBundleWithSameSizeAndVersionReplacesTheInstalledCopy() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let v1 = dir.appendingPathComponent("bundled-v1.sqlite")
        let v2 = dir.appendingPathComponent("bundled-v2.sqlite")
        try Self.makeBundledDatabase(at: v1, kpaoName: "Palo Alto")
        try Self.makeBundledDatabase(at: v2, kpaoName: "Palo Altx")   // same length, different data
        let v1Bytes = try Data(contentsOf: v1)
        let v2Bytes = try Data(contentsOf: v2)
        try #require(v1Bytes.count == v2Bytes.count)
        try #require(v1Bytes != v2Bytes)

        let install = dir.appendingPathComponent("install", isDirectory: true)
        let installed = try AviationDatabase.installBundledDatabase(from: v1, into: install, dataVersion: "nasr-same")
        _ = try AviationDatabase.installBundledDatabase(from: v2, into: install, dataVersion: "nasr-same")

        // efb-0xs: the fingerprint includes a content hash, so the regenerated bundle is installed.
        #expect(try Data(contentsOf: installed) == v2Bytes)
        let db = try AviationDatabase(bundledURL: v2, installDirectory: install, dataVersion: "nasr-same")
        #expect(try db.airport(byICAO: "KPAO")?.name == "Palo Altx")
    }

    // MARK: - dataCycle

    @Test func dataCycleIsNilWithoutAMetadataTable() throws {
        let (db, dir) = try Self.makeMetadataDatabase(nil)
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(try db.dataCycle() == nil)
    }

    @Test func dataCycleParsesYYYYMMDDAsUTCMidnight() throws {
        let (db, dir) = try Self.makeMetadataDatabase([
            ("nasr_effective", "2026-10-29"),
            ("nasr_expires", "2026-11-26"),
            ("source", "TEST NASR"),
        ])
        defer { try? FileManager.default.removeItem(at: dir) }
        let cycle = try #require(try db.dataCycle())
        #expect(cycle.source == "TEST NASR")
        let effective = try Self.utcMidnight(2026, 10, 29)
        let expires = try Self.utcMidnight(2026, 11, 26)
        #expect(cycle.effective == effective)
        #expect(cycle.expires == expires)
    }

    @Test func dataCycleDefaultsSourceToFAANASR() throws {
        let (db, dir) = try Self.makeMetadataDatabase([
            ("nasr_effective", "2026-10-29"),
            ("nasr_expires", "2026-11-26"),
        ])
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(try db.dataCycle()?.source == "FAA NASR")
    }

    @Test func dataCycleIsNilWhenEffectiveIsNotADate() throws {
        let (db, dir) = try Self.makeMetadataDatabase([
            ("nasr_effective", "not-a-date"),
            ("nasr_expires", "2026-11-26"),
        ])
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(try db.dataCycle() == nil)
    }

    @Test func dataCycleIsNilWhenExpiresIsMissing() throws {
        let (db, dir) = try Self.makeMetadataDatabase([("nasr_effective", "2026-10-29")])
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(try db.dataCycle() == nil)
    }

    @Test func dataCycleDoesNotCheckThatExpiresFollowsEffective() throws {
        let (db, dir) = try Self.makeMetadataDatabase([
            ("nasr_effective", "2026-11-26"),
            ("nasr_expires", "2026-10-29"),
        ])
        defer { try? FileManager.default.removeItem(at: dir) }
        let cycle = try #require(try db.dataCycle())
        #expect(cycle.expires < cycle.effective)
    }
}
