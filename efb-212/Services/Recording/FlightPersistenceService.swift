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
import OSLog

/// Outcome of persisting a stopped recording.
enum FlightPersistenceResult: Sendable, Equatable {
    /// A FlightRecord and draft LogbookEntry were created and saved.
    case saved
    /// The recording had no track points; its data was deleted.
    case discardedEmpty
    /// The track could not be read. The flight and its audio were kept and the record is marked damaged.
    case savedTrackUnreadable
    /// The records could not be saved. The recording data is untouched and is recovered at next launch.
    case saveFailed
}

@MainActor
protocol FlightPersistenceServiceProtocol {
    /// Persist a stopped recording: inserts into `modelContext` and saves it.
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

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "FlightPersistence")

    func persist(
        summary: FlightRecordingSummary,
        aircraftProfileID: UUID?,
        pilotProfileID: UUID?,
        modelContext: ModelContext
    ) -> FlightPersistenceResult {
        store(
            summary: summary, aircraftProfileID: aircraftProfileID, pilotProfileID: pilotProfileID,
            modelContext: modelContext, origin: .stopped
        )
    }

    /// Why a FlightRecord is being created.
    enum Origin: Sendable {
        /// The pilot (or auto-stop) ended the recording.
        case stopped
        /// Launch-time recovery of a recording the app never finished (crash or kill).
        case recovered
    }

    /// Create the FlightRecord and draft logbook entry and save them. Never deletes anything when
    /// the track cannot be read, and never relies on SwiftData autosave.
    func store(
        summary: FlightRecordingSummary,
        aircraftProfileID: UUID?,
        pilotProfileID: UUID?,
        modelContext: ModelContext,
        origin: Origin
    ) -> FlightPersistenceResult {
        // The database is the truth for the track, not the coordinator's counter.
        // A read ERROR is not an empty track: keep the flight and its audio, and mark it damaged.
        let track: [TrackPointRecord]
        var trackUnreadable = false
        do {
            track = try recordingDB.trackPoints(forFlight: summary.flightID)
        } catch {
            logger.error("Track unreadable for \(summary.flightID.uuidString): \(error.localizedDescription)")
            track = []
            trackUnreadable = true
        }

        // Recovery keeps flights with audio or transcript but no track; only a normal stop discards.
        if !trackUnreadable && track.isEmpty && origin == .stopped {
            discard(summary)
            return .discardedEmpty
        }

        let first = track.first
        let last = track.last
        let departure = first.flatMap { nearestAirport(latitude: $0.latitude, longitude: $0.longitude) }
        let arrival = last.flatMap { nearestAirport(latitude: $0.latitude, longitude: $0.longitude) }

        let record = SchemaV1.FlightRecord()
        record.id = summary.flightID
        record.startDate = summary.startDate
        record.endDate = summary.endDate
        record.durationSeconds = summary.endDate.timeIntervalSince(summary.startDate)  // seconds
        record.departureICAO = departure?.icao
        record.departureName = departure?.name
        record.arrivalICAO = arrival?.icao
        record.arrivalName = arrival?.name
        record.trackPointCount = trackUnreadable ? summary.trackPointCount : track.count
        record.transcriptSegmentCount = summary.transcriptSegmentCount
        record.audioFileURL = summary.audioFileURL.flatMap(Self.relativeToApplicationSupport)
        record.aircraftProfileID = aircraftProfileID?.uuidString
        record.pilotProfileID = pilotProfileID?.uuidString
        if trackUnreadable {
            record.notes = SchemaV1.FlightRecord.trackUnreadableNote
        } else if origin == .recovered {
            record.notes = SchemaV1.FlightRecord.recoveredNote
        }
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

        // Save now: a kill right after stop must not lose the History row while track and audio stay.
        // On failure the recording data is untouched, so launch-time recovery rebuilds the record.
        do {
            try modelContext.save()
        } catch {
            logger.error("Saving flight \(summary.flightID.uuidString) failed: \(error.localizedDescription)")
            return .saveFailed
        }
        return trackUnreadable ? .savedTrackUnreadable : .saved
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

    /// Delete a recording with no track. Only called after the track was READ successfully and was
    /// empty; a read error never reaches here (see `persist`).
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
