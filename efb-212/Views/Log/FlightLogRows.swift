//
//  FlightLogRows.swift
//  efb-212
//
//  The pieces of the flight log strip: header, warning rows, the NOW cell (active leg,
//  GS / TRK / ALT with VS, altitude tape, route controls) and the FLOWN rows.
//  Stale rules from the old instrument strip: "---" without a fix, values grey and announced
//  ", stale" when the fix is lost, ALT and VS dashed without a vertical fix. No animation.
//

import SwiftUI
import CoreLocation

// MARK: - Building blocks

/// Section band: "NEXT", "NOW", "FLOWN", with an optional quiet detail ("direct").
struct FlightLogSectionLabel: View {
    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(spacing: Space.s) {
            ColumnSectionLabel(title)
            if let detail {
                Spacer(minLength: Space.s)
                ColumnSectionLabel(detail)
            }
        }
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paperSecondary)
    }
}

/// A 60pt strip control: glyph over an uppercase label.
struct FlightLogCellButton: View {
    let title: String
    let systemImage: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: systemImage)
                    .font(.title3)
                Text(title)
                    .font(TypeRole.stripLabel)
                    .textCase(.uppercase)
                    .tracking(StripMetrics.labelTracking)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .foregroundStyle(Palette.ink)
            .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: - Header

/// LOG, route title, SEARCH, BRIEF (Israel), CLEAR (instruments hidden), REC. 60pt high. The controls
/// keep their full cell width; the title takes what is left on one line.
struct FlightLogHeader: View {
    @Environment(AppState.self) private var appState
    let recordingViewModel: RecordingViewModel?
    /// iPhone and iPad Split View: the record control shows its glyph only.
    var compact: Bool = false
    /// The flight log is hidden (no NEXT on screen): the title carries the next waypoint's time-to.
    var showsNextTime: Bool = false
    /// Fix state for the time-to; no time on a stale or missing fix.
    var gpsStatus: GPSStatus? = nil
    /// The instruments are hidden (no NOW cell): the header carries Clear while navigation is active.
    var onClear: (() -> Void)? = nil

    /// "9:12" to the next waypoint; nil when hidden, with no next waypoint, no ETE or a stale fix.
    private var nextTime: (text: String, spoken: String)? {
        guard showsNextTime, FlightLogStrip.nextIdent(for: appState) != nil,
              let gpsStatus, !gpsStatus.isStale,
              let ete = appState.estimatedTimeEnroute else { return nil }  // seconds
        return (FlightLogStrip.timeToText(ete), FlightLogStrip.spokenDuration(ete))
    }

    var body: some View {
        let route = FlightLogStrip.routeTitle(for: appState)
        let next = nextTime
        let title = route.map { title in next.map { "\(title) \u{00B7} \($0.text)" } ?? title }
        HStack(spacing: 0) {
            FlightLogCellButton(title: "Log", systemImage: "list.bullet", accessibilityLabel: "Flight log") {
                appState.selectedScreen = .log
            }
            .accessibilityIdentifier("flight-log-button")
            .fixedSize()

            Text(title ?? "No route")
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(title == nil ? Palette.inkSecondary : Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Space.s)
                .accessibilityLabel(route.map { title in
                    "Route \(title)" + (next.map { ", next in \($0.spoken)" } ?? "")
                } ?? "No route")
                .accessibilityIdentifier(title == nil ? "no-route" : "active-navigation-bar")

            if appState.region.hasAirportData {
                FlightLogCellButton(title: "Search", systemImage: "magnifyingglass", accessibilityLabel: "Search airports") {
                    appState.stripColumn = .search
                }
                .fixedSize()
            }
            if appState.region == .israel {
                // Israel NOTAM briefing (IL-BRIEF)
                FlightLogCellButton(title: "Brief", systemImage: "doc.text.magnifyingglass", accessibilityLabel: "NOTAM briefing") {
                    Haptics.light()
                    appState.isPresentingIsraelBriefing = true
                }
                .accessibilityIdentifier("israel-briefing-button")
                .fixedSize()
            }
            if let onClear, appState.hasActiveNavigation {
                FlightLogCellButton(title: "Clear", systemImage: "xmark",
                                    accessibilityLabel: "Clear \(route ?? "navigation")", action: onClear)
                    .accessibilityIdentifier("clear-direct-to")
                    .fixedSize()
            }
            if let recordingViewModel {
                RecordButton(viewModel: recordingViewModel, compact: compact)
                    .fixedSize()
            }
        }
        .frame(minHeight: StripMetrics.cell)
        .background(Palette.paperSecondary)
    }
}

// MARK: - Warnings and cautions

/// Full-width warning and caution rows in priority order. Renders nothing when all is well.
struct FlightLogNotices: View {
    @Environment(AppState.self) private var appState
    let mapViewModel: MapViewModel
    let airspaceCheckUnavailable: Bool
    let israelAlertsSuspended: Bool
    let israelAlerts: [IsraelAlert]
    let isOffline: Bool
    let showIsraelChartHint: Bool
    let onDismissIsraelChartHint: () -> Void
    let recordingViewModel: RecordingViewModel?
    let recordingUnavailable: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            // Why there is no position, with Open Settings when the pilot can fix it.
            if let failure = appState.gpsFailure, mapViewModel.gpsStatus.isStale {
                GPSFailureNotice(reason: failure)
            }
            // The airspace proximity check cannot run: say so instead of showing nothing (efb-8lm)
            if airspaceCheckUnavailable {
                AirspaceCheckUnavailableBanner()
            }
            // Israel alerts, highest priority first. Without a fresh fix they cannot be evaluated:
            // say so instead of showing the last ones as current.
            if israelAlertsSuspended {
                IsraelAlertsSuspendedBanner()
            } else if !israelAlerts.isEmpty {
                IsraelAlertBanner(alerts: israelAlerts)
            }
            CurrencyWarningBanner()
                .withAutoCompute()
            if isOffline {
                Label("Offline, using cached data", systemImage: "wifi.slash")
                    .font(TypeRole.data)
                    .foregroundStyle(Palette.caution)
                    .noticeRow(tint: Palette.caution)
                    .accessibilityIdentifier("offline-notice")
            }
            // Chart cycle (INFRA-03) and stale or hidden TFR / AIRMET-SIGMET data (efb-zfm.11)
            DataAgeBadge(.chartCycle, validUntil: mapViewModel.chartExpirationDate)
                .hiddenWhenFresh()
            OverlayStalenessBadges(viewModel: mapViewModel)
            // First Israel launch: where to get the official chart (once per install)
            if appState.region == .israel, showIsraelChartHint {
                IsraelChartHintBanner(onDismiss: onDismissIsraelChartHint)
            }
            if let recordingViewModel {
                RecordingNotices(viewModel: recordingViewModel)
            } else if recordingUnavailable {
                // Recording database failed: the rest of the app works, but say so (no silent missing button).
                Label("Recording unavailable", systemImage: "mic.slash.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.caution)
                    .noticeRow(tint: Palette.caution)
                    .accessibilityIdentifier("recording-unavailable")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - NOW cell

/// The active leg: leg line with progress, GS / TRK / ALT with VS, the altitude tape, the
/// Israel route cautions and the route controls.
struct FlightLogNowCell: View {
    @Environment(AppState.self) private var appState
    let gpsStatus: GPSStatus
    let onClear: () -> Void
    /// iPhone: full width under the chart, readouts at 38pt.
    var compact: Bool = false

    // Readouts keep exact point sizes but scale with Dynamic Type.
    @ScaledMetric(relativeTo: .largeTitle) private var readoutSize: CGFloat = 42      // points
    @ScaledMetric(relativeTo: .largeTitle) private var compactReadoutSize: CGFloat = 38  // points

    private var route: ActiveRoute? { FlightLogStrip.followedRoute(for: appState) }
    private var isStale: Bool { gpsStatus.isStale }
    /// A fix exists and the cell has something to show (values still dim when stale).
    private var hasFix: Bool { appState.gpsAvailable && appState.ownshipPosition != nil }
    /// CoreLocation reports no altitude (vertical accuracy < 0) on Wi-Fi-only fixes.
    private var hasAltitude: Bool { (appState.ownshipPosition?.verticalAccuracy ?? -1) >= 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            legLine
            readouts
            AltitudeTape(
                altitudeFeet: hasFix && hasAltitude && !isStale ? appState.altitude : nil,
                verticalSpeedFPM: appState.verticalSpeed
            )
            cautions
            controls
        }
        .padding(compact ? Space.s : Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.activeCell)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Now")
    }

    // MARK: Leg line

    @ViewBuilder
    private var legLine: some View {
        if let route, let leg = route.current {
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(leg.fromCode) \u{25B8} \(leg.toCode)")
                        .font(TypeRole.dataEmphasis)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityLabel("Leg \(leg.fromCode) to \(leg.toCode)")
                        .accessibilityIdentifier("israel-route-leg")
                    Spacer(minLength: Space.s)
                    Text("\(leg.altitudeText) FT MSL")
                        .font(TypeRole.dataEmphasis)
                        .foregroundStyle(Palette.ink)
                        .accessibilityLabel("Published altitude \(leg.altitudeText) feet")
                        .accessibilityIdentifier("israel-route-altitude")
                }
                if let toGo = appState.distanceToNext, leg.distanceNM > 0 {
                    let flown = min(max(leg.distanceNM - toGo, 0), leg.distanceNM)  // nautical miles
                    HStack(spacing: Space.s) {
                        LegProgressBar(fraction: flown / leg.distanceNM)
                        Text(String(format: "%.1f / %.1f NM", flown, leg.distanceNM))
                            .font(TypeRole.data)
                            .foregroundStyle(Palette.inkSecondary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Leg progress")
                    .accessibilityValue(String(format: "%.1f of %.1f nautical miles flown", flown, leg.distanceNM))
                }
            }
        } else if let next = FlightLogStrip.nextIdent(for: appState) {
            let from = appState.directToAirport == nil ? (appState.activePlanDeparture ?? "PPOS") : "DIRECT"
            Text("\(from) \u{25B8} \(next)")
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityLabel("Leg \(from) to \(next)")
        }
    }

    // MARK: Readouts

    /// GS, TRK and ALT with VS, each at its full width with the spacing flexing between them. When the
    /// three do not fit (large Dynamic Type), ALT wraps under GS and TRK: no value is ever dropped.
    private var readouts: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 0) {
                groundSpeedReadout
                Spacer(minLength: Space.l)
                trackReadout
                Spacer(minLength: Space.l)
                altitudeReadout
            }
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(alignment: .top, spacing: Space.l) {
                    groundSpeedReadout
                    trackReadout
                }
                altitudeReadout
            }
        }
    }

    private var groundSpeedReadout: some View {
        readout(label: "GS kt", value: gsValue, name: "Ground speed", unit: "knots", dimmed: isStale)
    }

    private var trackReadout: some View {
        readout(label: "TRK \u{00B0}T", value: trkValue, name: "Track", unit: "degrees true", dimmed: isStale)
    }

    private func readout(label: String, value: String, name: String, unit: String, dimmed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            readoutLabel(label)
            Text(value)
                .font(TypeRole.readout(size: compact ? compactReadoutSize : readoutSize))
                .foregroundStyle(dimmed ? Palette.inkSecondary : Palette.ink)
                .lineLimit(1)
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue("\(value) \(unit)\(dimmed ? ", stale" : "")")
    }

    private var altitudeReadout: some View {
        let dimmed = isStale || !hasAltitude
        return VStack(alignment: .leading, spacing: 0) {
            readoutLabel("ALT ft MSL")
            HStack(alignment: .lastTextBaseline, spacing: Space.xs) {
                Text(altValue)
                    .font(TypeRole.readout(size: compact ? compactReadoutSize : readoutSize))
                    .foregroundStyle(dimmed ? Palette.inkSecondary : Palette.ink)
                    .lineLimit(1)
                HStack(spacing: 0) {
                    if let arrow = vsArrow, !dimmed {
                        Image(systemName: arrow)
                    }
                    Text(vsValue)
                }
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(dimmed ? Palette.inkSecondary : Palette.ink)
                .lineLimit(1)
                .fixedSize()
            }
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Altitude")
        .accessibilityValue("\(altValue) feet, vertical speed \(vsValue) feet per minute\(dimmed ? ", stale" : "")")
    }

    private func readoutLabel(_ text: String) -> some View {
        Text(text)
            .font(TypeRole.stripLabel)
            .tracking(StripMetrics.labelTracking)
            .foregroundStyle(Palette.inkSecondary)
            .lineLimit(1)
    }

    /// Ground speed in knots, rounded to nearest 1 kt.
    private var gsValue: String {
        guard hasFix else { return "---" }
        return "\(Int(appState.groundSpeed))"
    }

    /// Track in degrees true, 3-digit with leading zeros.
    private var trkValue: String {
        guard hasFix else { return "---" }
        return String(format: "%03.0f", appState.track)
    }

    /// Altitude in feet MSL, rounded to nearest 10 ft (aviation standard).
    private var altValue: String {
        guard hasFix, hasAltitude else { return "---" }
        return "\(Int((appState.altitude / 10).rounded() * 10))"
    }

    /// Vertical speed in fpm with +/- prefix.
    private var vsValue: String {
        guard hasFix, hasAltitude else { return "---" }
        let vs = Int(appState.verticalSpeed)
        return vs >= 0 ? "+\(vs)" : "\(vs)"
    }

    /// Climb or descent arrow; none within 100 fpm of level.
    private var vsArrow: String? {
        guard hasFix, hasAltitude, abs(appState.verticalSpeed) >= 100 else { return nil }  // feet per minute
        return appState.verticalSpeed > 0 ? "arrow.up" : "arrow.down"
    }

    // MARK: Cautions

    /// Amber route cautions: amber type on an amber rule (no filled amber block at night).
    @ViewBuilder
    private var cautions: some View {
        if let route {
            let following = route.following
            if following.isOffRoute, let text = FlightLogStrip.offRouteText(following) {
                caution(text, identifier: "israel-route-off-route")
            }
            if following.isAltitudeCaution, let leg = route.current,
               let text = FlightLogStrip.altitudeText(following, published: leg.altitudeText) {
                caution(text, identifier: "israel-route-altitude-caution")
            }
        }
    }

    private func caution(_ text: String, identifier: String) -> some View {
        Text(text)
            .font(TypeRole.dataEmphasis)
            .foregroundStyle(Palette.caution)
            .padding(.vertical, Space.s)
            .padding(.horizontal, Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                Rectangle().fill(Palette.caution).frame(width: 4)
            }
            .accessibilityIdentifier(identifier)
    }

    // MARK: Controls

    @ViewBuilder
    private var controls: some View {
        if let route {
            HStack(spacing: Space.s) {
                controlButton("Prev", label: "Previous leg", identifier: "israel-route-previous", enabled: route.currentLeg > 0) {
                    appState.sequenceActiveRoute(forward: false)
                }
                controlButton("Next", label: "Next leg", identifier: "israel-route-next", enabled: !route.isLastLeg) {
                    appState.sequenceActiveRoute(forward: true)
                }
                Spacer(minLength: 0)
                clearButton
            }
        } else if appState.hasActiveNavigation {
            HStack {
                Spacer(minLength: 0)
                clearButton
            }
        }
    }

    private var clearButton: some View {
        controlButton("Clear", label: "Clear \(FlightLogStrip.routeTitle(for: appState) ?? "navigation")",
                      identifier: "clear-direct-to", enabled: true, action: onClear)
    }

    private func controlButton(_ title: String, label: String, identifier: String, enabled: Bool,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, Space.m)
                .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
                .background(Palette.paperSecondary, in: RoundedRectangle(cornerRadius: Radius.s))
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }
}

/// Distance flown along the active leg, in route magenta.
private struct LegProgressBar: View {
    let fraction: Double  // 0...1

    var body: some View {
        Capsule()
            .fill(Palette.paperSecondary)
            .frame(height: 6)
            .overlay(alignment: .leading) {
                GeometryReader { geometry in
                    Capsule()
                        .fill(Palette.route)
                        .frame(width: geometry.size.width * min(max(fraction, 0), 1))
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Altitude tape

/// Altitude left to right on a 0 to 4,000 ft scale (wider above 3,500 ft), the ownship marker
/// and an arrow to where one minute at the current vertical speed puts the aircraft.
struct AltitudeTape: View {
    /// Feet MSL; nil when there is no current vertical fix (nothing is drawn as current).
    let altitudeFeet: Double?
    let verticalSpeedFPM: Double  // feet per minute

    /// Top of the scale in feet: 4,000, or twice the altitude rounded up to 1,000 ft once above 3,500.
    static func scaleTop(for altitude: Double?) -> Double {
        guard let altitude, altitude > 3500 else { return 4000 }
        return (altitude * 2 / 1000).rounded(.up) * 1000
    }

    var body: some View {
        let top = Self.scaleTop(for: altitudeFeet)
        Canvas { context, size in
            let x0: CGFloat = 8, x1 = size.width - 8
            let barY: CGFloat = 20, barHeight: CGFloat = 16
            func x(_ feet: Double) -> CGFloat { x0 + (x1 - x0) * CGFloat(min(max(feet, 0), top) / top) }

            context.fill(Path(roundedRect: CGRect(x: x0, y: barY, width: x1 - x0, height: barHeight), cornerRadius: 3),
                         with: .color(Palette.paperSecondary))
            for feet in stride(from: 1000.0, to: top, by: 1000) {
                var tick = Path()
                tick.move(to: CGPoint(x: x(feet), y: barY))
                tick.addLine(to: CGPoint(x: x(feet), y: barY + barHeight))
                context.stroke(tick, with: .color(Palette.rule), lineWidth: 1.5)
            }

            // Labels under the bar: the scale ends, and the current altitude centred under the marker but
            // kept inside the tape. An end label the altitude label would touch is not drawn.
            let labelY = size.height - 6
            let zeroLabel = context.resolve(Text("0").font(TypeRole.stripLabel).foregroundStyle(Palette.inkSecondary))
            let topLabel = context.resolve(Text(Int(top).formatted()).font(TypeRole.stripLabel).foregroundStyle(Palette.inkSecondary))
            let zeroMaxX = x0 + zeroLabel.measure(in: size).width
            let topMinX = x1 - topLabel.measure(in: size).width
            var altitudeLabel: (text: GraphicsContext.ResolvedText, centerX: CGFloat, minX: CGFloat, maxX: CGFloat)?
            if let altitude = altitudeFeet {
                let text = context.resolve(Text(Int((altitude / 10).rounded() * 10).formatted())
                    .font(TypeRole.stripLabel).foregroundStyle(Palette.ink))
                let half = text.measure(in: size).width / 2
                let centerX = min(max(x(altitude), x0 + half), x1 - half)
                altitudeLabel = (text, centerX, centerX - half, centerX + half)
            }
            if zeroMaxX + Space.xs < altitudeLabel?.minX ?? .infinity {
                context.draw(zeroLabel, at: CGPoint(x: x0, y: labelY), anchor: .leading)
            }
            if topMinX - Space.xs > altitudeLabel?.maxX ?? -.infinity {
                context.draw(topLabel, at: CGPoint(x: x1, y: labelY), anchor: .trailing)
            }

            guard let altitude = altitudeFeet else { return }
            let ax = x(altitude)
            let midY = barY + barHeight / 2
            if abs(verticalSpeedFPM) >= 100 {
                // One minute at the current vertical speed. The arrow carries no text: the VS value is
                // printed beside ALT, and a label here collided with the marker.
                let target = x(altitude + verticalSpeedFPM)
                let direction: CGFloat = target >= ax ? 1 : -1
                var shaft = Path()
                shaft.move(to: CGPoint(x: ax, y: midY))
                shaft.addLine(to: CGPoint(x: target - direction * 6, y: midY))
                context.stroke(shaft, with: .color(Palette.ink), lineWidth: 4)
                var head = Path()
                head.move(to: CGPoint(x: target, y: midY))
                head.addLine(to: CGPoint(x: target - direction * 9, y: midY - 6))
                head.addLine(to: CGPoint(x: target - direction * 9, y: midY + 6))
                head.closeSubpath()
                context.fill(head, with: .color(Palette.ink))
            }
            var marker = Path()
            marker.move(to: CGPoint(x: ax - 7, y: 4))
            marker.addLine(to: CGPoint(x: ax + 7, y: 4))
            marker.addLine(to: CGPoint(x: ax, y: barY - 2))
            marker.closeSubpath()
            context.fill(marker, with: .color(Palette.ink))
            if let altitudeLabel {
                context.draw(altitudeLabel.text, at: CGPoint(x: altitudeLabel.centerX, y: labelY), anchor: .center)
            }
        }
        .frame(height: 56)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Altitude tape")
        .accessibilityValue(spokenValue)
    }

    private var spokenValue: String {
        guard let altitudeFeet else { return "No current altitude" }
        let altitude = "\(Int((altitudeFeet / 10).rounded() * 10)) feet"
        guard abs(verticalSpeedFPM) >= 100 else { return "\(altitude), level" }
        return "\(altitude), \(verticalSpeedFPM > 0 ? "climbing" : "descending") \(Int(abs(verticalSpeedFPM))) feet per minute"
    }
}

// MARK: - FLOWN

/// Departure and the route points already passed.
struct FlightLogFlown: View {
    @Environment(AppState.self) private var appState

    private var codes: [String] {
        if let route = FlightLogStrip.followedRoute(for: appState), let departure = route.departureCode {
            return [departure] + route.legs.prefix(route.currentLeg).map(\.toCode)
        }
        if appState.directToAirport == nil, appState.activeFlightPlan, let departure = appState.activePlanDeparture {
            return [departure]
        }
        return []
    }

    var body: some View {
        let rows = codes
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                FlightLogSectionLabel(title: "Flown")
                ForEach(Array(rows.enumerated()), id: \.offset) { index, code in
                    if index > 0 { ColumnRule() }
                    HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                        Text(code)
                            .font(TypeRole.rowIdent)
                            .foregroundStyle(Palette.inkSecondary)
                        if index == 0 {
                            Text("DEP")
                                .font(TypeRole.stripLabel)
                                .tracking(StripMetrics.labelTracking)
                                .foregroundStyle(Palette.inkSecondary)
                        }
                    }
                    .padding(.horizontal, Space.m)
                    .padding(.vertical, Space.s)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(index == 0 ? "Departed \(code)" : "Passed \(code)")
                }
            }
        }
    }
}
