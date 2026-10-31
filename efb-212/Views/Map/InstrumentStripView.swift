//
//  InstrumentStripView.swift
//  efb-212
//
//  Full-width bottom bar showing a GPS status chip and GS, ALT, VS, TRK instrument cells.
//  DTG and ETE appear conditionally when a flight plan or direct-to is active.
//
//  Design findings F5 and F18: values are 28pt monospaced and labels 13pt so they read at
//  arm's length over the sectional; the GPS chip is a real cell (no overlap with TRK); when
//  the last fix is stale (> 5 s) the values grey out instead of pretending to be current.
//  No animation on value changes (pilot SA).
//

import SwiftUI

struct InstrumentStripView: View {
    @Environment(AppState.self) private var appState

    /// Position quality from MapViewModel's 1 Hz clock.
    var gpsStatus: GPSStatus = .lost(ageSeconds: nil)

    /// Values are shown dimmed when the fix is stale or lost.
    private var isStale: Bool { gpsStatus.isStale }

    var body: some View {
        HStack(spacing: 0) {
            GPSStatusChip(status: gpsStatus)
                .padding(.trailing, 8)
            Divider().frame(height: 44)
            InstrumentCell(label: "GS", value: gsValue, unit: "KT", dimmed: isStale)
            Divider().frame(height: 44)
            InstrumentCell(label: "ALT", value: altValue, unit: "FT", dimmed: isStale || !hasAltitude)
            Divider().frame(height: 44)
            InstrumentCell(label: "VS", value: vsValue, unit: "FPM", dimmed: isStale || !hasAltitude)
            Divider().frame(height: 44)
            InstrumentCell(label: "TRK", value: trkValue, unit: "\u{00B0}", dimmed: isStale)

            if appState.activeFlightPlan || appState.directToAirport != nil {
                Divider().frame(height: 44)
                InstrumentCell(label: "DTG", value: dtgValue, unit: "NM", dimmed: isStale)
                Divider().frame(height: 44)
                InstrumentCell(label: "ETE", value: eteValue, unit: "", dimmed: isStale)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("Instrument strip")
    }

    // MARK: - Computed Values

    /// A fix exists and the strip has something to show (values still dim when stale).
    private var hasFix: Bool { appState.gpsAvailable && appState.ownshipPosition != nil }

    /// CoreLocation reports no altitude (vertical accuracy < 0) on Wi-Fi-only fixes.
    private var hasAltitude: Bool {
        guard let position = appState.ownshipPosition else { return false }
        return position.verticalAccuracy >= 0
    }

    /// Ground speed in knots, rounded to nearest 1 kt
    private var gsValue: String {
        guard hasFix else { return "---" }
        return "\(Int(appState.groundSpeed))"
    }

    /// Altitude in feet MSL, rounded to nearest 10 ft (aviation standard)
    private var altValue: String {
        guard hasFix, hasAltitude else { return "---" }
        return "\(Int((appState.altitude / 10).rounded() * 10))"
    }

    /// Vertical speed in fpm with +/- prefix
    private var vsValue: String {
        guard hasFix, hasAltitude else { return "---" }
        let vs = Int(appState.verticalSpeed)
        return vs >= 0 ? "+\(vs)" : "\(vs)"
    }

    /// Track in degrees true, 3-digit with leading zeros
    private var trkValue: String {
        guard hasFix else { return "---" }
        return String(format: "%03.0f", appState.track)
    }

    /// Distance to go in nautical miles
    private var dtgValue: String {
        guard let dtg = appState.distanceToNext else { return "---" }
        return String(format: "%.1f", dtg)
    }

    /// Estimated time enroute formatted as Xh XXm or Xm
    private var eteValue: String {
        guard let ete = appState.estimatedTimeEnroute else { return "---" }
        let minutes = Int(ete / 60)
        let hours = minutes / 60
        let mins = minutes % 60
        if hours > 0 { return "\(hours)h\(String(format: "%02d", mins))m" }
        return "\(mins)m"
    }
}

// MARK: - GPSStatusChip

/// OK / DEGR / LOST chip. Red = warning (lost), amber = caution (degraded); OK is neutral.
struct GPSStatusChip: View {
    let status: GPSStatus

    private var tint: Color {
        switch status {
        case .ok: return .green
        case .degraded: return .orange
        case .lost: return .red
        }
    }

    private var isAlert: Bool {
        if case .ok = status { return false }
        return true
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 12, height: 12)
            Text(status.label)
                .font(.system(size: 15, weight: .bold, design: .monospaced))
                .foregroundStyle(isAlert ? tint : .primary)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 10)
        .frame(height: 44)
        .background(isAlert ? tint.opacity(0.15) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("GPS status")
        .accessibilityLabel(status.accessibilityDescription)
    }
}

// MARK: - InstrumentCell

/// Single instrument readout cell: 13pt label, 28pt monospaced semibold value, 13pt unit.
/// `dimmed` greys the value when the data behind it is stale or missing.
struct InstrumentCell: View {
    let label: String
    let value: String
    let unit: String
    var dimmed: Bool = false

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            HStack(alignment: .lastTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
                    .foregroundStyle(dimmed ? .secondary : .primary)
                    .opacity(dimmed ? 0.6 : 1.0)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(minWidth: 84)
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value) \(unit)\(dimmed ? ", stale" : "")")
    }
}

#Preview("GPS Available") {
    let appState = AppState()

    InstrumentStripView(gpsStatus: .ok)
        .environment({
            appState.gpsAvailable = true
            appState.ownshipPosition = CLLocation(
                coordinate: .init(latitude: 37.46, longitude: -122.11),
                altitude: 1377, horizontalAccuracy: 5, verticalAccuracy: 8, timestamp: Date()
            )
            appState.groundSpeed = 115
            appState.altitude = 4520
            appState.verticalSpeed = -200
            appState.track = 245
            return appState
        }())
        .padding()
}

#Preview("No GPS") {
    InstrumentStripView(gpsStatus: .lost(ageSeconds: nil))
        .environment(AppState())
        .padding()
}

#Preview("Stale") {
    let appState = AppState()

    InstrumentStripView(gpsStatus: .lost(ageSeconds: 12))
        .environment({
            appState.gpsAvailable = true
            appState.ownshipPosition = CLLocation(
                coordinate: .init(latitude: 37.46, longitude: -122.11),
                altitude: 1377, horizontalAccuracy: 5, verticalAccuracy: 8, timestamp: Date()
            )
            appState.groundSpeed = 105
            appState.altitude = 5500
            appState.track = 180
            return appState
        }())
        .padding()
}

#Preview("With Flight Plan") {
    let appState = AppState()

    InstrumentStripView(gpsStatus: .degraded(.noAltitude))
        .environment({
            appState.gpsAvailable = true
            appState.ownshipPosition = CLLocation(
                coordinate: .init(latitude: 37.46, longitude: -122.11),
                altitude: 0, horizontalAccuracy: 65, verticalAccuracy: -1, timestamp: Date()
            )
            appState.groundSpeed = 105
            appState.altitude = 5500
            appState.verticalSpeed = 0
            appState.track = 180
            appState.activeFlightPlan = true
            appState.distanceToNext = 42.3
            appState.estimatedTimeEnroute = 1440  // 24 minutes
            return appState
        }())
        .padding()
}

import CoreLocation
