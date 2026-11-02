//
//  RecordingStopPathCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization tests: pin what RecordingCoordinator and TrackRecorder do TODAY when a
//  recording stops (double stop, countdown stop, swallowed start failures, phase-marker rows,
//  track write failures). Asserts marked BUG pin current wrong behavior on purpose.
//

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

/// Temp-file recording database, removed (with its WAL/SHM side files) by the caller's defer.
private enum TempRecordingDB {
    static func make() throws -> (db: RecordingDatabase, url: URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("char-stop-\(UUID().uuidString).sqlite")
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: url.path))
        return (db, url)
    }

    static func remove(_ url: URL) {
        for suffix in ["", "-wal", "-shm"] {
            try? FileManager.default.removeItem(atPath: url.path + suffix)
        }
    }
}

private struct InjectedStartFailure: Error {}

// MARK: - RecordingCoordinator

@Suite("Characterization: RecordingCoordinator stop path", .serialized)
@MainActor
struct RecordingCoordinatorStopPathCharacterizationTests {

    @Test func secondStopReturnsNilAndStaysIdle() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = MockAudioRecorder()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: audio, transcriptionService: MockTranscriptionService()
        )

        _ = try await coordinator.startRecording()
        let first = await coordinator.stopRecording()
        let second = await coordinator.stopRecording()

        #expect(first != nil)
        #expect(second == nil)
        #expect(coordinator.state.recordingStatus == .idle)
        #expect(audio.stopRecordingCallCount == 1)  // the second stop never reaches the services
    }

    @Test func stopSummaryCarriesAudioURLFlightIDAndEmptyTrack() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = MockAudioRecorder()
        let audioURL = URL(fileURLWithPath: "/tmp/char-stop-\(UUID().uuidString).m4a")
        audio.stopRecordingURL = audioURL
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: audio, transcriptionService: MockTranscriptionService()
        )

        let flightID = try await coordinator.startRecording()
        let summary = try #require(await coordinator.stopRecording())

        #expect(summary.flightID == flightID)
        #expect(summary.audioFileURL == audioURL)
        // No fixes were ingested (stop follows start immediately; the live GPS stream has not delivered).
        #expect(summary.trackPointCount == 0)
        #expect(summary.phases.isEmpty)
        #expect(summary.transcriptSegmentCount == 0)
        #expect(summary.endDate >= summary.startDate)
    }

    @Test func audioStartFailureIsSwallowedAndRecordingContinues() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = MockAudioRecorder()
        audio.startRecordingError = InjectedStartFailure()
        let transcription = MockTranscriptionService()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: audio, transcriptionService: transcription
        )

        let flightID = try await coordinator.startRecording()

        #expect(coordinator.state.recordingStatus == .recording)
        #expect(coordinator.state.lastError == nil)        // the failure is only logged, not surfaced
        #expect(transcription.startTranscriptionCalled)    // transcription still starts without audio

        let summary = await coordinator.stopRecording()
        #expect(summary?.flightID == flightID)
        #expect(coordinator.state.recordingStatus == .idle)
    }

    @Test func transcriptionStartFailureIsSwallowedAndStopStillStopsIt() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let transcription = MockTranscriptionService()
        transcription.startTranscriptionError = InjectedStartFailure()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: MockAudioRecorder(), transcriptionService: transcription
        )

        let flightID = try await coordinator.startRecording()

        #expect(coordinator.state.recordingStatus == .recording)
        #expect(coordinator.state.lastError == nil)

        let summary = await coordinator.stopRecording()
        #expect(summary?.flightID == flightID)
        // stop calls stopTranscription even though it never started
        #expect(transcription.stopTranscriptionCallCount == 1)
    }

    @Test func stopDuringCountdownReturnsNilAndLeavesCountdownRunning() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let audio = MockAudioRecorder()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: audio, transcriptionService: MockTranscriptionService()
        )
        coordinator.state.recordingStatus = .countdown(remaining: 2)
        coordinator.state.countdownRemaining = 2

        let summary = await coordinator.stopRecording()

        // stopRecording only knows about a started flight; the countdown is cancelled by
        // cancelCountdown() (RecordingOverlayView routes .countdown taps there).
        #expect(summary == nil)
        #expect(coordinator.state.recordingStatus == .countdown(remaining: 2))
        #expect(coordinator.state.countdownRemaining == 2)
        #expect(audio.stopRecordingCalled == false)
    }
}

// MARK: - TrackRecorder

@Suite("Characterization: TrackRecorder stop path")
struct TrackRecorderStopPathCharacterizationTests {

    /// Taxi 40 s at 10 kt, then rotate and climb 600 fpm for 90 s (same profile as TrackRecorderTests).
    static func flyTaxiToDeparture(_ recorder: TrackRecorder) async {
        let fieldElevation = 100.0  // feet MSL
        var second = 0
        for _ in 0..<40 {
            await recorder.ingest(TrackRecorderTests.fix(second: second, speedKnots: 10, altitudeFeet: fieldElevation))
            second += 1
        }
        for i in 0..<15 {
            let speed = 10 + Double(i + 1) * (40.0 / 15.0)  // knots
            await recorder.ingest(TrackRecorderTests.fix(second: second, speedKnots: speed, altitudeFeet: fieldElevation))
            second += 1
        }
        var altitude = fieldElevation
        for k in 0..<90 {
            altitude += 10  // feet per second = 600 fpm
            await recorder.ingest(TrackRecorderTests.fix(second: second, speedKnots: min(70, 50 + Double(k)), altitudeFeet: altitude))
            second += 1
        }
    }

    @Test func everyPhaseMarkerRowIsClosedInTheDatabaseAfterStop() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let flightID = UUID()
        let recorder = TrackRecorder(recordingDB: db, flightID: flightID)

        await Self.flyTaxiToDeparture(recorder)
        let summary = await recorder.stopTracking()
        let rows = try db.phaseMarkers(forFlight: flightID)

        let phases = rows.map(\.phase)
        #expect(phases.contains(FlightPhaseType.taxi.rawValue))
        #expect(phases.contains(FlightPhaseType.takeoff.rawValue))
        #expect(rows.map(\.id) == summary.phaseMarkers.map(\.id))   // one row per in-memory marker

        // efb-df8: every stored marker has an end time; the last one closes at the last fix.
        #expect(rows.allSatisfy { $0.endTimestamp != nil })
        #expect(summary.phaseMarkers.allSatisfy { $0.endTimestamp != nil })
        let lastFix = try #require(try db.trackPoints(forFlight: flightID).last?.timestamp)
        #expect(rows.last?.endTimestamp == lastFix)
        // Each marker ends where the next begins, so phase durations are real.
        for (current, next) in zip(rows, rows.dropFirst()) {
            #expect(current.endTimestamp == next.startTimestamp)
        }
        #expect(rows.contains { ($0.endTimestamp ?? $0.startTimestamp).timeIntervalSince($0.startTimestamp) > 0 })
    }

    /// Counts calls from a `@Sendable` callback.
    final class CallCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func increment() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }

    @Test func failedTrackWritesAreNotCountedAndAreReportedOnce() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let flightID = UUID()
        let recorder = TrackRecorder(recordingDB: db, flightID: flightID)
        let reported = CallCounter()
        await recorder.setFailureHandlers(onWriteFailure: { _ in reported.increment() }, onStreamFailure: nil)
        try await db.dbPool.write { try $0.execute(sql: "DROP TABLE track_points") }

        for second in 0..<10 {
            await recorder.ingest(TrackRecorderTests.fix(second: second, speedKnots: 10, altitudeFeet: 100))
        }
        let summary = await recorder.stopTracking()

        // efb-5ql: every insert failed, so the summary reports no stored points, and says why.
        #expect(await recorder.trackPointCount == 0)
        #expect(summary.trackPointCount == 0)
        #expect(summary.failedWriteCount == 10)
        #expect(reported.count == 1)
        #expect(throws: (any Error).self) { try db.trackPoints(forFlight: flightID) }
    }

    @Test func storedTrackPointsAreCountedWhenWritesSucceed() async throws {
        let (db, dbURL) = try TempRecordingDB.make()
        defer { TempRecordingDB.remove(dbURL) }
        let flightID = UUID()
        let recorder = TrackRecorder(recordingDB: db, flightID: flightID)

        for second in 0..<5 {
            await recorder.ingest(TrackRecorderTests.fix(second: second, speedKnots: 10, altitudeFeet: 100))
        }
        let summary = await recorder.stopTracking()

        #expect(summary.trackPointCount == 5)
        #expect(summary.failedWriteCount == 0)
        #expect(!summary.streamFailed)
        #expect(try db.trackPoints(forFlight: flightID).count == 5)
    }
}
