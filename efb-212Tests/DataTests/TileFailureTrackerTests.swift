//
//  TileFailureTrackerTests.swift
//  efb-212Tests
//
//  efb-zfm.18: the "map tiles not loading" indicator needs a run of errors, and one good tile clears it.
//

import Testing
@testable import efb_212

@Suite("Tile failure tracker")
struct TileFailureTrackerTests {
    @Test func aFewErrorsAreNotAnOutage() {
        var tracker = TileFailureTracker()
        for _ in 0..<(TileFailureTracker.threshold - 1) { tracker.recordError() }
        #expect(!tracker.isFailing)
    }

    @Test func aRunOfErrorsRaisesTheIndicator() {
        var tracker = TileFailureTracker()
        for _ in 0..<TileFailureTracker.threshold { tracker.recordError() }
        #expect(tracker.isFailing)
    }

    @Test func aTileFromTheNetworkClearsItAndTheRunStartsOver() {
        var tracker = TileFailureTracker()
        for _ in 0..<(TileFailureTracker.threshold + 3) { tracker.recordError() }
        tracker.recordNetworkLoad()
        #expect(!tracker.isFailing)
        for _ in 0..<(TileFailureTracker.threshold - 1) { tracker.recordError() }
        #expect(!tracker.isFailing)  // errors before the good tile do not count toward the next run
    }
}
