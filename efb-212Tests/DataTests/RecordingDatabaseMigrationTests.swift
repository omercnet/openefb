//
//  RecordingDatabaseMigrationTests.swift
//  efb-212Tests
//
//  RecordingDatabase v3: transcript_segments.confidence is nullable; rows an older build
//  stored with the -1 "unknown" sentinel become NULL (efb-z0k).
//

import Testing
import Foundation
import GRDB
@testable import efb_212

@Suite("RecordingDatabase transcript confidence migration")
struct RecordingDatabaseMigrationTests {

    static func tempPath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("recdb-migration-\(UUID().uuidString).sqlite").path
    }

    /// Build a database exactly as the v1/v2 builds left it (confidence REAL NOT NULL, -1 for unknown).
    static func makeLegacyPool(flightID: UUID) throws -> (pool: DatabasePool, path: String) {
        let path = tempPath()
        let pool = try DatabasePool(path: path)
        try pool.write { db in
            try db.execute(sql: "CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)")
            try db.execute(sql: "INSERT INTO grdb_migrations VALUES ('v1'), ('v2_debrief')")
            try db.execute(sql: """
                CREATE TABLE transcript_segments (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
                    text TEXT NOT NULL, confidence REAL NOT NULL,
                    audioStartTime REAL NOT NULL, audioEndTime REAL NOT NULL, flightPhase TEXT NOT NULL)
                """)
            try db.execute(sql: "CREATE INDEX idx_transcript_segments_flight ON transcript_segments(flightID)")
            try db.execute(sql: """
                CREATE TABLE track_points (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, timestamp REAL NOT NULL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL, altitudeFeet REAL NOT NULL,
                    groundSpeedKnots REAL NOT NULL, verticalSpeedFPM REAL NOT NULL, courseDegrees REAL NOT NULL)
                """)
            try db.execute(sql: """
                CREATE TABLE phase_markers (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, phase TEXT NOT NULL,
                    startTimestamp REAL NOT NULL, endTimestamp REAL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL)
                """)
            try db.execute(sql: """
                CREATE TABLE debrief_results (
                    id TEXT PRIMARY KEY, flightID TEXT NOT NULL, narrativeSummary TEXT NOT NULL,
                    phaseObservationsJSON TEXT NOT NULL, improvementsJSON TEXT NOT NULL,
                    overallRating INTEGER NOT NULL, generatedAt REAL NOT NULL,
                    promptTokensEstimate INTEGER, responseTokensEstimate INTEGER)
                """)
            for (index, confidence) in [0.9, -1.0, 0.0].enumerated() {
                try db.execute(
                    sql: "INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, 0, 1, 'cruise')",
                    arguments: [UUID(), flightID, Double(index), "segment \(index)", confidence])  // UUIDs bind as 16-byte BLOBs, as GRDB records store them
            }
        }
        return (pool, path)
    }

    @Test func unknownSentinelRowsBecomeNullAndRealValuesSurvive() throws {
        let flightID = UUID()
        let (pool, _) = try Self.makeLegacyPool(flightID: flightID)

        let db = try RecordingDatabase(dbPool: pool)   // runs v3 on the legacy schema
        let segments = try db.transcriptSegments(forFlight: flightID)

        try #require(segments.count == 3)
        #expect(segments.map(\.text) == ["segment 0", "segment 1", "segment 2"])
        #expect(segments[0].confidence == 0.9)
        #expect(segments[1].confidence == nil)       // was -1
        #expect(segments[2].confidence == 0.0)       // a real zero stays a zero
    }

    @Test func migratedTableAcceptsNilAndKeepsFlightIndex() throws {
        let flightID = UUID()
        let (pool, _) = try Self.makeLegacyPool(flightID: flightID)
        let db = try RecordingDatabase(dbPool: pool)

        try db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, timestamp: Date(timeIntervalSince1970: 10), text: "unscored",
            confidence: nil, audioStartTime: 0, audioEndTime: 1, flightPhase: "cruise"))

        let stored = try db.transcriptSegments(forFlight: flightID).last
        #expect(stored?.text == "unscored")
        #expect(stored?.confidence == nil)

        let indexes = try pool.read { db in
            try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transcript_segments'")
        }
        #expect(indexes.contains("idx_transcript_segments_flight"))
    }

    @Test func freshDatabaseStoresNilConfidence() throws {
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: Self.tempPath()))
        let flightID = UUID()
        try db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, text: "no score", confidence: nil,
            audioStartTime: 0, audioEndTime: 1, flightPhase: "taxi"))
        try db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, timestamp: Date().addingTimeInterval(1), text: "scored", confidence: 0.7,
            audioStartTime: 1, audioEndTime: 2, flightPhase: "taxi"))

        let segments = try db.transcriptSegments(forFlight: flightID)
        #expect(segments.first?.confidence == nil)
        #expect(segments.last?.confidence == 0.7)
    }
}
