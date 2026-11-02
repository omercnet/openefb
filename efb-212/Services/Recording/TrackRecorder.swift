//
//  TrackRecorder.swift
//  efb-212
//
//  GPS track capture actor. Consumes CLLocationUpdate.liveUpdates(.airborne)
//  and writes TrackPointRecord to RecordingDatabase at 1Hz.
//  Owns a FlightPhaseDetector and a VerticalSpeedEstimator and publishes phase changes.
//
//  Uses CLBackgroundActivitySession for background GPS (stored as strong property).
//

import Foundation
import CoreLocation

/// Summary returned when track recording stops.
nonisolated struct TrackRecorderSummary: Sendable {
    let trackPointCount: Int      // points actually stored
    let failedWriteCount: Int     // points that could not be written
    let streamFailed: Bool        // the location stream threw while tracking
    let phaseMarkers: [PhaseMarkerRecord]
    let currentPhase: FlightPhaseType
}

actor TrackRecorder {

    // MARK: - Properties

    private let recordingDB: RecordingDatabase
    private var phaseDetector: FlightPhaseDetector
    private var verticalSpeedEstimator = VerticalSpeedEstimator()
    private var trackingTask: Task<Void, Never>?
    private var backgroundSession: CLBackgroundActivitySession?
    private let flightID: UUID
    private var _trackPointCount: Int = 0
    private var _failedWriteCount: Int = 0
    private var _streamFailed = false
    private var lastFixTimestamp: Date?
    private var _currentPhase: FlightPhaseType = .preflight

    /// Phase change callback -- called on each phase transition.
    var onPhaseChange: (@Sendable (FlightPhaseType, PhaseMarkerRecord) -> Void)?

    /// Called once, on the first track point that could not be written.
    var onWriteFailure: (@Sendable (Error) -> Void)?

    /// Called when the location stream throws while tracking (the track stops growing).
    var onStreamFailure: (@Sendable (Error) -> Void)?

    func setFailureHandlers(
        onWriteFailure: (@Sendable (Error) -> Void)?,
        onStreamFailure: (@Sendable (Error) -> Void)?
    ) {
        self.onWriteFailure = onWriteFailure
        self.onStreamFailure = onStreamFailure
    }

    // MARK: - Init

    init(recordingDB: RecordingDatabase, flightID: UUID) {
        self.recordingDB = recordingDB
        self.flightID = flightID
        self.phaseDetector = FlightPhaseDetector()
    }

    // MARK: - Public API

    var currentPhase: FlightPhaseType {
        _currentPhase
    }

    var trackPointCount: Int {
        _trackPointCount
    }

    /// Last smoothed vertical speed in feet per minute.
    var verticalSpeedFPM: Double {
        verticalSpeedEstimator.verticalSpeedFPM
    }

    /// A stream failure ends the track silently otherwise; flag it for the summary and callback.
    private func noteStreamFailure(_ error: Error) {
        _streamFailed = true
        onStreamFailure?(error)
    }

    /// Start GPS tracking via CLLocationUpdate.liveUpdates(.airborne).
    /// Creates CLBackgroundActivitySession for background operation.
    func startTracking() async {
        // Enable background GPS tracking
        backgroundSession = CLBackgroundActivitySession()

        trackingTask = Task { [weak self] in
            let updates = CLLocationUpdate.liveUpdates(.airborne)

            do {
                for try await update in updates {
                    guard !Task.isCancelled else { break }
                    guard let location = update.location else { continue }
                    guard let self else { break }
                    await self.ingest(location)
                }
            } catch {
                // CLLocationUpdate can throw on cancellation or auth denial. A throw while still
                // tracking means the track stops growing: record it and tell the coordinator.
                if !Task.isCancelled, let self {
                    await self.noteStreamFailure(error)
                }
            }
        }
    }

    /// Stop GPS tracking and return summary. The still-open final phase marker is closed at the
    /// last fix, in the database and in the returned summary.
    func stopTracking() -> TrackRecorderSummary {
        trackingTask?.cancel()
        trackingTask = nil
        backgroundSession?.invalidate()
        backgroundSession = nil

        var markers = phaseDetector.phaseMarkers
        if let last = markers.last, last.endTimestamp == nil, let end = lastFixTimestamp {
            try? recordingDB.updatePhaseMarkerEnd(id: last.id, endTimestamp: end)
            markers[markers.count - 1] = PhaseMarkerRecord(
                id: last.id, flightID: last.flightID, phase: last.phase,
                startTimestamp: last.startTimestamp, endTimestamp: end,
                latitude: last.latitude, longitude: last.longitude
            )
        }

        return TrackRecorderSummary(
            trackPointCount: _trackPointCount,
            failedWriteCount: _failedWriteCount,
            streamFailed: _streamFailed,
            phaseMarkers: markers,
            currentPhase: _currentPhase
        )
    }

    /// Process one GPS fix: convert to aviation units, estimate vertical speed,
    /// persist the track point, and advance the phase detector.
    /// Internal (not private) so tests can drive it with synthetic CLLocations.
    func ingest(_ location: CLLocation) {
        // Convert CLLocation to aviation units (same conversions as LocationService)
        let speedKnots = max(0, location.speed * 1.94384)  // m/s to knots
        let altitudeFeet = location.altitude / 0.3048       // meters to feet MSL
        let trackDegrees = location.course >= 0 ? location.course : 0  // degrees true

        // Vertical speed from successive fixes, keyed on the fix timestamp (feet per minute)
        let vsi = verticalSpeedEstimator.update(
            altitudeFeet: altitudeFeet,
            timestamp: location.timestamp,
            verticalAccuracyMeters: location.verticalAccuracy
        )

        let point = TrackPointRecord(
            flightID: flightID,
            timestamp: location.timestamp,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitudeFeet: altitudeFeet,
            groundSpeedKnots: speedKnots,
            verticalSpeedFPM: vsi,
            courseDegrees: trackDegrees
        )

        // Write to GRDB (append-only, no memory accumulation). Only stored points are counted:
        // the stop summary must not report a track that was never written.
        do {
            try recordingDB.insertTrackPoint(point)
            _trackPointCount += 1
        } catch {
            _failedWriteCount += 1
            if _failedWriteCount == 1 {
                onWriteFailure?(error)  // once per recording; later failures only add to the count
            }
        }
        lastFixTimestamp = location.timestamp

        // Run through phase detector
        let previousPhase = _currentPhase
        // verticalAccuracy < 0: no altitude (Wi-Fi-only fix); phase detection falls back to speed
        let newPhase = phaseDetector.process(point, hasAltitude: location.verticalAccuracy >= 0)
        _currentPhase = newPhase

        if newPhase != previousPhase, let lastMarker = phaseDetector.phaseMarkers.last {
            try? recordingDB.insertPhaseMarker(lastMarker)
            // The detector closed the previous marker in memory at this fix; store that end time.
            let markers = phaseDetector.phaseMarkers
            if markers.count >= 2, let end = markers[markers.count - 2].endTimestamp {
                try? recordingDB.updatePhaseMarkerEnd(id: markers[markers.count - 2].id, endTimestamp: end)
            }
            onPhaseChange?(newPhase, lastMarker)
        }
    }
}
