//
//  ScreenCaptureHooks.swift
//  efb-212
//
//  DEBUG only. Puts the app on a given screen for tools/ci/capture-screens.sh. Launch arguments:
//    -OpenEFBScreen map|log
//    -OpenEFBStripColumn log|nearest|layers|search|airport:<ICAO>
//    -OpenEFBDisplayMode day|night
//    -OpenEFBDirectTo <ICAO>             direct to this airport, as the Nearest list's Direct does
//    -OpenEFBRoute settings|disclaimers|aircraft|aircraftedit|pilot|logbookentry|logbooklocked|flightdetail|cvfr|debrief|replay|replayfast|israel-plan
//                                        a full-screen page over the app (CaptureRouteHost), named like the React Native
//                                        screens; the record pages show the first stored record, so also pass -OpenEFBSeed small
//    -OpenEFBRecording notices|stopped|stop
//                                        recording problems over the map (applyRecording, called when the map builds its
//                                        recording view model): notices = microphone off and audio failing, stopped =
//                                        recording failed and not saved (auto start off), stop = the End recording? dialog
//    -OpenEFBBriefing YES                the Israel NOTAM briefing sheet over the map
//    -OpenEFBLayers all                  every map layer on (the all-layers map)
//  Unknown values are ignored; without the arguments nothing changes.
//

#if DEBUG

import Foundation
import Observation

/// What CaptureRouteHost shows; set by ScreenCaptureHooks.apply.
@Observable
@MainActor
final class CaptureRouteModel {
    static let shared = CaptureRouteModel()
    var route: ScreenCaptureHooks.Route?
}

enum ScreenCaptureHooks {
    static let screenKey = "OpenEFBScreen"
    static let stripColumnKey = "OpenEFBStripColumn"
    static let displayModeKey = "OpenEFBDisplayMode"
    static let directToKey = "OpenEFBDirectTo"
    static let routeKey = "OpenEFBRoute"
    static let briefingKey = "OpenEFBBriefing"
    static let layersKey = "OpenEFBLayers"
    static let recordingKey = "OpenEFBRecording"

    /// The pages -OpenEFBRoute opens; the raw value is the launch argument value.
    enum Route: String, CaseIterable {
        case settings, disclaimers, aircraft, aircraftedit, pilot, logbookentry, logbooklocked, flightdetail, cvfr, debrief, replay, replayfast
        case israelPlan = "israel-plan"
    }

    @MainActor
    static func apply(to appState: AppState, defaults: UserDefaults = .standard) {
        if let screen = defaults.string(forKey: screenKey).flatMap(AppScreen.init(rawValue:)) {
            appState.selectedScreen = screen
        }
        if let column = defaults.string(forKey: stripColumnKey) {
            switch column {
            case "log": appState.stripColumn = .log
            case "nearest": appState.stripColumn = .nearest
            case "layers": appState.stripColumn = .layers
            case "search": appState.stripColumn = .search
            default:
                let parts = column.split(separator: ":", maxSplits: 1)
                if parts.count == 2, parts[0] == "airport", !parts[1].isEmpty {
                    appState.selectedAirportID = parts[1].uppercased()
                    appState.stripColumn = .airport
                }
            }
        }
        switch defaults.string(forKey: displayModeKey) {
        case "day": appState.displayMode = .day
        case "night": appState.displayMode = .night
        default: break
        }
        if defaults.string(forKey: layersKey) == "all" {
            appState.visibleLayers = Set(MapLayer.allCases)
        }
        if defaults.string(forKey: briefingKey) == "YES" {
            appState.isPresentingIsraelBriefing = true
        }
        CaptureRouteModel.shared.route = defaults.string(forKey: routeKey).flatMap(Route.init(rawValue:))
        // A flight is replayed only while nothing is recording (ReplayView), and the scenario would start one.
        if CaptureRouteModel.shared.route != nil || defaults.string(forKey: recordingKey) == "stopped" {
            appState.isAutoStartEnabled = false
        }
        if let icao = defaults.string(forKey: directToKey),
           let airport = try? appState.getOrCreateDatabaseService().airport(byICAO: icao.uppercased()) {
            appState.directToAirport = airport
            appState.activeFlightPlan = true
            appState.updateActiveRouteProgress()
        }
    }

    /// -OpenEFBRoute replay: transcript panel open; replayfast: 4x with the panel closed.
    @MainActor
    static func applyReplay(to viewModel: ReplayViewModel) {
        switch CaptureRouteModel.shared.route {
        case .replay: viewModel.isTranscriptPanelExpanded = true
        case .replayfast:
            viewModel.selectSpeed(4)
            viewModel.isTranscriptPanelExpanded = false
        default: break
        }
    }

    /// -OpenEFBRecording: problems and the stop dialog on the recording view model the map builds.
    @MainActor
    static func applyRecording(to viewModel: RecordingViewModel, defaults: UserDefaults = .standard) {
        struct Cause: LocalizedError { var errorDescription: String? { "The audio file could not be written." } }
        switch defaults.string(forKey: recordingKey) {
        case "notices":
            viewModel.microphoneDenied = true
            viewModel.lastError = .audioSessionFailed(underlying: Cause())
            // The map checks the microphone permission once it is up and clears the flag; set it again after that.
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                viewModel.microphoneDenied = true
            }
        case "stopped":
            viewModel.lastError = .recordingFailed(underlying: Cause())
            viewModel.showDiscardedNotice = true
        case "stop":
            viewModel.showStopConfirmation = true
        default: break
        }
    }
}

#endif
