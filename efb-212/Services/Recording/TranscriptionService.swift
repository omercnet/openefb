//
//  TranscriptionService.swift
//  efb-212
//
//  Real-time speech transcription using SpeechAnalyzer (iOS 26) as primary
//  engine with SFSpeechRecognizer on-device fallback.
//  Only isFinal transcript segments are stored to GRDB.
//  Volatile results are displayed in UI via callback.
//
//  Segment times (audioStartTime / audioEndTime) are seconds from the start of the
//  audio file. AudioRecorder stamps every buffer with its file position, so the
//  analyzer timeline and the replay timeline agree even though transcription starts
//  slightly after audio capture.
//
//  Design source: SFR CockpitTranscriptionEngine (680 lines), adapted for iOS 26.
//

import Foundation
import AVFoundation
import CoreMedia
import Speech
import os

// MARK: - Audio Buffer Input

/// Audio buffer wrapper for streaming from AudioRecorder to TranscriptionService.
/// `@unchecked Sendable`: `AVAudioPCMBuffer` is not Sendable, but the audio tap hands each buffer
/// off once and never touches it again, so exactly one consumer owns it at a time.
nonisolated struct AudioBufferInput: @unchecked Sendable {
    let buffer: AVAudioPCMBuffer
    let time: AVAudioTime
}

// MARK: - Transcription Engine Selection

/// Which speech recognition engine is active.
enum TranscriptionEngine: Sendable {
    case speechAnalyzer   // iOS 26 SpeechAnalyzer (primary)
    case sfSpeechRecognizer  // Fallback
}

// MARK: - Segment Timing / Confidence

/// Confidence and audio time range extracted from a transcription result.
nonisolated struct TranscriptSegmentMetrics: Sendable, Equatable {
    /// 0.0-1.0, or nil when the engine gave none.
    let confidence: Double?
    let audioStartTime: TimeInterval  // seconds from start of audio file
    let audioEndTime: TimeInterval    // seconds from start of audio file
}

// MARK: - Transcription Service

actor TranscriptionService: TranscriptionServiceProtocol {

    private let recordingDB: RecordingDatabase
    private let vocabularyProcessor = AviationVocabularyProcessor()
    private var _isTranscribing = false
    private var flightID: UUID?
    private var transcriptionTask: Task<Void, Never>?
    private var activeEngine: TranscriptionEngine?

    // Buffer streaming via AsyncStream
    private var bufferContinuation: AsyncStream<AudioBufferInput>.Continuation?

    // SFSpeechRecognizer fallback components
    private var sfRecognizer: SFSpeechRecognizer?
    private var sfRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var sfRecognitionTask: SFSpeechRecognitionTask?
    /// File position (seconds) of the first buffer fed to SFSpeechRecognizer. Its segment
    /// timestamps are relative to the audio it has seen, so this offset re-anchors them.
    private var sfTimelineOffsetSeconds: TimeInterval?

    /// Callback for UI updates (volatile + final segments).
    var onTranscriptUpdate: (@Sendable (TranscriptDisplayItem) -> Void)?

    /// Provider for current flight phase (set by coordinator).
    var currentPhaseProvider: (@Sendable () async -> FlightPhaseType)?

    /// Aviation contextual strings for SFSpeechRecognizer to improve accuracy.
    private let aviationContextualStrings = [
        "november", "niner", "squawk", "atis", "metar", "pirep",
        "runway", "taxiway", "cleared", "roger", "wilco", "unable",
        "approach", "departure", "tower", "ground", "center", "unicom",
        "altitude", "heading", "flight level", "maintain", "descend", "climb",
    ]

    /// Region terms (Israel reporting-point names, Hebrew and English) that bias recognition. Empty for the US.
    private var regionVocabulary: [String] = []

    /// Set the region vocabulary before a recording starts (called from MapContainerView wiring).
    func setRegionVocabulary(_ terms: [String]) {
        regionVocabulary = terms
    }

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "TranscriptionService")

    // MARK: - Init

    init(recordingDB: RecordingDatabase) {
        self.recordingDB = recordingDB
    }

    // MARK: - Callback Setters

    /// Set the transcript update callback (called from MapContainerView wiring).
    func setOnTranscriptUpdate(_ callback: (@Sendable (TranscriptDisplayItem) -> Void)?) {
        onTranscriptUpdate = callback
    }

    /// Set the current flight phase provider (called from RecordingCoordinator wiring).
    func setCurrentPhaseProvider(_ provider: (@Sendable () async -> FlightPhaseType)?) {
        currentPhaseProvider = provider
    }

    // MARK: - TranscriptionServiceProtocol

    var isTranscribing: Bool {
        _isTranscribing
    }

    /// Start real-time transcription for a flight.
    /// Checks SpeechAnalyzer availability first, falls back to SFSpeechRecognizer.
    func startTranscription(flightID: UUID) async throws {
        self.flightID = flightID
        sfTimelineOffsetSeconds = nil

        // Try SpeechAnalyzer first (iOS 26+)
        let locale = Locale(identifier: "en-US")

        if await checkSpeechAnalyzerAvailability(locale: locale) {
            try await startSpeechAnalyzerTranscription(locale: locale)
            activeEngine = .speechAnalyzer
        } else {
            // Fallback to SFSpeechRecognizer with on-device recognition
            try startSFSpeechRecognizerTranscription(locale: locale)
            activeEngine = .sfSpeechRecognizer
        }

        _isTranscribing = true
        logger.info("Transcription started for flight \(flightID.uuidString) using \(String(describing: self.activeEngine))")
    }

    /// Stop transcription and clean up all resources.
    func stopTranscription() async {
        transcriptionTask?.cancel()
        transcriptionTask = nil
        bufferContinuation?.finish()
        bufferContinuation = nil

        // Clean up SFSpeechRecognizer resources
        sfRecognitionTask?.cancel()
        sfRecognitionTask = nil
        sfRecognitionRequest?.endAudio()
        sfRecognitionRequest = nil
        sfRecognizer = nil
        sfTimelineOffsetSeconds = nil

        _isTranscribing = false
        flightID = nil
        activeEngine = nil
        logger.info("Transcription stopped")
    }

    // MARK: - Buffer Feed

    /// Feed audio buffer from AudioRecorder for real-time transcription.
    /// Routes to the active transcription engine. `time` is the buffer's position in
    /// the audio file (sampleTime at the file's sample rate), as stamped by AudioRecorder.
    func feedBuffer(_ input: AudioBufferInput) {
        let buffer = input.buffer
        let time = input.time
        guard _isTranscribing else { return }

        switch activeEngine {
        case .speechAnalyzer:
            // Stream to SpeechAnalyzer via AsyncStream
            bufferContinuation?.yield(input)

        case .sfSpeechRecognizer:
            if sfTimelineOffsetSeconds == nil, time.isSampleTimeValid, time.sampleRate > 0 {
                sfTimelineOffsetSeconds = Double(time.sampleTime) / time.sampleRate
            }
            // Append to SFSpeechAudioBufferRecognitionRequest
            sfRecognitionRequest?.append(buffer)

        case .none:
            break
        }
    }

    // MARK: - Final Segment Storage

    /// Store a final transcript segment tagged with the current flight phase and notify the UI.
    /// Both engines funnel through here so phase tagging has one code path.
    func recordFinalSegment(text: String, metrics: TranscriptSegmentMetrics) async {
        guard let flightID else { return }

        let phase = await currentPhaseProvider?() ?? .preflight

        let segment = TranscriptSegmentRecord(
            flightID: flightID,
            text: text,
            confidence: metrics.confidence,
            audioStartTime: metrics.audioStartTime,
            audioEndTime: metrics.audioEndTime,
            flightPhase: phase.rawValue
        )

        do {
            try recordingDB.insertTranscript(segment)
        } catch {
            logger.error("Failed to store transcript: \(error.localizedDescription)")
        }

        onTranscriptUpdate?(TranscriptDisplayItem(
            id: UUID(),
            text: text,
            timestamp: Date(),
            isVolatile: false
        ))
    }

    // MARK: - Metrics Extraction

    /// Extract confidence and audio time range from an attributed transcription result.
    /// Confidence is the character-length-weighted mean of the runs that carry one, or
    /// nil if none do. Time range prefers the runs' audioTimeRange
    /// attributes and falls back to `resultRange` (the result's overall range).
    nonisolated static func metrics(
        from text: AttributedString,
        resultRange: CMTimeRange
    ) -> TranscriptSegmentMetrics {
        var weightedConfidence = 0.0
        var confidenceWeight = 0.0
        var rangeStart: TimeInterval?
        var rangeEnd: TimeInterval?

        if #available(iOS 26.0, *) {
            for run in text.runs {
                let length = Double(text[run.range].characters.count)
                if let confidence = run.transcriptionConfidence, length > 0 {
                    weightedConfidence += confidence * length
                    confidenceWeight += length
                }
                if let timeRange = run.audioTimeRange, timeRange.isValid {
                    let start = timeRange.start.seconds
                    let end = CMTimeRangeGetEnd(timeRange).seconds
                    rangeStart = min(rangeStart ?? start, start)
                    rangeEnd = max(rangeEnd ?? end, end)
                }
            }
        }

        if rangeStart == nil || rangeEnd == nil, resultRange.isValid, !resultRange.start.isIndefinite {
            rangeStart = resultRange.start.seconds
            rangeEnd = CMTimeRangeGetEnd(resultRange).seconds
        }

        let confidence: Double? = confidenceWeight > 0 ? weightedConfidence / confidenceWeight : nil
        return TranscriptSegmentMetrics(
            confidence: confidence,
            audioStartTime: rangeStart ?? 0,
            audioEndTime: rangeEnd ?? 0
        )
    }

    // MARK: - SpeechAnalyzer (iOS 26)

    /// Check if SpeechAnalyzer is available for the given locale.
    private func checkSpeechAnalyzerAvailability(locale: Locale) async -> Bool {
        // SpeechTranscriber.installedLocales contains locales with downloaded models
        if #available(iOS 26.0, *) {
            let installedLocales = await SpeechTranscriber.installedLocales
            return installedLocales.contains(locale)
        }
        return false
    }

    /// Start transcription using SpeechAnalyzer (iOS 26+).
    /// Uses SpeechAnalyzer.analyzeSequence(_:) with an AsyncStream of AnalyzerInput buffers.
    @available(iOS 26.0, *)
    private func startSpeechAnalyzerTranscription(locale: Locale) async throws {
        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: [.audioTimeRange, .transcriptionConfidence]
        )

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        if !regionVocabulary.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings[.general] = regionVocabulary
            try? await analyzer.setContext(context)
        }

        // Create buffer stream for feeding audio from AudioRecorder
        let (bufferStream, bufferContinuation) = AsyncStream<AudioBufferInput>.makeStream()
        self.bufferContinuation = bufferContinuation

        // Map AudioBufferInput stream to AnalyzerInput stream, anchored on the file timeline
        let inputStream = bufferStream.map { bufferInput -> AnalyzerInput in
            let time = bufferInput.time
            guard time.isSampleTimeValid, time.sampleRate > 0 else {
                return AnalyzerInput(buffer: bufferInput.buffer)
            }
            let start = CMTime(value: CMTimeValue(time.sampleTime), timescale: CMTimeScale(time.sampleRate))
            return AnalyzerInput(buffer: bufferInput.buffer, bufferStartTime: start)
        }

        let vocabularyProcessor = self.vocabularyProcessor
        let onTranscriptUpdate = self.onTranscriptUpdate
        let logger = self.logger

        transcriptionTask = Task { [weak self] in
            // Process transcription results in a child task
            let resultsTask = Task { [weak self] in
                do {
                    for try await result in transcriber.results {
                        guard !Task.isCancelled else { break }
                        let text = String(result.text.characters)
                        let processed = vocabularyProcessor.process(text)

                        if result.isFinal {
                            let metrics = Self.metrics(from: result.text, resultRange: result.range)
                            await self?.recordFinalSegment(text: processed, metrics: metrics)
                        } else {
                            // Volatile result -- UI only, not stored
                            onTranscriptUpdate?(TranscriptDisplayItem(
                                id: UUID(),
                                text: processed,
                                timestamp: Date(),
                                isVolatile: true
                            ))
                        }
                    }
                } catch {
                    if !Task.isCancelled {
                        logger.error("SpeechAnalyzer results error: \(error.localizedDescription)")
                    }
                }
            }

            // Feed audio to analyzer using analyzeSequence(_:)
            do {
                _ = try await analyzer.analyzeSequence(inputStream)
            } catch {
                if !Task.isCancelled {
                    logger.error("SpeechAnalyzer analyze error: \(error.localizedDescription)")
                }
            }

            resultsTask.cancel()
        }
    }

    // MARK: - SFSpeechRecognizer Fallback

    /// Start transcription using SFSpeechRecognizer with on-device recognition.
    private func startSFSpeechRecognizerTranscription(locale: Locale) throws {
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable else {
            throw EFBError.transcriptionUnavailable
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true  // No time limit
        request.contextualStrings = aviationContextualStrings + regionVocabulary
        request.addsPunctuation = true

        self.sfRecognizer = recognizer
        self.sfRecognitionRequest = request

        let vocabularyProcessor = self.vocabularyProcessor
        let onTranscriptUpdate = self.onTranscriptUpdate
        let logger = self.logger

        sfRecognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            if let error = error {
                if (error as NSError).code != 1 {  // Code 1 = cancelled, expected on stop
                    logger.error("SFSpeechRecognizer error: \(error.localizedDescription)")
                }
                return
            }

            guard let result = result else { return }

            let text = result.bestTranscription.formattedString
            let processed = vocabularyProcessor.process(text)

            if result.isFinal {
                let segments = result.bestTranscription.segments
                // Mean word confidence; SFSpeechRecognizer reports 0 for words it didn't score.
                let confidence: Double? = segments.isEmpty
                    ? nil
                    : segments.map { Double($0.confidence) }.reduce(0, +) / Double(segments.count)
                let start = segments.first?.timestamp ?? 0
                let end = segments.last.map { $0.timestamp + $0.duration } ?? 0

                Task { [weak self] in
                    guard let self else { return }
                    let offset = await self.sfTimelineOffsetSeconds ?? 0
                    await self.recordFinalSegment(
                        text: processed,
                        metrics: TranscriptSegmentMetrics(
                            confidence: confidence,
                            audioStartTime: start + offset,
                            audioEndTime: end + offset
                        )
                    )
                }
            } else {
                // Volatile result -- UI only
                onTranscriptUpdate?(TranscriptDisplayItem(
                    id: UUID(),
                    text: processed,
                    timestamp: Date(),
                    isVolatile: true
                ))
            }
        }
    }
}
