//
//  FlightRecoveryTests.swift
//  efb-212Tests
//
//  Launch-time recovery of recordings the app never finished (efb crash/kill recovery).
//

import Testing
import Foundation
import GRDB
import SwiftData
@testable import efb_212

@Suite("Flight recovery", .serialized)
@MainActor
struct FlightRecoveryTests {

    static let start = Date(timeIntervalSince1970: 1_700_000_000)

    struct Fixture {
        let db: RecordingDatabase
        let dbURL: URL
        let audioDir: URL
        let context: ModelContext
        let service: FlightRecoveryService

        func cleanup() {
            for suffix in ["", "-wal", "-shm"] {
                try? FileManager.default.removeItem(atPath: dbURL.path + suffix)
            }
            try? FileManager.default.removeItem(at: audioDir)
        }
    }

    static func makeFixture() throws -> Fixture {
        let dbURL = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-\(UUID().uuidString).sqlite")
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: dbURL.path))
        let audioDir = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-audio-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
        let persistence = FlightPersistenceService(recordingDB: db, databaseService: nil)
        let service = FlightRecoveryService(recordingDB: db, persistence: persistence, audioDirectory: audioDir)
        return Fixture(db: db, dbURL: dbURL, audioDir: audioDir,
                       context: try FlightPersistenceTests.makeContext(), service: service)
    }

    static func insertTrack(_ db: RecordingDatabase, flightID: UUID, count: Int) throws {
        for i in 0..<count {
            try db.insertTrackPoint(TrackPointRecord(
                flightID: flightID, timestamp: start.addingTimeInterval(Double(i) * 10),
                latitude: 37.4611, longitude: -122.1150, altitudeFeet: 1000,  // feet MSL
                groundSpeedKnots: 90, verticalSpeedFPM: 0, courseDegrees: 90
            ))
        }
    }

    static func writeAudio(_ dir: URL, flightID: UUID) throws -> URL {
        let url = dir.appendingPathComponent("\(flightID.uuidString).m4a")
        try Data(repeating: 0x41, count: 256).write(to: url)
        return url
    }

    @Test func orphanedTrackAndAudioBecomeARecoveredFlightAndDraftLogbookEntry() throws {
        let f = try Self.makeFixture()
        defer { f.cleanup() }
        let flightID = UUID()
        try Self.insertTrack(f.db, flightID: flightID, count: 4)
        try f.db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, timestamp: Self.start, text: "Palo Alto traffic", confidence: 0.9,
            audioStartTime: 0, audioEndTime: 1, flightPhase: "taxi"
        ))
        let audio = try Self.writeAudio(f.audioDir, flightID: flightID)

        let recovered = f.service.recoverOrphans(modelContext: f.context)

        #expect(recovered == [flightID])
        let flight = try #require(try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.id == flightID)
        #expect(flight.isRecovered)
        #expect(flight.healthWarning == "Recovered")
        #expect(flight.trackPointCount == 4)
        #expect(flight.transcriptSegmentCount == 1)
        #expect(flight.startDate == Self.start)
        #expect(flight.durationSeconds == 30)   // seconds, first to last fix
        #expect(flight.audioFileURL?.hasSuffix("\(flightID.uuidString).m4a") == true)
        #expect(try f.context.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).count == 1)
        #expect(f.context.hasChanges == false)
        // Nothing was deleted.
        #expect(FileManager.default.fileExists(atPath: audio.path))
        #expect(try f.db.trackPoints(forFlight: flightID).count == 4)
    }

    @Test func recoveryRunsOnceAndSkipsFlightsThatAlreadyHaveARecord() throws {
        let f = try Self.makeFixture()
        defer { f.cleanup() }
        let orphan = UUID()
        let saved = UUID()
        try Self.insertTrack(f.db, flightID: orphan, count: 2)
        try Self.insertTrack(f.db, flightID: saved, count: 2)
        let existing = SchemaV1.FlightRecord()
        existing.id = saved
        f.context.insert(existing)
        try f.context.save()

        #expect(f.service.recoverOrphans(modelContext: f.context) == [orphan])
        #expect(f.service.recoverOrphans(modelContext: f.context).isEmpty)
        let ids = try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).map(\.id)
        #expect(Set(ids) == [orphan, saved])
        #expect(ids.count == 2)
        #expect(try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>())
            .first { $0.id == saved }?.isRecovered == false)
    }

    @Test func aRecordingInProgressIsNeverRecovered() throws {
        let f = try Self.makeFixture()
        defer { f.cleanup() }
        let active = UUID()
        try Self.insertTrack(f.db, flightID: active, count: 3)

        #expect(f.service.recoverOrphans(modelContext: f.context, activeFlightID: active).isEmpty)
        #expect(try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).isEmpty)
    }

    @Test func audioWithNoTrackIsStillRecoveredNotDeleted() throws {
        let f = try Self.makeFixture()
        defer { f.cleanup() }
        let flightID = UUID()
        let audio = try Self.writeAudio(f.audioDir, flightID: flightID)

        #expect(f.service.recoverOrphans(modelContext: f.context) == [flightID])
        let flight = try #require(try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.trackPointCount == 0)
        #expect(flight.isRecovered)
        #expect(FileManager.default.fileExists(atPath: audio.path))
    }

    @Test func anOrphanWhoseTrackCannotBeReadIsLeftUntouchedForTheNextLaunch() throws {
        let f = try Self.makeFixture()
        defer { f.cleanup() }
        let flightID = UUID()
        try Self.insertTrack(f.db, flightID: flightID, count: 2)
        let audio = try Self.writeAudio(f.audioDir, flightID: flightID)
        try f.db.dbPool.write { try $0.execute(sql: "ALTER TABLE track_points RENAME TO track_points_hidden") }

        // The track table is unreachable; transcripts and audio exist but the read error must not
        // turn into a deletion or a half-built record.
        #expect(f.service.recoverOrphans(modelContext: f.context).isEmpty)
        #expect(try f.context.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).isEmpty)
        #expect(FileManager.default.fileExists(atPath: audio.path))
    }
}
