//
//  IsraelNotamClosureMapper.swift
//  efb-212
//
//  Maps NOTAM route-closure chains ("CVFR RTE CLSD GALIM-DAROM-HOTRM") onto route segments of the
//  published Israeli network. The network lives in IL-1's `IsraelAviationDatabase`; this file
//  depends only on the lookup protocol below so that database can conform without changes here.
//  No drawing and no alerts (IL-3, IL-8).
//

import Foundation

/// Segment lookup by point codes. IL-1's database conforms with its own segment type.
nonisolated protocol IsraelRouteSegmentLookup: Sendable {
    associatedtype Segment: Hashable & Sendable

    /// Whether `code` is a published point or airfield in the network.
    func knowsPoint(_ code: String) -> Bool
    /// The segment joining two points in that direction, or nil when none is published.
    func segment(from: String, to: String) -> Segment?
}

/// One closure mapped onto the network.
nonisolated struct IsraelClosureMatch<Segment: Hashable & Sendable>: Sendable {
    let closure: IsraelRouteClosure
    /// Segments found for the chain's legs, in chain order, without duplicates.
    let segments: [Segment]
    /// Point codes the network doesn't know. Reported, never dropped: the pilot must see a closure
    /// we could not place.
    let unknownCodes: [String]
    /// Legs whose points are both known but have no published segment between them.
    let unmatchedLegs: [IsraelClosureLeg]

    /// Every leg of the chain landed on a segment.
    var isFullyMapped: Bool { unknownCodes.isEmpty && unmatchedLegs.isEmpty }
}

nonisolated struct IsraelClosureLeg: Equatable, Hashable, Sendable {
    let from: String
    let to: String
}

nonisolated struct IsraelClosureMapping<Segment: Hashable & Sendable>: Sendable {
    let matches: [IsraelClosureMatch<Segment>]

    /// Every segment closed by any of the mapped closures.
    var closedSegments: Set<Segment> { Set(matches.flatMap(\.segments)) }
    /// Every code that could not be placed.
    var unknownCodes: Set<String> { Set(matches.flatMap(\.unknownCodes)) }
    /// Closures that could not be fully placed: surface these to the pilot, don't hide them.
    var unresolved: [IsraelClosureMatch<Segment>] { matches.filter { !$0.isFullyMapped } }
}

nonisolated enum IsraelNotamClosureMapper {

    /// - Parameters:
    ///   - closures: from the feed (`IsraelNotamFeed.closures`).
    ///   - date: keep only closures whose validity window contains it; nil keeps all of them.
    ///     A D) schedule is not evaluated: such a closure is kept (`hasSchedule`).
    static func map<Lookup: IsraelRouteSegmentLookup>(
        _ closures: [IsraelRouteClosure],
        using lookup: Lookup,
        at date: Date? = nil
    ) -> IsraelClosureMapping<Lookup.Segment> {
        let selected = date.map { date in closures.filter { $0.isValid(at: date) } } ?? closures
        return IsraelClosureMapping(matches: selected.map { match($0, using: lookup) })
    }

    static func match<Lookup: IsraelRouteSegmentLookup>(
        _ closure: IsraelRouteClosure,
        using lookup: Lookup
    ) -> IsraelClosureMatch<Lookup.Segment> {
        var unknown: [String] = []
        for code in closure.chain where !lookup.knowsPoint(code) && !unknown.contains(code) {
            unknown.append(code)
        }
        var segments: [Lookup.Segment] = []
        var unmatched: [IsraelClosureLeg] = []
        for leg in closure.legs where lookup.knowsPoint(leg.from) && lookup.knowsPoint(leg.to) {
            // A closure shuts the route both ways; the network may store one direction only.
            guard let segment = lookup.segment(from: leg.from, to: leg.to) ?? lookup.segment(from: leg.to, to: leg.from) else {
                unmatched.append(IsraelClosureLeg(from: leg.from, to: leg.to))
                continue
            }
            if !segments.contains(segment) { segments.append(segment) }
        }
        return IsraelClosureMatch(closure: closure, segments: segments, unknownCodes: unknown, unmatchedLegs: unmatched)
    }
}
