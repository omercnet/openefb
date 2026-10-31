//
//  VerticalSpeedEstimator.swift
//  efb-212
//
//  Vertical speed (feet per minute) from successive GPS altitude fixes.
//  Pure value type: uses the fix timestamps, never the wall clock, so the
//  result is deterministic and testable from synthetic fixes.
//
//  Smoothing: exponential moving average with a ~5 s time constant, which is
//  light enough to follow a 500 fpm climb within a few fixes but damps the
//  +/- 3 m per-fix GPS altitude jitter that would otherwise read as +/- 600 fpm.
//

import Foundation

nonisolated struct VerticalSpeedEstimator: Sendable {

    /// EMA time constant in seconds. alpha = 1 - exp(-dt / timeConstant).
    let timeConstantSeconds: TimeInterval

    /// Current smoothed estimate in feet per minute. 0 until two valid fixes have been seen.
    private(set) var verticalSpeedFPM: Double = 0

    private var lastAltitudeFeet: Double?   // feet MSL
    private var lastTimestamp: Date?

    init(timeConstantSeconds: TimeInterval = 5) {
        self.timeConstantSeconds = timeConstantSeconds
    }

    /// Feed one fix and return the updated estimate in feet per minute.
    ///
    /// - Parameters:
    ///   - altitudeFeet: altitude of the fix in feet MSL
    ///   - timestamp: the fix's own timestamp (CLLocation.timestamp), not Date()
    ///   - verticalAccuracyMeters: CLLocation.verticalAccuracy; negative means the
    ///     altitude is invalid and the fix is ignored (estimate held)
    @discardableResult
    mutating func update(altitudeFeet: Double, timestamp: Date, verticalAccuracyMeters: Double) -> Double {
        guard verticalAccuracyMeters >= 0 else { return verticalSpeedFPM }

        guard let previousAltitude = lastAltitudeFeet, let previousTimestamp = lastTimestamp else {
            lastAltitudeFeet = altitudeFeet
            lastTimestamp = timestamp
            return verticalSpeedFPM
        }

        let dt = timestamp.timeIntervalSince(previousTimestamp)  // seconds
        guard dt > 0 else { return verticalSpeedFPM }  // duplicate or out-of-order fix

        let instantaneousFPM = (altitudeFeet - previousAltitude) / dt * 60

        if !hasEstimate {
            // Seed with the first observed rate so a steady climb reads correctly at once.
            verticalSpeedFPM = instantaneousFPM
            hasEstimate = true
        } else {
            let alpha = 1 - exp(-dt / timeConstantSeconds)
            verticalSpeedFPM += alpha * (instantaneousFPM - verticalSpeedFPM)
        }

        lastAltitudeFeet = altitudeFeet
        lastTimestamp = timestamp
        return verticalSpeedFPM
    }

    private var hasEstimate = false
}
