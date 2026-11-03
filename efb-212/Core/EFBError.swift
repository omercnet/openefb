//
//  EFBError.swift
//  efb-212
//
//  Centralized error types with user-facing messages.
//  Conforms to LocalizedError for SwiftUI alert integration
//  and Identifiable for .alert(item:) usage.
//

import Foundation

enum EFBError: LocalizedError, Identifiable {

    // GPS / Location
    case gpsUnavailable

    // Charts
    case chartExpired(Date)
    case chartDownloadFailed(String)
    case chartCorrupted(String)

    // Weather
    case weatherStale(TimeInterval)
    case weatherFetchFailed(underlying: Error)

    // Recording
    case recordingFailed(underlying: Error)
    case audioSessionFailed(underlying: Error)
    case transcriptionUnavailable
    case microphonePermissionDenied

    // Database
    case databaseCorrupted
    case databaseMigrationFailed(underlying: Error)

    // NASR Import
    case nasrImportFailed(underlying: Error)

    // TFR
    case tfrFetchFailed(underlying: Error)

    // Network
    case networkUnavailable

    // Debrief
    case debriefFailed(underlying: Error)
    case debriefUnavailable(reason: String)

    // Aviation Data
    case airportNotFound(String)

    // Region data (IL-2)
    case regionDataUnavailable(String)  // region display name

    // Remote config
    case remoteConfigRejected(String)  // why the downloaded file was not used

    // MARK: - Identifiable

    var id: String {
        switch self {
        case .gpsUnavailable:
            return "gpsUnavailable"
        case .chartExpired(let date):
            return "chartExpired-\(date.timeIntervalSince1970)"
        case .chartDownloadFailed(let region):
            return "chartDownloadFailed-\(region)"
        case .chartCorrupted(let region):
            return "chartCorrupted-\(region)"
        case .weatherStale(let age):
            return "weatherStale-\(age)"
        case .weatherFetchFailed:
            return "weatherFetchFailed"
        case .recordingFailed:
            return "recordingFailed"
        case .audioSessionFailed:
            return "audioSessionFailed"
        case .transcriptionUnavailable:
            return "transcriptionUnavailable"
        case .microphonePermissionDenied:
            return "microphonePermissionDenied"
        case .databaseCorrupted:
            return "databaseCorrupted"
        case .databaseMigrationFailed:
            return "databaseMigrationFailed"
        case .nasrImportFailed:
            return "nasrImportFailed"
        case .tfrFetchFailed:
            return "tfrFetchFailed"
        case .networkUnavailable:
            return "networkUnavailable"
        case .debriefFailed:
            return "debriefFailed"
        case .debriefUnavailable(let reason):
            return "debriefUnavailable-\(reason)"
        case .airportNotFound(let icao):
            return "airportNotFound-\(icao)"
        case .regionDataUnavailable(let region):
            return "regionDataUnavailable-\(region)"
        case .remoteConfigRejected(let reason):
            return "remoteConfigRejected-\(reason)"
        }
    }

    // MARK: - LocalizedError

    var errorDescription: String? {
        switch self {
        case .gpsUnavailable:
            return "No GPS position. Turn on Location for Kanaf in Settings › Privacy & Security › Location Services."

        case .chartExpired(let date):
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            return "Chart expired \(formatter.string(from: date)). Download the current chart before using it."

        case .chartDownloadFailed(let region):
            return "Chart download for \(region) failed. Check the internet connection and try again."

        case .chartCorrupted(let region):
            return "The \(region) chart file is damaged. Delete it and download it again."

        case .weatherStale(let age):
            let minutes = Int(age / 60)
            return "Weather is \(minutes) min old. Refresh before relying on it."

        case .weatherFetchFailed(let underlying):
            return "Weather download failed: \(underlying.localizedDescription)"

        case .recordingFailed(let underlying):
            return "Recording failed: \(underlying.localizedDescription)"

        case .audioSessionFailed(let underlying):
            return "Cockpit audio could not start: \(underlying.localizedDescription)"

        case .transcriptionUnavailable:
            return "Speech recognition is not available on this iPad. The flight records without a transcript."

        case .microphonePermissionDenied:
            return "Microphone is off, so no cockpit audio is recorded. Turn it on in Settings › Kanaf › Microphone."

        case .databaseCorrupted:
            return "The airport database could not be opened. Reinstall Kanaf."

        case .databaseMigrationFailed(let underlying):
            return "The flight database could not be updated: \(underlying.localizedDescription). Reinstall Kanaf."

        case .nasrImportFailed(let underlying):
            return "FAA airport data import failed: \(underlying.localizedDescription). Try again with a fresh NASR download."

        case .tfrFetchFailed(let underlying):
            return "TFRs could not be loaded: \(underlying.localizedDescription)"

        case .networkUnavailable:
            return "No internet. Weather, TFRs and downloads are unavailable; downloaded maps and the airport database still work."

        case .debriefFailed(let underlying):
            return "Debrief failed: \(underlying.localizedDescription)"

        case .debriefUnavailable(let reason):
            return reason

        case .airportNotFound(let icao):
            return "\(icao) is not in the airport database. Check the identifier."

        case .regionDataUnavailable(let region):
            return "\(region) aviation data is not installed in this build yet."

        case .remoteConfigRejected(let reason):
            return "The app configuration update was not used: \(reason). The app keeps working with its previous settings."
        }
    }

    // MARK: - Severity

    var severity: ErrorSeverity {
        switch self {
        case .gpsUnavailable:
            return .critical
        case .chartExpired:
            return .warning
        case .chartDownloadFailed:
            return .error
        case .chartCorrupted:
            return .error
        case .weatherStale:
            return .warning
        case .weatherFetchFailed:
            return .error
        case .recordingFailed:
            return .error
        case .audioSessionFailed:
            return .error
        case .transcriptionUnavailable:
            return .warning
        case .microphonePermissionDenied:
            return .error
        case .databaseCorrupted:
            return .critical
        case .databaseMigrationFailed:
            return .critical
        case .nasrImportFailed:
            return .error
        case .tfrFetchFailed:
            return .warning
        case .networkUnavailable:
            return .warning
        case .debriefFailed:
            return .error
        case .debriefUnavailable:
            return .warning
        case .airportNotFound:
            return .info
        case .regionDataUnavailable:
            return .info
        case .remoteConfigRejected:
            return .info
        }
    }
}
