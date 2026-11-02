//
//  RemoteConfigTests.swift
//  efb-212Tests
//
//  The remote config file (docs/handoff/REMOTE-CONFIG.md): what a file may touch, what makes the app
//  ignore it, and the fetch policy. A file is data only: unknown or out-of-range values are dropped one
//  by one, a lower serial or an expired file never applies, and offline the app keeps its last good copy
//  or its built-in values.
//

import Testing
import Foundation
@testable import efb_212

nonisolated final class RemoteConfigTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date
    init(_ start: Date) { current = start }
    var now: Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
}

@Suite("Remote config", .serialized)
@MainActor
struct RemoteConfigTests {

    // MARK: Fixtures

    /// 2026-11-02T12:00:00Z
    nonisolated static let t0 = Date(timeIntervalSince1970: 1_793_620_800)
    nonisolated static let day: TimeInterval = 86_400

    nonisolated static func iso(_ date: Date) -> String { date.formatted(Date.ISO8601FormatStyle()) }

    /// A valid file; `mutate` edits the JSON object before it is encoded.
    nonisolated static func file(
        serial: Int = 1, expiresIn: TimeInterval = 30 * day, mutate: (inout [String: Any]) -> Void = { _ in }
    ) -> Data {
        var object: [String: Any] = [
            "schemaVersion": 1, "serial": serial,
            "issuedAt": iso(t0.addingTimeInterval(-3600)), "expiresAt": iso(t0.addingTimeInterval(expiresIn)),
        ]
        mutate(&object)
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }

    nonisolated static func text(_ english: String, _ hebrew: String? = nil) -> [String: String] {
        hebrew.map { ["en": english, "he": $0] } ?? ["en": english]
    }

    static func makeStore(
        _ service: any RemoteConfigServiceProtocol = MockRemoteConfigService.offline(),
        storage: URL? = nil, build: Int = 5, clock: RemoteConfigTestClock = RemoteConfigTestClock(t0)
    ) -> RemoteConfigStore {
        RemoteConfigStore(service: service, storageURL: storage, buildNumber: build, now: { clock.now })
    }

    static func tempStorage() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("remote-config-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("last-config.json")
    }

    static func rejects(_ data: Data, now: Date = t0) -> Bool {
        do { _ = try RemoteConfig.parse(data, now: now); return false }
        catch EFBError.remoteConfigRejected { return true }
        catch { return false }
    }

    // MARK: Parsing: what a file may carry

    @Test func aFullFileDecodesWithNothingIgnored() throws {
        let data = Self.file(serial: 7) { object in
            object["minSupportedBuild"] = 2
            object["recommendedBuild"] = 3
            object["updateMessage"] = Self.text("Update to build 3", "עדכנו")
            object["disabledFeatures"] = ["israelDiagramOverlay": Self.text("Fix pending", "תיקון בדרך")]
            object["parameters"] = ["cvfrReportWindowSeconds": 150]
            object["notices"] = [[
                "id": "n1", "severity": "caution", "regions": ["israel"],
                "until": Self.iso(Self.t0.addingTimeInterval(Self.day)), "text": Self.text("Hello"),
            ]]
        }
        let config = try RemoteConfig.parse(data, now: Self.t0)
        #expect(config.serial == 7)
        #expect(config.minSupportedBuild == 2 && config.recommendedBuild == 3)
        #expect(config.disabledFeatures[.israelDiagramOverlay]?.english == "Fix pending")
        #expect(config.parameters[.cvfrReportWindowSeconds] == 150)
        #expect(config.notices.map(\.id) == ["n1"])
        #expect(config.notices.first?.severity == .caution)
        #expect(config.ignored.isEmpty)
    }

    @Test func oneBadValueIsDroppedAndTheRestStillApplies() throws {
        let data = Self.file { object in
            object["minSupportedBuild"] = -4
            object["disabledFeatures"] = [
                "proximityAlerts": Self.text("Not a feature that can be switched off"),
                "israelDiagramOverlay": Self.text("Fix pending"),
            ]
            object["parameters"] = ["cvfrReportWindowSeconds": 9999, "madeUp": 1]
            object["notices"] = [["id": "no-text"]]
            object["recommendedBuild"] = 3
        }
        let config = try RemoteConfig.parse(data, now: Self.t0)
        #expect(Set(config.disabledFeatures.keys) == [.israelDiagramOverlay])
        #expect(config.parameters.isEmpty)
        #expect(config.notices.isEmpty)
        #expect(config.minSupportedBuild == nil)
        #expect(config.recommendedBuild == 3)
        // minSupportedBuild, proximityAlerts, the out-of-range value, madeUp and the notice.
        #expect(config.ignored.count == 5)
    }

    @Test(arguments: [0.0, 29.9, 300.1, .infinity])
    func aParameterOutsideItsRangeIsIgnored(value: Double) throws {
        // JSON has no infinity: send it as the string the encoder would never produce, which is also ignored.
        let sent: Any = value.isFinite ? value : "inf"
        let config = try RemoteConfig.parse(Self.file { $0["parameters"] = ["cvfrReportWindowSeconds": sent] }, now: Self.t0)
        #expect(config.parameters.isEmpty)
        #expect(config.ignored.count == 1)
    }

    @Test(arguments: [30.0, 120.0, 300.0])
    func aParameterAtOrInsideItsRangeIsKept(value: Double) throws {
        let config = try RemoteConfig.parse(Self.file { $0["parameters"] = ["cvfrReportWindowSeconds": value] }, now: Self.t0)
        #expect(config.parameters[.cvfrReportWindowSeconds] == value)
    }

    @Test func aRemoteNoticeIsNeverRed() throws {
        let config = try RemoteConfig.parse(Self.file { object in
            object["notices"] = [["id": "a", "severity": "critical", "text": Self.text("x")],
                                 ["id": "b", "severity": "warning", "text": Self.text("y")]]
        }, now: Self.t0)
        #expect(config.notices.map(\.severity) == [.info, .info])
    }

    @Test func hebrewIsUsedOnlyOnAHebrewDeviceAndWhenAHebrewTextExists() {
        let both = RemoteText(english: "Update", hebrew: "עדכנו")
        #expect(both.resolved(preferredLanguage: "he-IL") == "עדכנו")
        #expect(both.resolved(preferredLanguage: "en-US") == "Update")
        #expect(RemoteText(english: "Update").resolved(preferredLanguage: "he") == "Update")
    }

    // MARK: Parsing: what rejects a whole file

    @Test func aFileWithAnUnusableEnvelopeIsRejected() {
        #expect(Self.rejects(Data("not json".utf8)))
        #expect(Self.rejects(Data("[]".utf8)))
        #expect(Self.rejects(Data(count: RemoteConfig.maximumBytes + 1)))
        #expect(Self.rejects(Self.file { $0["schemaVersion"] = 2 }), "a newer schema")
        #expect(Self.rejects(Self.file { $0.removeValue(forKey: "schemaVersion") }))
        #expect(Self.rejects(Self.file { $0.removeValue(forKey: "serial") }))
        #expect(Self.rejects(Self.file { $0["serial"] = true }), "a boolean is not a serial")
        #expect(Self.rejects(Self.file { $0["serial"] = 1.5 }))
        #expect(Self.rejects(Self.file { $0["expiresAt"] = "tomorrow" }))
        #expect(Self.rejects(Self.file { $0["expiresAt"] = Self.iso(Self.t0.addingTimeInterval(-7200)) }), "expires before it was issued")
    }

    @Test func aFileThatAlreadyExpiredIsRejected() {
        let data = Self.file(expiresIn: 60)
        #expect(!Self.rejects(data))
        #expect(Self.rejects(data, now: Self.t0.addingTimeInterval(61)))
    }

    @Test func fractionalSecondTimestampsFromJavaScriptAreAccepted() throws {
        let config = try RemoteConfig.parse(Self.file { object in
            object["issuedAt"] = "2026-11-02T00:00:00.000Z"
            object["expiresAt"] = "2027-01-01T00:00:00.000Z"
        }, now: Self.t0)
        #expect(config.serial == 1)
    }

    // MARK: Store: precedence and expiry

    @Test func aLowerSerialIsRejectedAndTheSavedCopyStays() {
        let store = Self.makeStore()
        store.apply(Self.file(serial: 5) { $0["parameters"] = ["cvfrReportWindowSeconds": 150] })
        store.apply(Self.file(serial: 4) { $0["parameters"] = ["cvfrReportWindowSeconds": 200] })
        #expect(store.config?.serial == 5)
        #expect(store.value(for: .cvfrReportWindowSeconds) == 150)
        #expect(store.lastError != nil)

        store.apply(Self.file(serial: 5) { $0["parameters"] = ["cvfrReportWindowSeconds": 200] })
        #expect(store.value(for: .cvfrReportWindowSeconds) == 200, "the same serial is accepted")
        #expect(store.lastError == nil)
        store.apply(Self.file(serial: 6) { $0["parameters"] = [:] })
        #expect(store.value(for: .cvfrReportWindowSeconds) == RemoteParameter.cvfrReportWindowSeconds.builtIn)
    }

    @Test func anExpiredCopyStopsApplyingAndTheBuiltInValuesReturn() {
        let clock = RemoteConfigTestClock(Self.t0)
        let store = Self.makeStore(clock: clock)
        store.apply(Self.file(expiresIn: 3600) { object in
            object["parameters"] = ["cvfrReportWindowSeconds": 150]
            object["disabledFeatures"] = ["israelDiagramOverlay": Self.text("Fix pending")]
            object["minSupportedBuild"] = 99
        })
        #expect(store.value(for: .cvfrReportWindowSeconds) == 150)
        #expect(store.isDisabled(.israelDiagramOverlay))
        #expect(store.updateRequest != nil)

        clock.advance(7200)
        #expect(store.value(for: .cvfrReportWindowSeconds) == 120)
        #expect(!store.isDisabled(.israelDiagramOverlay))
        #expect(store.disabledMessage(for: .israelDiagramOverlay) == nil)
        #expect(store.updateRequest == nil)
        #expect(store.active == nil)
        #expect(store.sourceDescription == "Built-in")
    }

    @Test func aFeatureThatIsNotOnTheListCannotBeSwitchedOff() {
        let store = Self.makeStore()
        store.apply(Self.file { object in
            object["disabledFeatures"] = [
                "proximityAlerts": Self.text("off"), "airspaceCheck": Self.text("off"),
                "closureBlocking": Self.text("off"), "disclaimers": Self.text("off"),
            ]
        })
        #expect(store.active?.disabledFeatures.isEmpty == true)
        #expect(store.active?.ignored.count == 4)
        #expect(!store.isDisabled(.israelDiagramOverlay))
    }

    @Test func aSwitchedOffFeatureReportsTheFilesOwnMessage() {
        let store = Self.makeStore()
        store.apply(Self.file { $0["disabledFeatures"] = ["israelDiagramOverlay": Self.text("Diagrams are paused while we fix a placement error.")] })
        #expect(store.disabledMessage(for: .israelDiagramOverlay) == "Diagrams are paused while we fix a placement error.")
    }

    // MARK: Store: offline and disk

    @Test func offlineFirstLaunchUsesTheBuiltInValues() async {
        let service = MockRemoteConfigService.offline()
        let store = Self.makeStore(service)
        await store.refresh()
        #expect(service.callCount == 1)
        #expect(store.active == nil)
        #expect(store.value(for: .cvfrReportWindowSeconds) == 120)
        #expect(store.sourceDescription == "Built-in")
        #expect(store.lastError != nil)
    }

    @Test func theLastGoodCopySurvivesARelaunchAndStillExpires() async {
        let storage = Self.tempStorage()
        defer { try? FileManager.default.removeItem(at: storage.deletingLastPathComponent()) }
        let clock = RemoteConfigTestClock(Self.t0)

        let first = Self.makeStore(
            MockRemoteConfigService(data: Self.file(serial: 3, expiresIn: 10 * Self.day) { $0["parameters"] = ["cvfrReportWindowSeconds": 150] }),
            storage: storage, clock: clock)
        await first.refresh()
        #expect(first.value(for: .cvfrReportWindowSeconds) == 150)

        // Relaunch with no network.
        let second = Self.makeStore(MockRemoteConfigService.offline(), storage: storage, clock: clock)
        #expect(second.config?.serial == 3)
        #expect(second.value(for: .cvfrReportWindowSeconds) == 150)
        #expect(second.sourceDescription.hasPrefix("Serial 3"))

        // Later than the file's expiry: it no longer applies, but its serial still blocks an older file.
        clock.advance(11 * Self.day)
        let third = Self.makeStore(MockRemoteConfigService.offline(), storage: storage, clock: clock)
        #expect(third.active == nil)
        #expect(third.value(for: .cvfrReportWindowSeconds) == 120)
        third.apply(Self.file(serial: 2, expiresIn: 30 * Self.day + 11 * Self.day))
        #expect(third.config?.serial == 3)
        #expect(third.lastError != nil)
    }

    @Test func aDamagedSavedFileIsIgnored() throws {
        let storage = Self.tempStorage()
        defer { try? FileManager.default.removeItem(at: storage.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{ truncated".utf8).write(to: storage)
        let store = Self.makeStore(storage: storage)
        #expect(store.config == nil)
        #expect(store.sourceDescription == "Built-in")
    }

    // MARK: Store: fetch policy

    @Test func nothingIsFetchedWhileARecordingIsActive() async {
        let service = MockRemoteConfigService(data: Self.file())
        let store = Self.makeStore(service)
        await store.refreshIfDue(recordingActive: true)
        #expect(service.callCount == 0)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 1)
    }

    @Test func aSuccessfulCheckIsNotRepeatedWithinAnHour() async {
        let clock = RemoteConfigTestClock(Self.t0)
        let service = MockRemoteConfigService(data: Self.file())
        let store = Self.makeStore(service, clock: clock)
        await store.refreshIfDue(recordingActive: false)
        clock.advance(RemoteConfigStore.checkInterval - 1)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 1)
        clock.advance(2)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 2)
    }

    @Test func aRejectedFileCountsAsACheckSoABadFileIsNotHammered() async {
        let clock = RemoteConfigTestClock(Self.t0)
        let service = MockRemoteConfigService(data: Data("garbage".utf8))
        let store = Self.makeStore(service, clock: clock)
        await store.refreshIfDue(recordingActive: false)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 1)
        #expect(store.lastError != nil)
    }

    @Test func aNetworkFailureIsRetriedAfterFiveMinutes() async {
        let clock = RemoteConfigTestClock(Self.t0)
        let service = MockRemoteConfigService.offline()
        let store = Self.makeStore(service, clock: clock)
        await store.refreshIfDue(recordingActive: false)
        clock.advance(RemoteConfigStore.retryInterval - 1)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 1)
        clock.advance(2)
        await store.refreshIfDue(recordingActive: false)
        #expect(service.callCount == 2)
    }

    // MARK: Store: update request and notices

    @Test(arguments: [
        (1, "required"), (2, "recommended"), (3, "none"),
    ])
    func theUpdateRequestFollowsTheRunningBuild(build: Int, expected: String) {
        let store = Self.makeStore(build: build)
        store.apply(Self.file { object in
            object["minSupportedBuild"] = 2
            object["recommendedBuild"] = 3
            object["updateMessage"] = Self.text("Please update")
        })
        switch (store.updateRequest, expected) {
        case (.required("Please update")?, "required"), (.recommended("Please update")?, "recommended"), (nil, "none"): break
        default: Issue.record("build \(build): got \(String(describing: store.updateRequest)), expected \(expected)")
        }
    }

    @Test func noticesFollowTheRegionTheExpiryAndDismissal() {
        let clock = RemoteConfigTestClock(Self.t0)
        let store = Self.makeStore(clock: clock)
        store.apply(Self.file { object in
            object["notices"] = [
                ["id": "il", "regions": ["israel"], "text": Self.text("Israel only")],
                ["id": "all", "text": Self.text("Everyone")],
                ["id": "soon", "until": Self.iso(Self.t0.addingTimeInterval(3600)), "text": Self.text("Short")],
            ]
        })
        #expect(store.notices(for: .us).map(\.id) == ["all", "soon"])
        #expect(store.notices(for: .israel).map(\.id) == ["il", "all", "soon"])
        store.dismissBanner("all")
        #expect(store.notices(for: .israel).map(\.id) == ["il", "soon"])
        clock.advance(7200)
        #expect(store.notices(for: .israel).map(\.id) == ["il"])
    }

    // MARK: The file the relay serves

    @Test func theRelaysCheckedInFileDecodesWithNothingIgnored() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let file = root.appendingPathComponent("web/notam-relay/config/app-config.json")
        // "Now" is pinned inside the file's validity so the test doesn't expire with the calendar.
        let config = try RemoteConfig.parse(Data(contentsOf: file), now: Self.t0)
        #expect(config.ignored.isEmpty)
        #expect(config.serial >= 1)
    }

    // MARK: Service

    @Test func theServiceReturnsTheBodyOfA200() async throws {
        let body = Self.file()
        let session = StubURLProtocol.session { _ in (200, body) }
        let service = RemoteConfigService(session: session, url: { URL(string: "https://relay.example/config.json") })
        #expect(try await service.fetchConfigData() == body)
    }

    @Test(arguments: [404, 500, 503])
    func theServiceRefusesAnythingButA200(status: Int) async {
        let session = StubURLProtocol.session { _ in (status, Self.file()) }
        let service = RemoteConfigService(session: session, url: { URL(string: "https://relay.example/config.json") })
        await #expect(throws: EFBError.self) { try await service.fetchConfigData() }
    }

    @Test func theServiceRefusesAnOversizedBody() async {
        let session = StubURLProtocol.session { _ in (200, Data(count: RemoteConfig.maximumBytes + 1)) }
        let service = RemoteConfigService(session: session, url: { URL(string: "https://relay.example/config.json") })
        await #expect(throws: EFBError.self) { try await service.fetchConfigData() }
    }
}
