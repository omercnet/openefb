//
//  DisplayModeModifier.swift
//  efb-212
//
//  Applies the user's DisplayMode app-wide via `.preferredColorScheme`. `auto` with no GPS fix
//  returns nil so the system appearance decides; with a fix it follows the sun (re-evaluated
//  every minute and on position change). Views read the effective scheme from `\.colorScheme`.
//

import Combine
import SwiftUI
import CoreLocation

struct DisplayModeModifier: ViewModifier {
    @Environment(AppState.self) private var appState
    @State private var now = Date()

    private let clock = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    /// nil = let the system decide (auto, no fix yet).
    private var scheme: ColorScheme? {
        switch appState.displayMode {
        case .day: return .light
        case .night: return .dark
        case .auto:
            guard let coordinate = appState.ownshipPosition?.coordinate else { return nil }
            let night = DisplayModeResolver.isNight(
                mode: .auto, systemIsDark: false, coordinate: coordinate, date: now
            )
            return night ? .dark : .light
        }
    }

    func body(content: Content) -> some View {
        content
            .preferredColorScheme(scheme)
            .onReceive(clock) { now = $0 }
    }
}

extension View {
    /// Apply the app-wide day / night / auto display mode.
    func appliesDisplayMode() -> some View { modifier(DisplayModeModifier()) }
}
