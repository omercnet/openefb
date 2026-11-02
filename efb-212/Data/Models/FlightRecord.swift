//
//  FlightRecord.swift
//  efb-212
//
//  SwiftData model for flight recording metadata.
//  Stored in SchemaV1 for versioned migration support.
//  GRDB stores the high-frequency data (track points, transcripts);
//  this SwiftData model stores the flight-level metadata and summary.
//

import Foundation
import SwiftData

extension SchemaV1 {

    @Model
    final class FlightRecord {
        /// Unique identifier for this flight recording.
        var id: UUID = UUID()

        /// When the recording started.
        var startDate: Date = Date()

        /// When the recording ended (nil if still recording).
        var endDate: Date?

        /// Departure airport ICAO identifier (detected from nearest airport at start).
        var departureICAO: String?

        /// Arrival airport ICAO identifier (detected from nearest airport at end).
        var arrivalICAO: String?

        /// Departure airport display name.
        var departureName: String?

        /// Arrival airport display name.
        var arrivalName: String?

        /// Total recording duration -- seconds.
        var durationSeconds: Double = 0

        /// Relative path to the recorded audio file (within app's documents directory).
        var audioFileURL: String?

        /// Audio quality profile used for this recording ("standard" or "high").
        var audioQuality: String = "standard"  // AudioQualityProfile raw value

        /// Total number of GPS track points recorded.
        var trackPointCount: Int = 0

        /// Total number of transcript segments recorded.
        var transcriptSegmentCount: Int = 0

        /// UUID string of the aircraft profile used during this flight.
        var aircraftProfileID: String?

        /// UUID string of the pilot profile used during this flight.
        var pilotProfileID: String?

        /// Whether an AI debrief has been generated for this flight (Phase 4).
        var hasDebrief: Bool = false

        /// Free-text pilot notes about this flight.
        var notes: String?

        /// Date this record was created.
        var createdAt: Date = Date()

        init() {}
    }
}

// MARK: - Recording health

/// A FlightRecord kept despite a problem with its recording. The state lives in `notes` (which the
/// History and Detail views surface) so no SchemaV1 attribute is added; a SchemaV2 can promote it.
extension SchemaV1.FlightRecord {
    nonisolated static let trackUnreadableNote =
        "Track could not be read. The flight and its audio were kept; try again after restarting the app."
    nonisolated static let recoveredNote =
        "Recovered: the app closed while this flight was recording. The track and audio were kept."

    /// The track exists but could not be read when the recording stopped.
    var isTrackUnreadable: Bool { notes?.hasPrefix(Self.trackUnreadableNote) == true }

    /// Rebuilt at launch from an interrupted recording.
    var isRecovered: Bool { notes?.hasPrefix(Self.recoveredNote) == true }

    /// Short caution for lists; nil for a normal flight.
    var healthWarning: String? {
        if isTrackUnreadable { return "Track damaged" }
        if isRecovered { return "Recovered" }
        return nil
    }
}
