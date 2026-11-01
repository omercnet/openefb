//
//  AutoStartGate.swift
//  efb-212
//
//  After a manual End Recording the aircraft is usually still moving. Without a gate the
//  auto-start monitor sees speed above the threshold and re-arms the countdown straight away.
//  The gate holds auto-start off until the aircraft has slowed below the threshold, or the app
//  restarts (a new coordinator starts with an open gate).
//

import Foundation

nonisolated struct AutoStartGate: Sendable, Equatable {
    private(set) var isSuppressed = false

    /// The pilot ended the recording by hand.
    mutating func manualStop() {
        isSuppressed = true
    }

    /// Feed the latest ground speed. Returns true when auto-start may arm.
    /// Speed at or below `thresholdKts` (knots) reopens the gate; the same comparison the
    /// monitor uses to arm (`speed > threshold`), so "stopped" means "would not arm".
    mutating func update(speedKts: Double, thresholdKts: Double) -> Bool {
        if isSuppressed && speedKts <= thresholdKts {
            isSuppressed = false
        }
        return !isSuppressed
    }
}
