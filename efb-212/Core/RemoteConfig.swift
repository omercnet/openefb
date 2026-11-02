//
//  RemoteConfig.swift
//  efb-212
//
//  The remote config file (web/notam-relay/config/app-config.json, served at /config.json): a small,
//  versioned set of values the app reads at runtime. It is data, never code: it can switch a listed
//  feature off, move a listed parameter inside its range, show a notice and ask pilots to update.
//  Anything the build does not list is ignored, so a file can't add behaviour or touch a safety function.
//
//  Decoding is lenient on purpose: one bad value is ignored (and reported in `ignored`), the rest of
//  the file still applies. Only the envelope (schema, serial, dates) can reject the whole file.
//

import Foundation

// MARK: - Text

/// Pilot-facing text in English with an optional Hebrew version.
nonisolated struct RemoteText: Equatable, Sendable {
    let english: String
    let hebrew: String?

    /// Hebrew when the device's first preferred language is Hebrew and a Hebrew text exists, else English.
    func resolved(preferredLanguage: String = Locale.preferredLanguages.first ?? "en") -> String {
        if let hebrew, !hebrew.isEmpty, preferredLanguage.lowercased().hasPrefix("he") { return hebrew }
        return english
    }

    /// nil unless `value` is an object with a non-empty "en" string.
    init?(json value: Any?) {
        guard let object = value as? [String: Any],
              let english = (object["en"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !english.isEmpty else { return nil }
        self.english = english
        self.hebrew = (object["he"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    init(english: String, hebrew: String? = nil) {
        self.english = english
        self.hebrew = hebrew
    }
}

// MARK: - What a file may touch

/// Features a file may switch off. Anything else in `disabledFeatures` is ignored.
/// Safety functions are never listed here: proximity and airspace alerts, NOTAM closure blocking on
/// filing, disclaimers, data-age and expiry badges.
nonisolated enum RemoteFeature: String, CaseIterable, Sendable {
    /// The CAAI aerodrome diagrams drawn on the Israel map (IL-13). The diagram sheet PDFs stay available.
    case israelDiagramOverlay
}

/// Values a file may adjust, each inside a range fixed in the build.
nonisolated enum RemoteParameter: String, CaseIterable, Sendable {
    /// A transcript segment counts as a position report within this window of the closest approach -- seconds.
    case cvfrReportWindowSeconds

    /// The value when no file is in effect -- same unit as the parameter.
    var builtIn: Double {
        switch self {
        case .cvfrReportWindowSeconds: return CVFRDebriefBuilder.reportWindowSeconds
        }
    }

    /// Accepted range, inclusive.
    var range: ClosedRange<Double> {
        switch self {
        case .cvfrReportWindowSeconds: return 30...300
        }
    }
}

// MARK: - Notices

nonisolated struct RemoteNotice: Equatable, Sendable, Identifiable {
    enum Severity: String, Sendable { case info, caution }

    let id: String
    let severity: Severity
    /// Region raw values (`us`, `israel`); empty = every region.
    let regions: Set<String>
    let until: Date?
    let text: RemoteText

    func applies(region: Region, now: Date) -> Bool {
        if let until, now >= until { return false }
        return regions.isEmpty || regions.contains(region.rawValue)
    }
}

// MARK: - Config

nonisolated struct RemoteConfig: Equatable, Sendable {

    /// Schema versions this build understands.
    static let supportedSchemaVersions: Set<Int> = [1]
    /// Larger bodies are refused without parsing.
    static let maximumBytes = 64 * 1024

    let schemaVersion: Int
    /// Increases with every published change; a file with a lower serial than the cached one is a stale copy.
    let serial: Int
    let issuedAt: Date
    /// After this the file no longer applies and the built-in values are used.
    let expiresAt: Date
    /// Build numbers (CFBundleVersion). Below `minSupportedBuild` the app asks for an update on every tab.
    let minSupportedBuild: Int?
    let recommendedBuild: Int?
    let updateMessage: RemoteText?
    let disabledFeatures: [RemoteFeature: RemoteText]
    let parameters: [RemoteParameter: Double]
    let notices: [RemoteNotice]
    /// What was left out and why, one line each; for Settings and tests.
    let ignored: [String]

    func isExpired(now: Date) -> Bool { now >= expiresAt }

    /// Throws `EFBError.remoteConfigRejected` when the envelope is unusable or the file is expired at `now`.
    static func parse(_ data: Data, now: Date) throws -> RemoteConfig {
        guard data.count <= maximumBytes else { throw EFBError.remoteConfigRejected("the file is too large") }
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw EFBError.remoteConfigRejected("the file is not a JSON object")
        }
        guard let schema = integer(root["schemaVersion"]) else {
            throw EFBError.remoteConfigRejected("no schema version")
        }
        guard supportedSchemaVersions.contains(schema) else {
            throw EFBError.remoteConfigRejected("schema \(schema) is newer than this build understands")
        }
        guard let serial = integer(root["serial"]), serial >= 0 else {
            throw EFBError.remoteConfigRejected("no serial")
        }
        guard let issuedAt = date(root["issuedAt"]), let expiresAt = date(root["expiresAt"]), expiresAt > issuedAt else {
            throw EFBError.remoteConfigRejected("missing or invalid dates")
        }
        guard now < expiresAt else { throw EFBError.remoteConfigRejected("the file has expired") }

        var ignored: [String] = []

        func build(_ key: String) -> Int? {
            guard let raw = root[key] else { return nil }
            if let value = integer(raw), value >= 0 { return value }
            ignored.append("\(key): not a build number")
            return nil
        }
        let minBuild = build("minSupportedBuild")
        let recommended = build("recommendedBuild")

        var updateMessage: RemoteText?
        if let raw = root["updateMessage"] {
            updateMessage = RemoteText(json: raw)
            if updateMessage == nil { ignored.append("updateMessage: needs an English text") }
        }

        var disabled: [RemoteFeature: RemoteText] = [:]
        if let raw = root["disabledFeatures"] {
            if let object = raw as? [String: Any] {
                for (key, value) in object.sorted(by: { $0.key < $1.key }) {
                    guard let feature = RemoteFeature(rawValue: key) else {
                        ignored.append("disabledFeatures.\(key): not a feature that can be switched off")
                        continue
                    }
                    guard let message = RemoteText(json: value) else {
                        ignored.append("disabledFeatures.\(key): needs an English message")
                        continue
                    }
                    disabled[feature] = message
                }
            } else {
                ignored.append("disabledFeatures: not an object")
            }
        }

        var parameters: [RemoteParameter: Double] = [:]
        if let raw = root["parameters"] {
            if let object = raw as? [String: Any] {
                for (key, value) in object.sorted(by: { $0.key < $1.key }) {
                    guard let parameter = RemoteParameter(rawValue: key) else {
                        ignored.append("parameters.\(key): unknown parameter")
                        continue
                    }
                    guard let number = number(value) else {
                        ignored.append("parameters.\(key): not a number")
                        continue
                    }
                    guard parameter.range.contains(number) else {
                        ignored.append("parameters.\(key): \(number) is outside \(parameter.range.lowerBound)...\(parameter.range.upperBound)")
                        continue
                    }
                    parameters[parameter] = number
                }
            } else {
                ignored.append("parameters: not an object")
            }
        }

        var notices: [RemoteNotice] = []
        if let raw = root["notices"] {
            if let list = raw as? [[String: Any]] {
                for (index, entry) in list.enumerated() {
                    if let notice = notice(from: entry) { notices.append(notice) }
                    else { ignored.append("notices[\(index)]: needs an id and an English text") }
                }
            } else {
                ignored.append("notices: not a list of objects")
            }
        }

        return RemoteConfig(
            schemaVersion: schema, serial: serial, issuedAt: issuedAt, expiresAt: expiresAt,
            minSupportedBuild: minBuild, recommendedBuild: recommended, updateMessage: updateMessage,
            disabledFeatures: disabled, parameters: parameters, notices: notices, ignored: ignored)
    }

    // MARK: Helpers

    private static func notice(from entry: [String: Any]) -> RemoteNotice? {
        guard let id = (entry["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty,
              let text = RemoteText(json: entry["text"]) else { return nil }
        // A remote notice is never red: anything but "caution" shows as info.
        let severity = RemoteNotice.Severity(rawValue: entry["severity"] as? String ?? "") ?? .info
        let regions = Set((entry["regions"] as? [String]) ?? [])
        return RemoteNotice(id: id, severity: severity, regions: regions, until: date(entry["until"]), text: text)
    }

    /// JSON numbers arrive as NSNumber; reject booleans and fractions.
    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.rounded() == double, abs(double) < 1e12 else { return nil }
        return number.intValue
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String else { return nil }
        if let plain = try? Date(text, strategy: Date.ISO8601FormatStyle()) { return plain }
        return try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }
}
