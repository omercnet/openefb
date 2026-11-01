//
//  RecordingViewModel.swift
//  efb-212
//
//  Recording UI state management. Bridges RecordingCoordinator.State
//  to SwiftUI via @Observable. Handles start/stop/countdown actions,
//  formatted elapsed time, the discarded-recording notice, and stop confirmation.
//
//  Periodically syncs from coordinator state (every 0.5s) for flight phase
//  and audio level updates.
//

import AVFoundation
import CoreLocation
import Foundation
import Observation
import SwiftData

@Observable
@MainActor
final class RecordingViewModel {

    // MARK: - Observed State

    var recordingStatus: RecordingStatus = .idle
    var elapsedTime: TimeInterval = 0
    var currentPhase: FlightPhaseType = .preflight
    var recentTranscripts: [TranscriptDisplayItem] = []
    var audioLevel: Float = -160  // dBFS
    var countdownRemaining: Int = 0
    var showStopConfirmation: Bool = false
    var lastError: EFBError?
    /// The last stopped recording had no track points and was not saved. Shown until dismissed.
    var showDiscardedNotice: Bool = false
    /// True while microphone access is denied. Recording still captures the GPS track; the
    /// overlay says audio and transcript are off and how to fix it (Settings).
    var microphoneDenied: Bool = false

    // MARK: - Dependencies

    private let coordinator: RecordingCoordinator
    private weak var appState: AppState?
    private var syncTask: Task<Void, Never>?

    /// Creates the FlightRecord + draft logbook entry when a recording stops.
    var persistence: (any FlightPersistenceServiceProtocol)?

    /// SwiftData model context the persisted records are inserted into (injected from the view layer).
    var modelContext: ModelContext?

    /// What happened to the last stopped recording (saved, or discarded because it had no track).
    var lastPersistenceResult: FlightPersistenceResult?

    // MARK: - Init

    init(coordinator: RecordingCoordinator, appState: AppState) {
        self.coordinator = coordinator
        self.appState = appState
        startSyncLoop()
    }

    // syncTask is cancelled when the ViewModel goes out of scope
    // since it uses [weak self] pattern.

    // MARK: - Actions

    /// Start a new flight recording.
    func startRecording() async {
        lastError = nil
        showDiscardedNotice = false
        // Ask once (system prompt); afterwards the state comes from Settings.
        if AVAudioApplication.shared.recordPermission == .undetermined {
            _ = await AVAudioApplication.requestRecordPermission()
        }
        microphoneDenied = AVAudioApplication.shared.recordPermission == .denied
        do {
            let flightID = try await coordinator.startRecording()
            appState?.activeFlightRecordID = flightID
        } catch {
            lastError = .recordingFailed(underlying: error)
        }
    }

    /// Request stop -- shows confirmation dialog per user decision.
    func requestStop() {
        showStopConfirmation = true
    }

    /// Confirm stop after dialog approval.
    /// After stopping, FlightPersistenceService creates the FlightRecord and draft logbook entry
    /// (or discards a recording with no track points).
    func confirmStop() async {
        showStopConfirmation = false
        let summary = await coordinator.stopRecording()
        appState?.activeFlightRecordID = nil
        // Don't leave the shared status at .recording until the next 0.5 s sync tick:
        // Flight Detail disables Replay while it isn't .idle.
        appState?.recordingStatus = .idle

        guard let summary, let persistence, let ctx = modelContext else { return }
        let result = persistence.persist(
            summary: summary,
            aircraftProfileID: appState?.activeAircraftProfileID,
            pilotProfileID: appState?.activePilotProfileID,
            modelContext: ctx
        )
        lastPersistenceResult = result
        showDiscardedNotice = Self.shouldShowDiscardedNotice(for: result)
    }

    /// A recording with no track points is discarded; tell the pilot instead of dropping it silently.
    nonisolated static func shouldShowDiscardedNotice(for result: FlightPersistenceResult) -> Bool {
        if case .discardedEmpty = result { return true }
        return false
    }

    /// How serious `lastError` is for the pilot.
    nonisolated enum ProblemSeverity: Equatable, Sendable {
        /// Recording continues (e.g. the audio stopped but the GPS track is still recording). Amber.
        case caution
        /// Recording has stopped or never started. Red.
        case warning
    }

    /// Amber while the recording is still running (recording or paused); red once it has stopped
    /// or failed to start (idle, countdown cancelled, stopping).
    nonisolated static func problemSeverity(for status: RecordingStatus) -> ProblemSeverity {
        switch status {
        case .recording, .paused: return .caution
        case .idle, .countdown, .stopping: return .warning
        }
    }

    /// Severity of the current `lastError`, from the live recording status.
    var lastErrorSeverity: ProblemSeverity { Self.problemSeverity(for: recordingStatus) }

    /// Clear the recording problem notice.
    func dismissError() { lastError = nil }

    /// Cancel an active auto-start countdown.
    func cancelCountdown() async {
        await coordinator.cancelCountdown()
    }


    // MARK: - Formatted Output

    /// Formatted elapsed time as "HH:MM:SS".
    var formattedElapsedTime: String {
        let totalSeconds = Int(elapsedTime)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }

    /// Whether the recorder is actively recording (not idle/stopping).
    var isRecording: Bool {
        if case .recording = recordingStatus { return true }
        return false
    }

    /// Whether a countdown is active.
    var isCountingDown: Bool {
        if case .countdown = recordingStatus { return true }
        return false
    }

    // MARK: - State Sync

    /// Periodically sync from RecordingCoordinator.State to update UI.
    private func startSyncLoop() {
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self else { break }

                let state = self.coordinator.state
                self.recordingStatus = state.recordingStatus
                // Covers auto-started recordings and permission changed in Settings mid-flight.
                self.microphoneDenied = state.recordingStatus == .recording
                    && AVAudioApplication.shared.recordPermission == .denied
                self.elapsedTime = state.elapsedTime
                self.currentPhase = state.currentPhase
                self.recentTranscripts = state.recentTranscripts
                self.audioLevel = state.audioLevel
                self.countdownRemaining = state.countdownRemaining

                // Surface mid-recording failures (e.g. audio write error) once
                if let error = state.lastError {
                    self.lastError = error
                    state.lastError = nil
                }

                // Sync key state to AppState for cross-tab visibility
                if let appState = self.appState {
                    appState.recordingStatus = state.recordingStatus
                    appState.currentFlightPhase = state.currentPhase
                    appState.recordingElapsedTime = state.elapsedTime
                    appState.recentTranscripts = state.recentTranscripts
                    appState.audioLevel = state.audioLevel
                }
            }
        }
    }
}
