//
//  MapControlsView.swift
//  efb-212
//
//  Right-edge floating controls: orientation toggle (text, "N↑" / "TRK↑"), zoom in/out,
//  layer toggle, and a north indicator while the map is rotated. In-flight controls are
//  60pt (turbulence) on .ultraThinMaterial backgrounds. The Recenter button lives at the
//  bottom next to NRST (see RecenterButton) so it is separate from the mode toggle (F7).
//

import SwiftUI
import MapLibre

/// Shared size for in-flight map controls (design: ≥ 60pt).
enum MapControlMetrics {
    static let size: CGFloat = 60
    static let cornerRadius: CGFloat = 10
}

struct MapControlsView: View {
    let mapViewModel: MapViewModel
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        // 12pt between groups: the translucent 60pt controls read as one blob at 8pt over a busy map.
        VStack(spacing: 12) {
            // Orientation toggle: text shows the CURRENT mode (F7)
            Button {
                let newMode: MapMode = appState.mapMode == .northUp ? .trackUp : .northUp
                Haptics.light()
                mapViewModel.setMapMode(newMode)
            } label: {
                Text(appState.mapMode == .northUp ? "N\u{2191}" : "TRK\u{2191}")
                    .font(.headline.weight(.bold))
                    .minimumScaleFactor(0.8)
                    .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
            }
            .buttonStyle(PressableButtonStyle())
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
            .accessibilityIdentifier("Map orientation")
            .accessibilityLabel("Map orientation")
            .accessibilityValue(appState.mapMode == .northUp ? "North up" : "Track up")
            .accessibilityHint(appState.mapMode == .northUp ? "Switch to track up" : "Switch to north up")

            // Zoom controls (combined background)
            VStack(spacing: 0) {
                // Zoom in
                Button {
                    let newZoom = min(appState.mapZoom + 1, 18)
                    mapViewModel.mapService.mapView?.setZoomLevel(newZoom, animated: true)
                } label: {
                    Image(systemName: "plus")
                        .font(.title2)
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                        .contentShape(Rectangle())  // whole 60pt cell is the target, not just the glyph
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityLabel("Zoom in")

                Divider()
                    .frame(width: 44)

                // Zoom out
                Button {
                    let newZoom = max(appState.mapZoom - 1, 2)
                    mapViewModel.mapService.mapView?.setZoomLevel(newZoom, animated: true)
                } label: {
                    Image(systemName: "minus")
                        .font(.title2)
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityLabel("Zoom out")
            }
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))

            // Layer toggle button
            Button {
                Haptics.light()
                appState.isPresentingLayerControls.toggle()
            } label: {
                Image(systemName: "square.3.layers.3d")
                    .font(.title2)
                    .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
            }
            .buttonStyle(PressableButtonStyle())
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
            .accessibilityLabel("Toggle map layers")
            .accessibilityValue(appState.isPresentingLayerControls ? "Open" : "Closed")

            // Israel NOTAM briefing (IL-BRIEF)
            if appState.region == .israel {
                Button {
                    Haptics.light()
                    appState.isPresentingIsraelBriefing = true
                } label: {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.title2)
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                }
                .buttonStyle(PressableButtonStyle())
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
                .accessibilityLabel("NOTAM briefing")
                .accessibilityIdentifier("israel-briefing-button")
            }

            // Night mode quick toggle: day <-> night (Settings can return to Auto)
            Button {
                Haptics.light()
                appState.displayMode = colorScheme == .dark ? .day : .night
            } label: {
                Image(systemName: colorScheme == .dark ? "sun.max.fill" : "moon.fill")
                    .font(.title2)
                    .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
            }
            .buttonStyle(PressableButtonStyle())
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
            .accessibilityIdentifier("Toggle night mode")
            .accessibilityLabel("Night mode")
            .accessibilityValue(colorScheme == .dark ? "On, \(appState.displayMode.title)" : "Off, \(appState.displayMode.title)")
            .accessibilityHint(colorScheme == .dark ? "Switch to day display" : "Switch to night display")

            // North indicator: only while the map is rotated (track-up or rotate gesture)
            if abs(mapViewModel.mapDirection) > 0.5 {
                NorthIndicator(mapDirection: mapViewModel.mapDirection)
            }
        }
    }
}

// MARK: - NorthIndicator

/// Arrow pointing to true north while the map is rotated. Rotates against the map
/// direction so it always points where north is on screen.
struct NorthIndicator: View {
    let mapDirection: Double   // degrees clockwise from north

    var body: some View {
        ZStack {
            Circle()
                .fill(.ultraThinMaterial)
            VStack(spacing: 0) {
                Image(systemName: "arrowtriangle.up.fill")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.red)
                Text("N")
                    .font(.callout.weight(.heavy))
            }
            .rotationEffect(.degrees(-mapDirection))
        }
        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("North indicator")
        .accessibilityValue("Map rotated \(Int(mapDirection.rounded())) degrees")
    }
}

// MARK: - RecenterButton

/// Large button shown while follow is suspended after a pan. Tapping re-centres on the
/// aircraft at the current zoom and re-engages follow (F3).
struct RecenterButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "location.fill")
                    .font(.title3.weight(.semibold))
                Text("Recenter")
                    .font(.title3.weight(.bold))
            }
            .padding(.horizontal, 20)
            .frame(height: MapControlMetrics.size + 4)
        }
        .buttonStyle(.borderedProminent)
        .tint(Palette.accent)
        .foregroundStyle(Palette.onAccent)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityIdentifier("Recenter")
        .accessibilityLabel("Recenter on aircraft")
    }
}
