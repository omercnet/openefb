//
//  LayersColumnView.swift
//  efb-212
//
//  Map layers in the strip column, opened from the LAYERS footer cell: display (day / night / auto),
//  orientation (north up / track up), the sectional with its opacity, offline and cycle status, the
//  Israel CVFR chart layers, and the data layers. Live-data layers (TFRs, AIRMET/SIGMET) show their
//  data age while visible, or why they are not loaded with a Retry.
//

import SwiftUI

struct LayersColumnView: View {
    private let mapViewModel: MapViewModel
    @Environment(AppState.self) private var appState
    @State private var offlineMaps = OfflineMapService.shared

    init(mapViewModel: MapViewModel) {
        self.mapViewModel = mapViewModel
    }

    var body: some View {
        @Bindable var appState = appState
        let sectionalOn = appState.visibleLayers.contains(.sectional)

        VStack(spacing: 0) {
            ColumnHeader {
                Text("Layers")
                    .font(TypeRole.title)
                    .foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    // Display (F16) and orientation
                    VStack(alignment: .leading, spacing: Space.s) {
                        ColumnSectionLabel("Display")
                        segmentRow(
                            options: DisplayMode.allCases,
                            selected: appState.displayMode,
                            title: \.title,
                            select: { appState.displayMode = $0 }
                        )
                        .accessibilityLabel("Display mode")
                        .accessibilityIdentifier("display-mode")
                    }
                    .padding(.horizontal, Space.l)

                    VStack(alignment: .leading, spacing: Space.s) {
                        ColumnSectionLabel("Orientation")
                        segmentRow(
                            options: MapMode.allCases,
                            selected: appState.mapMode,
                            title: { $0 == .northUp ? "North up" : "Track up" },
                            select: { mapViewModel.setMapMode($0) }
                        )
                        .accessibilityLabel("Map orientation")
                        .accessibilityIdentifier("Map orientation")
                    }
                    .padding(.horizontal, Space.l)

                    ColumnRule()

                    // Sectional (F17): FAA chart overlay with its own opacity
                    VStack(alignment: .leading, spacing: Space.s) {
                        ColumnSectionLabel("Sectional")
                        if appState.region.isAvailable(.sectional) {
                            layerToggle(layer: .sectional, label: "VFR sectional chart", tint: Palette.layerSectional, padded: false)
                            if sectionalOn {
                                OpacitySlider(opacity: $appState.sectionalOpacity)
                                DataAgeBadge(.chartCycle, validUntil: mapViewModel.chartExpirationDate)
                                    .hiddenWhenFresh()
                            }
                            offlineStatusRow
                        } else {
                            unavailableRow("VFR sectional chart", padded: false)
                        }
                    }
                    .padding(.horizontal, Space.l)

                    ColumnRule()

                    // Israel CVFR chart (IL-3): the region's own chart, from the bundled CAAI data
                    if appState.region.isAvailable(.cvfrRoutes) {
                        cvfrChartSection
                        ColumnRule()
                    }

                    // Data layers
                    ColumnSectionLabel("Data layers")
                        .padding(.horizontal, Space.l)
                    if appState.region.isAvailable(.airports) {
                        layerToggle(layer: .airports, label: "Airports", tint: Palette.layerAirports)
                    } else {
                        unavailableRow("Airports")
                    }
                    if appState.region.isAvailable(.airspace) {
                        layerToggle(layer: .airspace, label: "Airspace", tint: Palette.layerAirspace)
                    } else {
                        unavailableRow("Airspace")
                    }
                    if appState.region.isAvailable(.tfrs) {
                        dataLayerToggle(
                            layer: .tfrs, label: "TFRs", tint: Palette.warning, product: .tfr,
                            fetchedAt: mapViewModel.tfrFetchedAt, failed: mapViewModel.tfrLoadFailed,
                            retry: { await mapViewModel.loadTFRs() }
                        )
                    } else {
                        unavailableRow("TFRs")
                    }
                    if appState.region.isAvailable(.advisories) {
                        dataLayerToggle(
                            layer: .advisories, label: "AIRMET/SIGMET", tint: Palette.layerAdvisory, product: .airmetSigmet,
                            fetchedAt: mapViewModel.advisoriesFetchedAt, failed: mapViewModel.advisoriesLoadFailed,
                            retry: { await mapViewModel.loadAdvisories() }
                        )
                    } else {
                        unavailableRow("AIRMET/SIGMET")
                    }
                    layerToggle(layer: .weatherDots, label: "Weather", tint: Palette.layerWeather)

                    // Weather data age (staleness on every weather surface)
                    if appState.visibleLayers.contains(.weatherDots),
                       let oldestObs = mapViewModel.oldestWeatherObservationTime {
                        HStack(spacing: Space.xs) {
                            Text("Age")
                                .font(TypeRole.caption)
                                .foregroundStyle(Palette.inkSecondary)
                            DataAgeBadge(.metar, observed: oldestObs)
                        }
                        .padding(.leading, 52)  // Indent under toggle
                    }

                    if appState.region.isAvailable(.navaids) {
                        layerToggle(layer: .navaids, label: "Navaids", tint: Palette.layerAdvisory)
                    } else {
                        unavailableRow("Navaids")
                    }
                    if appState.region.isAvailable(.airportDiagrams) || appState.region.isAvailable(.israelDiagrams) {
                        airportDiagramToggle
                    } else {
                        unavailableRow("Airport diagrams")
                    }
                }
                .padding(.vertical, Space.l)
            }
        }
        .foregroundStyle(Palette.ink)
        .background(Palette.paper)
    }

    // MARK: - Segment Row (display, orientation)

    /// Equal-width 60 pt buttons, the selected one on the active-cell fill. A plain segmented picker is
    /// too small a target in flight.
    private func segmentRow<Option: Hashable>(
        options: [Option],
        selected: Option,
        title: @escaping (Option) -> String,
        select: @escaping (Option) -> Void
    ) -> some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                let isSelected = option == selected
                Button {
                    Haptics.light()
                    select(option)
                } label: {
                    Text(title(option))
                        .font(TypeRole.body.weight(isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? Palette.ink : Palette.inkSecondary)
                        .frame(maxWidth: .infinity, minHeight: StripMetrics.cell)
                        .background(isSelected ? Palette.activeCell : Palette.paperSecondary)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.s))
        .overlay(RoundedRectangle(cornerRadius: Radius.s).strokeBorder(Palette.rule, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    // MARK: - Israel CVFR Chart (IL-3)

    private var cvfrChartSection: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            ColumnSectionLabel("CVFR chart")
                .padding(.horizontal, Space.l)
            layerToggle(layer: .cvfrRoutes, label: "Routes and altitudes", tint: Palette.layerWeather)
            layerToggle(layer: .cvfrPoints, label: "Reporting points", tint: Palette.layerAirports)
            layerToggle(layer: .cvfrAirspace, label: "Airspace (CTR, TMA, P/R/D)", tint: Palette.layerAdvisory)
            layerToggle(layer: .cvfrRunways, label: "Runways", tint: Palette.layerDiagrams)
            layerToggle(layer: .cvfrClosures, label: "NOTAM route closures", tint: Palette.warning)
            layerToggle(layer: .lsaRoutes, label: "Sport-aviation (LSA) routes", tint: Color(uiColor: IsraelLSAOverlay.routeColor))
            if appState.visibleLayers.contains(.cvfrClosures) {
                closureStatusRow
                    .padding(.horizontal, Space.l)
            }
        }
    }

    /// Age of the NOTAM feed behind the closures, or why nothing is drawn. Old data is never
    /// drawn as current: past the NOTAM limit the layer shows nothing and says so.
    @ViewBuilder
    private var closureStatusRow: some View {
        switch mapViewModel.mapService.israelChart.closureStatus {
        case .noFeed:
            Label("No NOTAM feed: closures not shown", systemImage: "exclamationmark.triangle.fill")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.caution)
        case .loaded(let generatedAt, let level, let closed):
            HStack(spacing: Space.xs) {
                Text("Age")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.inkSecondary)
                DataAgeBadge(.notam, observed: generatedAt)
                if IsraelChartFeatureBuilder.drawableFreshness.contains(level) {
                    Text("\(closed) segment\(closed == 1 ? "" : "s") closed")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.inkSecondary)
                } else {
                    Text("Too old: closures hidden")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.caution)
                }
            }
        }
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
                .foregroundStyle(status == .expired ? Palette.caution : (status == .ready ? Palette.ink : Palette.inkSecondary))
                .accessibilityIdentifier("offline-status-line")
            Text("Sectional cycle: valid to \(OfflineMapsView.dateString(cycle.expires))")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.inkSecondary)
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
                    .font(TypeRole.body.weight(.medium))
            }
            .tint(Palette.layerDiagrams)
            .frame(minHeight: StripMetrics.cell)
            .accessibilityIdentifier("Airport diagrams")
            Text(appState.region == .israel ? "Advisory. Verify against the CAAI diagram." : "Advisory. Verify against the FAA diagram.")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.inkSecondary)
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
                .font(TypeRole.body.weight(.medium))
        }
        .tint(tint)
        .frame(minHeight: StripMetrics.cell)
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
                    .font(TypeRole.body.weight(.medium))
            }
            .tint(tint)
            .frame(minHeight: StripMetrics.cell)

            if appState.visibleLayers.contains(layer) {
                HStack(spacing: Space.xs) {
                    if let fetchedAt {
                        Text("Age")
                            .font(TypeRole.caption)
                            .foregroundStyle(Palette.inkSecondary)
                        DataAgeBadge(product, observed: fetchedAt)
                    } else if failed {
                        Label("Not loaded", systemImage: "exclamationmark.triangle.fill")
                            .font(TypeRole.caption)
                            .foregroundStyle(Palette.caution)
                        Button { Task { await retry() } } label: {
                            Text("Retry")
                                .font(TypeRole.label.weight(.semibold))
                                .foregroundStyle(Palette.accentText)
                                .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableButtonStyle())
                        .accessibilityLabel("Retry \(label)")
                    } else {
                        ProgressView().controlSize(.mini)
                        Text("Loading\u{2026}")
                            .font(TypeRole.caption)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
        }
        .padding(.horizontal, Space.l)
    }

    // MARK: - Helpers

    /// Disabled row for a layer the region has no data source for. Plain reason, never an empty layer.
    private func unavailableRow(_ label: String, padded: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(TypeRole.body.weight(.medium))
                .foregroundStyle(Palette.inkSecondary)
            Text(appState.region.unavailableReason)
                .font(TypeRole.caption)
                .foregroundStyle(Palette.inkSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
        .padding(.horizontal, padded ? Space.l : 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), unavailable")
        .accessibilityValue(appState.region.unavailableReason)
        .accessibilityIdentifier("unavailable-\(label)")
    }
}
