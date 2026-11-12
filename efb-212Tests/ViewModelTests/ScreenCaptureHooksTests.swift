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

    @Test func captureSeedProfilesAreKnown() {
        #expect(CaptureSeed.profiles == ["capture", "capture-fresh"])
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
