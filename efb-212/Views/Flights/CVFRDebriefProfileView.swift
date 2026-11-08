//
//  CVFRDebriefProfileView.swift
//  efb-212
//
//  The unrolled CVFR debrief (Direction 2, stage 2): the flight on one distance axis in three bands. ROUTE is
//  the straightened route with the reporting points; ALTITUDE is the published altitude per leg with its ±200 ft
//  band against the flown altitude, scored stretches outside the band in amber and aerodrome zones hatched as not
//  scored; RADIO is the position report at each point. Times are labels at the waypoints. No overall score: the
//  verdict line names at most the two findings to look at. Every number comes from CVFRDebriefBuilder.
//
//  Units: nautical miles along the route (x), feet MSL (y).
//

import SwiftUI

struct CVFRDebriefProfileView: View {
    let debrief: CVFRDebrief

    @Environment(\.colorScheme) private var colorScheme

    /// A reporting point on the axis; `passage` is nil when the point is missing from the database.
    private struct Stop {
        let code: String
        let distanceNM: Double
        let passage: CVFRPointPassage?
    }

    private let totalNM: Double
    private let stops: [Stop]
    /// Not-scored aerodrome zones on the axis -- nautical miles.
    private let zones: [ClosedRange<Double>]
    private let excursions: [CVFRAltitudeExcursion]
    private let longest: CVFRAltitudeExcursion?
    private let findings: [String]
    /// Published altitudes per leg (one or two numbers) -- feet MSL.
    private let published: [[Double]]
    /// Altitude band's vertical range -- feet MSL.
    private let altitudeRange: ClosedRange<Double>

    /// Room at each end of the axis for edge labels and the altitude scale -- points.
    private static let inset: CGFloat = 44
    /// Labels closer than this share a row only if staggered -- points.
    private static let labelSpacing: CGFloat = 84
    private static let routeHeight: CGFloat = 132
    private static let altitudeHeight: CGFloat = 220
    private static let radioHeight: CGFloat = 104
    /// The altitude band reserves this much at the bottom for the waypoint times -- points.
    private static let timeRowHeight: CGFloat = 24

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    init(debrief: CVFRDebrief) {
        self.debrief = debrief
        totalNM = debrief.legs.last?.endDistanceNM ?? 0
        stops = CVFRDebriefBuilder.routeStops(of: debrief.legs).map { stop in
            Stop(code: stop.code, distanceNM: stop.distanceNM,
                 passage: debrief.points.first { $0.code == stop.code && $0.distanceAlongRouteNM == stop.distanceNM })
        }
        var zones: [ClosedRange<Double>] = []
        var zoneStart: Double?
        var zoneEnd = 0.0
        for sample in debrief.profile {
            if sample.excluded {
                if zoneStart == nil { zoneStart = sample.distanceNM }
                zoneEnd = sample.distanceNM
            } else if let start = zoneStart {
                zones.append(start...zoneEnd)
                zoneStart = nil
            }
        }
        if let start = zoneStart { zones.append(start...zoneEnd) }
        self.zones = zones
        excursions = CVFRDebriefBuilder.excursions(in: debrief)
        longest = CVFRDebriefVerdict.longest(excursions)
        findings = CVFRDebriefVerdict.findings(debrief)
        published = debrief.legs.map { $0.publishedAltitude.map(CVFRDebriefBuilder.publishedAltitudes) ?? [] }
        let band = CVFRDebriefBuilder.tightBandFeet
        let altitudes = debrief.profile.map(\.altitudeFeet) + published.flatMap { $0.flatMap { [$0 - band, $0 + band] } }
        let low = ((altitudes.min() ?? 0) - band) / 500
        let high = ((altitudes.max() ?? 1000) + band) / 500
        altitudeRange = (low.rounded(.down) * 500)...max(low.rounded(.down) * 500 + 1000, high.rounded(.up) * 500)
    }

    var body: some View {
        if totalNM > 0 {
            VStack(alignment: .leading, spacing: Space.m) {
                verdict
                band("Route", detail: "straightened", height: Self.routeHeight, summary: routeSummary, draw: drawRoute)
                band("Altitude", detail: "published ±200 ft, flown", height: Self.altitudeHeight, summary: altitudeSummary, draw: drawAltitude)
                band("Radio", detail: "position report at each point", height: Self.radioHeight, summary: radioSummary, draw: drawRadio)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("cvfr-profile")
        }
    }

    // MARK: Verdict

    private var verdict: some View {
        let headline = Text(CVFRDebriefVerdict.headline(count: findings.count))
            .font(TypeRole.identifier)
            .foregroundStyle(Palette.ink)
        let notChecked = Text("Reports not checked: no transcript.")
            .font(TypeRole.caption)
            .foregroundStyle(Palette.inkSecondary)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: Space.s) {
                headline
                ForEach(findings, id: \.self) { chip($0) }
                if !debrief.transcriptAvailable { notChecked }
            }
            VStack(alignment: .leading, spacing: Space.s) {
                headline
                ForEach(findings, id: \.self) { chip($0) }
                if !debrief.transcriptAvailable { notChecked }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("cvfr-verdict")
    }

    /// Amber rule and amber type, day and night (no filled amber block); the triangle keeps it from being colour only.
    private func chip(_ text: String) -> some View {
        HStack(spacing: Space.xs) {
            Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
            Text(text)
        }
        .font(TypeRole.dataEmphasis)
        .foregroundStyle(Palette.caution)
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.s)
        .overlay(RoundedRectangle(cornerRadius: Radius.s).strokeBorder(Palette.caution, lineWidth: 1.5))
        .accessibilityLabel("Caution: \(text)")
    }

    // MARK: Bands

    private func band(
        _ title: String, detail: String, height: CGFloat, summary: String,
        draw: @escaping (inout GraphicsContext, CGSize) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.s) {
                Text(title)
                    .font(TypeRole.stripLabel)
                    .textCase(.uppercase)
                    .tracking(StripMetrics.labelTracking)
                    .foregroundStyle(Palette.ink)
                Text(detail)
                    .font(TypeRole.stripLabel)
                    .foregroundStyle(Palette.inkSecondary)
            }
            Canvas { context, size in draw(&context, size) }
                .frame(height: height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
    }

    /// x for a distance along the route -- points.
    private func x(_ distanceNM: Double, _ size: CGSize) -> CGFloat {
        Self.inset + CGFloat(distanceNM / totalNM) * (size.width - 2 * Self.inset)
    }

    /// Row 0 unless the previous label on row 0 is too close, then row 1 (and back).
    private func labelRows(_ size: CGSize) -> [Int] {
        var rows: [Int] = []
        var lastX: [CGFloat] = [-.infinity, -.infinity]
        for stop in stops {
            let position = x(stop.distanceNM, size)
            let row = position - lastX[0] >= Self.labelSpacing ? 0 : 1
            rows.append(row)
            lastX[row] = position
        }
        return rows
    }

    private func drawZones(_ context: GraphicsContext, top: CGFloat, bottom: CGFloat, size: CGSize) {
        for zone in zones {
            let rect = CGRect(x: x(zone.lowerBound, size), y: top,
                              width: max(1, x(zone.upperBound, size) - x(zone.lowerBound, size)), height: bottom - top)
            var hatched = context
            hatched.clip(to: Path(rect))
            var lines = Path()
            var start = rect.minX - rect.height
            while start < rect.maxX {
                lines.move(to: CGPoint(x: start, y: rect.maxY))
                lines.addLine(to: CGPoint(x: start + rect.height, y: rect.minY))
                start += 7
            }
            hatched.stroke(lines, with: .color(Palette.inkSecondary.opacity(0.5)), lineWidth: 1)
        }
    }

    private func drawWaypointRules(_ context: GraphicsContext, top: CGFloat, bottom: CGFloat, size: CGSize) {
        for stop in stops {
            var rule = Path()
            rule.move(to: CGPoint(x: x(stop.distanceNM, size), y: top))
            rule.addLine(to: CGPoint(x: x(stop.distanceNM, size), y: bottom))
            context.stroke(rule, with: .color(Palette.inkSecondary), style: StrokeStyle(lineWidth: 1, dash: [2, 4]))
        }
    }

    // MARK: Route band

    private func drawRoute(_ context: inout GraphicsContext, _ size: CGSize) {
        let lineY: CGFloat = 28
        drawZones(context, top: 0, bottom: size.height, size: size)
        var route = Path()
        route.move(to: CGPoint(x: x(0, size), y: lineY))
        route.addLine(to: CGPoint(x: x(totalNM, size), y: lineY))
        context.stroke(route, with: .color(Palette.route), lineWidth: 4)

        let rows = labelRows(size)
        for (stop, row) in zip(stops, rows) {
            let center = CGPoint(x: x(stop.distanceNM, size), y: lineY)
            let glyph: Path
            if CVFRDebriefBuilder.isAerodromeCode(stop.code) {
                glyph = Path(ellipseIn: CGRect(x: center.x - 7, y: center.y - 7, width: 14, height: 14))
            } else {
                var triangle = Path()
                triangle.move(to: CGPoint(x: center.x, y: center.y - 10))
                triangle.addLine(to: CGPoint(x: center.x + 9, y: center.y + 7))
                triangle.addLine(to: CGPoint(x: center.x - 9, y: center.y + 7))
                triangle.closeSubpath()
                glyph = triangle
            }
            context.fill(glyph, with: .color(Palette.activeCell))
            context.stroke(glyph, with: .color(Palette.ink), lineWidth: 2.5)

            let labelY = lineY + 16 + CGFloat(row) * 40
            context.draw(Text(stop.code).font(TypeRole.dataEmphasis).foregroundStyle(Palette.ink),
                         at: CGPoint(x: center.x, y: labelY), anchor: .top)
            if let hebrew = stop.passage?.nameHebrew {
                context.draw(Text(hebrew).font(TypeRole.caption).foregroundStyle(Palette.inkSecondary),
                             at: CGPoint(x: center.x, y: labelY + 19), anchor: .top)
            }
        }
    }

    // MARK: Altitude band

    private func drawAltitude(_ context: inout GraphicsContext, _ size: CGSize) {
        let top: CGFloat = 8
        let bottom = size.height - Self.timeRowHeight
        let span = altitudeRange.upperBound - altitudeRange.lowerBound
        func y(_ feet: Double) -> CGFloat { bottom - CGFloat((feet - altitudeRange.lowerBound) / span) * (bottom - top) }

        // Thousand-foot rules, labelled at the trailing end ("2k").
        var feet = (altitudeRange.lowerBound / 1000).rounded(.up) * 1000
        while feet <= altitudeRange.upperBound {
            var rule = Path()
            rule.move(to: CGPoint(x: x(0, size), y: y(feet)))
            rule.addLine(to: CGPoint(x: x(totalNM, size), y: y(feet)))
            context.stroke(rule, with: .color(Palette.rule), lineWidth: 1)
            context.draw(Text("\(Int(feet / 1000))k").font(TypeRole.stripLabel).foregroundStyle(Palette.inkSecondary),
                         at: CGPoint(x: x(totalNM, size) + 6, y: y(feet)), anchor: .leading)
            feet += 1000
        }
        drawZones(context, top: top, bottom: bottom, size: size)
        for zone in zones {
            let mid = x((zone.lowerBound + zone.upperBound) / 2, size)
            context.draw(Text("not scored").font(TypeRole.stripLabel).foregroundStyle(Palette.inkSecondary),
                         at: CGPoint(x: mid, y: top), anchor: .top)
        }

        // Published altitude: ±200 ft band, then the magenta step line (risers between legs on the first number).
        let band = CVFRDebriefBuilder.tightBandFeet
        var step = Path()
        for (leg, values) in zip(debrief.legs, published) {
            let x0 = x(leg.startDistanceNM, size), x1 = x(leg.endDistanceNM, size)
            for value in values {
                context.fill(Path(CGRect(x: x0, y: y(value + band), width: x1 - x0, height: y(value - band) - y(value + band))),
                             with: .color(Palette.route.opacity(0.12)))
            }
            guard let first = values.first else { continue }
            if step.isEmpty { step.move(to: CGPoint(x: x0, y: y(first))) } else { step.addLine(to: CGPoint(x: x0, y: y(first))) }
            step.addLine(to: CGPoint(x: x1, y: y(first)))
            for value in values.dropFirst() {
                var second = Path()
                second.move(to: CGPoint(x: x0, y: y(value)))
                second.addLine(to: CGPoint(x: x1, y: y(value)))
                context.stroke(second, with: .color(Palette.route), lineWidth: 2.5)
            }
        }
        context.stroke(step, with: .color(Palette.route), lineWidth: 2.5)

        // Scored stretches outside ±200 ft: amber between the band edge and the trace. Night: amber rule, no fill.
        let profile = debrief.profile
        for excursion in excursions {
            let samples = profile[excursion.sampleRange]
            guard let first = samples.first, let last = samples.last,
                  published.indices.contains(excursion.legIndex), !published[excursion.legIndex].isEmpty else { continue }
            let reference = first.altitudeFeet - CVFRDebriefBuilder.deviationFeet(altitude: first.altitudeFeet, published: published[excursion.legIndex])
            let edge = reference + (excursion.deviationFeet > 0 ? band : -band)
            var area = Path()
            area.move(to: CGPoint(x: x(first.distanceNM, size), y: y(edge)))
            for sample in samples { area.addLine(to: CGPoint(x: x(sample.distanceNM, size), y: y(sample.altitudeFeet))) }
            area.addLine(to: CGPoint(x: x(last.distanceNM, size), y: y(edge)))
            area.closeSubpath()
            if colorScheme != .dark { context.fill(area, with: .color(Palette.cautionFill)) }
            context.stroke(area, with: .color(Palette.caution), lineWidth: 1.5)
        }

        // Flown altitude in ink.
        var trace = Path()
        for sample in profile {
            let point = CGPoint(x: x(sample.distanceNM, size), y: y(sample.altitudeFeet))
            if trace.isEmpty { trace.move(to: point) } else { trace.addLine(to: point) }
        }
        context.stroke(trace, with: .color(Palette.ink), style: StrokeStyle(lineWidth: 2.2, lineJoin: .round))

        drawWaypointRules(context, top: top, bottom: bottom, size: size)
        for (index, stop) in stops.enumerated() {
            guard let time = stop.passage?.time else { continue }
            let isLast = index == stops.count - 1
            context.draw(Text(Self.timeFormatter.string(from: time)).font(TypeRole.data).foregroundStyle(Palette.inkSecondary),
                         at: CGPoint(x: x(stop.distanceNM, size) + (isLast ? 0 : 4), y: size.height),
                         anchor: isLast ? .bottomTrailing : .bottomLeading)
        }

        // The longest stretch carries its label: "330 ft low · 4:02".
        if let longest, let first = profile[longest.sampleRange].first, let last = profile[longest.sampleRange].last {
            let label = context.resolve(Text("\(CVFRDebriefVerdict.deviationText(longest.deviationFeet)) · \(FlightLogStrip.timeToText(longest.seconds))")
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.caution))
            let measured = label.measure(in: size)
            let width = measured.width + 2 * Space.s, height = measured.height + Space.s
            let midX = min(max(x((first.distanceNM + last.distanceNM) / 2, size), width / 2), size.width - width / 2)
            let low = longest.deviationFeet < 0
            let extreme = profile[longest.sampleRange].map(\.altitudeFeet)
            let anchorY = low ? y(extreme.min() ?? first.altitudeFeet) + 6 : y(extreme.max() ?? first.altitudeFeet) - 6 - height
            let box = CGRect(x: midX - width / 2, y: min(max(top, anchorY), bottom - height), width: width, height: height)
            let shape = RoundedRectangle(cornerRadius: Radius.s).path(in: box)
            context.fill(shape, with: .color(Palette.activeCell))
            context.stroke(shape, with: .color(Palette.caution), lineWidth: 2)
            context.draw(label, at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
        }
    }

    // MARK: Radio band

    private func drawRadio(_ context: inout GraphicsContext, _ size: CGSize) {
        let rows = labelRows(size)
        for (stop, row) in zip(stops, rows) {
            guard let passage = stop.passage else { continue }
            let center = x(stop.distanceNM, size)
            let rowY = 4 + CGFloat(row) * 50
            context.draw(Text(stop.code).font(TypeRole.dataEmphasis).foregroundStyle(Palette.ink),
                         at: CGPoint(x: center, y: rowY), anchor: .top)
            let statusY = rowY + 22
            if !debrief.transcriptAvailable {
                context.draw(Text("not checked").font(TypeRole.caption).foregroundStyle(Palette.inkSecondary),
                             at: CGPoint(x: center, y: statusY), anchor: .top)
            } else if passage.reported {
                let heard = passage.reportTime.map { "heard \(Self.timeFormatter.string(from: $0))" } ?? "heard"
                context.draw(Text(heard).font(TypeRole.data).foregroundStyle(Palette.ok),
                             at: CGPoint(x: center, y: statusY), anchor: .top)
            } else if !CVFRDebriefBuilder.isAerodromeCode(stop.code) {
                // Amber rule and amber type: the same chip day and night.
                let label = context.resolve(Text("\u{25B2} not heard").font(TypeRole.dataEmphasis).foregroundStyle(Palette.caution))
                let measured = label.measure(in: size)
                let box = CGRect(x: center - measured.width / 2 - Space.s, y: statusY,
                                 width: measured.width + 2 * Space.s, height: measured.height + Space.xs * 2)
                context.stroke(RoundedRectangle(cornerRadius: Radius.s).path(in: box), with: .color(Palette.caution), lineWidth: 1.5)
                context.draw(label, at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
            }
        }
    }

    // MARK: Accessibility (one summary per band)

    private var routeSummary: String {
        let points = stops.map { "\($0.code) at \(Int($0.distanceNM.rounded())) nautical miles" }.joined(separator: ", ")
        return "Route, \(Int(totalNM.rounded())) nautical miles: \(points)."
    }

    private var altitudeSummary: String {
        var parts = debrief.legs.map { leg -> String in
            let name = "\(leg.fromCode) to \(leg.toCode)"
            guard let altitude = leg.publishedAltitude else { return "\(name), no published altitude" }
            guard let adherence = leg.adherence else { return "\(name), published \(altitude) feet, not measured" }
            let low = adherence.fractionWithin300 < CVFRDebriefVerdict.lowLegFraction ? ", caution" : ""
            return "\(name), published \(altitude) feet, \(CVFRDebriefBuilder.percent(adherence.fractionWithin200)) within 200 feet\(low)"
        }
        if let longest, debrief.legs.indices.contains(longest.legIndex) {
            let leg = debrief.legs[longest.legIndex]
            parts.append("Longest stretch outside the band: \(CVFRDebriefVerdict.deviationText(longest.deviationFeet)) for \(FlightLogStrip.spokenDuration(longest.seconds)) on \(leg.fromCode) to \(leg.toCode)")
        }
        if !zones.isEmpty { parts.append("Aerodrome zones are not scored") }
        return "Altitude. " + parts.joined(separator: ". ") + "."
    }

    private var radioSummary: String {
        guard debrief.transcriptAvailable else { return "Radio. Position reports not checked: no transcript." }
        let parts = stops.compactMap { stop -> String? in
            guard let passage = stop.passage else { return nil }
            if passage.reported {
                return passage.reportTime.map { "\(stop.code) heard at \(Self.timeFormatter.string(from: $0))" } ?? "\(stop.code) heard"
            }
            return CVFRDebriefBuilder.isAerodromeCode(stop.code) ? nil : "\(stop.code) not heard"
        }
        return "Radio. " + (parts.isEmpty ? "No reporting points." : parts.joined(separator: ", ") + ".")
    }
}
