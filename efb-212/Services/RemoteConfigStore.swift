//
//  RemoteConfigStore.swift
//  efb-212
//
//  The remote config in effect: fetch policy, validation, the last good copy on disk, and the answers
//  the rest of the app asks (is a feature switched off, what is a parameter, is an update wanted).
//  A shared store rather than an AppState property because the map overlay and the debrief loader read
//  it and neither can reach AppState (same shape as IsraelDiagramStore).
//
//  Rules (docs/handoff/REMOTE-CONFIG.md):
//   - a file with a lower serial than the cached one is a stale copy and is rejected;
//   - an expired file (cached or new) never applies: the built-in values are used;
//   - offline: the last good copy, else the built-in values; the map never waits for this;
//   - never fetches while a flight is being recorded; at most once an hour (5 minutes after a failure).
//

import Foundation
import Observation
import os

@MainActor
@Observable
final class RemoteConfigStore {
    static let shared = RemoteConfigStore()

    /// Minimum time between checks after the file was read or rejected -- seconds.
    nonisolated static let checkInterval: TimeInterval = 3600
    /// Minimum time between checks after the network failed -- seconds.
    nonisolated static let retryInterval: TimeInterval = 300

    /// The last good config, even if it has expired. Use `active` for what applies.
    private(set) var config: RemoteConfig?
    /// When the cached config was downloaded.
    private(set) var fetchedAt: Date?
    /// Why the last check did not produce a new file; nil after a successful check.
    private(set) var lastError: String?
    private(set) var isChecking = false
    /// Banner and notice ids the pilot dismissed this session.
    private(set) var dismissedBannerIDs: Set<String> = []

    @ObservationIgnored private let service: any RemoteConfigServiceProtocol
    @ObservationIgnored private let storageURL: URL?
    @ObservationIgnored private let buildNumber: Int
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var nextCheckAt: Date?

    /// Application Support/RemoteConfig/last-config.json
    nonisolated static var defaultStorageURL: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return support.appendingPathComponent("RemoteConfig", isDirectory: true).appendingPathComponent("last-config.json")
    }

    /// The running build's CFBundleVersion.
    nonisolated static var currentBuildNumber: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "") ?? 0
    }

    /// - Parameters:
    ///   - storageURL: where the last good file is kept; nil = memory only (tests).
    ///   - buildNumber: the running build; injected by tests.
    init(
        service: any RemoteConfigServiceProtocol = RemoteConfigService(),
        storageURL: URL? = RemoteConfigStore.defaultStorageURL,
        buildNumber: Int = RemoteConfigStore.currentBuildNumber,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.service = service
        self.storageURL = storageURL
        self.buildNumber = buildNumber
        self.now = now
        loadSaved()
    }

    // MARK: - What applies

    /// The config in effect now: the cached one unless it has expired.
    var active: RemoteConfig? {
        guard let config, !config.isExpired(now: now()) else { return nil }
        return config
    }

    /// The pilot-facing message when `feature` is switched off, else nil.
    func disabledMessage(for feature: RemoteFeature) -> String? {
        active?.disabledFeatures[feature]?.resolved()
    }

    func isDisabled(_ feature: RemoteFeature) -> Bool { disabledMessage(for: feature) != nil }

    /// The value for `parameter`: the file's when it applies, else the built-in one.
    func value(for parameter: RemoteParameter) -> Double {
        active?.parameters[parameter] ?? parameter.builtIn
    }

    enum UpdateRequest: Equatable {
        /// The running build is below `minSupportedBuild`.
        case required(String)
        /// The running build is below `recommendedBuild`.
        case recommended(String)
    }

    /// Whether the config asks the pilot to update. Wording falls back to a fixed text when the file has none.
    var updateRequest: UpdateRequest? {
        guard let active else { return nil }
        let text = active.updateMessage?.resolved() ?? "A newer version of Kanaf is available."
        if let minimum = active.minSupportedBuild, buildNumber < minimum { return .required(text) }
        if let recommended = active.recommendedBuild, buildNumber < recommended { return .recommended(text) }
        return nil
    }

    /// Notices that apply to `region` now and were not dismissed.
    func notices(for region: Region) -> [RemoteNotice] {
        let current = now()
        return (active?.notices ?? []).filter { $0.applies(region: region, now: current) && !dismissedBannerIDs.contains($0.id) }
    }

    /// The map-wide banner id for a required update.
    nonisolated static let updateBannerID = "update-required"

    func dismissBanner(_ id: String) { dismissedBannerIDs.insert(id) }

    /// Settings > About line: where the values in effect come from.
    var sourceDescription: String {
        guard let active, let fetchedAt else { return "Built-in" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return "Serial \(active.serial), checked \(formatter.localizedString(for: fetchedAt, relativeTo: now()))"
    }

    // MARK: - Fetching

    /// Checks the relay when one is due. Called at launch and when the app becomes active.
    /// Does nothing while a flight is being recorded, while a check runs, or before the next due time.
    func refreshIfDue(recordingActive: Bool) async {
        guard !recordingActive, !isChecking else { return }
        if let nextCheckAt, now() < nextCheckAt { return }
        await refresh()
    }

    /// Fetches and applies a new file now.
    func refresh() async {
        isChecking = true
        defer { isChecking = false }
        let data: Data
        do {
            data = try await service.fetchConfigData()
        } catch {
            lastError = error.localizedDescription
            nextCheckAt = now().addingTimeInterval(Self.retryInterval)
            return
        }
        nextCheckAt = now().addingTimeInterval(Self.checkInterval)
        apply(data)
    }

    /// Validates `data` against the cached copy and adopts it. A rejected file leaves the cache untouched.
    func apply(_ data: Data) {
        let current = now()
        do {
            let incoming = try RemoteConfig.parse(data, now: current)
            if let config, incoming.serial < config.serial {
                throw EFBError.remoteConfigRejected("serial \(incoming.serial) is older than the saved \(config.serial)")
            }
            config = incoming
            fetchedAt = current
            lastError = nil
            persist(data, fetchedAt: current)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Disk

    private struct SavedConfig: Codable {
        let fetchedAt: Date
        let body: Data
    }

    private func loadSaved() {
        guard let storageURL, let raw = try? Data(contentsOf: storageURL),
              let saved = try? JSONDecoder().decode(SavedConfig.self, from: raw) else { return }
        // Re-validated on every launch; an expired copy is kept (for its serial) but never applies.
        guard let parsed = try? RemoteConfig.parse(saved.body, now: saved.fetchedAt) else { return }
        config = parsed
        fetchedAt = saved.fetchedAt
    }

    private func persist(_ body: Data, fetchedAt: Date) {
        guard let storageURL else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let raw = try JSONEncoder().encode(SavedConfig(fetchedAt: fetchedAt, body: body))
            try raw.write(to: storageURL, options: .atomic)
        } catch {
            Logger(subsystem: "quartermint.efb-212", category: "RemoteConfigStore")
                .error("Could not save the remote config: \(error.localizedDescription, privacy: .public)")
        }
    }
}
