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
//  Two persisted toggles in Layers (FlightLogVisibility, default on) hide parts of it for chart
//  room: Flight log hides this column and the rail (the header then shows the next time-to);
//  Instruments hides NOW (FLOWN takes its space; the header then carries Clear).
//  No animation on value changes (pilot SA).
//

import SwiftUI

/// UserDefaults keys for the map-screen panel toggles (Layers > Panels). Both default to on.
enum FlightLogVisibility {
    static let flightLogKey = "showsFlightLog"
    static let instrumentsKey = "showsInstruments"
}

struct FlightLogStrip: View {
    let gpsStatus: GPSStatus
    let nearestEntry: NearestAirportEntry?
    let recordingViewModel: RecordingViewModel?
    let notices: FlightLogNotices
    let onClear: () -> Void
    @AppStorage(FlightLogVisibility.instrumentsKey) private var showsInstruments = true

    /// NOW is pinned: the warnings and NEXT above it take their natural height and scroll only when the
    /// column is too short (warnings, large Dynamic Type); FLOWN scrolls in whatever space is left below.
    /// With the instruments hidden NOW is omitted and Clear moves to the header.
    var body: some View {
        VStack(spacing: 0) {
            FlightLogHeader(recordingViewModel: recordingViewModel, onClear: showsInstruments ? nil : onClear)
            ColumnRule()
            ViewThatFits(in: .vertical) {
                aboveNow
                ScrollView { aboveNow }
            }
            .layoutPriority(1)  // after NOW's fixed height, the region above gets the space before FLOWN
            if showsInstruments {
                VStack(alignment: .leading, spacing: 0) {
                    FlightLogSectionLabel(title: "Now")
                    FlightLogNowCell(gpsStatus: gpsStatus, onClear: onClear)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            ScrollView {
                FlightLogFlown()
            }
        }
        .background(Palette.paper)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Flight log")
    }

    private var aboveNow: some View {
        VStack(alignment: .leading, spacing: 0) {
            notices
            FlightLogNext(gpsStatus: gpsStatus, nearestEntry: nearestEntry)
        }
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
    nonisolated static func clockText(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// The NEXT data line, "18.4 NM \u{00B7} 341\u{00B0} \u{00B7} ETA 15:41". A missing value dashes; a stale fix
    /// dashes all three so the last distance, bearing and ETA are never shown as current.
    nonisolated static func nextDataText(
        distanceNM: Double?, bearingTrue: Double?, eta: Date?, timeZone: TimeZone = .current, stale: Bool
    ) -> String {
        let distance = stale ? nil : distanceNM  // nautical miles
        let bearing = stale ? nil : bearingTrue  // degrees true
        let eta = stale ? nil : eta
        return [
            distance.map { String(format: "%.1f NM", $0) } ?? "--- NM",
            bearing.map { String(format: "%03.0f\u{00B0}", $0) } ?? "---\u{00B0}",
            "ETA \(eta.map { clockText($0, timeZone: timeZone) } ?? "---")",
        ].joined(separator: " \u{00B7} ")
    }

    /// VoiceOver counterpart of `nextDataText`: the known values only, or ", stale" with no numbers on a stale fix.
    nonisolated static func nextDataSpoken(
        distanceNM: Double?, bearingTrue: Double?, eta: Date?, timeZone: TimeZone = .current, stale: Bool
    ) -> String {
        if stale { return "distance, bearing and ETA unavailable, stale" }
        var parts: [String] = []
        if let distanceNM { parts.append(String(format: "%.1f NM", distanceNM)) }   // nautical miles
        if let bearingTrue { parts.append(String(format: "%03.0f\u{00B0}", bearingTrue)) }  // degrees true
        if let eta { parts.append("ETA \(clockText(eta, timeZone: timeZone))") }
        return parts.joined(separator: " \u{00B7} ")
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
    /// takes its place and the "---" stays small and secondary. The 104pt rail keeps the ident over the
    /// time-to in row sizes so the full time fits.
    private func nextRow(_ ident: String) -> some View {
        let quiet = isQuiet
        let bigTime = TypeRole.nextTime
        let time = Text(timeText)
            .font(quiet ? TypeRole.data : (compact ? TypeRole.rowTime : bigTime))
            .foregroundStyle(quiet ? Palette.inkSecondary : Palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(compact ? 0.5 : 0.3)
            .accessibilityHidden(true)
        let identText = Text(ident)
            .font(quiet && !compact ? bigTime : TypeRole.rowIdent)
            .foregroundStyle(gpsStatus.isStale ? Palette.inkSecondary : Palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(compact ? 0.5 : (quiet ? 0.3 : 0.6))
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
            Text(dataText)
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

    private var etaDate: Date? {
        if let route {
            // Israel: the route-following ETA, as the route bar showed it.
            return route.following.nextPointETA
        }
        guard !isQuiet, let ete = appState.estimatedTimeEnroute else { return nil }
        return ScenarioHooks.now.addingTimeInterval(ete)
    }

    /// Israel routes read their ETA in Israel time; Direct-To and US plans in device time.
    private var etaTimeZone: TimeZone {
        route != nil ? (TimeZone(identifier: "Asia/Jerusalem") ?? .current) : .current
    }

    /// "18.4 NM \u{00B7} 341\u{00B0} \u{00B7} ETA 15:41"; all dashed on a stale fix.
    private var dataText: String {
        FlightLogStrip.nextDataText(
            distanceNM: appState.distanceToNext, bearingTrue: appState.bearingToNext,
            eta: etaDate, timeZone: etaTimeZone, stale: gpsStatus.isStale
        )
    }

    private func spokenLine(_ ident: String) -> String {
        var parts = ["NEXT \(ident)"]
        if !isQuiet, let ete = appState.estimatedTimeEnroute {
            parts.append("in \(FlightLogStrip.spokenDuration(ete))")
        }
        let data = FlightLogStrip.nextDataSpoken(
            distanceNM: appState.distanceToNext, bearingTrue: appState.bearingToNext,
            eta: etaDate, timeZone: etaTimeZone, stale: gpsStatus.isStale
        )
        if !data.isEmpty { parts.append(data) }
        return parts.joined(separator: " \u{00B7} ")
    }

    // MARK: Later rows

    /// The route points after the next one, each with its cumulative time-to at the current ground speed:
    /// at most 3 (2 in the rail) so NOW stays in view, then a quiet "+N more to <dest>" line.
    @ViewBuilder
    private var laterRows: some View {
        if let route {
            let later = Array(route.legs.dropFirst(route.currentLeg + 1))
            let shown = later.prefix(compact ? 2 : 3)
            ForEach(Array(shown.enumerated()), id: \.offset) { index, leg in
                ColumnRule()
                laterRow(leg, timeTo: cumulativeTime(through: index, of: later))
            }
            if later.count > shown.count, let destination = route.destinationCode {
                ColumnRule()
                Text("+\(later.count - shown.count) more to \(destination)")
                    .font(TypeRole.data)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, compact ? Space.s : Space.m)
                    .padding(.vertical, Space.s)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("next-more-points")
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
