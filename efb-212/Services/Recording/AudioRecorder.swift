//
//  AudioRecorder.swift
//  efb-212
//
//  AVAudioEngine-based cockpit audio recorder with dual output:
//  1. AAC file write for archival recording
//  2. PCM buffer streaming to transcription service via callback
//
//  Handles audio session configuration for background recording,
//  interruption recovery (phone call, Siri), and headphone disconnect.
//
//  Design source: SFR CockpitAudioEngine pattern, adapted for iOS 26.
//

import AVFoundation
import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif

// MARK: - AudioRecorder Actor

actor AudioRecorder: AudioRecorderProtocol {

    // MARK: - Properties

    private var audioEngine: AVAudioEngine?
    private var outputFile: AVAudioFile?
    private var _isRecording = false
    private var _audioLevel: Float = -160  // dBFS silence floor
    private var flightID: UUID?

    /// Callback for streaming PCM buffers to transcription service (Plan 03 wiring point).
    var onBufferAvailable: (@Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void)?

    /// Callback for gap markers on interruptions.
    var onInterruptionGap: (@Sendable (InterruptionGapReason) -> Void)?

    /// Callback for unrecoverable failures mid-recording (e.g. disk full while writing).
    /// The recorder has already stopped itself when this fires.
    var onRecordingError: (@Sendable (EFBError) -> Void)?

    /// URL of a partially written file kept after a mid-recording failure,
    /// returned once by the next stopRecording() call.
    private var partialFileURL: URL?

    // Notification observers
    private var interruptionObserver: (any NSObjectProtocol)?
    private var routeChangeObserver: (any NSObjectProtocol)?
    private var didBecomeActiveObserver: (any NSObjectProtocol)?
    private var isPausedByInterruption = false

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "AudioRecorder")

    // MARK: - Callback Setters

    /// Set the buffer streaming callback (called from RecordingCoordinator wiring).
    func setOnBufferAvailable(_ callback: (@Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void)?) {
        onBufferAvailable = callback
    }

    /// Set the interruption gap callback (called from RecordingCoordinator wiring).
    func setOnInterruptionGap(_ callback: (@Sendable (InterruptionGapReason) -> Void)?) {
        onInterruptionGap = callback
    }

    /// Set the recording error callback (called from RecordingCoordinator wiring).
    func setOnRecordingError(_ callback: (@Sendable (EFBError) -> Void)?) {
        onRecordingError = callback
    }

    // MARK: - AudioRecorderProtocol

    var isRecording: Bool { _isRecording }
    var audioLevel: Float { _audioLevel }

    // MARK: - Start Recording

    #if DEBUG
    /// `-OpenEFBNoAudio YES` (DEBUG only): record without the microphone. The CI flight scenarios pass it
    /// (`tools/fly.sh --no-audio`): simulators on the self-hosted VMs abort inside CoreAudio when asked for input.
    nonisolated static let noAudioKey = "OpenEFBNoAudio"
    #endif

    func startRecording(flightID: UUID, profile: AudioQualityProfile, outputURL: URL) async throws {
        self.flightID = flightID

        #if DEBUG
        if UserDefaults.standard.bool(forKey: Self.noAudioKey) {
            logger.notice("Audio capture off (-OpenEFBNoAudio). Recording without audio.")
            throw EFBError.audioSessionFailed(underlying: AudioRecorderError.noAudioInput)
        }
        #endif

        // Create recordings directory if needed
        let recordingDir = outputURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: recordingDir, withIntermediateDirectories: true)

        // Configure audio session for background recording
        try configureAudioSession(profile: profile)

        // Create audio engine
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        // Guard channel count > 0 to prevent crash on simulator (SFR pattern)
        guard recordingFormat.channelCount > 0 else {
            logger.warning("No audio input available (channelCount == 0). Skipping audio recording.")
            throw EFBError.audioSessionFailed(underlying: AudioRecorderError.noAudioInput)
        }

        // Create AAC output file
        let outputSettings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: profile.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: profile.bitRate
        ]
        let file = try AVAudioFile(forWriting: outputURL, settings: outputSettings)
        outputFile = file

        // The file's processing format (mono, profile sample rate) rarely equals the hardware
        // input format (e.g. 48 kHz, possibly stereo in the simulator). Writing a mismatched
        // buffer fails with avfaudio error -50, so convert before writing.
        let fileFormat = file.processingFormat
        let converter = recordingFormat == fileFormat ? nil : AVAudioConverter(from: recordingFormat, to: fileFormat)
        let rateRatio = fileFormat.sampleRate / recordingFormat.sampleRate
        // Install tap: write to file AND stream to transcription callback
        let bufferCallback = onBufferAvailable
        let logger = self.logger
        // File timeline: frames written so far. Buffers are handed to the transcription
        // service stamped with this position so transcript times line up with the file
        // (and therefore with replay), not with the hardware clock.
        let framesWritten = OSAllocatedUnfairLock<AVAudioFramePosition>(initialState: 0)
        let writeFailed = OSAllocatedUnfairLock(initialState: false)
        let sampleRate = recordingFormat.sampleRate
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: recordingFormat) { [weak self] buffer, _ in
            // Write to AAC file. A failure here (disk full, file vanished) is not
            // recoverable for this recording: report once and stop so audio isn't lost silently.
            do {
                if let converter {
                    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * rateRatio).rounded(.up)) + 32
                    guard let converted = AVAudioPCMBuffer(pcmFormat: fileFormat, frameCapacity: capacity) else {
                        throw AudioRecorderError.noAudioInput
                    }
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
                    if let conversionError { throw conversionError }
                    try file.write(from: converted)
                } else {
                    try file.write(from: buffer)
                }
            } catch {
                let firstFailure = writeFailed.withLock { failed -> Bool in
                    defer { failed = true }
                    return !failed
                }
                if firstFailure {
                    logger.error("Audio file write failed: \(error.localizedDescription)")
                    Task { [weak self] in
                        await self?.handleWriteFailure(error)
                    }
                }
                return
            }

            let bufferFrames = AVAudioFramePosition(buffer.frameLength)
            let bufferStartFrame = framesWritten.withLock { frames -> AVAudioFramePosition in
                defer { frames += bufferFrames }
                return frames
            }
            let fileTime = AVAudioTime(sampleTime: bufferStartFrame, atRate: sampleRate)

            // Stream PCM buffer to transcription service
            bufferCallback?(buffer, fileTime)

            // Compute RMS for audio level meter
            guard let channelData = buffer.floatChannelData else { return }
            let channelDataValue = channelData.pointee
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else { return }

            var sum: Float = 0
            for i in 0..<frameLength {
                let sample = channelDataValue[i]
                sum += sample * sample
            }
            let rms = sqrtf(sum / Float(frameLength))
            let dBFS = rms > 0 ? 20 * log10f(rms) : -160

            // Update audio level (actor-isolated property updated from nonisolated context)
            // Use a Task to hop back to actor isolation
            Task { [weak self] in
                await self?.updateAudioLevel(dBFS)
            }
        }

        // Prepare and start engine
        engine.prepare()
        try engine.start()
        audioEngine = engine

        _isRecording = true

        // Register interruption and route change observers
        registerNotificationObservers()

        logger.info("Audio recording started for flight \(flightID.uuidString)")
    }

    // MARK: - Stop Recording

    func stopRecording() async -> URL? {
        guard _isRecording else {
            // A mid-recording failure already tore down the engine; hand back what was written.
            let partial = partialFileURL
            partialFileURL = nil
            return partial
        }

        // Remove tap and stop engine
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil

        _isRecording = false
        isPausedByInterruption = false

        // Remove notification observers
        removeNotificationObservers()

        // Close output file and capture URL
        let fileURL = outputFile?.url
        outputFile = nil

        // Deactivate audio session
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        logger.info("Audio recording stopped")
        return fileURL
    }

    // MARK: - Write Failure

    /// Stop the recorder after an unrecoverable file write error and report it.
    /// Keeps the partial file on disk. Internal so tests can exercise the path
    /// without real audio hardware.
    func handleWriteFailure(_ error: Error) async {
        guard _isRecording else { return }

        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil

        _isRecording = false
        isPausedByInterruption = false
        removeNotificationObservers()

        partialFileURL = outputFile?.url
        outputFile = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        logger.error("Audio recording stopped after write failure")
        onRecordingError?(.recordingFailed(underlying: error))
    }

    // MARK: - Pause / Resume

    func pauseRecording() async {
        guard _isRecording else { return }
        audioEngine?.stop()
        logger.info("Audio recording paused")
    }

    func resumeRecording() async throws {
        guard _isRecording, let engine = audioEngine else { return }

        // Reconfigure audio session before restarting
        try AVAudioSession.sharedInstance().setActive(true)

        try engine.start()
        isPausedByInterruption = false
        logger.info("Audio recording resumed")
    }

    // MARK: - Audio Session Configuration

    private func configureAudioSession(profile: AudioQualityProfile) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [
                .allowBluetoothHFP,
                .allowBluetoothA2DP,
                .defaultToSpeaker,
                .mixWithOthers
            ]
        )
        try session.setPreferredSampleRate(profile.sampleRate)
        try session.setPreferredIOBufferDuration(0.05)  // 50ms buffer
        try session.setPreferredInputNumberOfChannels(1)  // mono
        try session.setActive(true)
    }

    // MARK: - Audio Level Update

    private func updateAudioLevel(_ level: Float) {
        _audioLevel = level
    }

    // MARK: - Notification Observers

    private func registerNotificationObservers() {
        let center = NotificationCenter.default

        // Interruption handling (phone call, Siri)
        interruptionObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            // Pull Sendable values out here: `Notification` itself is not Sendable.
            let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let optionsValue = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
            Task { [weak self] in
                await self?.handleInterruption(typeValue: typeValue, optionsValue: optionsValue)
            }
        }

        // Route change handling (headphone disconnect)
        routeChangeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            Task { [weak self] in
                await self?.handleRouteChange(reasonValue: reasonValue)
            }
        }

        #if canImport(UIKit)
        // Fallback resume on app becoming active (per SFR pattern: not all interruptions
        // have a matching end notification)
        didBecomeActiveObserver = center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            Task { [weak self] in
                await self?.handleDidBecomeActive()
            }
        }
        #endif
    }

    private func removeNotificationObservers() {
        let center = NotificationCenter.default
        if let observer = interruptionObserver {
            center.removeObserver(observer)
            interruptionObserver = nil
        }
        if let observer = routeChangeObserver {
            center.removeObserver(observer)
            routeChangeObserver = nil
        }
        if let observer = didBecomeActiveObserver {
            center.removeObserver(observer)
            didBecomeActiveObserver = nil
        }
    }

    // MARK: - Interruption Handling

    private func handleInterruption(typeValue: UInt?, optionsValue: UInt?) async {
        guard let typeValue,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            // Phone call, Siri -- pause recording, insert gap marker
            logger.info("Audio interruption began")
            await pauseRecording()
            isPausedByInterruption = true
            onInterruptionGap?(.phoneCall)

        case .ended:
            // Auto-resume if system says it's safe
            logger.info("Audio interruption ended")
            if let optionsValue {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    try? await resumeRecording()
                }
            }

        @unknown default:
            break
        }
    }

    // MARK: - Route Change Handling

    private func handleRouteChange(reasonValue: UInt?) async {
        guard let reasonValue,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }

        if reason == .oldDeviceUnavailable {
            // Headphone disconnect -- audio continues via built-in mic per .defaultToSpeaker
            logger.info("Audio route change: headphone disconnected")
            onInterruptionGap?(.headphoneDisconnect)
        }
    }

    // MARK: - Did Become Active Fallback

    private func handleDidBecomeActive() async {
        // Fallback: if recording was paused by interruption and the end notification
        // never arrived (Apple docs: "there is no guarantee"), attempt resume when
        // app returns to foreground
        guard isPausedByInterruption else { return }
        logger.info("App became active with paused recording -- attempting resume")
        try? await resumeRecording()
    }
}

// MARK: - AudioRecorder Errors

enum AudioRecorderError: LocalizedError, Sendable {
    case noAudioInput

    var errorDescription: String? {
        switch self {
        case .noAudioInput:
            return "No microphone found. The flight records without cockpit audio."
        }
    }
}
