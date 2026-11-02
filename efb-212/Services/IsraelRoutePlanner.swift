//
//  IsraelRoutePlanner.swift
//  efb-212
//
//  Shortest-path routing over the published Israeli CVFR network (IL-PLAN). Pure and nonisolated:
//  it takes the points, segments and the NOTAM closure marks as input and never touches the
//  database or the network itself.
//
//  Rules (domestic AIP A-07 / A-11, docs/handoff/IL-PLAN.md):
//  - A segment is flown only in a direction CAAI publishes an altitude for; 34 segments are one-way.
//  - By-request (dashed) and military (blue) segments are excluded unless the pilot overrides, and a
//    route using one is never fileable.
//  - A segment fully closed by a NOTAM for the departure window is excluded; a partial closure stays
//    with a caution and the altitude that remains available.
//

import Foundation
import CoreLocation

// MARK: - Options

nonisolated struct IsraelRouteOptions: Equatable, Sendable {
    /// Allow dashed segments that need real-time ATC approval. The route is then not fileable.
    var allowByRequest: Bool = false
    /// Allow blue military segments (civil use only with IAF approval). Not fileable either.
    var allowMilitary: Bool = false
    /// Planned off-block time. With it, sport-aviation weekend rules are applied: weekend-only routes are left out
    /// when the departure is not in a weekend, and each leg is checked at its own time. nil skips the time rules.
    var departure: Date?
    /// The pilot's holiday declaration for the departure day (the data has no holiday calendar).
    var dayOverride: IsraelDayOverride = .none
    /// The NOTAM check covers departure to departure + this (seconds). 3 h covers any domestic CVFR leg set.
    var closureWindow: TimeInterval = 3 * 3600

    init(
        allowByRequest: Bool = false, allowMilitary: Bool = false, closureWindow: TimeInterval = 3 * 3600,
        departure: Date? = nil, dayOverride: IsraelDayOverride = .none
    ) {
        self.allowByRequest = allowByRequest
        self.allowMilitary = allowMilitary
        self.closureWindow = closureWindow
        self.departure = departure
        self.dayOverride = dayOverride
    }
}

// MARK: - Result types

/// Why a leg needs the pilot's attention. `blocksFiling` legs make the whole plan unfileable.
nonisolated enum IsraelRouteCaution: Hashable, Sendable {
    /// Dashed segment: real-time ATC approval, cannot be filed.
    case byRequest
    /// Blue segment: IAF approval, cannot be filed.
    case military
    /// NOTAM closes part of the segment (some altitudes, or with exceptions); `text` is the chart label.
    case partialClosure(notamID: String, text: String)
    /// A NOTAM that looks like a closure but the relay could not read in full.
    case checkNotam(notamID: String)
    /// Sport-aviation weekend-only route; the weekend has begun by the AIP default (Friday 06:00) but a bubble
    /// may start it as late as 14:00, and the data does not say which. Cannot be filed.
    case weekendStartUnconfirmed
    /// Sport-aviation weekend-only route, and this leg is flown outside a weekend (the weekend ends or has not begun).
    case notInUse
    /// Sport-aviation route whose conditions are on the CAAI chart notes (`text` is the layer's value).
    case specialConditions(text: String?)
    /// The layer marks this sport-aviation route for small aircraft only.
    case smallAircraftOnly

    var blocksFiling: Bool {
        switch self {
        case .byRequest, .military, .checkNotam, .weekendStartUnconfirmed, .notInUse: return true
        case .partialClosure, .specialConditions, .smallAircraftOnly: return false
        }
    }

    /// Short badge text for the legs table.
    var badge: String {
        switch self {
        case .byRequest: return "BY REQUEST"
        case .military: return "MILITARY"
        case .partialClosure: return "PARTIAL CLSD"
        case .checkNotam: return "CHECK NOTAM"
        case .weekendStartUnconfirmed: return "WEEKEND START?"
        case .notInUse: return "NOT IN USE"
        case .specialConditions: return "SPECIAL"
        case .smallAircraftOnly: return "SMALL A/C"
        }
    }
}

nonisolated struct IsraelRouteLeg: Identifiable, Hashable, Sendable {
    /// The segment's database id (unique per leg: a shortest path never repeats a segment).
    var id: Int { segment.id }
    let segment: IsraelRouteSegment
    let from: IsraelReportingPoint
    let to: IsraelReportingPoint
    /// true when flown in the published from -> to direction.
    let forward: Bool
    /// Published altitude for the direction flown (feet MSL, or a two-value text).
    let altitude: IsraelRouteAltitude?
    let distanceNM: Double          // nautical miles
    let eteSeconds: TimeInterval    // seconds at the planning cruise speed
    let cautions: [IsraelRouteCaution]

    /// The polyline in the direction flown.
    var polyline: [CLLocationCoordinate2D] { forward ? segment.polyline : segment.polyline.reversed() }
    /// Bearing in the direction flown -- degrees true.
    var bearingTrue: Double { forward ? segment.bearingTrue : (segment.bearingTrue + 180).truncatingRemainder(dividingBy: 360) }
    /// "2500" or "2500/3500"; "---" when unpublished (cannot happen for a routed leg).
    var altitudeText: String { altitude?.published ?? "---" }
}

nonisolated struct IsraelRoutePlan: Hashable, Sendable {
    let legs: [IsraelRouteLeg]
    let cruiseSpeedKnots: Double    // knots, used for every leg's ETE

    /// Every point along the route in order, departure first.
    var points: [IsraelReportingPoint] {
        guard let first = legs.first else { return [] }
        return [first.from] + legs.map(\.to)
    }
    var pointCodes: [String] { points.map(\.code) }
    var totalDistanceNM: Double { legs.reduce(0) { $0 + $1.distanceNM } }
    var totalETESeconds: TimeInterval { legs.reduce(0) { $0 + $1.eteSeconds } }
    /// No leg carries a caution that blocks filing.
    var isFileable: Bool { !legs.contains { $0.cautions.contains(where: \.blocksFiling) } }
    /// The whole polyline, departure to destination.
    var polyline: [CLLocationCoordinate2D] { legs.flatMap(\.polyline) }
    /// The network the plan is flown on (CVFR when the plan has no legs).
    var network: IsraelRouteNetwork { legs.first?.segment.network ?? .cvfr }
}

nonisolated enum IsraelNoRouteReason: Equatable, Sendable {
    /// A path exists only through segments closed by NOTAM.
    case closed
    /// A path exists only against a one-way segment's published direction.
    case oneWay
    /// A path exists only through by-request or military segments.
    case restricted
    /// A path exists only through weekend-only sport-aviation routes, and the departure is not in a weekend.
    case notInUse
    /// The two points are not connected at all.
    case disconnected
}

nonisolated enum IsraelRouteError: Error, Equatable, Sendable, LocalizedError {
    /// The code is not a point of the network (an airstrip without a published route, or a typo).
    case unknownPoint(String)
    case noRoute(from: String, to: String, reason: IsraelNoRouteReason)

    var errorDescription: String? {
        switch self {
        case .unknownPoint(let code):
            return "\(code) is not on the route network."
        case .noRoute(let from, let to, let reason):
            let base = "No open route between \(from) and \(to)"
            switch reason {
            case .closed: return base + ": the only routes are closed by NOTAM."
            case .oneWay: return base + ": the only routes are one-way against this direction."
            case .restricted: return base + ": the only routes need ATC or IAF approval."
            case .notInUse: return base + ": the only routes are weekend-only and the departure is not in a weekend."
            case .disconnected: return base + "."
            }
        }
    }

    /// The fpl.co.il wording pilots know.
    var hebrewDescription: String {
        switch self {
        case .unknownPoint(let code): return "\(code) אינה נקודה ברשת הנתיבים"
        case .noRoute(let from, let to, _): return "לא נמצא נתיב פתוח בין \(from) ל-\(to)"
        }
    }
}

// MARK: - Closure state per segment

/// What the NOTAM feed says about a segment for the planned window.
nonisolated enum IsraelSegmentClosure: Hashable, Sendable {
    case full(notamID: String)
    case partial(notamID: String, text: String)
    case check(notamID: String)
}

/// A closure the planner could not place on the network in full: a point code it does not know, or a
/// leg with no published segment. It may still close the planned route, so filing is blocked until the
/// pilot reads the NOTAM (efb-qpk: never fail open).
nonisolated struct IsraelUnresolvedClosure: Hashable, Sendable, Identifiable {
    let notamID: String
    /// Point codes the network does not know, in chain order.
    let unknownCodes: [String]
    /// Legs between known points with no published segment.
    let unmatchedLegs: [IsraelClosureLeg]
    var id: String { notamID }
}

/// The NOTAM closure marks for a planned window: what landed on segments, and what did not.
nonisolated struct IsraelClosureMarks: Hashable, Sendable {
    /// Segment id -> closure state.
    var segments: [Int: IsraelSegmentClosure] = [:]
    /// Closures (one per NOTAM) that could not be placed in full. Each blocks filing.
    var unresolved: [IsraelUnresolvedClosure] = []

    init(segments: [Int: IsraelSegmentClosure] = [:], unresolved: [IsraelUnresolvedClosure] = []) {
        self.segments = segments
        self.unresolved = unresolved
    }
}

// MARK: - Planner

nonisolated struct IsraelRoutePlanner: Sendable {

    private struct Edge: Sendable {
        let segment: IsraelRouteSegment
        let forward: Bool
        let toCode: String
        let lengthNM: Double

        var polylineStart: CLLocationCoordinate2D {
            (forward ? segment.polyline.first : segment.polyline.last) ?? CLLocationCoordinate2D(latitude: 0, longitude: 0)
        }
        var polylineEnd: CLLocationCoordinate2D {
            (forward ? segment.polyline.last : segment.polyline.first) ?? CLLocationCoordinate2D(latitude: 0, longitude: 0)
        }
    }

    private let pointsByCode: [String: IsraelReportingPoint]
    private let segments: [IsraelRouteSegment]
    private let closures: [Int: IsraelSegmentClosure]

    /// - Parameters:
    ///   - points: the published reporting points and ARPs (duplicated codes resolve to the copy segments use).
    ///   - segments: the CVFR network.
    ///   - closures: segment id -> closure state for the planned window (`closures(from:...)` builds it).
    init(points: [IsraelReportingPoint], segments: [IsraelRouteSegment], closures: [Int: IsraelSegmentClosure] = [:]) {
        var byCode: [String: IsraelReportingPoint] = [:]
        for point in points { byCode[point.code.uppercased()] = point }
        // "LLNV" names two ARPs; the one the segments reference wins.
        let referenced = Set(segments.flatMap { [$0.fromPointID, $0.toPointID] })
        for point in points where referenced.contains(point.id) { byCode[point.code.uppercased()] = point }
        pointsByCode = byCode
        self.segments = segments
        self.closures = closures
    }

    func knowsPoint(_ code: String) -> Bool { pointsByCode[code.uppercased()] != nil }
    func point(code: String) -> IsraelReportingPoint? { pointsByCode[code.uppercased()] }

    /// Shortest open route from `from` through each `via` to `to`.
    /// - Parameter cruiseSpeedKnots: the aircraft profile's cruise speed -- knots -- for the ETE.
    func route(
        from: String, via: [String] = [], to: String,
        cruiseSpeedKnots: Double, options: IsraelRouteOptions = IsraelRouteOptions()
    ) throws(IsraelRouteError) -> IsraelRoutePlan {
        let stops = ([from] + via + [to]).map { $0.uppercased() }
        for code in stops where !knowsPoint(code) { throw .unknownPoint(code) }
        let graph = adjacency(options: options, ignoreClosures: false, ignoreDirection: false, ignoreTimeRules: false)
        var legs: [IsraelRouteLeg] = []
        var elapsed: TimeInterval = 0  // seconds since departure, for the time rules
        for (start, end) in zip(stops, stops.dropFirst()) where start != end {
            guard let path = shortestPath(graph, from: start, to: end) else {
                throw .noRoute(from: start, to: end, reason: diagnose(from: start, to: end, options: options))
            }
            for edge in path {
                let legStart = options.departure.map { $0.addingTimeInterval(elapsed) }
                let leg = makeLeg(edge, cruiseSpeedKnots: cruiseSpeedKnots, legStart: legStart, dayOverride: options.dayOverride)
                legs.append(leg)
                elapsed += leg.eteSeconds
            }
        }
        return IsraelRoutePlan(legs: legs, cruiseSpeedKnots: cruiseSpeedKnots)
    }

    /// The same stops in reverse order, re-routed: one-way segments make the return differ.
    func returnRoute(of plan: IsraelRoutePlan, options: IsraelRouteOptions = IsraelRouteOptions()) throws(IsraelRouteError) -> IsraelRoutePlan {
        let codes = plan.pointCodes
        guard codes.count >= 2, let first = codes.first, let last = codes.last else {
            return plan
        }
        return try route(from: last, to: first, cruiseSpeedKnots: plan.cruiseSpeedKnots, options: options)
    }

    // MARK: Closure marks

    /// Segment closure states from the NOTAM feed for a departure window. A stale or absent feed yields
    /// none; the caller must then tell the pilot the closures were not checked.
    /// Closures that cannot be placed on the network in full are returned in `unresolved`, never dropped.
    /// - Parameters:
    ///   - routeNetwork: the network the plan is flown on; only closures naming one of its route kinds count.
    ///   - departure: planned departure; closures overlapping [departure, departure + window] count.
    ///   - now: for the feed-freshness check.
    static func closures(
        from report: IsraelNotamReport?,
        network: IsraelChartNetwork,
        routeNetwork: IsraelRouteNetwork = .cvfr,
        departure: Date,
        window: TimeInterval,
        now: Date = Date()
    ) -> IsraelClosureMarks {
        guard let report, IsraelChartFeatureBuilder.drawableFreshness.contains(report.freshness(now: now).level) else {
            return IsraelClosureMarks()
        }
        let end = departure.addingTimeInterval(window)
        let active = report.feed.closures.filter { closure in
            routeNetwork.closureKinds.contains(where: closure.covers) && closure.overlaps(start: departure, end: end)
        }
        let mapping = IsraelNotamClosureMapper.map(active, using: network)
        var result = IsraelClosureMarks()
        for match in mapping.matches {
            let state: IsraelSegmentClosure
            switch match.closure.severity {
            case .full: state = .full(notamID: match.closure.notamId)
            case .check: state = .check(notamID: match.closure.notamId)
            case .partial:
                state = .partial(notamID: match.closure.notamId, text: IsraelChartFeatureBuilder.closureText(match.closure, now: now))
            }
            for segment in match.segments {
                if let existing = result.segments[segment.id], existing.rank >= state.rank { continue }
                result.segments[segment.id] = state
            }
            if !match.isFullyMapped, !result.unresolved.contains(where: { $0.notamID == match.closure.notamId }) {
                result.unresolved.append(IsraelUnresolvedClosure(
                    notamID: match.closure.notamId, unknownCodes: match.unknownCodes, unmatchedLegs: match.unmatchedLegs
                ))
            }
        }
        return result
    }

    // MARK: Graph

    private func adjacency(options: IsraelRouteOptions, ignoreClosures: Bool, ignoreDirection: Bool, ignoreTimeRules: Bool) -> [String: [Edge]] {
        var graph: [String: [Edge]] = [:]
        // A weekend-only sport-aviation route is out when the departure is not in a weekend by any published rule.
        // Later legs are not excluded here: they are marked per leg, because the flight may cross into or out of a weekend.
        let weekdayDeparture = options.departure.map {
            IsraelLSATimeRules.weekendState(at: $0, override: options.dayOverride) == .notInUse
        } ?? false
        for segment in segments {
            if segment.isByRequest && !options.allowByRequest { continue }
            if segment.isMilitary && !options.allowMilitary { continue }
            if !ignoreTimeRules, weekdayDeparture, segment.network == .lsa, segment.activity == .weekend { continue }
            if !ignoreClosures, case .full = closures[segment.id] { continue }
            let length = segment.lengthNM ?? Self.length(of: segment.polyline)
            let from = segment.fromCode.uppercased(), to = segment.toCode.uppercased()
            if ignoreDirection || segment.altitudeForward != nil {
                graph[from, default: []].append(Edge(segment: segment, forward: true, toCode: to, lengthNM: length))
            }
            if ignoreDirection || segment.altitudeReverse != nil {
                graph[to, default: []].append(Edge(segment: segment, forward: false, toCode: from, lengthNM: length))
            }
        }
        return graph
    }

    /// Dijkstra on distance. Returns the edges in order, or nil when `to` is unreachable.
    private func shortestPath(_ graph: [String: [Edge]], from: String, to: String) -> [Edge]? {
        var distance: [String: Double] = [from: 0]
        var previous: [String: Edge] = [:]
        var settled: Set<String> = []
        var frontier: [(code: String, distance: Double)] = [(from, 0)]
        while let index = frontier.indices.min(by: { frontier[$0].distance < frontier[$1].distance }) {
            let current = frontier.remove(at: index)
            if settled.contains(current.code) { continue }
            settled.insert(current.code)
            if current.code == to { break }
            for edge in graph[current.code] ?? [] where !settled.contains(edge.toCode) {
                let candidate = current.distance + edge.lengthNM
                if candidate < distance[edge.toCode] ?? .infinity {
                    distance[edge.toCode] = candidate
                    previous[edge.toCode] = edge
                    frontier.append((edge.toCode, candidate))
                }
            }
        }
        guard settled.contains(to) else { return nil }
        var path: [Edge] = []
        var cursor = to
        while cursor != from, let edge = previous[cursor] {
            path.append(edge)
            cursor = edge.forward ? edge.segment.fromCode.uppercased() : edge.segment.toCode.uppercased()
        }
        return path.reversed()
    }

    /// Relax the rules one at a time to tell the pilot which one cut the route.
    private func diagnose(from: String, to: String, options: IsraelRouteOptions) -> IsraelNoRouteReason {
        if shortestPath(adjacency(options: options, ignoreClosures: false, ignoreDirection: false, ignoreTimeRules: true), from: from, to: to) != nil {
            return .notInUse
        }
        if shortestPath(adjacency(options: options, ignoreClosures: true, ignoreDirection: false, ignoreTimeRules: true), from: from, to: to) != nil {
            return .closed
        }
        if shortestPath(adjacency(options: options, ignoreClosures: true, ignoreDirection: true, ignoreTimeRules: true), from: from, to: to) != nil {
            return .oneWay
        }
        var everything = options
        everything.allowByRequest = true
        everything.allowMilitary = true
        if shortestPath(adjacency(options: everything, ignoreClosures: true, ignoreDirection: true, ignoreTimeRules: true), from: from, to: to) != nil {
            return .restricted
        }
        return .disconnected
    }

    /// - Parameters:
    ///   - legStart: when this leg is flown (departure + the legs before it); nil skips the time rules.
    private func makeLeg(_ edge: Edge, cruiseSpeedKnots: Double, legStart: Date?, dayOverride: IsraelDayOverride) -> IsraelRouteLeg {
        let segment = edge.segment
        let fromCode = edge.forward ? segment.fromCode : segment.toCode
        let toCode = edge.toCode
        // Both codes were validated by `adjacency`, which only emits edges between known points, but
        // a segment may reference a point the caller did not supply: synthesise from the polyline end.
        let from = point(code: fromCode) ?? Self.syntheticPoint(id: segment.fromPointID, code: fromCode, at: edge.polylineStart)
        let to = point(code: toCode) ?? Self.syntheticPoint(id: segment.toPointID, code: toCode, at: edge.polylineEnd)
        var cautions: [IsraelRouteCaution] = []
        if segment.isByRequest { cautions.append(.byRequest) }
        if segment.isMilitary { cautions.append(.military) }
        switch closures[segment.id] {
        case .partial(let id, let text): cautions.append(.partialClosure(notamID: id, text: text))
        case .check(let id): cautions.append(.checkNotam(notamID: id))
        case .full, .none: break
        }
        if segment.network == .lsa {
            switch segment.activity {
            case .allWeek: break
            case .weekend:
                if let legStart {
                    switch IsraelLSATimeRules.weekendState(at: legStart, override: dayOverride) {
                    case .inUse: break
                    case .startUnconfirmed: cautions.append(.weekendStartUnconfirmed)
                    case .notInUse: cautions.append(.notInUse)
                    }
                }
            case .special, .unspecified: cautions.append(.specialConditions(text: segment.activitySource))
            }
            if segment.smallOnly { cautions.append(.smallAircraftOnly) }
        }
        let speed = max(cruiseSpeedKnots, 1)
        return IsraelRouteLeg(
            segment: segment, from: from, to: to, forward: edge.forward,
            altitude: segment.altitude(forward: edge.forward),
            distanceNM: edge.lengthNM,
            eteSeconds: edge.lengthNM / speed * 3600,
            cautions: cautions
        )
    }

    private static func syntheticPoint(id: Int, code: String, at coordinate: CLLocationCoordinate2D) -> IsraelReportingPoint {
        IsraelReportingPoint(id: id, code: code, nameEnglish: nil, nameHebrew: nil, kind: .onRequest,
                             latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    /// Polyline length -- nautical miles.
    static func length(of polyline: [CLLocationCoordinate2D]) -> Double {
        zip(polyline, polyline.dropFirst()).reduce(0) { $0 + haversineNM($1.0, $1.1) }
    }

    /// Great-circle distance -- nautical miles (haversine; the CoreLocation helper is main-actor isolated).
    static func haversineNM(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let radiusNM = 3440.065  // mean earth radius, nautical miles
        let lat1 = a.latitude * .pi / 180, lat2 = b.latitude * .pi / 180
        let dLat = lat2 - lat1, dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radiusNM * asin(min(1, h.squareRoot()))
    }
}

extension IsraelSegmentClosure {
    /// full > check > partial, like the chart.
    nonisolated var rank: Int {
        switch self {
        case .full: return 2
        case .check: return 1
        case .partial: return 0
        }
    }
}

extension IsraelRouteClosure {
    /// The validity window meets [start, end]. A missing bound is open-ended; the D) schedule is not evaluated.
    nonisolated func overlaps(start: Date, end: Date) -> Bool {
        if let validFrom, validFrom > end { return false }
        if let validTo, validTo < start { return false }
        return true
    }
}
