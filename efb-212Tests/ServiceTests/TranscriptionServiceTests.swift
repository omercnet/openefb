//
//  TranscriptionServiceTests.swift
//  efb-212Tests
//
//  Unit tests for TranscriptionService.
//  Tests initial state, vocabulary processor integration,
//  and GRDB storage of final transcript segments.
//  Cannot test real Speech framework in simulator.
//

import Testing
import Foundation
import GRDB
import CoreMedia
import Speech
@testable import efb_212

@Suite("TranscriptionService Tests")
@MainActor
struct TranscriptionServiceTests {

    // MARK: - Helpers

    /// Create a temporary file-backed DatabasePool for testing.
    /// DatabasePool requires a real file path (not :memory:).
    static func makeTempDB() throws -> RecordingDatabase {
        let tmpDir = FileManager.default.temporaryDirectory
        let dbPath = tmpDir.appendingPathComponent("test-\(UUID().uuidString).sqlite").path
        let pool = try DatabasePool(path: dbPath)
        return try RecordingDatabase(dbPool: pool)
    }

    // MARK: - Initial State

    @Test func initialStateNotTranscribing() async throws {
        let db = try Self.makeTempDB()
        let service = TranscriptionService(recordingDB: db)
        let isTranscribing = await service.isTranscribing
        #expect(isTranscribing == false)
    }

    // MARK: - Vocabulary Processor Integration

    @Test func vocabularyProcessorIntegrated() {
        // Test that AviationVocabularyProcessor is functional and would be called
        let processor = AviationVocabularyProcessor()
        let input = "november seven three two papa squawk one two zero zero"
        let output = processor.process(input)
        // Both corrections should apply
        #expect(output.contains("N732P"))
        #expect(output.contains("1200"))
    }

    // MARK: - GRDB Storage of Final Segments

    @Test func onlyFinalSegmentsStoredToGRDB() throws {
        let db = try Self.makeTempDB()
        let flightID = UUID()

        // Simulate storing a final transcript segment
        let segment = TranscriptSegmentRecord(
            flightID: flightID,
            text: "N732P contact tower 123.45",
            confidence: 0.95,
            audioStartTime: 10.0,
            audioEndTime: 15.0,
            flightPhase: FlightPhaseType.cruise.rawValue
        )
        try db.insertTranscript(segment)

        // Verify retrieval
        let segments = try db.transcriptSegments(forFlight: flightID)
        #expect(segments.count == 1)
        #expect(segments.first?.text == "N732P contact tower 123.45")
        #expect(segments.first?.confidence == 0.95)
        #expect(segments.first?.flightPhase == "cruise")
    }

    // MARK: - Phase Provider Tagging

    @Test func finalSegmentsAreTaggedWithProvidedPhase() async throws {
        let db = try Self.makeTempDB()
        let service = TranscriptionService(recordingDB: db)
        let flightID = UUID()

        await service.setCurrentPhaseProvider { .approach }

        // Sets the flight context. Engine start may throw on hosts without Speech; that's fine,
        // recordFinalSegment only needs the flight ID.
        _ = try? await service.startTranscription(flightID: flightID)
        await service.recordFinalSegment(
            text: "Tower, N732P, five mile final",
            metrics: TranscriptSegmentMetrics(confidence: 0.8, audioStartTime: 12, audioEndTime: 15)
        )

        let segments = try db.transcriptSegments(forFlight: flightID)
        #expect(segments.count == 1)
        #expect(segments.first?.flightPhase == FlightPhaseType.approach.rawValue)
        #expect(segments.first?.audioStartTime == 12)
        #expect(segments.first?.audioEndTime == 15)
        #expect(segments.first?.confidence == 0.8)

        await service.stopTranscription()
    }

    @Test func phaseProviderIsReadPerSegmentNotAtStart() async throws {
        let db = try Self.makeTempDB()
        let service = TranscriptionService(recordingDB: db)
        let flightID = UUID()

        let phases = PhaseBox()
        await service.setCurrentPhaseProvider { phases.current }

        _ = try? await service.startTranscription(flightID: flightID)

        phases.current = .taxi
        await service.recordFinalSegment(
            text: "ground, taxi to two eight left",
            metrics: TranscriptSegmentMetrics(confidence: 0.9, audioStartTime: 1, audioEndTime: 3)
        )
        phases.current = .cruise
        await service.recordFinalSegment(
            text: "level at four thousand five hundred",
            metrics: TranscriptSegmentMetrics(confidence: 0.9, audioStartTime: 600, audioEndTime: 603)
        )

        let tags = try db.transcriptSegments(forFlight: flightID).map(\.flightPhase)
        #expect(tags == [FlightPhaseType.taxi.rawValue, FlightPhaseType.cruise.rawValue])

        await service.stopTranscription()
    }

    @Test func missingProviderDefaultsToPreflightNotCruise() async throws {
        let db = try Self.makeTempDB()
        let service = TranscriptionService(recordingDB: db)
        let flightID = UUID()

        _ = try? await service.startTranscription(flightID: flightID)
        await service.recordFinalSegment(
            text: "test",
            metrics: TranscriptSegmentMetrics(confidence: 0.5, audioStartTime: 0, audioEndTime: 1)
        )

        #expect(try db.transcriptSegments(forFlight: flightID).first?.flightPhase == FlightPhaseType.preflight.rawValue)
        await service.stopTranscription()
    }

    // MARK: - SpeechAnalyzer Metrics Extraction

    @Test func metricsUseAttributedConfidenceAndTimeRange() {
        guard #available(iOS 26.0, *) else { return }
        var first = AttributedString("cleared ")
        first.transcriptionConfidence = 1.0
        first.audioTimeRange = CMTimeRange(
            start: CMTime(seconds: 10, preferredTimescale: 1000),
            end: CMTime(seconds: 11, preferredTimescale: 1000)
        )
        var second = AttributedString("takeoff")
        second.transcriptionConfidence = 0.5
        second.audioTimeRange = CMTimeRange(
            start: CMTime(seconds: 11, preferredTimescale: 1000),
            end: CMTime(seconds: 12.5, preferredTimescale: 1000)
        )
        let text = first + second

        let metrics = TranscriptionService.metrics(from: text, resultRange: .invalid)

        // Length-weighted: 8 chars at 1.0, 7 chars at 0.5 -> (8 + 3.5) / 15
        #expect(abs(metrics.confidence - 11.5 / 15) < 0.001)
        #expect(metrics.audioStartTime == 10)
        #expect(metrics.audioEndTime == 12.5)
    }

    @Test func metricsMarkConfidenceUnknownWhenAbsent() {
        let text = AttributedString("no attributes here")
        let range = CMTimeRange(
            start: CMTime(seconds: 4, preferredTimescale: 1000),
            end: CMTime(seconds: 6, preferredTimescale: 1000)
        )

        let metrics = TranscriptionService.metrics(from: text, resultRange: range)

        #expect(metrics.confidence == TranscriptionService.unknownConfidence)
        #expect(metrics.confidence < 0)  // sorts below every real 0...1 value
        #expect(metrics.audioStartTime == 4)
        #expect(metrics.audioEndTime == 6)
    }
}

/// Mutable phase holder for provider tests.
private final class PhaseBox: @unchecked Sendable {
    var current: FlightPhaseType = .preflight
}
