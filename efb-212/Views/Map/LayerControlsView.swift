//
//  LayerControlsView.swift
//  efb-212
//
//  Layer toggle panel with .regularMaterial background per UI-SPEC.
//  Controls visibility of airports, airspace, TFRs, AIRMET/SIGMETs, weather dots, navaids.
//  Live-data layers (TFRs, AIRMET/SIGMET) show their data age while visible.
//  Includes sectional opacity slider and chart expiration badge (INFRA-03).
//  Map style picker for VFR Sectional, Street, Satellite, Terrain.
//

import SwiftUI

struct LayerControlsView: View {
    let mapViewModel: MapViewModel
    @Environment(AppState.self) private var appState
    @State private var offlineMaps = OfflineMapService.shared

    var body: some View {
        @Bindable var appState = appState

        VStack(alignment: .leading, spacing: 12) {
            // Title + close
            HStack {
                Text("Map Layers")
                    .font(.title3)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    appState.isPresentingLayerControls = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Close map layers")
            }
            .padding(.horizontal, 16)

            Divider()

            // Layer toggles
            layerToggle(layer: .airports, label: "Airports", tint: .cyan)
            layerToggle(layer: .airspace, label: "Airspace", tint: .orange)
            dataLayerToggle(
                layer: .tfrs, label: "TFRs", tint: .red,
                fetchedAt: mapViewModel.tfrFetchedAt, failed: mapViewModel.tfrLoadFailed
            )
            dataLayerToggle(
                layer: .advisories, label: "AIRMET/SIGMET", tint: .purple,
                fetchedAt: mapViewModel.advisoriesFetchedAt, failed: mapViewModel.advisoriesLoadFailed
            )
            layerToggle(layer: .weatherDots, label: "Weather", tint: .green)

            // Weather data age badge (per user decision: staleness on every weather surface)
            if appState.visibleLayers.contains(.weatherDots),
               let oldestObs = mapViewModel.oldestWeatherObservationTime {
                HStack(spacing: 4) {
                    Text("Data age:")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    WeatherBadge(observationTime: oldestObs)
                }
                .padding(.leading, 52)  // Indent under toggle
            }

            layerToggle(layer: .navaids, label: "Navaids", tint: .purple)
            airportDiagramToggle

            Divider()

            // Sectional opacity slider
            OpacitySlider(opacity: $appState.sectionalOpacity)

            // Chart expiration status below opacity slider (INFRA-03)
            ChartExpirationBadge(daysRemaining: mapViewModel.chartDaysRemaining)
            offlineStatusRow

            Divider()

            // Map style picker
            VStack(alignment: .leading, spacing: 8) {
                Text("Map Style")
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)

                Picker("Map Style", selection: $appState.mapStyle) {
                    ForEach(MapStyle.allCases, id: \.self) { style in
                        Text(styleName(for: style)).tag(style)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 16)
        .frame(width: 260)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Offline Status (F6)

    /// "Offline: ready / partial / not downloaded / expired" for the visible map at the active
    /// base style, plus the sectional cycle. Amber when a downloaded sectional is expired.
    private var offlineStatusRow: some View {
        let status = appState.mapVisibleBounds.map {
            offlineMaps.status(visible: $0, style: appState.mapStyle)
        } ?? .notDownloaded
        let cycle = SectionalCycle.current()
        return VStack(alignment: .leading, spacing: 2) {
            Text(status.label)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(status == .expired ? Color.orange : (status == .ready ? Color.primary : Color.secondary))
                .accessibilityIdentifier("offline-status-line")
            Text("Sectional cycle: valid to \(OfflineMapsView.dateString(cycle.expires))")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("sectional-cycle-line")
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Airport Diagram Toggle (T11)

    /// Georeferenced FAA airport diagrams at zoom 14 and closer. Advisory only.
    private var airportDiagramToggle: some View {
        @Bindable var overlay = mapViewModel.mapService.airportDiagramOverlay
        return VStack(alignment: .leading, spacing: 2) {
            Toggle(isOn: $overlay.isEnabled) {
                Text("Airport diagrams")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .tint(.gray)
            .accessibilityIdentifier("Airport diagrams")
            Text("Advisory, verify against the charted diagram")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.leading, 36)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Layer Toggle Row

    private func layerToggle(layer: MapLayer, label: String, tint: Color) -> some View {
        Toggle(isOn: Binding(
            get: { appState.visibleLayers.contains(layer) },
            set: { _ in mapViewModel.toggleLayer(layer) }
        )) {
            Text(label)
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .tint(tint)
        .padding(.horizontal, 16)
    }

    // MARK: - Fetched Data Layer Toggle (TFRs, AIRMET/SIGMET)

    /// Toggle plus a status line while visible: data age since fetch, loading, or unavailable.
    private func dataLayerToggle(
        layer: MapLayer,
        label: String,
        tint: Color,
        fetchedAt: Date?,
        failed: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Toggle(isOn: Binding(
                get: { appState.visibleLayers.contains(layer) },
                set: { _ in mapViewModel.toggleLayer(layer) }
            )) {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .tint(tint)

            if appState.visibleLayers.contains(layer) {
                HStack(spacing: 4) {
                    if let fetchedAt {
                        Text("Data age:")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        WeatherBadge(observationTime: fetchedAt)
                    } else if failed {
                        Text("Unavailable \u{2014} check connection")
                            .font(.caption2)
                            .foregroundStyle(.red)
                    } else {
                        Text("Loading\u{2026}")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.leading, 36)  // Indent under toggle label
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Helpers

    private func styleName(for style: MapStyle) -> String {
        switch style {
        case .vfrSectional: return "VFR"
        case .street: return "Street"
        case .satellite: return "Satellite"
        case .terrain: return "Terrain"
        }
    }
}
