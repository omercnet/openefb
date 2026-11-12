//
//  ScreenCaptureHooksTests.swift
//  efb-212Tests
//
//  The DEBUG launch arguments that put the app on a screen for tools/ci/capture-screens.sh: the existing ones keep
//  working, the new ones (-OpenEFBRoute, -OpenEFBBriefing, -OpenEFBLayers) parse, and unknown values change nothing.
//

#if DEBUG

import Testing
import Foundation
import GRDB
import SwiftData
@testable import efb_212

@Suite("Screen capture hooks", .serialized)
@MainActor
struct ScreenCaptureHooksTests {

    private func defaults(_ values: [String: String]) -> UserDefaults {
        let d = UserDefaults(suiteName: "capture-hooks-\(UUID().uuidString)") ?? .standard
        for (key, value) in values { d.set(value, forKey: key) }
        return d
    }

    @Test func existingArgumentsStillApply() {
        let state = AppState()
        ScreenCaptureHooks.apply(to: state, defaults: defaults([
            "OpenEFBScreen": "log", "OpenEFBStripColumn": "airport:ksql", "OpenEFBDisplayMode": "night",
        ]))
        #expect(state.selectedScreen == .log)
        #expect(state.stripColumn == .airport)
        #expect(state.selectedAirportID == "KSQL")
        #expect(state.displayMode == .night)
    }

    @Test func everyRouteValueParses() {
        let expected = ["settings", "disclaimers", "aircraft", "aircraftedit", "pilot", "logbookentry", "logbooklocked", "flightdetail", "cvfr", "debrief", "replay", "replayfast", "israel-plan"]
        #expect(Set(ScreenCaptureHooks.Route.allCases.map(\.rawValue)) == Set(expected))
        for value in expected {
            ScreenCaptureHooks.apply(to: AppState(), defaults: defaults(["OpenEFBRoute": value]))
            #expect(CaptureRouteModel.shared.route?.rawValue == value)
        }
    }

    @Test func unknownRouteShowsNothing() {
        ScreenCaptureHooks.apply(to: AppState(), defaults: defaults(["OpenEFBRoute": "settings"]))
        ScreenCaptureHooks.apply(to: AppState(), defaults: defaults(["OpenEFBRoute": "nonsense"]))
        #expect(CaptureRouteModel.shared.route == nil)
        ScreenCaptureHooks.apply(to: AppState(), defaults: defaults([:]))
        #expect(CaptureRouteModel.shared.route == nil)
    }

    @Test func layersAllTurnsEveryLayerOn() {
        let state = AppState()
        ScreenCaptureHooks.apply(to: state, defaults: defaults(["OpenEFBLayers": "all"]))
        #expect(state.visibleLayers == Set(MapLayer.allCases))
        let other = AppState()
        let before = other.visibleLayers
        ScreenCaptureHooks.apply(to: other, defaults: defaults(["OpenEFBLayers": "some"]))
        #expect(other.visibleLayers == before)
    }

    @Test func briefingOpensTheSheetOnlyOnYes() {
        let state = AppState()
        ScreenCaptureHooks.apply(to: state, defaults: defaults(["OpenEFBBriefing": "NO"]))
        #expect(!state.isPresentingIsraelBriefing)
        ScreenCaptureHooks.apply(to: state, defaults: defaults(["OpenEFBBriefing": "YES"]))
        #expect(state.isPresentingIsraelBriefing)
    }

    @Test func aRouteTurnsAutoStartOff() {
        let state = AppState()
        #expect(state.isAutoStartEnabled)
        ScreenCaptureHooks.apply(to: state, defaults: defaults(["OpenEFBRoute": "replay"]))
        #expect(!state.isAutoStartEnabled)
    }

    private func seed(_ profile: String) throws -> ModelContext {
        let container = try ModelContainer(
            for: SchemaV1.AircraftProfile.self, SchemaV1.PilotProfile.self, SchemaV1.UserSettings.self,
            SchemaV1.FlightPlanRecord.self, SchemaV1.FlightRecord.self, SchemaV1.LogbookEntry.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("capture-seed-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let audio = tmp.appendingPathComponent("recordings")
        try FileManager.default.createDirectory(at: audio, withIntermediateDirectories: true)
        try Data().write(to: audio.appendingPathComponent("stale.m4a"))
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: tmp.appendingPathComponent("r.sqlite").path))
        defer { try? FileManager.default.removeItem(at: tmp) }
        try CaptureSeed.run(profile: profile, container: container, recordingDB: db, audioDirectory: audio)
        #expect(try FileManager.default.contentsOfDirectory(atPath: audio.path).isEmpty)
        let flights = try db.flightIDsWithRecordedData().count
        #expect(flights == (profile == "capture" ? 1 : 0))
        return container.mainContext
    }

    @Test func captureSeedFillsTheDocumentedData() throws {
        let ctx = try seed("capture")
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.AircraftProfile>()).map(\.nNumber).sorted() == ["4X-ABC", "N172KF", "N28PA"])
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.PilotProfile>()).count == 1)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).count == 1)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).count == 2)
    }

    @Test func captureFreshLeavesNothingBehind() throws {
        let ctx = try seed("capture-fresh")
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.AircraftProfile>()).isEmpty)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.PilotProfile>()).isEmpty)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.FlightRecord>()).isEmpty)
        #expect(try ctx.fetch(FetchDescriptor<SchemaV1.LogbookEntry>()).isEmpty)
    }

    @Test func microphoneNoticeIsForcedAgainstTheSyncLoop() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("capture-hooks-\(UUID().uuidString).sqlite")
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: url.path))
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + suffix) } }
        let state = AppState()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: MockAudioRecorder(), transcriptionService: MockTranscriptionService())
        let vm = RecordingViewModel(coordinator: coordinator, appState: state)
        ScreenCaptureHooks.applyRecording(to: vm, defaults: defaults(["OpenEFBRecording": "notices"]))
        #expect(vm.microphoneDenied && vm.captureForcesMicrophoneDenied)
        // The sync loop runs every 500 ms while recording; the forced flag must survive it.
        _ = try await coordinator.startRecording()
        vm.startSyncLoopForTesting()
        try await Task.sleep(for: .milliseconds(1_200))
        #expect(vm.microphoneDenied)
        _ = await coordinator.stopRecording()
    }

    @Test func noArgumentsChangeNothing() {
        let state = AppState()
        ScreenCaptureHooks.apply(to: state, defaults: defaults([:]))
        #expect(state.selectedScreen == .map)
        #expect(state.stripColumn == .log)
        #expect(!state.isPresentingIsraelBriefing)
    }
}

#endif
