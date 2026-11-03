//
//  InstrumentStripView.swift
//  efb-212
//
//  Full-width bottom bar showing a GPS status chip and GS, ALT, VS, TRK instrument cells.
//  DTG and ETE appear conditionally when a flight plan or direct-to is active.
//
//  Design findings F5 and F18: values are 32pt condensed fixed-width digits and labels 13pt so they read at
//  arm's length over the sectional; the GPS chip is a real cell (no overlap with TRK); when
//  the last fix is stale (> 5 s) the values grey out instead of pretending to be current.
//  No animation on value changes (pilot SA).
//

import SwiftUI

/// Which readouts the strip shows. Pure so the size-class rule is testable.
nonisolated enum InstrumentStripLayout {
    enum Field: String, Equatable, Sendable { case gs = "GS", alt = "ALT", vs = "VS", trk = "TRK", dtg = "DTG", ete = "ETE" }

    /// Regular width (iPad): GS, ALT, VS, TRK, plus DTG and ETE with an active route.
    /// Compact width (iPhone portrait): only the key fields GS, ALT, TRK, plus DTG and ETE with a route,
    /// so the numbers keep their size instead of shrinking.
    static func fields(compact: Bool, routeActive: Bool) -> [Field] {
        let base: [Field] = compact ? [.gs, .alt, .trk] : [.gs, .alt, .vs, .trk]
        return routeActive ? base + [.dtg, .ete] : base
    }
}

struct InstrumentStripView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// Position quality from MapViewModel's 1 Hz clock.
    var gpsStatus: GPSStatus = .lost(ageSeconds: nil)

    /// Values are shown dimmed when the fix is stale or lost.
    private var isStale: Bool { gpsStatus.isStale }

    private var isCompact: Bool { horizontalSizeClass == .compact }
    private var routeActive: Bool { appState.activeFlightPlan || appState.directToAirport != nil }

    var body: some View {
        let fields = InstrumentStripLayout.fields(compact: isCompact, routeActive: routeActive)
        Group {
            if isCompact {
                // iPhone: chip + GS/ALT/TRK on one row, DTG/ETE on a second row while a route is active.
                let primary = fields.filter { $0 != .dtg && $0 != .ete }
                let route = fields.filter { $0 == .dtg || $0 == .ete }
                VStack(spacing: 4) {
                    HStack(spacing: 0) {
                        GPSStatusChip(status: gpsStatus)
                            .padding(.trailing, 4)
                        ForEach(primary, id: \.self) { field in
                            Divider().frame(height: 44)
                            // ALT can be five digits; it gets its width first and GS/TRK shrink instead.
                            cell(for: field)
                                .layoutPriority(field == .alt ? 1 : 0)
                        }
                    }
                    if !route.isEmpty {
                        Divider()
                        HStack(spacing: 0) {
                            ForEach(route, id: \.self) { field in
                                cell(for: field)
                            }
                        }
                    }
                }
            } else {
                HStack(spacing: 0) {
                    GPSStatusChip(status: gpsStatus)
                        .padding(.trailing, 8)
                    ForEach(fields, id: \.self) { field in
                        Divider().frame(height: 44)
                        cell(for: field)
                    }
                }
            }
        }
        .padding(.horizontal, isCompact ? 8 : 16)
        .padding(.vertical, 8)
        .panelSurface()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Instruments")
        .accessibilityIdentifier("Instrument strip")
    }

    @ViewBuilder
    private func cell(for field: InstrumentStripLayout.Field) -> some View {
        let compact = isCompact
        switch field {
        case .gs: InstrumentCell(label: "GS", value: gsValue, unit: "KT", dimmed: isStale, compact: compact)
        // iPhone: ALT keeps its natural width (it can be five digits); the other cells share the rest.
        case .alt: InstrumentCell(label: "ALT", value: altValue, unit: "FT", dimmed: isStale || !hasAltitude, compact: compact, fillsWidth: false)
        case .vs: InstrumentCell(label: "VS", value: vsValue, unit: "FPM", dimmed: isStale || !hasAltitude, compact: compact)
        case .trk: InstrumentCell(label: "TRK", value: trkValue, unit: "\u{00B0}", dimmed: isStale, compact: compact)
        case .dtg: InstrumentCell(label: "DTG", value: dtgValue, unit: "NM", dimmed: isStale, compact: compact)
        case .ete: InstrumentCell(label: "ETE", value: eteValue, unit: "", dimmed: isStale, compact: compact)
        }
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
        case .ok: return Palette.ok
        case .degraded: return Palette.caution
        case .lost: return Palette.warning
        }
    }

    private var isAlert: Bool {
        if case .ok = status { return false }
        return true
    }

    @ScaledMetric(relativeTo: .callout) private var statusSize: CGFloat = 15

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 12, height: 12)
            Text(status.label)
                .font(.system(size: statusSize, weight: .bold, design: .monospaced))
                .foregroundStyle(isAlert ? tint : .primary)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 44)
        .background {
            if isAlert {
                RoundedRectangle(cornerRadius: Radius.s)
                    .fill(tint.opacity(0.08))
                    .background(Palette.statusChipBase, in: RoundedRectangle(cornerRadius: Radius.s))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("GPS status")
        .accessibilityLabel(status.accessibilityDescription)
    }
}

// MARK: - InstrumentCell

/// Single instrument readout cell: 13pt label, 32pt condensed fixed-digit semibold value, 13pt unit.
/// `dimmed` greys the value when the data behind it is stale or missing.
struct InstrumentCell: View {
    let label: String
    let value: String
    let unit: String
    var dimmed: Bool = false
    /// iPhone: no minimum width, cell shares the row; the unit moves up next to the label.
    var compact: Bool = false
    /// iPhone: stretch to share the row. False for a cell that should take only its natural width.
    var fillsWidth: Bool = true
    @Environment(\.colorScheme) private var colorScheme
    // Instrument readouts keep exact point sizes but scale with Dynamic Type.
    @ScaledMetric(relativeTo: .caption) private var labelSize: CGFloat = 13
    @ScaledMetric(relativeTo: .largeTitle) private var valueSize: CGFloat = 32

    /// Night: low-luminance text instead of bright white (F16).
    private var valueStyle: Color {
        if dimmed { return .secondary }
        return colorScheme == .dark ? NightPalette.text : .primary
    }

    /// Spoken form: "Ground speed 95 knots"; stale data is announced, never color alone.
    private var spoken: (name: String, unit: String) {
        switch label {
        case "GS": return ("Ground speed", "knots")
        case "ALT": return ("Altitude", "feet")
        case "VS": return ("Vertical speed", "feet per minute")
        case "TRK": return ("Track", "degrees")
        case "DTG": return ("Distance to go", "nautical miles")
        case "ETE": return ("Estimated time enroute", "")
        default: return (label, unit)
        }
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(compact && !unit.isEmpty ? "\(label) \(unit)" : label)
                .font(.system(size: labelSize, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(alignment: .lastTextBaseline, spacing: 3) {
                Text(value)
                    .font(TypeRole.readout(size: valueSize))
                    .foregroundStyle(valueStyle)
                    .lineLimit(1)
                    // iPhone at xxxLarge: "12500" needs ~94 pt next to the GPS chip on a 375 pt screen.
                    .minimumScaleFactor(compact ? 0.6 : 1)
                    // Stale values are grey and announced; no extra fade (kept >= 4.5:1)
                if !unit.isEmpty && !compact {
                    Text(unit)
                        .font(.system(size: labelSize, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(minWidth: compact ? 0 : 84, maxWidth: compact && fillsWidth ? .infinity : nil)
        .padding(.horizontal, compact ? 2 : 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken.name)
        .accessibilityValue("\(value) \(spoken.unit)\(dimmed ? ", stale" : "")")
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
