//
//  SpeechAnalyzerSession.swift
//  KanafSpeech
//
//  One live transcription: microphone -> AVAudioConverter -> SpeechAnalyzer, results forwarded as module events.
//  Port of the SpeechAnalyzer path of efb-212/Services/Recording/TranscriptionService.swift, which was fed buffers by
//  AudioRecorder. expo-audio gives JavaScript no PCM, so this session captures its own audio (docs/port-notes/A3.md).
//
//  Segment times are seconds of audio delivered to the analyzer since start. They skip an interruption, like the
//  Swift file-position stamps did; the TypeScript side places them on the flight timeline.
//

import AVFoundation
import CoreMedia
import Foundation
import Speech
import UIKit
import os

/// Frames handed to the analyzer so far. The audio tap is the only writer; the lock only keeps the type Sendable.
final class FrameClock: @unchecked Sendable {
    private let frames = OSAllocatedUnfairLock<Int64>(initialState: 0)

    /// The frame a buffer of `count` frames starts at. The next buffer starts `count` frames later.
    func advance(by count: Int64) -> Int64 {
        frames.withLock { value -> Int64 in
            defer { value += count }
            return value
        }
    }
}

@available(iOS 26.0, *)
final class SpeechAnalyzerSession: @unchecked Sendable {
    typealias Emit = @Sendable (String, [String: Any?]) -> Void

    enum Failure: Error {
        case noMicrophoneInput
        case unsupportedFormat
    }

    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let analyzerFormat: AVAudioFormat
    private let engine = AVAudioEngine()
    private let frames = FrameClock()
    private let stopped = OSAllocatedUnfairLock<Bool>(initialState: false)
    private let emit: Emit
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var tasks: [Task<Void, Never>] = []
    private var observers: [NSObjectProtocol] = []

    private init(transcriber: SpeechTranscriber, analyzer: SpeechAnalyzer, format: AVAudioFormat, emit: @escaping Emit) {
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.analyzerFormat = format
        self.emit = emit
    }

    // MARK: - Locale and assets

    /// Whether this device can run SpeechTranscriber at all (hardware and capabilities), whatever the locale.
    static var isSupportedDevice: Bool {
        SpeechTranscriber.isAvailable
    }

    /// The supported locale equivalent to `identifier`, or nil when SpeechTranscriber does not support it.
    static func supportedLocale(_ identifier: String) async -> Locale? {
        await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier))
    }

    /// Whether the locale's speech assets are on the device (the Swift app's `installedLocales.contains`).
    static func isInstalled(_ locale: Locale) async -> Bool {
        let installed = await SpeechTranscriber.installedLocales
        return installed.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
    }

    /// Same options as the Swift app: volatile results, per-run time ranges and confidence.
    private static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: [.audioTimeRange, .transcriptionConfidence]
        )
    }

    /// Downloads and installs the locale's assets when they are missing. Needs the network.
    static func installAssets(for locale: Locale) async throws {
        let transcriber = makeTranscriber(locale)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
    }

    // MARK: - Lifecycle

    /// Starts listening. The caller has checked the microphone permission, the locale and its assets.
    static func start(locale: Locale, contextualStrings: [String], emit: @escaping Emit) async throws -> SpeechAnalyzerSession {
        let transcriber = makeTranscriber(locale)
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw Failure.unsupportedFormat
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        if !contextualStrings.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings[.general] = contextualStrings
            try? await analyzer.setContext(context)
        }
        let session = SpeechAnalyzerSession(transcriber: transcriber, analyzer: analyzer, format: format, emit: emit)
        do {
            try session.begin()
        } catch {
            await session.stop()
            throw error
        }
        return session
    }

    /// Cancels the analysis and releases the microphone. The last unfinished utterance is dropped, as in Swift.
    func stop() async {
        stopped.withLock { $0 = true }
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        inputContinuation?.finish()
        inputContinuation = nil
        tasks.forEach { $0.cancel() }
        tasks = []
        await analyzer.cancelAndFinishNow()
    }

    private func begin() throws {
        try activateAudioSession()
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation

        let transcriber = self.transcriber
        let analyzer = self.analyzer
        let emit = self.emit
        tasks = [
            Task {
                do {
                    for try await result in transcriber.results {
                        emit("onResult", SpeechAnalyzerSession.payload(text: result.text, range: result.range, isFinal: result.isFinal))
                    }
                } catch {
                    if !Task.isCancelled {
                        emit("onFailure", ["message": "SpeechAnalyzer results failed: \(error.localizedDescription)"])
                    }
                }
            },
            Task {
                do {
                    _ = try await analyzer.analyzeSequence(stream)
                } catch {
                    if !Task.isCancelled {
                        emit("onFailure", ["message": "SpeechAnalyzer analysis failed: \(error.localizedDescription)"])
                    }
                }
            },
        ]

        try installTap()
        engine.prepare()
        try engine.start()
        observe()
    }

    // MARK: - Audio

    /// expo-audio's recorder sets playAndRecord while a flight records; set it only when nothing has.
    private func activateAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord && session.category != .record {
            try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothHFP])
        }
        try session.setActive(true)
    }

    /// Converts microphone buffers to the analyzer's format (the Swift recorder did the same for its file) and feeds them
    /// in, stamped with the frames delivered so far.
    private func installTap() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { throw Failure.noMicrophoneInput }
        guard let converter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else { throw Failure.unsupportedFormat }
        let outputFormat = analyzerFormat
        let ratio = outputFormat.sampleRate / inputFormat.sampleRate
        let frames = self.frames
        let continuation = inputContinuation

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
            let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
            guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
            var supplied = false
            var conversionError: NSError?
            converter.convert(to: converted, error: &conversionError) { _, status in
                if supplied {
                    status.pointee = .noDataNow
                    return nil
                }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
            guard conversionError == nil, converted.frameLength > 0 else { return }
            let startFrame = frames.advance(by: Int64(converted.frameLength))
            let start = CMTime(value: CMTimeValue(startFrame), timescale: CMTimeScale(outputFormat.sampleRate))
            continuation?.yield(AnalyzerInput(buffer: converted, bufferStartTime: start))
        }
    }

    /// Phone calls, Siri, route changes and backgrounding stop the engine; start it again when the system allows.
    private func observe() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                guard let self,
                      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
                let optionsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume) {
                    self.recover()
                }
            },
            center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                self?.recover()
            },
            // An interruption that ends without shouldResume: pick up again when the app comes back, like AudioRecorder.
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self, !self.engine.isRunning else { return }
                self.recover()
            },
        ]
    }

    private func recover() {
        if stopped.withLock({ $0 }) { return }
        do {
            engine.stop()
            try activateAudioSession()
            try installTap()
            engine.prepare()
            try engine.start()
        } catch {
            emit("onFailure", ["message": "The audio engine could not restart: \(error.localizedDescription)"])
        }
    }

    // MARK: - Results

    /// The event JavaScript receives. Final results carry the per-run confidence and time ranges the Swift
    /// `TranscriptionService.metrics(from:resultRange:)` read from the AttributedString; JavaScript computes the metrics.
    static func payload(text: AttributedString, range: CMTimeRange, isFinal: Bool) -> [String: Any?] {
        var body: [String: Any?] = ["text": String(text.characters), "isFinal": isFinal]
        guard isFinal else { return body }
        var runs: [[String: Any]] = []
        for run in text.runs {
            var item: [String: Any] = ["text": String(text[run.range].characters)]
            if let confidence = run.transcriptionConfidence {
                item["confidence"] = confidence
            }
            if let timeRange = run.audioTimeRange, timeRange.isValid {
                item["start"] = timeRange.start.seconds
                item["end"] = CMTimeRangeGetEnd(timeRange).seconds
            }
            runs.append(item)
        }
        body["runs"] = runs
        if range.isValid, !range.start.isIndefinite {
            body["rangeStart"] = range.start.seconds
            body["rangeEnd"] = CMTimeRangeGetEnd(range).seconds
        }
        return body
    }
}
