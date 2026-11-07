//
//  ScreenCaptureHooks.swift
//  efb-212
//
//  DEBUG only. Puts the app on a given screen for tools/ci/capture-screens.sh. Launch arguments:
//    -OpenEFBScreen map|log
//    -OpenEFBStripColumn log|nearest|layers|search|airport:<ICAO>
//    -OpenEFBDisplayMode day|night
//    -OpenEFBDirectTo <ICAO>             direct to this airport, as the Nearest list's Direct does
//  Unknown values are ignored; without the arguments nothing changes.
//

#if DEBUG

import Foundation

enum ScreenCaptureHooks {
    static let screenKey = "OpenEFBScreen"
    static let stripColumnKey = "OpenEFBStripColumn"
    static let displayModeKey = "OpenEFBDisplayMode"
    static let directToKey = "OpenEFBDirectTo"

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
        if let icao = defaults.string(forKey: directToKey),
           let airport = try? appState.getOrCreateDatabaseService().airport(byICAO: icao.uppercased()) {
            appState.directToAirport = airport
            appState.activeFlightPlan = true
            appState.updateActiveRouteProgress()
        }
    }
}

#endif
