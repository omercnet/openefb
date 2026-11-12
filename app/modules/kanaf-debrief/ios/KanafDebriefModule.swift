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
    // openSession and closeSession run on the JavaScript thread, generate on the module's background queue, so these fields
    // are only touched inside `locked`. Every change that depends on which session is current (open, close, starting a
    // generation and publishing its task) is ONE locked transaction, so a close can never miss a generation that is being
    // started, and a close of an old session can never clear a newer one.
    private let lock = NSLock()
    /// The open LanguageModelSession (an iOS 26 type, so held as AnyObject), its id, and the generation running on it.
    private var session: AnyObject?
    /// Id of the current session; handed to JavaScript by openSession and required by generate and closeSession.
    private var sessionId = 0
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

        /// Replaces any open session (cancelling its generation) and returns the new session's id.
        Function("openSession") { (instructions: String) throws -> Int in
            guard #available(iOS 26.0, *) else {
                throw DebriefModuleError.unsupported
            }
            let opened = LanguageModelSession(instructions: instructions)
            return self.locked {
                self.generation?.cancel()
                self.generation = nil
                self.sessionId += 1
                self.session = opened
                return self.sessionId
            }
        }

        AsyncFunction("generate") { (sessionId: Int, requestId: Int, prompt: String, promise: Promise) in
            guard #available(iOS 26.0, *) else {
                promise.reject("ERR_DEBRIEF_UNSUPPORTED", DebriefModuleError.unsupported.localizedDescription)
                return
            }
            self.startGeneration(sessionId: sessionId, requestId: requestId, prompt: prompt, promise: promise)
        }

        /// Cancels the generation and releases the session, but only if `sessionId` is still the current one: closing an
        /// older session after a newer one was opened must leave the newer one alone.
        Function("closeSession") { (sessionId: Int) in
            self.locked {
                guard self.sessionId == sessionId else { return }
                self.generation?.cancel()
                self.generation = nil
                self.session = nil
            }
        }

        OnDestroy {
            self.locked {
                self.generation?.cancel()
                self.generation = nil
                self.session = nil
            }
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
    private func startGeneration(sessionId: Int, requestId: Int, prompt: String, promise: Promise) {
        // Check the session, cancel a stale generation, create the task and publish it: one transaction under the lock. The
        // task body never takes the lock, so creating it here cannot deadlock; a closeSession either ran before (the check
        // below fails) or runs after (and cancels this task).
        let started: Bool = locked {
            guard self.sessionId == sessionId, let session = self.session as? LanguageModelSession else { return false }
            generation?.cancel() // one generation at a time; JavaScript never overlaps them, so this only cancels a stale one
            generation = Task { [weak self] in
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
            return true
        }
        if !started {
            promise.reject("ERR_DEBRIEF_NO_SESSION", DebriefModuleError.noSession.localizedDescription)
        }
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
