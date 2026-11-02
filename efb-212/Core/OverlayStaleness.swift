//
//  OverlayStaleness.swift
//  efb-212
//
//  How a fetched map overlay (TFRs, AIRMET/SIGMET) is drawn, from the age of its snapshot. Uses the
//  same thresholds as the data-age badge (`DataProduct`), so the map and the badge never disagree:
//  current data draws normally, an OLD snapshot draws marked as stale, and a snapshot past its
//  useful life is not drawn at all (it is never shown as current). Pure and `nonisolated`.
//

import Foundation

nonisolated enum OverlayStaleness: Equatable, Sendable {
    /// Inside its useful life, or never fetched.
    case current
    /// OLD: drawn faded with a dashed outline and an "OLD" badge on the map.
    case stale
    /// EXPIRED (or unsafe): not drawn; the badge says the layer is hidden.
    case hidden

    static func evaluate(_ product: DataProduct, fetchedAt: Date?, now: Date = Date()) -> OverlayStaleness {
        guard let fetchedAt else { return .current }
        switch DataFreshness.evaluate(product, observed: fetchedAt, now: now).level {
        case .unknown, .fresh: return .current
        case .old: return .stale
        case .expired, .unsafe: return .hidden
        }
    }
}
