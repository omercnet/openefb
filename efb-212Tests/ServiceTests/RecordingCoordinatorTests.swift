//
//  RecordingCoordinatorTests.swift
//  efb-212Tests
//
//  Unit tests for RecordingCoordinator lifecycle using mock audio/transcription.
//  Uses temporary GRDB RecordingDatabase for isolation.
//

import Testing
import Foundation
import GRDB
@testable import efb_212

@Suite("RecordingCoordinator Tests", .serialized)
@MainActor
struct RecordingCoordinatorTests {

    // MARK: - Helpers

    /// Create a temporary RecordingDatabase for testing.
    static func makeTempDB() throws -> RecordingDatabase {
        let tempDir = FileManager.default.temporaryDirectory
        let dbPath = tempDir.appendingPathComponent("recording-test-\(UUID().uuidString).sqlite").path
        var config = Configuration()
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA journal_mode = WAL")
        }
        let pool = try DatabasePool(path: dbPath, configuration: config)
        return try RecordingDatabase(dbPool: pool)
    }

    // MARK: - Start/Stop Lifecycle

    @Test func startRecordingTransitionsToRecording() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let mockTranscription = MockTranscriptionService()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: mockTranscription
        )

        _ = try await coordinator.startRecording()

        let status = coordinator.state.recordingStatus
        #expect(status == .recording)
    }

    @Test func stopRecordingReturnsToIdle() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let mockTranscription = MockTranscriptionService()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: mockTranscription
        )

        _ = try await coordinator.startRecording()
        let summary = await coordinator.stopRecording()

        let status = coordinator.state.recordingStatus
        #expect(status == .idle)
        #expect(summary != nil)
        #expect(summary?.flightID != nil)
    }

    @Test func startCallsAudioAndTranscription() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let mockTranscription = MockTranscriptionService()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: mockTranscription
        )

        _ = try await coordinator.startRecording()

        #expect(mockAudio.startRecordingCalled == true)
        #expect(mockTranscription.startTranscriptionCalled == true)
    }

    @Test func stopCallsAudioAndTranscription() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let mockTranscription = MockTranscriptionService()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: mockTranscription
        )

        _ = try await coordinator.startRecording()
        _ = await coordinator.stopRecording()

        #expect(mockAudio.stopRecordingCalled == true)
        #expect(mockTranscription.stopTranscriptionCalled == true)
    }

    @Test func stopRecordingWhenIdleReturnsNil() async throws {
        let db = try Self.makeTempDB()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: MockAudioRecorder(),
            transcriptionService: MockTranscriptionService()
        )

        let summary = await coordinator.stopRecording()
        #expect(summary == nil)
    }

    @Test func startRecordingReturnsFlightID() async throws {
        let db = try Self.makeTempDB()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: MockAudioRecorder(),
            transcriptionService: MockTranscriptionService()
        )

        let flightID = try await coordinator.startRecording()
        #expect(flightID != UUID(uuidString: "00000000-0000-0000-0000-000000000000"))

        // Cleanup
        _ = await coordinator.stopRecording()
    }

    // MARK: - Live Phase / Audio Level Sync

    @Test func syncPhaseAndLevelCopiesSubServiceStateIntoState() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: MockTranscriptionService()
        )

        _ = try await coordinator.startRecording()
        mockAudio._audioLevel = -20  // dBFS

        await coordinator.syncPhaseAndLevel()

        let level = coordinator.state.audioLevel
        let phase = coordinator.state.currentPhase
        #expect(level == -20)
        #expect(phase == .preflight)  // tracker has seen no fixes yet

        _ = await coordinator.stopRecording()
    }

    @Test func syncLoopRunsWhileRecordingWithoutViewLayer() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: MockTranscriptionService()
        )

        _ = try await coordinator.startRecording()
        mockAudio._audioLevel = -30  // dBFS

        // Nobody calls syncPhaseAndLevel(); the coordinator's own 1 Hz loop must do it.
        var level: Float = -160
        for _ in 0..<30 {
            try await Task.sleep(for: .milliseconds(100))
            level = coordinator.state.audioLevel
            if level == -30 { break }
        }
        #expect(level == -30)

        _ = await coordinator.stopRecording()
    }

    @Test func syncPhaseAndLevelIsNoOpWhenIdle() async throws {
        let db = try Self.makeTempDB()
        let mockAudio = MockAudioRecorder()
        mockAudio._audioLevel = -10
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: mockAudio,
            transcriptionService: MockTranscriptionService()
        )

        await coordinator.syncPhaseAndLevel()

        let level = coordinator.state.audioLevel
        #expect(level == -160)
    }

    // MARK: - Auto-start Countdown Handoff

    @Test func startRecordingIsAllowedFromEndOfCountdown() async throws {
        let db = try Self.makeTempDB()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: MockAudioRecorder(),
            transcriptionService: MockTranscriptionService()
        )

        // startCountdown() leaves status at .countdown(remaining: 1) before starting
        await MainActor.run { coordinator.state.recordingStatus = .countdown(remaining: 1) }

        _ = try await coordinator.startRecording()
        let status = coordinator.state.recordingStatus
        #expect(status == .recording)

        _ = await coordinator.stopRecording()
    }

    @Test func startRecordingRejectedWhileRecording() async throws {
        let db = try Self.makeTempDB()
        let coordinator = RecordingCoordinator(
            recordingDB: db,
            audioRecorder: MockAudioRecorder(),
            transcriptionService: MockTranscriptionService()
        )

        _ = try await coordinator.startRecording()
        await #expect(throws: EFBError.self) {
            _ = try await coordinator.startRecording()
        }
        _ = await coordinator.stopRecording()
    }
}
