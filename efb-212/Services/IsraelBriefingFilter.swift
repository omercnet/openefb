//
//  IsraelBriefingFilter.swift
//  efb-212
//
//  Pure filtering and ordering for the Israel NOTAM briefing (IL-BRIEF): flight window, distance from
//  the route or ownship, aerodrome, and the closures-first order. No UI and no I/O.
//

import Foundation

// MARK: - Inputs

/// The planned route as the briefing needs it.
nonisolated struct BriefingRoute: Equatable, Sendable {
    /// Point codes in order, departure first (reporting points and ICAO aerodromes).
    var codes: [String]
    var points: [IsraelLatLon]
    /// Planned off-block time; nil when there is no plan (active route only).
    var departure: Date?
    var eteSeconds: TimeInterval?
    /// The route network the plan is flown on; decides which route closures count as closures for this pilot.
    var network: IsraelRouteNetwork = .cvfr

    /// 4-letter ICAO codes on the route: the aerodromes whose NOTAMs matter next.
    var aerodromes: Set<String> {
        Set(codes.map { $0.uppercased() }.filter { $0.count == 4 && $0.hasPrefix("LL") })
    }
}

/// When the pilot will be flying. A NOTAM is relevant when its validity overlaps this window.
nonisolated struct BriefingWindow: Equatable, Sendable {
    let start: Date
    let end: Date

    static let defaultLength: TimeInterval = 3 * 3600  // seconds

    /// Planned departure plus ETE when the plan has both, otherwise now to +3 h.
    static func flight(route: BriefingRoute?, now: Date) -> BriefingWindow {
        if let departure = route?.departure, let ete = route?.eteSeconds, ete > 0 {
            return BriefingWindow(start: departure, end: departure.addingTimeInterval(ete))
        }
        return BriefingWindow(start: now, end: now.addingTimeInterval(defaultLength))
    }

    /// PERM is always valid; otherwise the validity interval must touch the window. A missing end means open-ended.
    func includes(_ notam: IsraelNotam) -> Bool {
        if notam.permanent { return true }
        let from = notam.validFrom ?? .distantPast
        let to = notam.validTo ?? .distantFuture
        return from <= end && to >= start
    }
}

nonisolated enum BriefingReference: Equatable, Sendable {
    case none
    case route(BriefingRoute)
    case ownship(IsraelLatLon)
}

nonisolated struct BriefingQuery: Equatable, Sendable {
    var window: BriefingWindow
    var reference: BriefingReference = .none
    /// Corridor half-width around the route or ownship -- nautical miles.
    var corridorNM: Double = 25
    /// ICAO location filter ("LLHZ"); empty = all.
    var aerodrome: String = ""
    /// Aerodromes on the planned route; their NOTAMs sort right after the closures.
    var routeAerodromes: Set<String> = []
    /// The pilot's route network: only closures of its route kinds are red or amber.
    var network: IsraelRouteNetwork = .cvfr
}

// MARK: - Output

/// How a NOTAM's route closures are ranked: red full, amber partial, then unreadable ("check NOTAM").
nonisolated enum BriefingClosureClass: Int, Comparable, Sendable {
    case full = 0
    case partial
    case check
    case none

    static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

nonisolated enum BriefingSection: Int, CaseIterable, Sendable {
    case closures = 0
    case routeAerodromes
    case other

    var title: String {
        switch self {
        case .closures: return "Closures"
        case .routeAerodromes: return "Aerodromes on route"
        case .other: return "Other NOTAMs"
        }
    }
}

nonisolated struct BriefingRow: Identifiable, Equatable, Sendable {
    let notam: IsraelNotam
    let closure: BriefingClosureClass
    /// A closure the relay could not read in full, or E) that reads like a closure with nothing drawable.
    let needsCheck: Bool
    let section: BriefingSection
    /// Gap between the NOTAM's area and the route or ownship -- nautical miles; 0 = inside; nil = no reference or no area.
    let distanceNM: Double?
    /// Route kinds closed by this NOTAM when none of them is the pilot's network (shown as a neutral label,
    /// never as a red closure). Empty otherwise.
    var otherRouteKinds: [String] = []

    var id: String { notam.rowId }
}

// MARK: - Filter

nonisolated enum IsraelBriefingFilter {

    static func rows(from notams: [IsraelNotam], query: BriefingQuery) -> [BriefingRow] {
        let aerodrome = query.aerodrome.trimmingCharacters(in: .whitespaces).uppercased()
        var result: [BriefingRow] = []
        for notam in notams {
            if notam.isSuperseded || notam.type?.uppercased() == "NOTAMC" { continue }
            guard query.window.includes(notam) else { continue }
            if !aerodrome.isEmpty, !matches(notam, aerodrome: aerodrome) { continue }

            var distance: Double?
            if let gap = distanceNM(of: notam, from: query.reference) {
                if gap > query.corridorNM { continue }
                distance = gap
            }

            let closure = closureClass(of: notam, network: query.network)
            let check = needsCheck(notam, network: query.network)
            let onRoute = isOnRoute(notam, aerodromes: query.routeAerodromes)
            let section: BriefingSection = closure != .none || check ? .closures : (onRoute ? .routeAerodromes : .other)
            result.append(BriefingRow(
                notam: notam, closure: closure, needsCheck: check, section: section, distanceNM: distance,
                otherRouteKinds: otherRouteKinds(of: notam, network: query.network)))
        }
        return result.sorted(by: order)
    }

    /// Section, then closure rank, then earliest start, then id.
    static func order(_ a: BriefingRow, _ b: BriefingRow) -> Bool {
        if a.section != b.section { return a.section.rawValue < b.section.rawValue }
        let rankA = a.closure == .none && a.needsCheck ? BriefingClosureClass.check : a.closure
        let rankB = b.closure == .none && b.needsCheck ? BriefingClosureClass.check : b.closure
        if rankA != rankB { return rankA < rankB }
        let fromA = a.notam.validFrom ?? .distantPast
        let fromB = b.notam.validFrom ?? .distantPast
        if fromA != fromB { return fromA < fromB }
        return a.notam.id < b.notam.id
    }

    // MARK: Classification

    /// The closure's severity for the pilot's own network only: a HEL, ultralight or ATS route closure does not
    /// close a CVFR pilot's route (UX-IL; the chart and the planner already filter by kind the same way).
    static func closureClass(of notam: IsraelNotam, network: IsraelRouteNetwork = .cvfr) -> BriefingClosureClass {
        let severities = notam.closures.filter { appliesTo($0, network) }.map(\.severity)
        if severities.contains(.full) { return .full }
        if severities.contains(.partial) { return .partial }
        if severities.contains(.check) { return .check }
        return .none
    }

    static func appliesTo(_ closure: IsraelRouteClosure, _ network: IsraelRouteNetwork) -> Bool {
        network.closureKinds.contains(where: closure.covers)
    }

    /// Route kinds this NOTAM closes that are not the pilot's network, in order ("HEL", "ULTRALIGHT", "ATS").
    /// Empty when the NOTAM also closes the pilot's network (then it is an ordinary closure row).
    static func otherRouteKinds(of notam: IsraelNotam, network: IsraelRouteNetwork = .cvfr) -> [String] {
        guard !notam.closures.contains(where: { appliesTo($0, network) }) else { return [] }
        var kinds: [String] = []
        for closure in notam.closures {
            for kind in closure.kinds where !kinds.contains(kind) { kinds.append(kind) }
        }
        return kinds
    }

    /// True when a closure is present that the app cannot fully read or draw.
    static func needsCheck(_ notam: IsraelNotam, network: IsraelRouteNetwork = .cvfr) -> Bool {
        if notam.closures.contains(where: { $0.severity == .check && appliesTo($0, network) }) { return true }
        return notam.closures.isEmpty && looksLikeRouteClosure(notam.e ?? notam.raw)
    }

    /// "ATS RTE J14 CLSD" with no chain behind it.
    static func looksLikeRouteClosure(_ text: String) -> Bool {
        let upper = text.uppercased()
        return upper.contains("CLSD") && (upper.contains("RTE") || upper.contains("ROUTE"))
    }

    static func matches(_ notam: IsraelNotam, aerodrome: String) -> Bool {
        if notam.location.uppercased() == aerodrome || notam.a?.uppercased() == aerodrome { return true }
        return (notam.e ?? "").uppercased().contains(aerodrome)
    }

    static func isOnRoute(_ notam: IsraelNotam, aerodromes: Set<String>) -> Bool {
        guard !aerodromes.isEmpty else { return false }
        if aerodromes.contains(notam.location.uppercased()) { return true }
        if let a = notam.a?.uppercased(), aerodromes.contains(a) { return true }
        return false
    }

    // MARK: Geometry

    /// The NOTAM's area from E) geometry, falling back to the Q-line circle.
    private enum Area {
        case circle(centre: IsraelLatLon, radiusNM: Double)
        case polygon([IsraelLatLon])
    }

    private static func area(of notam: IsraelNotam) -> Area? {
        if let polygon = notam.geometry.polygon, polygon.count >= 3 { return .polygon(polygon) }
        if let circle = notam.geometry.circle { return .circle(centre: circle.centre, radiusNM: circle.radiusNM) }
        if let centre = notam.q?.centre, let radius = notam.q?.radiusNM { return .circle(centre: centre, radiusNM: radius) }
        return nil
    }

    /// Gap between the NOTAM's area and the reference -- nautical miles (0 when they touch or overlap).
    /// nil when there is no reference or the NOTAM has no area, so such NOTAMs are kept, not dropped.
    static func distanceNM(of notam: IsraelNotam, from reference: BriefingReference) -> Double? {
        guard let area = area(of: notam) else { return nil }
        let referencePoints: [IsraelLatLon]
        switch reference {
        case .none: return nil
        case .ownship(let point): referencePoints = [point]
        case .route(let route): referencePoints = route.points
        }
        guard let origin = referencePoints.first else { return nil }
        let line = referencePoints.map { project($0, origin: origin) }

        switch area {
        case .circle(let centre, let radius):
            let c = project(centre, origin: origin)
            return max(0, distance(from: c, toPolyline: line) - radius)
        case .polygon(let ring):
            let shape = ring.map { project($0, origin: origin) }
            return distance(polygon: shape, toPolyline: line)
        }
    }

    // Planar NM coordinates around `origin` (equirectangular; accurate to well under 1% across Israel).
    private struct Pt { var x: Double; var y: Double }

    private static func project(_ p: IsraelLatLon, origin: IsraelLatLon) -> Pt {
        let cosLat = cos(origin.lat * .pi / 180)
        return Pt(x: (p.lon - origin.lon) * cosLat * 60, y: (p.lat - origin.lat) * 60)
    }

    private static func distance(_ a: Pt, _ b: Pt) -> Double { hypot(a.x - b.x, a.y - b.y) }

    private static func distance(from p: Pt, toSegment a: Pt, _ b: Pt) -> Double {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return distance(p, a) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
        return distance(p, Pt(x: a.x + t * dx, y: a.y + t * dy))
    }

    private static func distance(from p: Pt, toPolyline line: [Pt]) -> Double {
        guard line.count > 1 else { return line.first.map { distance(p, $0) } ?? .infinity }
        return zip(line, line.dropFirst()).map { distance(from: p, toSegment: $0, $1) }.min() ?? .infinity
    }

    private static func contains(_ polygon: [Pt], _ p: Pt) -> Bool {
        var inside = false
        var j = polygon.count - 1
        for i in polygon.indices {
            let a = polygon[i], b = polygon[j]
            if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { inside.toggle() }
            j = i
        }
        return inside
    }

    private static func cross(_ o: Pt, _ a: Pt, _ b: Pt) -> Double { (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) }

    private static func segmentsIntersect(_ p1: Pt, _ p2: Pt, _ p3: Pt, _ p4: Pt) -> Bool {
        let d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4)
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }

    private static func distance(polygon: [Pt], toPolyline line: [Pt]) -> Double {
        if line.contains(where: { contains(polygon, $0) }) { return 0 }
        let edges = zip(polygon, polygon.dropFirst() + [polygon[0]]).map { ($0, $1) }
        if line.count > 1 {
            for (a, b) in zip(line, line.dropFirst()) where edges.contains(where: { segmentsIntersect(a, b, $0.0, $0.1) }) { return 0 }
        }
        let fromVertices = polygon.map { distance(from: $0, toPolyline: line) }
        let fromRoute = line.flatMap { p in edges.map { distance(from: p, toSegment: $0.0, $0.1) } }
        return (fromVertices + fromRoute).min() ?? .infinity
    }
}

// MARK: - Route sources

extension BriefingRoute {
    /// From the Israel flight-plan screen: the planned route with its departure time and ETE.
    init(plan: IsraelRoutePlan, departure: Date) {
        self.init(
            codes: plan.pointCodes,
            points: plan.points.map { IsraelLatLon(lat: $0.latitude, lon: $0.longitude) },
            departure: departure,
            eteSeconds: plan.totalETESeconds,
            network: plan.network)
    }

    /// From the activated route: no departure time or ETE (the window then defaults to now +3 h).
    /// `departurePoint` is the first leg's start, which `ActiveRoute` does not carry.
    init?(active: ActiveRoute, departurePoint: IsraelLatLon?) {
        guard !active.legs.isEmpty else { return nil }
        var codes = [active.legs[0].fromCode]
        var points = departurePoint.map { [$0] } ?? []
        for leg in active.legs {
            codes.append(leg.toCode)
            points.append(IsraelLatLon(lat: leg.toLatitude, lon: leg.toLongitude))
        }
        self.init(codes: codes, points: points, departure: nil, eteSeconds: nil)
    }
}
