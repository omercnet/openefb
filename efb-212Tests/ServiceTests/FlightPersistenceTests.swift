//
//  FlightPersistenceTests.swift
//  efb-212Tests
//
//  Stopping a recording must yield exactly one FlightRecord (History/Replay/Debrief)
//  and one draft logbook entry; a recording with no track is discarded.
//

import Testing
import Foundation
import SwiftData
@testable import efb_212

@Suite("FlightPersistence Tests", .serialized)
@MainActor
struct FlightPersistenceTests {

    static let kpao = Airport(
        icao: "KPAO", name: "Palo Alto", latitude: 37.4611, longitude: -122.1150,
        elevation: 4, type: .airport, ownership: .publicOwned
    )

    static let start = Date(timeIntervalSince1970: 1_700_000_000)

    /// Keeps containers alive for the duration of the test run (ModelContext holds them weakly).
    nonisolated(unsafe) static var containers: [ModelContainer] = []

    static func makeContext() throws -> ModelContext {
        let container = try ModelContainer(
            for: SchemaV1.FlightRecord.self, SchemaV1.LogbookEntry.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        containers.append(container)
        return container.mainContext
    }

    static func summary(flightID: UUID, durationSeconds: Double, points: Int) -> FlightRecordingSummary {
        FlightRecordingSummary(
            flightID: flightID,
            startDate: start,
            endDate: start.addingTimeInterval(durationSeconds),
            trackPointCount: points,
            transcriptSegmentCount: 0,
            departureICAO: nil,
            arrivalICAO: nil,
            phases: [],
            audioFileURL: nil
        )
    }

    static func service(db: RecordingDatabase, airports: [Airport]) -> FlightPersistenceService {
        let mock = MockDatabaseManager()
        mock.airports = airports
        return FlightPersistenceService(recordingDB: db, databaseService: mock)
    }

    @Test func stopWithTrackCreatesOneFlightRecordAndOneDraftLogbookEntry() throws {
        let db = try RecordingCoordinatorTests.makeTempDB()
        let ctx = try Self.makeContext()
        let flightID = UUID()
        for i in 0..<5 {
            try db.insertTrackPoint(TrackPointRecord(
                flightID: flightID, timestamp: Self.start.addingTimeInterval(Double(i) * 24),
                latitude: 37.4611, longitude: -122.1150, altitudeFeet: 1000,
                groundSpeedKnots: 90, verticalSpeedFPM: 0, courseDegrees: 90
            ))
        }
        let aircraft = UUID()
        let pilot = UUID()

        let result = Self.service(db: db, airports: [Self.kpao]).persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 120, points: 5),
            aircraftProfileID: aircraft, pilotProfileID: pilot, modelContext: ctx
        )

        #expect(result == .saved)
        let flights = try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>())
        #expect(flights.count == 1)
        let flight = try #require(flights.first)
        #expect(flight.id == flightID)
        #expect(flight.startDate == Self.start)
        #expect(flight.durationSeconds == 120)
        #expect(flight.trackPointCount == 5)
        #expect(flight.departureICAO == "KPAO")
        #expect(flight.arrivalICAO == "KPAO")
        #expect(flight.aircraftProfileID == aircraft.uuidString)
        #expect(flight.pilotProfileID == pilot.uuidString)

        let entries = try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>())
        #expect(entries.count == 1)
        let entry = try #require(entries.first)
        #expect(entry.flightID == flightID)
        #expect(entry.date == Self.start)
        #expect(entry.departureICAO == "KPAO")
        #expect(entry.durationSeconds == 120)
        #expect(entry.isConfirmed == false)
    }

    @Test func stopWithNoTrackPointsDiscardsEverything() throws {
        let db = try RecordingCoordinatorTests.makeTempDB()
        let ctx = try Self.makeContext()
        let flightID = UUID()

        let result = Self.service(db: db, airports: [Self.kpao]).persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 5, points: 0),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .discardedEmpty)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).isEmpty)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).isEmpty)
    }

    @Test func unavailableAirportDatabaseStillSavesWithoutAirports() throws {
        let db = try RecordingCoordinatorTests.makeTempDB()
        let ctx = try Self.makeContext()
        let flightID = UUID()
        try db.insertTrackPoint(TrackPointRecord(
            flightID: flightID, latitude: 37.4, longitude: -122.1, altitudeFeet: 500,
            groundSpeedKnots: 80, verticalSpeedFPM: 0, courseDegrees: 0
        ))

        let service = FlightPersistenceService(recordingDB: db, databaseService: nil)
        let result = service.persist(
            summary: Self.summary(flightID: flightID, durationSeconds: 60, points: 1),
            aircraftProfileID: nil, pilotProfileID: nil, modelContext: ctx
        )

        #expect(result == .saved)
        let flight = try #require(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).first)
        #expect(flight.departureICAO == nil)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).count == 1)
    }
}
