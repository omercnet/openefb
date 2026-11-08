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
//  Stage 2 (Layers > Panels > Predictions): predicted airspace entries join NEXT in time order,
//  the soonest one as the amber next-thing block, each with the assumption it was made on.
//  No animation on value changes (pilot SA).
//

import SwiftUI

/// UserDefaults keys for the map-screen panel toggles (Layers > Panels). Flight log and
/// instruments default to on. Predictions default to off: pilots opt in to the preview until
/// an owner or CFI review in flight (docs/DESIGN.md, Stage 2).
enum FlightLogVisibility {
    static let flightLogKey = "showsFlightLog"
    static let instrumentsKey = "showsInstruments"
    static let predictionsKey = "showsPredictions"
    static let predictionsDefault = false

    /// The predictions toggle as @AppStorage reads it: a stored Bool, or a "YES"/"NO" launch argument.
    static func predictionsOn(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: predictionsKey) == nil ? predictionsDefault : defaults.bool(forKey: predictionsKey)
    }
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
    nonisolated static func timeToText(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        if total < 3600 {
            return String(format: "%d:%02d", total / 60, total % 60)
        }
        return String(format: "%d:%02d", total / 3600, (total % 3600) / 60)
    }

    /// Spoken time-to: "11 minutes 16 seconds", "1 minute 50 seconds", "1 hour 5 minutes".
    nonisolated static func spokenDuration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        func count(_ value: Int, _ unit: String) -> String { "\(value) \(unit)\(value == 1 ? "" : "s")" }
        if total < 3600 {
            return "\(count(total / 60, "minute")) \(count(total % 60, "second"))"
        }
        return "\(count(total / 3600, "hour")) \(count((total % 3600) / 60, "minute"))"
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

// MARK: - Predictions in NEXT (stage 2)

/// One row of NEXT: a predicted airspace entry or a route point, each with its time-to.
nonisolated enum NextItem: Identifiable, Equatable, Sendable {
    case event(PredictedEvent)
    /// `index` into the waypoint times given to `nextItems`: 0 is the next waypoint, then the later route points.
    case waypoint(index: Int, secondsAhead: TimeInterval?)

    var id: String {
        switch self {
        case .event(let event): "event/\(event.id)"
        case .waypoint(let index, _): "waypoint/\(index)"
        }
    }

    /// Seconds to the item; nil for a waypoint without a meaningful time (slow, stale fix, no ETE).
    var secondsAhead: TimeInterval? {
        switch self {
        case .event(let event): event.secondsAhead
        case .waypoint(_, let seconds): seconds
        }
    }
}

extension FlightLogStrip {
    /// Predicted events and route points in one time order. Waypoints keep their route order; a waypoint
    /// without a time never goes ahead of an event, and an event wins a tie (caution first).
    nonisolated static func nextItems(events: [PredictedEvent], waypoints: [TimeInterval?]) -> [NextItem] {
        var pending = events.sorted { $0.secondsAhead < $1.secondsAhead }[...]
        var items: [NextItem] = []
        var index = 0
        while index < waypoints.count || !pending.isEmpty {
            if let event = pending.first,
               index == waypoints.count || (waypoints[index].map { event.secondsAhead <= $0 } ?? true) {
                items.append(.event(event))
                pending.removeFirst()
            } else {
                items.append(.waypoint(index: index, secondsAhead: waypoints[index]))
                index += 1
            }
        }
        return items
    }

    /// The top (loud) row, at most `laterCap` later rows, and how many are left for "+N more".
    nonisolated static func splitNext(
        _ items: [NextItem], laterCap: Int
    ) -> (top: NextItem?, later: [NextItem], hiddenCount: Int) {
        guard let top = items.first else { return (nil, [], 0) }
        let rest = items.dropFirst()
        let later = Array(rest.prefix(laterCap))
        return (top, later, rest.count - later.count)
    }

    /// The floor the altitude tape draws: the soonest floor or boundary entry whose floor is above the surface.
    nonisolated static func tapeFloor(
        _ events: [PredictedEvent]
    ) -> (feet: Double, secondsAhead: TimeInterval, label: String)? {
        let floors = events.filter { $0.kind != .ceiling && ($0.limitFeetMSL ?? 0) > 0 }
        guard let event = floors.min(by: { $0.secondsAhead < $1.secondsAhead }),
              let limit = event.limitFeetMSL else { return nil }
        return (Double(limit), event.secondsAhead, event.title)  // feet MSL, seconds
    }

    /// The amber block's assumption line: "at 312\u{00B0}, +300 fpm" reads "If you hold 312\u{00B0} and +300 fpm".
    nonisolated static func holdText(_ assumption: String) -> String {
        guard assumption.hasPrefix("at ") else { return assumption }
        return "If you hold " + assumption.dropFirst(3).replacingOccurrences(of: ", ", with: " and ")
    }

    /// VoiceOver for a predicted event: "Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold
    /// track 312 and climb 300 feet per minute".
    nonisolated static func spokenEvent(_ event: PredictedEvent) -> String {
        let severity = event.severity == .warning ? "Warning" : "Caution"
        return "\(severity), \(spokenTitle(event.title)) in \(spokenDuration(event.secondsAhead)), "
            + spokenAssumption(event.assumption)
    }

    /// "B floor 3,000" is spoken "Class B floor 3,000 feet"; "CTR LLHA", "P 4", danger area "D 5"
    /// and alert area "A" as written. Only B, C and D standing alone or before floor/ceiling are classes.
    nonisolated static func spokenTitle(_ title: String) -> String {
        var words = title.components(separatedBy: " ")
        if let first = words.first, ["B", "C", "D"].contains(first),
           words.count == 1 || ["floor", "ceiling"].contains(words[1]) {
            words[0] = "Class \(first)"
        }
        if words.count >= 3, ["floor", "ceiling"].contains(words[words.count - 2]) {
            words.append("feet")
        }
        return words.joined(separator: " ")
    }

    /// "at 312\u{00B0}, +300 fpm" is spoken "if you hold track 312 and climb 300 feet per minute";
    /// "at 312\u{00B0}, level" "if you hold track 312 and stay level".
    nonisolated static func spokenAssumption(_ assumption: String) -> String {
        let parts = assumption.components(separatedBy: ", ")
        guard parts.count == 2, parts[0].hasPrefix("at ") else { return "assuming \(assumption)" }
        let track = parts[0].dropFirst(3).replacingOccurrences(of: "\u{00B0}", with: "")  // degrees true
        let vertical: String
        if parts[1] == "level" {
            vertical = "stay level"
        } else if parts[1].hasSuffix(" fpm"), let rate = Int(parts[1].dropLast(4)) {  // feet per minute
            vertical = "\(rate > 0 ? "climb" : "descend") \(abs(rate)) feet per minute"
        } else {
            return "assuming \(assumption)"
        }
        return "if you hold track \(track) and \(vertical)"
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
/// the nearest airport as a quiet row and a Plan a flight button. With predictions on (stage 2) the
/// predicted airspace entries join the rows in time order: the soonest item is the loud top row (an
/// amber or red block when it is an event), at most 3 later rows (2 in the rail), then "+N more".
/// Events are read from AppState on every render, so nothing is kept once they clear (stale fix, off).
struct FlightLogNext: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(FlightLogVisibility.predictionsKey) private var showsPredictions = FlightLogVisibility.predictionsDefault
    let gpsStatus: GPSStatus
    let nearestEntry: NearestAirportEntry?
    var compact: Bool = false

    /// Below 30 kt, without an ETE or on a stale fix the times are not meaningful: show "---".
    private var isQuiet: Bool {
        appState.groundSpeed < 30 || appState.estimatedTimeEnroute == nil || gpsStatus.isStale  // knots
    }

    private var route: ActiveRoute? { FlightLogStrip.followedRoute(for: appState) }

    /// Predicted entries, soonest first; none when the toggle is off or the fix is stale.
    private var events: [PredictedEvent] {
        showsPredictions && !gpsStatus.isStale ? appState.predictedEvents : []
    }

    /// The route points after the next one (Israel CVFR routes).
    private var laterLegs: [ActiveRouteLeg] {
        route.map { Array($0.legs.dropFirst($0.currentLeg + 1)) } ?? []
    }

    private var sectionDetail: String? {
        if appState.directToAirport != nil { return "direct" }
        if route != nil { return "route" }
        if appState.activeFlightPlan { return "plan" }
        return nil
    }

    var body: some View {
        let ident = FlightLogStrip.nextIdent(for: appState)
        let legs = laterLegs
        // Seconds to the next waypoint, then to each later route point; none without navigation.
        let waypointTimes: [TimeInterval?] = ident == nil ? []
            : [isQuiet ? nil : appState.estimatedTimeEnroute] + legs.indices.map { cumulativeTime(through: $0, of: legs) }
        let rows = FlightLogStrip.splitNext(
            FlightLogStrip.nextItems(events: events, waypoints: waypointTimes), laterCap: compact ? 2 : 3
        )
        VStack(alignment: .leading, spacing: 0) {
            FlightLogSectionLabel(title: "Next", detail: compact ? nil : sectionDetail)
            if let top = rows.top {
                switch top {
                case .event(let event):
                    eventBlock(event)
                case .waypoint(let index, let seconds):
                    if index == 0, let ident {
                        nextRow(ident)
                    } else {
                        waypointRow(index: index, timeTo: seconds, ident: ident, legs: legs)
                    }
                }
            }
            ForEach(rows.later) { item in
                ColumnRule()
                switch item {
                case .event(let event):
                    eventRow(event)
                case .waypoint(let index, let seconds):
                    waypointRow(index: index, timeTo: seconds, ident: ident, legs: legs)
                }
            }
            if rows.hiddenCount > 0 {
                ColumnRule()
                Text("+\(rows.hiddenCount) more" + (route?.destinationCode.map { " to \($0)" } ?? ""))
                    .font(TypeRole.data)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, compact ? Space.s : Space.m)
                    .padding(.vertical, Space.s)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("next-more-points")
            }
            if ident == nil {
                if rows.top != nil { ColumnRule() }
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

    // MARK: Predicted event block

    /// The amber (red for a warning) next-thing block: triangle, time-to in the largest type, what is met and
    /// the assumption. Day: a filled block with black (white on red) text. Night: no fill, a 5pt rule and
    /// amber (red) text on the active cell.
    private func eventBlock(_ event: PredictedEvent) -> some View {
        let warning = event.severity == .warning
        let night = colorScheme == .dark
        let accent = tone(of: event)
        let time = Text(FlightLogStrip.timeToText(event.secondsAhead))
            .font(compact ? TypeRole.rowTime : TypeRole.nextTime)
            .lineLimit(1)
            .minimumScaleFactor(compact ? 0.5 : 0.3)
        let title = Text(event.title)
            .font(TypeRole.rowIdent)
            .lineLimit(compact ? 2 : 1)
            .minimumScaleFactor(0.5)
        return VStack(alignment: .leading, spacing: Space.xs) {
            if compact {
                title
                time
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                    time
                    title
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: Space.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(FlightLogStrip.holdText(event.assumption))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(TypeRole.data)
        }
        .foregroundStyle(night ? accent : (warning ? Palette.onWarning : .black))
        .padding(compact ? Space.s : Space.m)
        .padding(.leading, night ? 5 : 0)  // points: clear of the night rule
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(night ? Palette.activeCell : (warning ? Palette.warning : Palette.cautionFill))
        .overlay(alignment: .leading) {
            if night {
                Rectangle().fill(accent).frame(width: 5)  // points
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(FlightLogStrip.spokenEvent(event))
        .accessibilityIdentifier("next-predicted-event")
    }

    /// Amber text and glyphs for a caution, red for a warning.
    private func tone(of event: PredictedEvent) -> Color {
        event.severity == .warning ? Palette.warning : Palette.caution
    }

    // MARK: Later rows

    /// Seconds to the end of `later[index]`: time to the next point plus the legs after it at ground speed.
    private func cumulativeTime(through index: Int, of later: [ActiveRouteLeg]) -> TimeInterval? {
        guard !isQuiet, let ete = appState.estimatedTimeEnroute else { return nil }
        let distance = later[...index].reduce(0) { $0 + $1.distanceNM }  // nautical miles
        return ete + distance / appState.groundSpeed * 3600
    }

    /// A predicted entry after the top row: a small diamond, the time-to in its tone, what is met and the assumption.
    private func eventRow(_ event: PredictedEvent) -> some View {
        laterLayout(timeTo: event.secondsAhead, tone: tone(of: event), title: event.title, detail: event.assumption)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(FlightLogStrip.spokenEvent(event))
            .accessibilityIdentifier("next-predicted-event-row")
    }

    /// A route point after the top row: index 0 is the next waypoint (pushed down by a sooner event),
    /// then the later route points with their published altitude and leg length.
    @ViewBuilder
    private func waypointRow(index: Int, timeTo: TimeInterval?, ident: String?, legs: [ActiveRouteLeg]) -> some View {
        if index == 0, let ident {
            laterLayout(timeTo: timeTo, tone: nil, title: ident, detail: dataText)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spokenLine(ident))
                .accessibilityIdentifier(route != nil ? "israel-route-next-point" : "next-waypoint")
        } else if legs.indices.contains(index - 1) {
            let leg = legs[index - 1]
            laterLayout(timeTo: timeTo, tone: nil, title: leg.toCode,
                        detail: "\(leg.altitudeText) FT \u{00B7} " + String(format: "%.1f NM", leg.distanceNM))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Then \(leg.toCode), \(leg.altitudeText) feet")
                .accessibilityValue(timeTo.map { "in \(FlightLogStrip.spokenDuration($0))" } ?? "no time while slow or without a fix")
        }
    }

    /// A later row: time-to in row size beside the ident and a data line (stacked in the rail); `tone` adds
    /// the predicted-event diamond and colours the time.
    private func laterLayout(timeTo: TimeInterval?, tone: Color?, title: String, detail: String) -> some View {
        let time = Text(timeTo.map(FlightLogStrip.timeToText) ?? "---")
            .font(TypeRole.rowTime)
            .foregroundStyle(timeTo == nil ? Palette.inkSecondary : (tone ?? Palette.ink))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        let text = VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(TypeRole.rowIdent)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(detail)
                .font(TypeRole.data)
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        return HStack(alignment: .center, spacing: Space.s) {
            if let tone {
                Image(systemName: "diamond.fill")
                    .font(TypeRole.data)
                    .foregroundStyle(tone)
            }
            if compact {
                VStack(alignment: .leading, spacing: 0) { text; time }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) { time; text }
            }
        }
        .padding(.horizontal, compact ? Space.s : Space.m)
        .padding(.vertical, Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
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
