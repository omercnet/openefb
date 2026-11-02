//
//  FlightPersistenceStopPathCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization tests: pin what FlightPersistenceService.persist does TODAY on the
//  stop path (read errors, discard of empty flights, counts, airport choice, audio path,
//  context save). Asserts marked BUG pin current wrong behavior on purpose.
//

import Testing
import Foundation
import GRDB
import SwiftData
@testable import efb_212

/// Temp-file recording database, removed (with its WAL/SHM side files) by the caller's defer.
private enum TempRecordingDB {
    static func make() throws -> (db: RecordingDatabase, url: URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("char-persist-\(UUID().uuidString).sqlite")
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: url.path))
        return (db, url)
    }

    static func remove(_ url: URL) {
        for suffix in ["", "-wal", "-shm"] {
            try? FileManager.default.removeItem(atPath: url.path + suffix)
        }
    }

    /// A real (tiny) audio file standing in for the recording's .m4a.
    static func makeAudioFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("char-audio-\(UUID().uuidString).m4a")
        try Data([0x00, 0x01, 0x02]).write(to: url)
        return url
    }
}

@Suite("Characterization: FlightPersistence stop path", .serialized)
@MainActor
struct FlightPersistenceStopPathCharacterizationTests {

    static let start = Date(timeIntervalSince1970: 1_700_000_000)

    static func summary(
        flightID: UUID,
        durationSeconds: Double,
        points: Int,
        audio: URL? = nil
    ) -> FlightRecordingSummary {
        FlightRecordingSummary(
            flightID: flightID,
            startDate: start,
            endDate: start.addingTimeInterval(durationSeconds),  // seconds
            trackPointCount: points,
            transcriptSegmentCount: 0,
            departureICAO: nil,
            arrivalICAO: nil,
            phases: [],
            audioFileURL: audio
        )
    }

    static func airport(_ icao: String, type: AirportType) -> Airport {
        Airport(
            icao: icao, name: icao, latitude: 37.4611, longitude: -122.1150,
            elevation: 4, type: type, ownership: .publicOwned  // elevation feet MSL
        )
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

    // MARK: - Read error

    @Test func unreadableTrackTableKeepsTheFlightItsAudioAndItsDataAndMarksItDamaged() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = try TempRecordingDB.makeAudioFile()
        defer { try? FileManager.default.removeItem(at: audio) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try Self.insertTrack(db, flightID: flightID, count: 3)
        try db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, timestamp: Self.start, text: "Palo Alto tower", confidence: 0.9,
            audioStartTime: 0, audioEndTime: 1, flightPhase: "taxi"
        ))
        try db.dbPool.write { try $0.execute(sql: "DROP TABLE track_points") }

        let service = FlightPersistenceService(recordingDB: db, databaseService: nil)
        let result = service.persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 600, points: 3, audio: audio),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        // efb-7xe: a READ error is not an empty flight. Nothing is deleted; the flight is marked damaged.
        #expect(result == .savedTrackUnreadable)
        let flight = try #require(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.id == flightID)
        #expect(flight.isTrackUnreadable)
        #expect(flight.healthWarning == "Track damaged")
        #expect(flight.trackPointCount == 3)   // the coordinator's count; the table cannot be read
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).count == 1)
        #expect(FileManager.default.fileExists(atPath: audio.path))
        #expect(try db.transcriptSegments(forFlight: flightID).count == 1)
        #expect(ctx.hasChanges == false)
    }

    // MARK: - Discard of an empty flight

    @Test func emptyFlightDiscardRemovesAudioTranscriptPhasesAndDebrief() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = try TempRecordingDB.makeAudioFile()
        defer { try? FileManager.default.removeItem(at: audio) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try db.insertTranscript(TranscriptSegmentRecord(
            flightID: flightID, timestamp: Self.start, text: "ground, ready to taxi", confidence: 0.8,
            audioStartTime: 0, audioEndTime: 2, flightPhase: "preflight"
        ))
        try db.insertPhaseMarker(PhaseMarkerRecord(
            flightID: flightID, phase: "taxi", startTimestamp: Self.start,
            latitude: 37.4611, longitude: -122.1150
        ))
        try db.insertDebrief(DebriefRecord(
            flightID: flightID, narrativeSummary: "Short ground run.",
            phaseObservationsJSON: "[]", improvementsJSON: "[]", overallRating: 3
        ))

        let result = FlightPersistenceService(recordingDB: db, databaseService: nil).persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 30, points: 0, audio: audio),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .discardedEmpty)
        #expect(FileManager.default.fileExists(atPath: audio.path) == false)
        #expect(try db.transcriptSegments(forFlight: flightID).isEmpty)
        #expect(try db.phaseMarkers(forFlight: flightID).isEmpty)
        // efb-bep: discarding the flight also removes its debrief row.
        #expect(try db.debrief(forFlight: flightID) == nil)
    }

    // MARK: - Saved flight fields

    @Test func savedTrackPointCountComesFromDatabaseRowsNotSummary() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try Self.insertTrack(db, flightID: flightID, count: 5)

        let result = FlightPersistenceService(recordingDB: db, databaseService: nil).persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 1_830, points: 99),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .saved)
        let flight = try #require(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.trackPointCount == 5)          // database rows, not the summary's 99
        #expect(flight.durationSeconds == 1_830)      // seconds, endDate - startDate
    }

    // MARK: - Airport preference

    @Test func departurePrefersLaterRealAirportOverNearerHeliportAndSeaplaneBase() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try Self.insertTrack(db, flightID: flightID, count: 2)

        let service = FlightPersistenceTests.service(db: db, airports: [
            Self.airport("15CA", type: .heliport),
            Self.airport("S00", type: .seaplane),
            Self.airport("KPAO", type: .airport),
        ])
        let result = service.persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 60, points: 2),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .saved)
        let flight = try #require(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.departureICAO == "KPAO")
        #expect(flight.arrivalICAO == "KPAO")
    }

    @Test func onlyHeliportsNearbyUsesTheFirstHeliport() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try Self.insertTrack(db, flightID: flightID, count: 2)

        let service = FlightPersistenceTests.service(db: db, airports: [
            Self.airport("15CA", type: .heliport),
            Self.airport("16CA", type: .heliport),
        ])
        _ = service.persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 60, points: 2),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        let flight = try #require(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.departureICAO == "15CA")
        #expect(flight.arrivalICAO == "15CA")
    }

    // MARK: - Audio path

    @Test func audioPathInsideApplicationSupportIsStoredRelative() throws {
        let appSupport = try #require(
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        )
        let url = appSupport.appendingPathComponent("efb-212/recordings/ABC.m4a")
        #expect(FlightPersistenceService.relativeToApplicationSupport(url) == "efb-212/recordings/ABC.m4a")
    }

    @Test func audioPathOutsideApplicationSupportIsStoredAbsolute() {
        let url = URL(fileURLWithPath: "/tmp/x.m4a")
        #expect(FlightPersistenceService.relativeToApplicationSupport(url) == "/tmp/x.m4a")
    }

    // MARK: - Context save

    @Test func persistSavesTheContextExplicitly() throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let ctx = try FlightPersistenceTests.makeContext()
        let flightID = UUID()
        try Self.insertTrack(db, flightID: flightID, count: 2)

        let result = FlightPersistenceService(recordingDB: db, databaseService: nil).persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 60, points: 2),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .saved)
        // efb-cul: the FlightRecord and draft LogbookEntry are saved, not left to autosave.
        #expect(ctx.hasChanges == false)
    }
}
