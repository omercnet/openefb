//
//  KanafSpeechModule.swift
//  KanafSpeech
//
//  Local Expo module for live transcription with the iOS 26 SpeechAnalyzer (owner decision Q11; plan risk R4: the
//  React Native libraries only wrap SFSpeechRecognizer). The TypeScript side is src/adapters/speechAnalyzer.ts.
//
//  Functions: isAvailable(locale), prepare(locale), start({locale, contextualStrings}) -> status, stop().
//  Events: onResult, onFailure. start() never downloads assets: a missing locale is reported as "assetsMissing" and
//  prepare() installs it ahead of time, so starting a recording never waits on the network.
//

import AVFoundation
import ExpoModulesCore
import Foundation
import Speech

struct KanafSpeechStartOptions: Record {
    @Field var locale: String = "en-US"
    @Field var contextualStrings: [String] = []
}

public final class KanafSpeechModule: Module {
    /// The running SpeechAnalyzerSession (an iOS 26 type, so held as AnyObject).
    private var session: AnyObject?

    public func definition() -> ModuleDefinition {
        Name("KanafSpeech")

        Events("onResult", "onFailure")

        AsyncFunction("isAvailable") { (locale: String, promise: Promise) in
            guard #available(iOS 26.0, *), SpeechAnalyzerSession.isSupportedDevice else {
                promise.resolve(false)
                return
            }
            Task {
                guard let supported = await SpeechAnalyzerSession.supportedLocale(locale) else {
                    promise.resolve(false)
                    return
                }
                promise.resolve(await SpeechAnalyzerSession.isInstalled(supported))
            }
        }

        AsyncFunction("prepare") { (locale: String, promise: Promise) in
            guard #available(iOS 26.0, *), SpeechAnalyzerSession.isSupportedDevice else {
                promise.reject("ERR_SPEECH_UNAVAILABLE", "SpeechAnalyzer needs iOS 26 or later on a device that supports it")
                return
            }
            Task {
                guard let supported = await SpeechAnalyzerSession.supportedLocale(locale) else {
                    promise.reject("ERR_SPEECH_LOCALE", "SpeechTranscriber does not support \(locale)")
                    return
                }
                do {
                    try await SpeechAnalyzerSession.installAssets(for: supported)
                    promise.resolve()
                } catch {
                    promise.reject(error)
                }
            }
        }

        AsyncFunction("start") { (options: KanafSpeechStartOptions, promise: Promise) in
            guard #available(iOS 26.0, *) else {
                promise.resolve("unavailable")
                return
            }
            Task { [weak self] in
                guard let self else {
                    promise.resolve("unavailable")
                    return
                }
                do {
                    promise.resolve(try await self.startSession(options))
                } catch {
                    promise.reject(error)
                }
            }
        }

        AsyncFunction("stop") { (promise: Promise) in
            Task { [weak self] in
                await self?.stopSession()
                promise.resolve()
            }
        }

        // The module may be gone before a task that captures it weakly runs, which would leave the microphone open: hand the
        // running session to the task instead.
        OnDestroy {
            guard #available(iOS 26.0, *), let current = self.session as? SpeechAnalyzerSession else { return }
            self.session = nil
            Task { await current.stop() }
        }
    }

    /// "started", or why nothing started: permissionDenied, unsupportedLocale, assetsMissing. Other failures throw.
    @available(iOS 26.0, *)
    private func startSession(_ options: KanafSpeechStartOptions) async throws -> String {
        await stopSession()
        guard SpeechAnalyzerSession.isSupportedDevice else { return "unavailable" }

        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            break
        case .undetermined:
            guard await AVAudioApplication.requestRecordPermission() else { return "permissionDenied" }
        default:
            return "permissionDenied"
        }

        guard let locale = await SpeechAnalyzerSession.supportedLocale(options.locale) else { return "unsupportedLocale" }
        guard await SpeechAnalyzerSession.isInstalled(locale) else { return "assetsMissing" }

        session = try await SpeechAnalyzerSession.start(
            locale: locale,
            contextualStrings: options.contextualStrings
        ) { [weak self] name, body in
            self?.sendEvent(name, body)
        }
        return "started"
    }

    private func stopSession() async {
        guard #available(iOS 26.0, *) else { return }
        let current = session as? SpeechAnalyzerSession
        session = nil
        await current?.stop()
    }
}
