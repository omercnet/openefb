//
//  FlightPersistenceService.swift
//  efb-212
//
//  The single place that turns a stopped recording into user data:
//  one SchemaV1.FlightRecord (Flights > History, Replay, Debrief) and one
//  draft LogbookEntry (Logbook tab, isConfirmed == false). The FlightRecord's
//  id equals the recording-database flight ID, which is how Replay and Debrief
//  find the track, transcript and phases in GRDB.
//
//  Empty-recording policy: a recording that wrote NO track points (started and
//  stopped on the ramp, GPS never delivered a fix, countdown stop) is DISCARDED.
//  Its GRDB rows and audio file are deleted and nothing appears in History or
//  the Logbook. A flight with no track is not replayable and would only clutter
//  the pilot's history with "---" rows. Short recordings with at least one track
//  point are kept.
//

import CoreLocation
import Foundation
import SwiftData

/// Outcome of persisting a stopped recording.
enum FlightPersistenceResult: Sendable {
    /// A FlightRecord and draft LogbookEntry were created.
    case saved
    /// The recording had no track points; its data was deleted.
    case discardedEmpty
}

@MainActor
protocol FlightPersistenceServiceProtocol {
    /// Persist a stopped recording. Inserts into `modelContext` (SwiftData autosaves).
    func persist(
        summary: FlightRecordingSummary,
        aircraftProfileID: UUID?,
        pilotProfileID: UUID?,
        modelContext: ModelContext
    ) -> FlightPersistenceResult
}

@MainActor
final class FlightPersistenceService: FlightPersistenceServiceProtocol {

    private let recordingDB: RecordingDatabase
    private let databaseService: (any DatabaseServiceProtocol)?
    private let logbook = LogbookViewModel()

    /// - Parameters:
    ///   - recordingDB: GRDB store holding the track written during the recording.
    ///   - databaseService: Aviation database for the nearest-airport lookup at the first
    ///     and last track point. nil (database unavailable) leaves departure/arrival empty.
    init(recordingDB: RecordingDatabase, databaseService: (any DatabaseServiceProtocol)?) {
        self.recordingDB = recordingDB
        self.databaseService = databaseService
    }

    func persist(
        summary: FlightRecordingSummary,
        aircraftProfileID: UUID?,
        pilotProfileID: UUID?,
        modelContext: ModelContext
    ) -> FlightPersistenceResult {
        // The database is the truth for the track, not the coordinator's counter.
        let track = (try? recordingDB.trackPoints(forFlight: summary.flightID)) ?? []

        guard let first = track.first, let last = track.last else {
            discard(summary)
            return .discardedEmpty
        }

        let departure = nearestAirport(latitude: first.latitude, longitude: first.longitude)
        let arrival = nearestAirport(latitude: last.latitude, longitude: last.longitude)

        let record = SchemaV1.FlightRecord()
        record.id = summary.flightID
        record.startDate = summary.startDate
        record.endDate = summary.endDate
        record.durationSeconds = summary.endDate.timeIntervalSince(summary.startDate)  // seconds
        record.departureICAO = departure?.icao
        record.departureName = departure?.name
        record.arrivalICAO = arrival?.icao
        record.arrivalName = arrival?.name
        record.trackPointCount = track.count
        record.transcriptSegmentCount = summary.transcriptSegmentCount
        record.audioFileURL = summary.audioFileURL.flatMap(Self.relativeToApplicationSupport)
        record.aircraftProfileID = aircraftProfileID?.uuidString
        record.pilotProfileID = pilotProfileID?.uuidString
        modelContext.insert(record)

        logbook.createFromRecording(
            summary: summary,
            departureICAO: departure?.icao,
            departureName: departure?.name,
            arrivalICAO: arrival?.icao,
            arrivalName: arrival?.name,
            aircraftProfileID: aircraftProfileID,
            aircraftType: nil,  // filled from the aircraft profile in the logbook edit view
            pilotProfileID: pilotProfileID,
            modelContext: modelContext
        )

        return .saved
    }

    // MARK: - Helpers

    private func nearestAirport(latitude: Double, longitude: Double) -> Airport? {
        guard let databaseService else { return nil }
        let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        // Several candidates: the single nearest can be a heliport or seaplane base (CL64), which is
        // not a useful departure/arrival for a logbook. Prefer the nearest real airport.
        let nearby = (try? databaseService.nearestAirports(to: coordinate, count: 8)) ?? []
        return nearby.first { $0.type == .airport } ?? nearby.first
    }

    private func discard(_ summary: FlightRecordingSummary) {
        try? recordingDB.deleteFlightData(flightID: summary.flightID)
        if let audio = summary.audioFileURL {
            try? FileManager.default.removeItem(at: audio)
        }
    }

    /// FlightRecord stores audio as a path relative to Application Support
    /// (ReplayViewModel re-roots it). Absolute URLs outside Application Support
    /// are kept as-is so nothing is silently lost.
    nonisolated static func relativeToApplicationSupport(_ url: URL) -> String {
        guard let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first else { return url.path }
        let root = appSupport.standardizedFileURL.path + "/"
        let full = url.standardizedFileURL.path
        return full.hasPrefix(root) ? String(full.dropFirst(root.count)) : full
    }
}
