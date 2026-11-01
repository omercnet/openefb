//
//  IsraelChartFeatures.swift
//  efb-212
//
//  Pure feature building for the Israel CVFR chart (IL-3): turns the CAAI data from
//  `IsraelAviationDatabaseProtocol` and the NOTAM closure feed into drawable features with their
//  label text, label placement and styling inputs. No MapLibre here: `IsraelChartOverlay` draws
//  these. Nonisolated so tests and background loads can run it off the main actor.
//
//  Symbology (docs/research/israel-cvfr.md §2): civil routes solid green, by-request routes dashed
//  green, military routes blue and flagged "MIL". Altitudes are per direction and are shown as
//  published ("2500/3500" stays text). Units: feet MSL on the controlling unit's QNH.
//

import Foundation
import CoreLocation

// MARK: - Routes

/// How a route segment is drawn.
nonisolated enum IsraelRouteStyle: String, Sendable {
    case civil        // solid: shared civil/military
    case byRequest    // dashed: real-time ATC approval needed
    case military     // blue, flagged: civil use only with IAF approval
}

/// The altitude label drawn once at the segment's midpoint, rotated to lie along the line.
nonisolated struct IsraelChartSegmentLabel: Equatable, Sendable {
    /// "→2500 / ←3000": the arrow shows which way along the drawn text the altitude applies.
    /// Published two-number text is kept verbatim ("→2500/3500").
    let text: String
    let coordinate: CLLocationCoordinate2D
    /// Clockwise degrees applied to the horizontal text image so it reads along the segment
    /// and never upside down (`iconRotation` with map alignment).
    let rotationDegrees: Double

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.text == rhs.text && lhs.rotationDegrees == rhs.rotationDegrees
            && lhs.coordinate.latitude == rhs.coordinate.latitude && lhs.coordinate.longitude == rhs.coordinate.longitude
    }
}

/// A NOTAM closure applied to a segment.
nonisolated struct IsraelChartClosureMark: Equatable, Sendable {
    let notamID: String
    /// "CLSD" plus the validity window the pilot can read at a glance ("CLSD to 13:30Z").
    let text: String
    let schedule: String?
}

nonisolated struct IsraelChartSegmentFeature: Sendable, Identifiable {
    let id: Int
    let fromCode: String
    let toCode: String
    let style: IsraelRouteStyle
    let polyline: [CLLocationCoordinate2D]
    /// nil when CAAI publishes no altitude in either direction.
    let label: IsraelChartSegmentLabel?
    /// Degrees true from -> to; closure labels rotate with it.
    let bearingTrue: Double
}

// MARK: - Points

nonisolated struct IsraelChartPointFeature: Sendable, Identifiable {
    let id: Int
    let code: String
    let kind: IsraelPointKind
    let coordinate: CLLocationCoordinate2D
}

// MARK: - Airspace

nonisolated struct IsraelChartAirspaceFeature: Sendable, Identifiable {
    let id: Int
    let kind: IsraelAirspaceKind
    /// P/R/D: drawn in the restricted (amber caution) colour, every other kind in airspace blue.
    let isRestricted: Bool
    /// Chart label: code or name, e.g. "LLHA CTR", "LLP11".
    let title: String
    /// "SFC–3000", "1500–FL95", "SFC–UNL". Empty when the source publishes no limits.
    let limits: String
    let labelCoordinate: CLLocationCoordinate2D
    let polygons: [[[CLLocationCoordinate2D]]]
}

// MARK: - Runways

nonisolated struct IsraelChartRunwayFeature: Sendable, Identifiable {
    let id: Int
    let aerodrome: String?
    let endA: CLLocationCoordinate2D
    let endB: CLLocationCoordinate2D
}

// MARK: - Closures

/// Closed segments derived from the NOTAM feed, with the freshness that decides whether they may
/// be drawn at all.
nonisolated struct IsraelChartClosureSet: Sendable {
    /// Segment id -> closure mark. Empty when the feed is stale, absent, or closes nothing.
    let marks: [Int: IsraelChartClosureMark]
    /// When the relay scraped the IAA (nil when no feed).
    let generatedAt: Date?
    let freshness: FreshnessLevel

    static let none = IsraelChartClosureSet(marks: [:], generatedAt: nil, freshness: .unknown)
}

/// A closed segment as drawn: red casing along the polyline and a "CLSD" label at its midpoint.
nonisolated struct IsraelChartClosureFeature: Sendable, Identifiable {
    var id: Int { segmentID }
    let segmentID: Int
    let polyline: [CLLocationCoordinate2D]
    let mark: IsraelChartClosureMark
    let labelCoordinate: CLLocationCoordinate2D
    let rotationDegrees: Double
}

/// In-memory CVFR network for the closure mapper: points by code, segments by (from, to).
nonisolated struct IsraelChartNetwork: IsraelRouteSegmentLookup, Sendable {
    typealias Segment = IsraelRouteSegment

    private let pointCodes: Set<String>
    private let segmentsByCodes: [String: IsraelRouteSegment]

    init(points: [IsraelReportingPoint], segments: [IsraelRouteSegment]) {
        pointCodes = Set(points.map { $0.code.uppercased() })
        var byCodes: [String: IsraelRouteSegment] = [:]
        for segment in segments {
            byCodes[Self.key(segment.fromCode, segment.toCode)] = segment
        }
        segmentsByCodes = byCodes
    }

    func knowsPoint(_ code: String) -> Bool { pointCodes.contains(code.uppercased()) }

    func segment(from: String, to: String) -> IsraelRouteSegment? {
        segmentsByCodes[Self.key(from, to)]
    }

    private static func key(_ from: String, _ to: String) -> String { from.uppercased() + ">" + to.uppercased() }
}

// MARK: - Builder

nonisolated enum IsraelChartFeatureBuilder {

    /// Closures older than this (by the relay's scrape time) are never drawn: the pilot sees the
    /// staleness badge and nothing on the map. `DataProduct.notam` expires at 6 h.
    static let drawableFreshness: Set<FreshnessLevel> = [.fresh, .old]

    /// Only CVFR route closures belong on this chart (helicopter, ultralight and ATS routes are
    /// other networks that share the point codes).
    static let chartRouteKind = "CVFR"

    // MARK: Routes

    static func routeStyle(_ segment: IsraelRouteSegment) -> IsraelRouteStyle {
        if segment.isMilitary { return .military }
        if segment.isByRequest { return .byRequest }
        return .civil
    }

    /// Label text and rotation for the published altitudes. `bearing` is degrees true from -> to.
    /// Returns nil when neither direction has a published altitude.
    static func segmentLabel(
        forward: IsraelRouteAltitude?,
        reverse: IsraelRouteAltitude?,
        bearingTrue: Double,
        at coordinate: CLLocationCoordinate2D,
        military: Bool
    ) -> IsraelChartSegmentLabel? {
        guard forward != nil || reverse != nil else { return nil }
        let bearing = normalizedDegrees(bearingTrue)
        // Text drawn along the line reads left-to-right in the from -> to direction when that
        // direction is eastward (0...180). Westward segments flip the text so it is never upside
        // down, and the arrows swap with it: "→" always means "the direction the text runs".
        let readsForward = bearing <= 180
        let rotation = textRotation(bearingTrue: bearing)
        let along = readsForward ? forward : reverse
        let against = readsForward ? reverse : forward
        var parts: [String] = []
        if let along { parts.append("\u{2192}" + along.published) }
        if let against { parts.append("\u{2190}" + against.published) }
        var text = parts.joined(separator: " / ")
        if military { text += "  MIL" }
        return IsraelChartSegmentLabel(text: text, coordinate: coordinate, rotationDegrees: rotation)
    }

    /// Clockwise degrees that make horizontal text read along a line with this bearing, flipped
    /// so it is never upside down.
    static func textRotation(bearingTrue: Double) -> Double {
        let bearing = normalizedDegrees(bearingTrue)
        return bearing <= 180 ? bearing - 90 : bearing - 270
    }

    /// The point halfway along the polyline's length (not the middle vertex, which can sit at a
    /// bend near one end).
    static func midpoint(of polyline: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D? {
        guard let first = polyline.first else { return nil }
        guard polyline.count > 1 else { return first }
        var lengths: [Double] = []
        var total = 0.0
        for (a, b) in zip(polyline, polyline.dropFirst()) {
            let d = MapQueryRegion.haversineNM(from: a, to: b)
            lengths.append(d)
            total += d
        }
        guard total > 0 else { return first }
        var remaining = total / 2
        for (index, length) in lengths.enumerated() {
            if remaining <= length {
                let t = length > 0 ? remaining / length : 0
                let a = polyline[index], b = polyline[index + 1]
                return CLLocationCoordinate2D(
                    latitude: a.latitude + (b.latitude - a.latitude) * t,
                    longitude: a.longitude + (b.longitude - a.longitude) * t
                )
            }
            remaining -= length
        }
        return polyline[polyline.count - 1]
    }

    static func segmentFeatures(_ segments: [IsraelRouteSegment]) -> [IsraelChartSegmentFeature] {
        segments.compactMap { segment in
            guard segment.polyline.count >= 2 else { return nil }
            let style = routeStyle(segment)
            let label = midpoint(of: segment.polyline).flatMap { mid in
                segmentLabel(
                    forward: segment.altitudeForward, reverse: segment.altitudeReverse,
                    bearingTrue: segment.bearingTrue, at: mid, military: style == .military
                )
            }
            return IsraelChartSegmentFeature(
                id: segment.id, fromCode: segment.fromCode, toCode: segment.toCode, style: style,
                polyline: segment.polyline, label: label, bearingTrue: segment.bearingTrue
            )
        }
    }

    /// Closed segments with their labels. Segments not in `segments` (outside the loaded data) are skipped.
    static func closureFeatures(
        _ segments: [IsraelChartSegmentFeature],
        marks: [Int: IsraelChartClosureMark]
    ) -> [IsraelChartClosureFeature] {
        segments.compactMap { segment in
            guard let mark = marks[segment.id], let mid = midpoint(of: segment.polyline) else { return nil }
            return IsraelChartClosureFeature(
                segmentID: segment.id, polyline: segment.polyline, mark: mark, labelCoordinate: mid,
                rotationDegrees: textRotation(bearingTrue: segment.bearingTrue)
            )
        }
    }

    // MARK: Points

    static func pointFeatures(_ points: [IsraelReportingPoint]) -> [IsraelChartPointFeature] {
        points.map { IsraelChartPointFeature(id: $0.id, code: $0.code, kind: $0.kind, coordinate: $0.coordinate) }
    }

    // MARK: Airspace

    /// One vertical limit as chart text: "SFC", "UNL", "FL95", "3000", or the published two-number text.
    static func limitText(_ limit: IsraelAirspaceLimit) -> String? {
        if let text = limit.publishedText, !text.isEmpty { return text }
        switch limit.reference {
        case .surface: return "SFC"
        case .unlimited: return "UNL"
        case .flightLevel:
            guard let feet = limit.feet else { return "FL" }
            return "FL" + String(feet / 100)
        case .agl:
            guard let feet = limit.feet else { return nil }
            return "\(feet) AGL"
        case .msl, nil:
            guard let feet = limit.feet else { return nil }
            return feet == 0 ? "SFC" : String(feet)
        }
    }

    /// "SFC–3000"; "" when neither limit is published (the tap sheet then says so).
    static func limitsText(floor: IsraelAirspaceLimit, ceiling: IsraelAirspaceLimit) -> String {
        let f = limitText(floor), c = limitText(ceiling)
        switch (f, c) {
        case let (f?, c?): return f + "\u{2013}" + c
        case let (f?, nil): return f + "\u{2013}?"
        case let (nil, c?): return "?\u{2013}" + c
        case (nil, nil): return ""
        }
    }

    static func airspaceTitle(_ airspace: IsraelAirspace) -> String {
        switch airspace.kind {
        case .prohibited, .restricted, .danger:
            return airspace.code ?? airspace.nameEnglish ?? airspace.kind.rawValue
        case .tma:
            // The published chart label ("LLBG TMA 2 500 - 8 000") already holds the limits the map
            // draws on the second line; it stays available as raw text in the tap sheet.
            return [airspace.code, "TMA"].compactMap { $0 }.joined(separator: " ")
        case .ctr, .atz, .cta, .fir:
            if let code = airspace.code { return code + " " + airspace.kind.rawValue }
            return airspace.nameEnglish.map { $0 + " " + airspace.kind.rawValue } ?? airspace.kind.rawValue
        }
    }

    static func isRestricted(_ kind: IsraelAirspaceKind) -> Bool {
        switch kind {
        case .prohibited, .restricted, .danger: return true
        case .ctr, .atz, .cta, .tma, .fir: return false
        }
    }

    /// Vertex average of the outer ring of the first polygon: good enough for a label anchor.
    static func labelAnchor(_ polygons: [[[CLLocationCoordinate2D]]]) -> CLLocationCoordinate2D? {
        guard let ring = polygons.first?.first, !ring.isEmpty else { return nil }
        let lat = ring.reduce(0.0) { $0 + $1.latitude } / Double(ring.count)
        let lon = ring.reduce(0.0) { $0 + $1.longitude } / Double(ring.count)
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// The FIR boundary is the whole country: it is not drawn as an airspace.
    static func airspaceFeatures(_ airspaces: [IsraelAirspace]) -> [IsraelChartAirspaceFeature] {
        airspaces.compactMap { airspace in
            guard airspace.kind != .fir, let anchor = labelAnchor(airspace.polygons) else { return nil }
            return IsraelChartAirspaceFeature(
                id: airspace.id, kind: airspace.kind, isRestricted: isRestricted(airspace.kind),
                title: airspaceTitle(airspace),
                limits: limitsText(floor: airspace.floor, ceiling: airspace.ceiling),
                labelCoordinate: anchor, polygons: airspace.polygons
            )
        }
    }

    // MARK: Runways

    static func runwayFeatures(_ runways: [IsraelRunway]) -> [IsraelChartRunwayFeature] {
        runways.map { IsraelChartRunwayFeature(id: $0.id, aerodrome: $0.aerodrome, endA: $0.endA, endB: $0.endB) }
    }

    // MARK: Closures

    /// Map the feed's CVFR closures onto the network. A feed whose scrape time is past the NOTAM
    /// expiry, or absent, yields no marks: an old closure set must never read as current.
    static func closures(
        from report: IsraelNotamReport?,
        network: IsraelChartNetwork,
        now: Date = Date()
    ) -> IsraelChartClosureSet {
        guard let report else { return .none }
        let freshness = report.freshness(now: now).level
        guard drawableFreshness.contains(freshness) else {
            return IsraelChartClosureSet(marks: [:], generatedAt: report.feed.generatedAt, freshness: freshness)
        }
        // Past its useful life but not expired: still drawn, and every label says how old the data is.
        let ageNote = freshness == .old ? dataAgeText(report.feed.generatedAt, now: now) : nil
        let cvfr = report.feed.closures.filter { $0.routeKind.uppercased() == chartRouteKind }
        let mapping = IsraelNotamClosureMapper.map(cvfr, using: network, at: now)
        var marks: [Int: IsraelChartClosureMark] = [:]
        for match in mapping.matches {
            let mark = IsraelChartClosureMark(
                notamID: match.closure.notamId,
                text: closureText(match.closure, now: now, dataAge: ageNote),
                schedule: match.closure.schedule
            )
            for segment in match.segments where marks[segment.id] == nil {
                marks[segment.id] = mark
            }
        }
        return IsraelChartClosureSet(marks: marks, generatedAt: report.feed.generatedAt, freshness: freshness)
    }

    /// "1h20m", "45m": age of the relay's scrape.
    static func dataAgeText(_ generatedAt: Date, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(generatedAt) / 60))
        return minutes >= 60 ? "\(minutes / 60)h\(String(format: "%02d", minutes % 60))m" : "\(minutes)m"
    }

    /// "CLSD to 13:30Z", "CLSD to 3 Nov 13:30Z" (end on another UTC day), "CLSD" (no end); with
    /// `dataAge`, "CLSD to 13:30Z (data 1h20m old)".
    static func closureText(_ closure: IsraelRouteClosure, now: Date, dataAge: String? = nil) -> String {
        var text = "CLSD"
        if let end = closure.validTo {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
            let sameDay = calendar.isDate(end, inSameDayAs: now)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = sameDay ? "HH:mm'Z'" : "d MMM HH:mm'Z'"
            text += " to " + formatter.string(from: end)
        }
        if let dataAge { text += " (data \(dataAge) old)" }
        return text
    }

    // MARK: Helpers

    static func normalizedDegrees(_ value: Double) -> Double {
        let r = value.truncatingRemainder(dividingBy: 360)
        return r < 0 ? r + 360 : r
    }
}

/// Which CVFR chart layers are on by default (IL-3 / IL-9).
@MainActor
enum IsraelChartDefaults {
    /// Official CAAI chart shown: closures, plus reporting-point and airspace tap targets (drawn
    /// invisible). Routes, altitude labels, airspace fills and runways are off. Street base: everything on.
    static func visibleLayers(officialChartPresent: Bool) -> Set<MapLayer> {
        officialChartPresent ? [.cvfrClosures, .cvfrPoints] : Set(MapLayer.cvfrChart)
    }
}

// MARK: - Aerodromes (IL-4)

nonisolated extension IsraelChartFeatureBuilder {
    /// Aerodromes with no ARP reporting point on the chart (those are already drawn as points).
    static func aerodromesWithoutPoint(_ aerodromes: [IsraelAerodrome], points: [IsraelReportingPoint]) -> [IsraelAerodrome] {
        let codes = Set(points.filter { $0.kind == .arp }.map { $0.code.uppercased() })
        return aerodromes.filter { $0.use != .foreign && !codes.contains($0.code.uppercased()) }
    }

    /// Code label; "*" marks an entry the curator has not reviewed, so the pilot knows to check the AIP.
    static func aerodromeLabel(_ aerodrome: IsraelAerodrome) -> String {
        aerodrome.isReviewed ? aerodrome.code : aerodrome.code + "*"
    }
}
