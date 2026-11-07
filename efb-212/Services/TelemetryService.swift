//
//  TelemetryService.swift
//  efb-212
//
//  Anonymous usage signals and MetricKit crash / hang summaries, sent through TelemetryDeck.
//  Off when no App ID is configured (build setting TELEMETRYDECK_APP_ID), under tests, or when the
//  pilot turns off "Share anonymous usage data" in Settings. Signals never carry coordinates,
//  airport identifiers, tail numbers, names or free text.
//

import Foundation
import MetricKit
import os
import TelemetryDeck

nonisolated enum Telemetry {

    /// UserDefaults key of the Settings toggle. Missing means on.
    static let enabledKey = "telemetryEnabled"

    private nonisolated struct State: Sendable {
        var config: TelemetryDeck.Config?
        var region: Region?
    }

    private static let state = OSAllocatedUnfairLock(initialState: State())
    private static let subscriber = MetricKitSubscriber()

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    /// Initialise TelemetryDeck and subscribe to MetricKit once. A no-op without an App ID, under
    /// tests, when the pilot opted out, or when already started.
    @MainActor
    static func start(region: Region) {
        setRegion(region)
        let appID = Bundle.main.object(forInfoDictionaryKey: "TelemetryDeckAppID") as? String ?? ""
        guard !appID.isEmpty, NSClassFromString("XCTestCase") == nil, isEnabled,
              state.withLock({ $0.config == nil }) else { return }
        let config = TelemetryDeck.Config(appID: appID)
        // "region" is a reserved TelemetryDeck parameter (the device locale region).
        config.defaultParameters = {
            state.withLock { $0.region }.map { ["appRegion": $0.rawValue] } ?? [:]
        }
        TelemetryDeck.initialize(config: config)
        state.withLock { $0.config = config }
        MXMetricManager.shared.add(subscriber)
    }

    /// Settings toggle: stops or resumes sending at once; starts the SDK if it was off at launch.
    @MainActor
    static func setEnabled(_ enabled: Bool, region: Region) {
        if let config = state.withLock({ $0.config }) {
            config.analyticsDisabled = !enabled
        } else if enabled {
            start(region: region)
        }
    }

    /// Keeps the `appRegion` default parameter current.
    static func setRegion(_ region: Region) {
        state.withLock { $0.region = region }
    }

    /// Send a signal. A no-op when not started or opted out.
    static func signal(_ name: String, parameters: [String: String] = [:]) {
        guard let config = state.withLock({ $0.config }), !config.analyticsDisabled else { return }
        TelemetryDeck.signal(name, parameters: parameters)
    }

    // MARK: - Parameters

    /// Recording length bucket in minutes: "0-15", "15-60" or "60+".
    static func durationBucket(_ seconds: TimeInterval) -> String {
        switch seconds / 60 {
        case ..<15: return "0-15"
        case ..<60: return "15-60"
        default: return "60+"
        }
    }

    /// Parameters for an `MXCrashDiagnostic.jsonRepresentation()`; nil when it can't be read.
    static func crashParameters(_ json: Data) -> [String: String]? {
        guard let parsed = diagnostic(json) else { return nil }
        var parameters: [String: String] = [:]
        for key in ["exceptionType", "exceptionCode", "signal", "appBuildVersion", "osVersion"] {
            parameters[key] = string(parsed.meta[key])
        }
        parameters["topFrames"] = topFrames(parsed.tree)
        return parameters
    }

    /// Parameters for an `MXHangDiagnostic.jsonRepresentation()`; nil when it can't be read.
    static func hangParameters(_ json: Data) -> [String: String]? {
        guard let parsed = diagnostic(json) else { return nil }
        var parameters: [String: String] = [:]
        for key in ["hangDuration", "appBuildVersion"] {
            parameters[key] = string(parsed.meta[key])
        }
        parameters["topFrames"] = topFrames(parsed.tree)
        return parameters
    }

    private static func diagnostic(_ json: Data) -> (meta: [String: Any], tree: [String: Any]?)? {
        guard let root = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any],
              let meta = root["diagnosticMetaData"] as? [String: Any] else { return nil }
        return (meta, root["callStackTree"] as? [String: Any])
    }

    /// The attributed (crashed / hung) thread's top frames, innermost first, as
    /// `binaryName+offsetIntoBinaryTextSegment` joined by " | ". Each frame's caller is its first subframe.
    private static func topFrames(_ tree: [String: Any]?, limit: Int = 8) -> String? {
        guard let stacks = tree?["callStacks"] as? [[String: Any]] else { return nil }
        let stack = stacks.first { $0["threadAttributed"] as? Bool == true } ?? stacks.first
        var frame = (stack?["callStackRootFrames"] as? [[String: Any]])?.first
        var frames: [String] = []
        while let current = frame, frames.count < limit {
            let binary = current["binaryName"] as? String ?? "?"
            let offset = (current["offsetIntoBinaryTextSegment"] as? NSNumber).map { "+\($0.int64Value)" } ?? ""
            frames.append(binary + offset)
            frame = (current["subFrames"] as? [[String: Any]])?.first
        }
        return frames.isEmpty ? nil : frames.joined(separator: " | ")
    }

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let text as String: return text
        case let number as NSNumber: return number.stringValue
        default: return nil
        }
    }
}

/// Turns MetricKit crash and hang diagnostics into signals. MetricKit calls it on a background queue.
nonisolated final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber, Sendable {
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            for crash in payload.crashDiagnostics ?? [] {
                Telemetry.signal("Diagnostics.crash", parameters: Telemetry.crashParameters(crash.jsonRepresentation()) ?? [:])
            }
            for hang in payload.hangDiagnostics ?? [] {
                Telemetry.signal("Diagnostics.hang", parameters: Telemetry.hangParameters(hang.jsonRepresentation()) ?? [:])
            }
        }
    }
}
