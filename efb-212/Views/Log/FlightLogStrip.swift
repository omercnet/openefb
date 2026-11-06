//
//  FlightLogStrip.swift
//  efb-212
//
//  The in-flight log beside the chart (Direction 2, stage 1). Reads top to bottom:
//  header (Log, route, Search, Rec), warnings and cautions, NEXT (the next waypoint's
//  time-to in the largest type on screen, then later waypoints), NOW (the active leg with
//  GS, TRK, ALT and VS over the altitude tape), FLOWN (departure and passed waypoints).
//  iPad: a fixed 400pt column at the leading edge. iPhone: the NEXT rows fold into a 104pt
//  rail (FlightLogRail) and the NOW cell moves under the chart at full width.
//  No animation on value changes (pilot SA).
//

import SwiftUI

struct FlightLogStrip: View {
    let gpsStatus: GPSStatus
    let nearestEntry: NearestAirportEntry?
    let recordingViewModel: RecordingViewModel?
    let notices: FlightLogNotices
    let onClear: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            FlightLogHeader(recordingViewModel: recordingViewModel)
            ColumnRule()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    notices
                    FlightLogNext(gpsStatus: gpsStatus, nearestEntry: nearestEntry)
                    FlightLogSectionLabel(title: "Now")
                    FlightLogNowCell(gpsStatus: gpsStatus, onClear: onClear)
                    FlightLogFlown()
                }
            }
        }
        .background(Palette.paper)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Flight log")
    }

    // MARK: - Text (static so tests read the same strings)

    /// Header title for the current navigation state ("DIRECT KSQL", "KPAO \u{2192} KSQL"); nil when nothing is active.
    static func routeTitle(for appState: AppState) -> String? {
        if let direct = appState.directToAirport {
            return "DIRECT \(direct.icao)"
        }
        if appState.activeFlightPlan, let leg = appState.activeRoute?.current,
           let dest = appState.activeRoute?.destinationCode {
            // Multi-leg CVFR route: the next reporting point and the altitude published for this leg.
            return "\u{2192} \(leg.toCode) \(leg.altitudeText) FT \u{00B7} \(dest)"
        }
        if appState.activeFlightPlan,
           let dep = appState.activePlanDeparture, let dest = appState.activePlanDestination {
            return "\(dep) \u{2192} \(dest)"
        }
        return nil
    }

    /// The next waypoint: the Direct-To field, else the active route's next point, else the plan destination.
    static func nextIdent(for appState: AppState) -> String? {
        if let direct = appState.directToAirport { return direct.icao }
        guard appState.activeFlightPlan else { return nil }
        return appState.activeRoute?.current?.toCode ?? appState.activePlanDestination
    }

    /// The multi-leg route being followed (Israel CVFR); nil for Direct-To and US direct plans.
    static func followedRoute(for appState: AppState) -> ActiveRoute? {
        guard appState.directToAirport == nil, appState.activeFlightPlan else { return nil }
        return appState.activeRoute
    }

    /// Time-to as "11:16" (m:ss) under an hour, "1:05" (h:mm) above.
    static func timeToText(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        if total < 3600 {
            return String(format: "%d:%02d", total / 60, total % 60)
        }
        return String(format: "%d:%02d", total / 3600, (total % 3600) / 60)
    }

    /// Spoken time-to: "11 minutes 16 seconds", "1 hour 5 minutes".
    static func spokenDuration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        if total < 3600 {
            return "\(total / 60) minutes \(total % 60) seconds"
        }
        return "\(total / 3600) hours \((total % 3600) / 60) minutes"
    }

    /// Wall-clock time "15:41" (24 h) in the given zone.
    static func clockText(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// Local time in Israel, "03:36" (24 h, two digits: glanceable and unambiguous).
    static func etaText(_ date: Date) -> String {
        clockText(date, timeZone: TimeZone(identifier: "Asia/Jerusalem") ?? .current)
    }

    /// "0.8 NM RIGHT OF ROUTE"; nil without a measurement.
    static func offRouteText(_ following: ActiveRouteFollowing) -> String? {
        guard let distance = following.crossTrackNM, let side = following.side else { return nil }
        return String(format: "%.1f NM %@ OF ROUTE", distance, side == .left ? "LEFT" : "RIGHT")
    }

    /// "350 FT HIGH \u{00B7} FLY 2500".
    static func altitudeText(_ following: ActiveRouteFollowing, published: String) -> String? {
        guard let deviation = following.altitudeDeviationFeet else { return nil }
        let feet = Int(abs(deviation).rounded())
        return "\(feet) FT \(deviation > 0 ? "HIGH" : "LOW") \u{00B7} FLY \(published)"
    }
}

// MARK: - FlightLogRail

/// iPhone and iPad Split View: the NEXT rows in a 104pt rail beside the chart.
struct FlightLogRail: View {
    let gpsStatus: GPSStatus
    let nearestEntry: NearestAirportEntry?

    var body: some View {
        ScrollView {
            FlightLogNext(gpsStatus: gpsStatus, nearestEntry: nearestEntry, compact: true)
        }
        .frame(width: StripMetrics.railWidth)
        .background(Palette.paper)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Flight log")
    }
}

// MARK: - FlightLogNext

/// NEXT: the next waypoint with its time-to, then the later route points; with no navigation,
/// the nearest airport as a quiet row and a Plan a flight button.
struct FlightLogNext: View {
    @Environment(AppState.self) private var appState
    let gpsStatus: GPSStatus
    let nearestEntry: NearestAirportEntry?
    var compact: Bool = false

    /// Below 30 kt, without an ETE or on a stale fix the times are not meaningful: show "---".
    private var isQuiet: Bool {
        appState.groundSpeed < 30 || appState.estimatedTimeEnroute == nil || gpsStatus.isStale  // knots
    }

    private var route: ActiveRoute? { FlightLogStrip.followedRoute(for: appState) }

    private var sectionDetail: String? {
        if appState.directToAirport != nil { return "direct" }
        if route != nil { return "route" }
        if appState.activeFlightPlan { return "plan" }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FlightLogSectionLabel(title: "Next", detail: compact ? nil : sectionDetail)
            if let ident = FlightLogStrip.nextIdent(for: appState) {
                nextRow(ident)
                laterRows
            } else {
                nearestRow
                planButton
            }
        }
    }

    // MARK: Next row

    /// The time-to is the big element; without a meaningful time (slow, no ETE, stale fix) the ident
    /// takes its place and the "---" stays small and secondary.
    private func nextRow(_ ident: String) -> some View {
        let quiet = isQuiet
        let time = Text(timeText)
            .font(quiet ? TypeRole.data : TypeRole.nextTime)
            .foregroundStyle(quiet ? Palette.inkSecondary : Palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.3)
            .accessibilityHidden(true)
        let identText = Text(ident)
            .font(quiet ? TypeRole.nextTime : TypeRole.rowIdent)
            .foregroundStyle(gpsStatus.isStale ? Palette.inkSecondary : Palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(quiet ? 0.3 : 0.6)
            // One element carries the whole row for VoiceOver and the UI tests ("NEXT BAZRA ...").
            .accessibilityLabel(spokenLine(ident))
            .accessibilityIdentifier(route != nil ? "israel-route-next-point" : "next-waypoint")
        return VStack(alignment: .leading, spacing: Space.xs) {
            if compact {
                identText
                time
            } else if quiet {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                    identText
                    time
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                    time
                    identText
                }
            }
            Text(dataParts.joined(separator: " \u{00B7} "))
                .font(TypeRole.data)
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
        .padding(compact ? Space.s : Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.activeCell)
    }

    private var timeText: String {
        guard !isQuiet, let ete = appState.estimatedTimeEnroute else { return "---" }  // seconds
        return FlightLogStrip.timeToText(ete)
    }

    /// "18.4 NM", "341\u{00B0}", "ETA 15:41".
    private var dataParts: [String] {
        var parts: [String] = []
        if let distance = appState.distanceToNext { parts.append(String(format: "%.1f NM", distance)) }   // nautical miles
        if let bearing = appState.bearingToNext { parts.append(String(format: "%03.0f\u{00B0}", bearing)) }  // degrees true
        if let eta = etaText { parts.append("ETA \(eta)") }
        return parts
    }

    private var etaText: String? {
        if let route {
            // Israel: the route-following ETA in Israel time, as the route bar showed it.
            return route.following.nextPointETA.map(FlightLogStrip.etaText)
        }
        guard !isQuiet, let ete = appState.estimatedTimeEnroute else { return nil }
        return FlightLogStrip.clockText(ScenarioHooks.now.addingTimeInterval(ete))
    }

    private func spokenLine(_ ident: String) -> String {
        var parts = ["NEXT \(ident)"]
        if !isQuiet, let ete = appState.estimatedTimeEnroute {
            parts.append("in \(FlightLogStrip.spokenDuration(ete))")
        }
        parts += dataParts
        return parts.joined(separator: " \u{00B7} ")
    }

    // MARK: Later rows

    /// The route points after the next one, each with its cumulative time-to at the current ground speed.
    @ViewBuilder
    private var laterRows: some View {
        if let route {
            let later = Array(route.legs.dropFirst(route.currentLeg + 1))
            ForEach(Array(later.enumerated()), id: \.offset) { index, leg in
                ColumnRule()
                laterRow(leg, timeTo: cumulativeTime(through: index, of: later))
            }
        }
    }

    /// Seconds to the end of `later[index]`: time to the next point plus the legs after it at ground speed.
    private func cumulativeTime(through index: Int, of later: [ActiveRouteLeg]) -> TimeInterval? {
        guard !isQuiet, let ete = appState.estimatedTimeEnroute else { return nil }
        let distance = later[...index].reduce(0) { $0 + $1.distanceNM }  // nautical miles
        return ete + distance / appState.groundSpeed * 3600
    }

    private func laterRow(_ leg: ActiveRouteLeg, timeTo: TimeInterval?) -> some View {
        let time = Text(timeTo.map(FlightLogStrip.timeToText) ?? "---")
            .font(TypeRole.rowTime)
            .foregroundStyle(timeTo == nil ? Palette.inkSecondary : Palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        let detail = VStack(alignment: .leading, spacing: 0) {
            Text(leg.toCode)
                .font(TypeRole.rowIdent)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text("\(leg.altitudeText) FT \u{00B7} " + String(format: "%.1f NM", leg.distanceNM))
                .font(TypeRole.data)
                .foregroundStyle(Palette.inkSecondary)
        }
        return Group {
            if compact {
                VStack(alignment: .leading, spacing: 0) { detail; time }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) { time; detail }
            }
        }
        .padding(.horizontal, compact ? Space.s : Space.m)
        .padding(.vertical, Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Then \(leg.toCode), \(leg.altitudeText) feet")
        .accessibilityValue(timeTo.map { "in \(FlightLogStrip.spokenDuration($0))" } ?? "no time while slow or without a fix")
    }

    // MARK: No navigation

    private var nearestRow: some View {
        Text(nearestText)
            .font(TypeRole.data)
            .foregroundStyle(Palette.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(compact ? Space.s : Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(nearestText)
    }

    /// "NRST KPAO 2.1 NM \u{00B7} 128\u{00B0}".
    private var nearestText: String {
        guard appState.region.hasAirportData else { return "No airport data yet" }
        guard let entry = nearestEntry else { return appState.gpsAvailable ? "No landable airport in range" : "Waiting for GPS" }
        return "NRST \(entry.airport.icao) " + String(format: "%.1f NM \u{00B7} %03.0f\u{00B0}", entry.distance, entry.bearing)
    }

    private var planButton: some View {
        Button {
            appState.selectedScreen = .log
        } label: {
            Text("Plan a flight")
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
                .background(Palette.activeCell, in: RoundedRectangle(cornerRadius: Radius.s))
                .overlay(RoundedRectangle(cornerRadius: Radius.s).strokeBorder(Palette.rule, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .padding(.horizontal, compact ? Space.s : Space.m)
        .padding(.bottom, Space.m)
        .accessibilityLabel("Plan a flight")
        .accessibilityIdentifier("plan-a-flight")
    }
}
