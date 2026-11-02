//
//  OverlayStalenessTests.swift
//  efb-212Tests
//
//  efb-zfm.11: a TFR / AIRMET-SIGMET snapshot is drawn current, marked stale, or not drawn at all,
//  from the same age thresholds as the data-age badge.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Overlay staleness")
struct OverlayStalenessTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func freshSnapshotIsCurrent() {
        #expect(OverlayStaleness.evaluate(.tfr, fetchedAt: now.addingTimeInterval(-5 * 60), now: now) == .current)
        #expect(OverlayStaleness.evaluate(.airmetSigmet, fetchedAt: now.addingTimeInterval(-29 * 60), now: now) == .current)
    }

    @Test func snapshotPastOldThresholdIsStaleNotCurrent() {
        #expect(OverlayStaleness.evaluate(.tfr, fetchedAt: now.addingTimeInterval(-31 * 60), now: now) == .stale)
        #expect(OverlayStaleness.evaluate(.airmetSigmet, fetchedAt: now.addingTimeInterval(-119 * 60), now: now) == .stale)
    }

    @Test func snapshotPastExpiryIsHiddenNotDrawn() {
        #expect(OverlayStaleness.evaluate(.tfr, fetchedAt: now.addingTimeInterval(-2 * 3600), now: now) == .hidden)
        #expect(OverlayStaleness.evaluate(.airmetSigmet, fetchedAt: now.addingTimeInterval(-3 * 3600), now: now) == .hidden)
    }

    @Test func neverFetchedIsCurrentSoNothingIsMarked() {
        #expect(OverlayStaleness.evaluate(.tfr, fetchedAt: nil, now: now) == .current)
    }
}
