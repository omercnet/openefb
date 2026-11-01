//
//  ActiveNavigationBar.swift
//  efb-212
//
//  Names the active Direct-To or route above the instrument strip and gives the pilot a
//  Clear button (>= 60 pt, the in-flight minimum) to undo a wrong pick.
//

import SwiftUI

struct ActiveNavigationBar: View {
    /// "DIRECT KSQL" or "KPAO \u{2192} KSQL".
    let title: String
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: Space.m) {
            Image(systemName: "location.north.line.fill")
                .accessibilityHidden(true)
            Text(title)
                .font(.system(.headline, design: .monospaced).weight(.bold))
                .lineLimit(1)
            Spacer(minLength: Space.s)
            Button(action: onClear) {
                Text("Clear")
                    .font(.headline)
                    .padding(.horizontal, Space.l)
                    .frame(minHeight: MapControlMetrics.size)  // 60 pt target fills the bar height
                    .background(Palette.fill, in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())
            .accessibilityLabel("Clear \(title)")
            .accessibilityIdentifier("clear-direct-to")
        }
        .padding(.horizontal, Space.m)
        // No vertical padding: the 60 pt Clear button sets the bar height (was 44 + 2 x 4 = 52).
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .frame(maxWidth: 420)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("active-navigation-bar")
    }

    /// Bar title for the current navigation state; nil when nothing is active.
    static func title(for appState: AppState) -> String? {
        if let direct = appState.directToAirport {
            return "DIRECT \(direct.icao)"
        }
        if appState.activeFlightPlan,
           let dep = appState.activePlanDeparture, let dest = appState.activePlanDestination {
            return "\(dep) \u{2192} \(dest)"
        }
        return nil
    }
}
