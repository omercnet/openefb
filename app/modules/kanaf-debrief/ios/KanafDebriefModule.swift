//
//  KanafDebriefModule.swift
//  KanafDebrief
//
//  Local Expo module for the on-device AI debrief with Apple FoundationModels (iOS 26). It does what the Swift app's
//  efb-212/Services/Debrief/DebriefEngine.swift did with LanguageModelSession: report whether the model is available,
//  create a session from the instructions, stream a guided generation of FlightDebrief, and release everything when asked.
//  The TypeScript side is src/adapters/foundationModels.ts; the lifecycle and saving are src/domain/debriefEngine.ts.
//
//  Functions: availability(), openSession(instructions), generate(requestId, prompt), closeSession().
//  Event: onPartial { requestId, json }, one per snapshot of the debrief being generated.
//
//  Memory: the model takes about 1.2 GB. The session exists only between openSession and closeSession, and closeSession
//  also cancels a generation in progress.
//

import ExpoModulesCore
import Foundation
import FoundationModels

enum DebriefModuleError: LocalizedError {
    case unsupported
    case noSession

    var errorDescription: String? {
        switch self {
        case .unsupported:
            return "The AI debrief needs iOS 26 or later."
        case .noSession:
            return "No debrief session is open."
        }
    }
}

public final class KanafDebriefModule: Module {
    // openSession and closeSession run on the JavaScript thread, generate on the module's background queue, so both fields
    // are only touched inside `locked`.
    private let lock = NSLock()
    /// The open LanguageModelSession (an iOS 26 type, so held as AnyObject) and the generation running on it.
    private var session: AnyObject?
    private var generation: Task<Void, Never>?

    public func definition() -> ModuleDefinition {
        Name("KanafDebrief")

        Events("onPartial")

        Function("availability") { () -> [String: String] in
            guard #available(iOS 26.0, *) else {
                return ["status": "unavailable", "reason": "osNotSupported"]
            }
            return Self.currentAvailability()
        }

        Function("openSession") { (instructions: String) throws in
            guard #available(iOS 26.0, *) else {
                throw DebriefModuleError.unsupported
            }
            let opened = LanguageModelSession(instructions: instructions)
            self.endGeneration()
            self.locked { self.session = opened }
        }

        AsyncFunction("generate") { (requestId: Int, prompt: String, promise: Promise) in
            guard #available(iOS 26.0, *) else {
                promise.reject("ERR_DEBRIEF_UNSUPPORTED", DebriefModuleError.unsupported.localizedDescription)
                return
            }
            self.startGeneration(requestId: requestId, prompt: prompt, promise: promise)
        }

        Function("closeSession") {
            self.endGeneration()
            self.locked { self.session = nil }
        }

        OnDestroy {
            self.endGeneration()
            self.locked { self.session = nil }
        }
    }

    /// Same mapping as DebriefEngine.checkAvailability: the reason is `String(describing:)` of Apple's case, which
    /// DebriefEngine turns into a message for the pilot.
    @available(iOS 26.0, *)
    private static func currentAvailability() -> [String: String] {
        switch SystemLanguageModel.default.availability {
        case .available:
            return ["status": "available"]
        case .unavailable(let reason):
            return ["status": "unavailable", "reason": String(describing: reason)]
        @unknown default:
            return ["status": "unavailable", "reason": "unknown"]
        }
    }

    /// Streams the guided generation. Every snapshot goes out as `onPartial`; the promise resolves with the final content
    /// as JSON text after it decodes as a FlightDebrief (what the Swift engine did with `FlightDebrief(finalContent)`),
    /// or rejects. A stream that produced nothing resolves with an empty string, which JavaScript reads as an empty answer.
    @available(iOS 26.0, *)
    private func startGeneration(requestId: Int, prompt: String, promise: Promise) {
        guard let session = locked({ self.session }) as? LanguageModelSession else {
            promise.reject("ERR_DEBRIEF_NO_SESSION", DebriefModuleError.noSession.localizedDescription)
            return
        }
        endGeneration() // one generation at a time; JavaScript never overlaps them, so this only cancels a stale one
        let task = Task { [weak self] in
            do {
                let stream = session.streamResponse(to: prompt, generating: FlightDebrief.self)
                var finalContent: GeneratedContent?
                for try await snapshot in stream {
                    try Task.checkCancellation()
                    finalContent = snapshot.rawContent
                    self?.sendEvent("onPartial", ["requestId": requestId, "json": snapshot.rawContent.jsonString])
                }
                try Task.checkCancellation()
                guard let finalContent else {
                    promise.resolve("")
                    return
                }
                _ = try FlightDebrief(finalContent)
                promise.resolve(finalContent.jsonString)
            } catch {
                if Task.isCancelled || error is CancellationError {
                    promise.reject("ERR_DEBRIEF_CANCELLED", "The debrief was cancelled")
                } else {
                    promise.reject("ERR_DEBRIEF_GENERATION", error.localizedDescription)
                }
            }
        }
        locked { generation = task }
    }

    private func endGeneration() {
        let running = locked { () -> Task<Void, Never>? in
            let current = generation
            generation = nil
            return current
        }
        running?.cancel()
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
