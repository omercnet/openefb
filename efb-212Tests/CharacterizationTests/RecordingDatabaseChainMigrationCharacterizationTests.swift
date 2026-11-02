//
//  RecordingDatabaseChainMigrationCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization tests: a recording.sqlite exactly as the FIRST build left it (only GRDB
//  migration "v1" applied) is opened by the current RecordingDatabase. Every later migration
//  must run once and no flight data may change. Asserts marked BUG pin current wrong behavior.
//

import Testing
import Foundation
import GRDB
@testable import efb_212

@Suite("Characterization: RecordingDatabase v1 -> current chain migration")
struct RecordingDatabaseChainMigrationCharacterizationTests {

    static let flightID = UUID()
    static let t0 = Date(timeIntervalSince1970: 1_700_000_000)  // whole seconds: GRDB stores dates as ms text

    static func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("char-chain-\(UUID().uuidString).sqlite")
    }

    static func remove(_ url: URL) {
        for suffix in ["", "-wal", "-shm"] {
            try? FileManager.default.removeItem(atPath: url.path + suffix)
        }
    }

    static let trackPoints: [TrackPointRecord] = makeTrackPoints()

    static func makeTrackPoints() -> [TrackPointRecord] {
        var points: [TrackPointRecord] = []
        for i in 0..<4 {
            let step = Double(i)
            let latitude: Double = 37.4611 + step * 0.001      // degrees
            let longitude: Double = -122.1150 - step * 0.001   // degrees
            let altitude: Double = 100 + step * 10             // feet MSL
            let speed: Double = 60 + step                      // knots
            let vsi: Double = step * 150                       // feet per minute
            let course: Double = 310 + step                    // degrees true
            points.append(TrackPointRecord(
                id: UUID(), flightID: flightID, timestamp: t0.addingTimeInterval(step),
                latitude: latitude, longitude: longitude, altitudeFeet: altitude,
                groundSpeedKnots: speed, verticalSpeedFPM: vsi, courseDegrees: course
            ))
        }
        return points
    }

    static let phaseMarkers: [PhaseMarkerRecord] = [
        PhaseMarkerRecord(
            id: UUID(), flightID: flightID, phase: "taxi", startTimestamp: t0,
            endTimestamp: t0.addingTimeInterval(2), latitude: 37.4611, longitude: -122.1150
        ),
        PhaseMarkerRecord(
            id: UUID(), flightID: flightID, phase: "takeoff", startTimestamp: t0.addingTimeInterval(2),
            endTimestamp: nil, latitude: 37.4631, longitude: -122.1170
        ),
    ]

    /// Exactly the v1 schema the first build created, plus a grdb_migrations table that lists only v1.
    /// Rows are bound through GRDB arguments, so UUIDs are 16-byte BLOBs and dates are GRDB date text,
    /// the same encoding the record types produce.
    static func makeV1Database(at url: URL) throws {
        let pool = try DatabasePool(path: url.path)
        try pool.write { db in
            try db.execute(sql: "CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)")
            try db.execute(sql: "INSERT INTO grdb_migrations VALUES ('v1')")
            try db.execute(sql: """
                CREATE TABLE track_points (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL, altitudeFeet REAL NOT NULL,
                    groundSpeedKnots REAL NOT NULL, verticalSpeedFPM REAL NOT NULL, courseDegrees REAL NOT NULL)
                """)
            try db.execute(sql: "CREATE INDEX idx_track_points_flight ON track_points(flightID)")
            try db.execute(sql: """
                CREATE TABLE transcript_segments (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
                    text TEXT NOT NULL, confidence REAL NOT NULL,
                    audioStartTime REAL NOT NULL, audioEndTime REAL NOT NULL, flightPhase TEXT NOT NULL)
                """)
            try db.execute(sql: "CREATE INDEX idx_transcript_segments_flight ON transcript_segments(flightID)")
            try db.execute(sql: """
                CREATE TABLE phase_markers (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, phase TEXT NOT NULL,
                    startTimestamp REAL NOT NULL, endTimestamp REAL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL)
                """)
            try db.execute(sql: "CREATE INDEX idx_phase_markers_flight ON phase_markers(flightID)")

            for p in trackPoints {
                try db.execute(
                    sql: "INSERT INTO track_points VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    arguments: [p.id, p.flightID, p.timestamp, p.latitude, p.longitude,
                                p.altitudeFeet, p.groundSpeedKnots, p.verticalSpeedFPM, p.courseDegrees]
                )
            }
            for m in phaseMarkers {
                try db.execute(
                    sql: "INSERT INTO phase_markers VALUES (?, ?, ?, ?, ?, ?, ?)",
                    arguments: [m.id, m.flightID, m.phase, m.startTimestamp, m.endTimestamp,
                                m.latitude, m.longitude]
                )
            }
            // v1 builds stored -1 when the speech engine reported no confidence.
            for (index, confidence) in [0.85, -1.0].enumerated() {
                try db.execute(
                    sql: "INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    arguments: [UUID(), flightID, t0.addingTimeInterval(Double(index)), "segment \(index)",
                                confidence, Double(index), Double(index) + 1, "taxi"]
                )
            }
        }
    }

    static func rawRows(_ pool: DatabasePool, table: String) throws -> [Row] {
        try pool.read { db in try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id") }
    }

    static func names(_ pool: DatabasePool, type: String) throws -> Set<String> {
        try pool.read { db in
            Set(try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = ?", arguments: [type]))
        }
    }

    static func appliedMigrations(_ pool: DatabasePool) throws -> [String] {
        try pool.read { db in
            try String.fetchAll(db, sql: "SELECT identifier FROM grdb_migrations ORDER BY identifier")
        }
    }

    static func counts(_ pool: DatabasePool) throws -> [String: Int] {
        try pool.read { db in
            var result: [String: Int] = [:]
            for table in ["track_points", "transcript_segments", "phase_markers", "debrief_results", "flight_route_legs"] {
                result[table] = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table)") ?? -1
            }
            return result
        }
    }

    // MARK: - Tests

    @Test func v1DatabaseMigratesToCurrentWithoutChangingFlightData() throws {
        let url = Self.tempURL()
        defer { Self.remove(url) }
        try Self.makeV1Database(at: url)

        let pool = try DatabasePool(path: url.path)
        let trackBefore = try Self.rawRows(pool, table: "track_points")
        let phasesBefore = try Self.rawRows(pool, table: "phase_markers")

        let db = try RecordingDatabase(dbPool: pool)

        #expect(try Self.appliedMigrations(pool) ==
                ["v1", "v2_debrief", "v3_nullable_transcript_confidence", "v4_flight_route_legs",
                 "v5_debrief_generatedAt_epoch"])
        let tables = try Self.names(pool, type: "table")
        #expect(tables.isSuperset(of: ["track_points", "transcript_segments", "phase_markers",
                                       "debrief_results", "flight_route_legs"]))
        #expect(tables.contains("transcript_segments_new") == false)
        let indexes = try Self.names(pool, type: "index")
        #expect(indexes.isSuperset(of: ["idx_track_points_flight", "idx_transcript_segments_flight",
                                        "idx_phase_markers_flight", "idx_debrief_results_flight"]))

        // Raw storage untouched by v2-v4.
        #expect(try Self.rawRows(pool, table: "track_points") == trackBefore)
        #expect(try Self.rawRows(pool, table: "phase_markers") == phasesBefore)

        // Decoded through the real record types: identical values.
        let points = try db.trackPoints(forFlight: Self.flightID)
        try #require(points.count == Self.trackPoints.count)
        for (got, want) in zip(points, Self.trackPoints) {
            #expect(got.id == want.id)
            #expect(got.flightID == want.flightID)
            #expect(got.timestamp == want.timestamp)
            #expect(got.latitude == want.latitude)
            #expect(got.longitude == want.longitude)
            #expect(got.altitudeFeet == want.altitudeFeet)
            #expect(got.groundSpeedKnots == want.groundSpeedKnots)
            #expect(got.verticalSpeedFPM == want.verticalSpeedFPM)
            #expect(got.courseDegrees == want.courseDegrees)
        }
        let markers = try db.phaseMarkers(forFlight: Self.flightID)
        try #require(markers.count == Self.phaseMarkers.count)
        for (got, want) in zip(markers, Self.phaseMarkers) {
            #expect(got.id == want.id)
            #expect(got.phase == want.phase)
            #expect(got.startTimestamp == want.startTimestamp)
            #expect(got.endTimestamp == want.endTimestamp)
            #expect(got.latitude == want.latitude)
            #expect(got.longitude == want.longitude)
        }
        #expect(markers.last?.endTimestamp == nil)

        let segments = try db.transcriptSegments(forFlight: Self.flightID)
        #expect(segments.map(\.text) == ["segment 0", "segment 1"])
        #expect(segments.first?.confidence == 0.85)
        #expect(segments.last?.confidence == nil)  // was the -1 sentinel
    }

    @Test func migratedV1DatabaseStoresAndReadsDebriefs() throws {
        let url = Self.tempURL()
        defer { Self.remove(url) }
        try Self.makeV1Database(at: url)
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: url.path))

        let generatedAt = Date(timeIntervalSinceReferenceDate: 800_000_000)  // whole seconds
        let record = DebriefRecord(
            flightID: Self.flightID, narrativeSummary: "Stable climb-out.",
            phaseObservationsJSON: "[]", improvementsJSON: "[\"Trim earlier\"]",
            overallRating: 4, generatedAt: generatedAt,
            promptTokensEstimate: 1_200, responseTokensEstimate: 300
        )
        try db.insertDebrief(record)

        let stored = try #require(try db.debrief(forFlight: Self.flightID))
        #expect(stored.id == record.id)
        #expect(stored.flightID == record.flightID)
        #expect(stored.narrativeSummary == record.narrativeSummary)
        #expect(stored.phaseObservationsJSON == record.phaseObservationsJSON)
        #expect(stored.improvementsJSON == record.improvementsJSON)
        #expect(stored.overallRating == 4)
        #expect(stored.promptTokensEstimate == 1_200)
        #expect(stored.responseTokensEstimate == 300)
        // efb-6io: written as a GRDB date, so it reads back as the same instant.
        #expect(stored.generatedAt == generatedAt)
    }

    @Test func v5ShiftsLegacyNumericDebriefDatesFromTheReferenceEpochToUnix() throws {
        let url = Self.tempURL()
        defer { Self.remove(url) }
        try Self.makeV1Database(at: url)
        let pool = try DatabasePool(path: url.path)
        _ = try RecordingDatabase(dbPool: pool)

        // A row written by the old build: seconds since 2001 as a bare REAL. Forget v5 and reopen.
        let instant = Date(timeIntervalSinceReferenceDate: 800_000_000)  // whole seconds
        let legacyID = UUID()
        try pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO debrief_results
                    (id, flightID, narrativeSummary, phaseObservationsJSON, improvementsJSON, overallRating, generatedAt)
                    VALUES (?, ?, 'old', '[]', '[]', 3, ?)
                    """,
                arguments: [legacyID, Self.flightID, 800_000_000.0]
            )
            try db.execute(sql: "DELETE FROM grdb_migrations WHERE identifier = 'v5_debrief_generatedAt_epoch'")
        }
        let db = try RecordingDatabase(dbPool: pool)

        #expect(try #require(try db.debrief(forFlight: Self.flightID)).generatedAt == instant)
        // Reopening again must not shift it a second time.
        let again = try RecordingDatabase(dbPool: pool)
        #expect(try #require(try again.debrief(forFlight: Self.flightID)).generatedAt == instant)
    }

    @Test func reopeningMigratedDatabaseIsNoOp() throws {
        let url = Self.tempURL()
        defer { Self.remove(url) }
        try Self.makeV1Database(at: url)
        let firstPool = try DatabasePool(path: url.path)
        _ = try RecordingDatabase(dbPool: firstPool)
        let countsAfterFirstOpen = try Self.counts(firstPool)
        let migrationsAfterFirstOpen = try Self.appliedMigrations(firstPool)
        let trackAfterFirstOpen = try Self.rawRows(firstPool, table: "track_points")

        let secondPool = try DatabasePool(path: url.path)
        _ = try RecordingDatabase(dbPool: secondPool)

        #expect(countsAfterFirstOpen["track_points"] == Self.trackPoints.count)
        #expect(countsAfterFirstOpen["phase_markers"] == Self.phaseMarkers.count)
        #expect(countsAfterFirstOpen["transcript_segments"] == 2)
        #expect(try Self.counts(secondPool) == countsAfterFirstOpen)
        #expect(try Self.appliedMigrations(secondPool) == migrationsAfterFirstOpen)
        #expect(try Self.rawRows(secondPool, table: "track_points") == trackAfterFirstOpen)
    }

    @Test func emptyFileGetsEveryTable() throws {
        let url = Self.tempURL()
        defer { Self.remove(url) }
        let pool = try DatabasePool(path: url.path)

        _ = try RecordingDatabase(dbPool: pool)

        let tables = try Self.names(pool, type: "table")
        #expect(tables.isSuperset(of: ["track_points", "transcript_segments", "phase_markers",
                                       "debrief_results", "flight_route_legs", "grdb_migrations"]))
        #expect(try Self.appliedMigrations(pool) ==
                ["v1", "v2_debrief", "v3_nullable_transcript_confidence", "v4_flight_route_legs",
                 "v5_debrief_generatedAt_epoch"])
    }
}
