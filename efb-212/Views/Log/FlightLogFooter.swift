//
//  FlightLogFooter.swift
//  efb-212
//
//  One row of 60pt cells under the strip column: GPS state first, NRST, LAYERS, ZOOM + and
//  ZOOM -. After a pan, ZOOM + becomes RECENTER until the chart follows ownship again (F3),
//  so nothing floats over the chart. Red = GPS lost (warning), amber = degraded (caution).
//

import SwiftUI
import MapLibre

struct FlightLogFooter: View {
    @Environment(AppState.self) private var appState
    let mapViewModel: MapViewModel
    /// Closest landable airport, nil until the first fix or when none is in range.
    let nearestEntry: NearestAirportEntry?
    /// iPhone and iPad Split View: cells shrink, NRST keeps distance and bearing.
    var compact: Bool = false

    var body: some View {
        HStack(spacing: 0) {
            gpsCell
            divider
            nrstCell
            divider
            FlightLogCellButton(title: "Layers", systemImage: "square.3.layers.3d", accessibilityLabel: "Map layers") {
                Haptics.light()
                toggle(.layers)
            }
            .accessibilityValue(appState.stripColumn == .layers ? "Open" : "Closed")
            divider
            if mapViewModel.isFollowing {
                FlightLogCellButton(title: "Zoom +", systemImage: "plus", accessibilityLabel: "Zoom in") {
                    zoom(by: 1)
                }
            } else {
                FlightLogCellButton(title: "Recenter", systemImage: "location.fill", accessibilityLabel: "Recenter on aircraft") {
                    mapViewModel.recenter()
                }
                .accessibilityIdentifier("Recenter")
            }
            divider
            FlightLogCellButton(title: "Zoom \u{2212}", systemImage: "minus", accessibilityLabel: "Zoom out") {
                zoom(by: -1)
            }
        }
        .frame(minHeight: StripMetrics.cell)
        // One row: the 1pt dividers are vertically greedy shapes, so without this the footer split the
        // column height with the strip content. Fixed at its ideal height, the dividers match the cells.
        .fixedSize(horizontal: false, vertical: true)
        .background(Palette.paperSecondary)
        .overlay(alignment: .top) { ColumnRule() }
    }

    private var divider: some View {
        Rectangle()
            .fill(Palette.rule)
            .frame(width: 1)
            .accessibilityHidden(true)
    }

    /// Open a column, or return to the log when it is already open.
    private func toggle(_ column: StripColumn) {
        appState.stripColumn = appState.stripColumn == column ? .log : column
    }

    /// Zoom one level, clamped to 2...18.
    private func zoom(by step: Double) {
        let newZoom = min(max(appState.mapZoom + step, 2), 18)
        mapViewModel.mapService.mapView?.setZoomLevel(newZoom, animated: true)
    }

    // MARK: - GPS

    private var gpsCell: some View {
        let status = mapViewModel.gpsStatus
        let tint = Self.gpsTint(status)
        return HStack(spacing: Space.xs) {
            Circle()
                .fill(tint)
                .frame(width: 10, height: 10)
            Text(Self.gpsText(status))
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(status == .ok ? Palette.ink : tint)
                .lineLimit(compact ? 2 : 1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, Space.s)
        .frame(minWidth: StripMetrics.cell, maxWidth: compact ? 76 : 120, minHeight: StripMetrics.cell)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("GPS status")
        .accessibilityLabel(status.accessibilityDescription)
    }

    /// "GPS 3D", "GPS DEGR", "GPS LOST 14 S".
    static func gpsText(_ status: GPSStatus) -> String {
        switch status {
        case .ok: return "GPS 3D"
        case .degraded: return "GPS DEGR"
        case .lost(let age):
            guard let age else { return "GPS LOST" }
            return "GPS LOST \(age) S"
        }
    }

    static func gpsTint(_ status: GPSStatus) -> Color {
        switch status {
        case .ok: return Palette.ok
        case .degraded: return Palette.caution
        case .lost: return Palette.warning
        }
    }

    // MARK: - NRST

    /// Dark ink cell: the emergency entry point, always in the same place.
    private var nrstCell: some View {
        Button {
            Haptics.light()
            toggle(.nearest)
        } label: {
            HStack(spacing: Space.s) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("NRST")
                        .font(TypeRole.stripLabel)
                        .tracking(StripMetrics.labelTracking)
                    Text(nearestIdent)
                        .font(TypeRole.dataEmphasis)
                }
                if appState.region.hasAirportData, let entry = nearestEntry {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(String(format: "%.1f NM", entry.distance))    // nautical miles
                        Text(String(format: "%03.0f\u{00B0}", entry.bearing))  // degrees true
                    }
                    .font(TypeRole.data)
                }
            }
            .foregroundStyle(Palette.paper)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, Space.s)
            .frame(maxWidth: .infinity, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            .background(Palette.ink)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityIdentifier("NRST")
        .accessibilityLabel(nearestAccessibilityText)
        .accessibilityHint("Opens the nearest airports list")
    }

    private var nearestIdent: String {
        guard appState.region.hasAirportData else { return "NO DATA" }
        guard let entry = nearestEntry else { return appState.gpsAvailable ? "NONE" : "NO GPS" }
        return entry.airport.icao
    }

    private var nearestAccessibilityText: String {
        guard appState.region.hasAirportData else { return "Nearest airports. No airport data for this region yet." }
        guard let entry = nearestEntry else { return "Nearest airports. No landable airport yet." }
        var text = "Nearest airport \(entry.airport.icao), \(String(format: "%.1f", entry.distance)) nautical miles, bearing \(String(format: "%03.0f", entry.bearing)) degrees"
        if let runway = entry.runwaySummary { text += ", runway \(runway)" }
        if entry.isPrivateUse { text += ", private use" }
        if entry.isMilitary { text += ", military, emergency use only" }
        if entry.requiresPPR { text += ", prior permission required" }
        if entry.isClosedByNotam { text += ", a NOTAM names this field closed" }
        return text
    }
}
