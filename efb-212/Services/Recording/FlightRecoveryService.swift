//
//  FlightRecoveryService.swift
//  efb-212
//
//  Launch-time recovery of recordings the app never finished (crash, kill, or a failed save).
//  A recording writes its track and transcript to GRDB and its audio to
//  Application Support/efb-212/recordings/<flightID>.m4a as it goes, but the FlightRecord (the
//  History row) is only created when the pilot stops. An interrupted recording therefore leaves
//  data with no FlightRecord. This service rebuilds a FlightRecord, marked "Recovered", for each
//  such flight so the pilot can replay it, instead of the data sitting unreachable forever.
//
//  Nothing is ever deleted here. A flight whose track cannot be read is skipped and retried at the
//  next launch; a flight with no track, transcript or audio is left alone.
//

import AVFoundation
import Foundation
import OSLog
import SwiftData

@MainActor
final class FlightRecoveryService {

    private let recordingDB: RecordingDatabase
    private let persistence: FlightPersistenceService
    private let audioDirectory: URL
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "FlightRecovery")

    /// - Parameters:
    ///   - audioDirectory: Where `<flightID>.m4a` files live; defaults to Application Support/efb-212/recordings.
    init(
        recordingDB: RecordingDatabase,
        persistence: FlightPersistenceService,
        audioDirectory: URL = FlightRecoveryService.defaultAudioDirectory
    ) {
        self.recordingDB = recordingDB
        self.persistence = persistence
        self.audioDirectory = audioDirectory
    }

    nonisolated static var defaultAudioDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return appSupport.appendingPathComponent("efb-212/recordings", isDirectory: true)
    }

    /// Recover every orphaned recording. Returns the flight IDs that got a FlightRecord.
    /// - Parameter activeFlightID: A recording in progress right now; never touched.
    @discardableResult
    func recoverOrphans(
        modelContext: ModelContext,
        activeFlightID: UUID? = nil,
        aircraftProfileID: UUID? = nil,
        pilotProfileID: UUID? = nil
    ) -> [UUID] {
        let existing: Set<UUID>
        do {
            existing = Set(try modelContext.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).map(\.id))
        } catch {
            // Without the list of known flights we cannot tell orphans from saved flights.
            logger.error("Recovery skipped, could not list flights: \(error.localizedDescription)")
            return []
        }

        var candidates = Set<UUID>()
        do {
            candidates.formUnion(try recordingDB.flightIDsWithRecordedData())
        } catch {
            logger.error("Recovery could not list recorded flights: \(error.localizedDescription)")
        }
        candidates.formUnion(audioFlightIDs())
        candidates.subtract(existing)
        if let activeFlightID { candidates.remove(activeFlightID) }

        var recovered: [UUID] = []
        for flightID in candidates.sorted(by: { $0.uuidString < $1.uuidString }) {
            guard let summary = summary(for: flightID) else { continue }
            let result = persistence.store(
                summary: summary,
                aircraftProfileID: aircraftProfileID,
                pilotProfileID: pilotProfileID,
                modelContext: modelContext,
                origin: .recovered
            )
            switch result {
            case .saved, .savedTrackUnreadable:
                recovered.append(flightID)
                logger.info("Recovered interrupted recording \(flightID.uuidString)")
            case .saveFailed, .discardedEmpty:
                logger.error("Could not recover \(flightID.uuidString); will retry at next launch")
            }
        }
        return recovered
    }

    // MARK: - Helpers

    /// Flight IDs of `<uuid>.m4a` files in the recordings directory.
    private func audioFlightIDs() -> [UUID] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: audioDirectory, includingPropertiesForKeys: nil
        )) ?? []
        return files.filter { $0.pathExtension == "m4a" }
            .compactMap { UUID(uuidString: $0.deletingPathExtension().lastPathComponent) }
    }

    /// Build a summary from what the recording left behind. nil when there is nothing to recover
    /// or the data cannot be read right now (left untouched, retried next launch).
    private func summary(for flightID: UUID) -> FlightRecordingSummary? {
        let track: [TrackPointRecord]
        let transcripts: [TranscriptSegmentRecord]
        let phases: [PhaseMarkerRecord]
        do {
            track = try recordingDB.trackPoints(forFlight: flightID)
            transcripts = try recordingDB.transcriptSegments(forFlight: flightID)
            phases = try recordingDB.phaseMarkers(forFlight: flightID)
        } catch {
            logger.error("Recovery skipped \(flightID.uuidString), data unreadable: \(error.localizedDescription)")
            return nil
        }

        let audioURL = audioDirectory.appendingPathComponent("\(flightID.uuidString).m4a")
        let hasAudio = FileManager.default.fileExists(atPath: audioURL.path)
        guard !track.isEmpty || !transcripts.isEmpty || hasAudio else { return nil }

        let audioSeconds = hasAudio ? Self.audioDuration(audioURL) : 0  // seconds
        let audioCreated = hasAudio
            ? (try? FileManager.default.attributesOfItem(atPath: audioURL.path)[.creationDate] as? Date) ?? nil
            : nil

        let start = track.first?.timestamp ?? transcripts.first?.timestamp ?? audioCreated ?? Date()
        let end = track.last?.timestamp
            ?? transcripts.last?.timestamp
            ?? start.addingTimeInterval(audioSeconds)

        return FlightRecordingSummary(
            flightID: flightID,
            startDate: start,
            endDate: max(end, start),
            trackPointCount: track.count,
            transcriptSegmentCount: transcripts.count,
            departureICAO: nil,
            arrivalICAO: nil,
            phases: phases,
            audioFileURL: hasAudio ? audioURL : nil
        )
    }

    /// Length of an audio file in seconds; 0 when it cannot be opened (a crash can leave it truncated).
    private nonisolated static func audioDuration(_ url: URL) -> Double {
        guard let file = try? AVAudioFile(forReading: url), file.fileFormat.sampleRate > 0 else { return 0 }
        return Double(file.length) / file.fileFormat.sampleRate
    }
}
