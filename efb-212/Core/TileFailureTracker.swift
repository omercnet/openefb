//
//  TileFailureTracker.swift
//  efb-212
//
//  Decides when basemap tile failures are worth telling the pilot about (efb-zfm.18). One failed tile is
//  normal (a gap in coverage, a retry); a run of errors with no tile arriving in between means the base
//  map is not loading, and the map shows "Map tiles not loading" until a tile loads again.
//

import Foundation

nonisolated struct TileFailureTracker: Equatable, Sendable {
    /// Consecutive tile errors, with no tile loaded from the network in between, before the indicator shows.
    static let threshold = 6
    private(set) var consecutiveErrors = 0

    var isFailing: Bool { consecutiveErrors >= Self.threshold }

    mutating func recordError() { consecutiveErrors += 1 }

    /// A tile arrived from the network: the source is reachable again.
    mutating func recordNetworkLoad() { consecutiveErrors = 0 }
}
