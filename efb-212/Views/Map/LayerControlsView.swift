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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Scrolls only when large text makes the panel taller than the space below it.
        ViewThatFits(in: .vertical) {
            panelContent
            ScrollView { panelContent }
        }
        .frame(width: typeSize.isAccessibilitySize ? 420 : 300)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: Space.l))
    }

    private var panelContent: some View {
        @Bindable var appState = appState
        let sectionalOn = appState.visibleLayers.contains(.sectional)

        return VStack(alignment: .leading, spacing: Space.m) {
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
                        .font(.title2)
                        .foregroundStyle(Palette.secondaryText)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Close map layers")
            }
            .padding(.horizontal, Space.l)

            Divider()

            // Base map (F17): what is drawn under everything
            VStack(alignment: .leading, spacing: Space.s) {
                SectionHeader("BASE MAP")
                Picker("Base map", selection: Binding(
                    get: { appState.mapStyle == .vfrSectional ? MapStyle.street : appState.mapStyle },
                    set: { appState.mapStyle = $0 }
                )) {
                    ForEach(Self.baseMaps, id: \.self) { style in
                        Text(styleName(for: style)).tag(style)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(.horizontal, Space.l)

            Divider()

            // Sectional (F17): FAA chart overlay with its own opacity
            VStack(alignment: .leading, spacing: Space.s) {
                SectionHeader("SECTIONAL")
                layerToggle(layer: .sectional, label: "VFR sectional chart", tint: Palette.layerSectional, padded: false)
                if sectionalOn {
                    OpacitySlider(opacity: $appState.sectionalOpacity)
                    DataAgeBadge(.chartCycle, validUntil: mapViewModel.chartExpirationDate)
                        .hiddenWhenFresh()
                }
                offlineStatusRow
            }
            .padding(.horizontal, Space.l)

            Divider()

            // Data layers
            SectionHeader("DATA LAYERS")
                .padding(.horizontal, Space.l)
            layerToggle(layer: .airports, label: "Airports", tint: Palette.layerAirports)
            layerToggle(layer: .airspace, label: "Airspace", tint: Palette.layerAirspace)
            dataLayerToggle(
                layer: .tfrs, label: "TFRs", tint: Palette.warning, product: .tfr,
                fetchedAt: mapViewModel.tfrFetchedAt, failed: mapViewModel.tfrLoadFailed,
                retry: { await mapViewModel.loadTFRs() }
            )
            dataLayerToggle(
                layer: .advisories, label: "AIRMET/SIGMET", tint: Palette.layerAdvisory, product: .airmetSigmet,
                fetchedAt: mapViewModel.advisoriesFetchedAt, failed: mapViewModel.advisoriesLoadFailed,
                retry: { await mapViewModel.loadAdvisories() }
            )
            layerToggle(layer: .weatherDots, label: "Weather", tint: Palette.layerWeather)

            // Weather data age (staleness on every weather surface)
            if appState.visibleLayers.contains(.weatherDots),
               let oldestObs = mapViewModel.oldestWeatherObservationTime {
                HStack(spacing: Space.xs) {
                    Text("Age")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.secondaryText)
                    DataAgeBadge(.metar, observed: oldestObs)
                }
                .padding(.leading, 52)  // Indent under toggle
            }

            layerToggle(layer: .navaids, label: "Navaids", tint: Palette.layerAdvisory)
            airportDiagramToggle
        }
        .padding(.vertical, Space.l)
    }

    // MARK: - Offline Status (F6)

    /// "Offline: ready / partial / not downloaded / expired" for the visible map at the active
    /// base style, plus the sectional cycle. Amber when a downloaded sectional is expired.
    private var offlineStatusRow: some View {
        // The status resolver keys sectional + street packs off `.vfrSectional`
        let offlineStyle: MapStyle = (appState.visibleLayers.contains(.sectional)
            && (appState.mapStyle == .street || appState.mapStyle == .vfrSectional))
            ? .vfrSectional : appState.mapStyle
        let status = appState.mapVisibleBounds.map {
            offlineMaps.status(visible: $0, style: offlineStyle)
        } ?? .notDownloaded
        let cycle = SectionalCycle.current()
        return VStack(alignment: .leading, spacing: 2) {
            Text(status.label)
                .font(TypeRole.label)
                .foregroundStyle(status == .expired ? Palette.caution : (status == .ready ? Palette.primaryText : Palette.secondaryText))
                .accessibilityIdentifier("offline-status-line")
            Text("Sectional cycle: valid to \(OfflineMapsView.dateString(cycle.expires))")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("sectional-cycle-line")
        }
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
            .tint(Palette.layerDiagrams)
            .frame(minHeight: 44)
            .accessibilityIdentifier("Airport diagrams")
            Text("Advisory. Verify against the FAA diagram.")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
                .padding(.leading, 36)
        }
        .padding(.horizontal, Space.l)
    }

    // MARK: - Layer Toggle Row

    private func layerToggle(layer: MapLayer, label: String, tint: Color, padded: Bool = true) -> some View {
        Toggle(isOn: Binding(
            get: { appState.visibleLayers.contains(layer) },
            set: { _ in Haptics.light(); mapViewModel.toggleLayer(layer) }
        )) {
            Text(label)
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .tint(tint)
        .frame(minHeight: 44)
        .padding(.horizontal, padded ? Space.l : 0)
    }

    // MARK: - Fetched Data Layer Toggle (TFRs, AIRMET/SIGMET)

    /// Toggle plus a status line while visible: data age since fetch, loading, or unavailable.
    private func dataLayerToggle(
        layer: MapLayer,
        label: String,
        tint: Color,
        product: DataProduct,
        fetchedAt: Date?,
        failed: Bool,
        retry: @escaping () async -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Toggle(isOn: Binding(
                get: { appState.visibleLayers.contains(layer) },
                set: { _ in Haptics.light(); mapViewModel.toggleLayer(layer) }
            )) {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .tint(tint)
            .frame(minHeight: 44)

            if appState.visibleLayers.contains(layer) {
                HStack(spacing: Space.xs) {
                    if let fetchedAt {
                        Text("Age")
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                        DataAgeBadge(product, observed: fetchedAt)
                    } else if failed {
                        Label("Not loaded", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.caution)
                        Button { Task { await retry() } } label: {
                            Text("Retry")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Palette.accentText)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableButtonStyle())
                    } else {
                        ProgressView().controlSize(.mini)
                        Text("Loading\u{2026}")
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
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
        case .vfrSectional, .street: return "Street"
        case .satellite: return "Satellite"
        case .terrain: return "Terrain"
        }
    }

    /// Base map choices. `.vfrSectional` is the legacy "street + sectional" value; the sectional is
    /// now the independent `.sectional` layer, so it reads as Street here.
    private static let baseMaps: [MapStyle] = [.street, .satellite, .terrain]
}
