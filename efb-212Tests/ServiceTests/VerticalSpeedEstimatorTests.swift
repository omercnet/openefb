//
//  VerticalSpeedEstimatorTests.swift
//  efb-212Tests
//
//  Vertical speed (feet per minute) from synthetic altitude fixes.
//  All timestamps are fixed epoch values so the result cannot depend on the wall clock.
//

import Testing
import Foundation
@testable import efb_212

@Suite("VerticalSpeedEstimator Tests")
struct VerticalSpeedEstimatorTests {

    /// Fixed epoch far from "now" -- proves the estimator keys on fix timestamps.
    static let t0 = Date(timeIntervalSince1970: 1_000_000_000)

    @Test func steadyClimbReadsFiveHundredFPM() {
        var estimator = VerticalSpeedEstimator()
        var last = 0.0
        // 500 fpm = 500/60 ft per second, 1 Hz fixes for 30 s
        for i in 0...30 {
            last = estimator.update(
                altitudeFeet: 100 + Double(i) * 500.0 / 60.0,
                timestamp: Self.t0.addingTimeInterval(Double(i)),
                verticalAccuracyMeters: 3
            )
        }
        #expect(abs(last - 500) < 10)
    }

    @Test func rateDependsOnFixTimestampsNotFixCount() {
        // Same per-fix altitude step, but fixes 2 s apart: half the climb rate.
        var oneHz = VerticalSpeedEstimator()
        var halfHz = VerticalSpeedEstimator()
        var oneHzResult = 0.0
        var halfHzResult = 0.0
        for i in 0...30 {
            let altitude = 100 + Double(i) * 10  // feet
            oneHzResult = oneHz.update(altitudeFeet: altitude,
                                       timestamp: Self.t0.addingTimeInterval(Double(i)),
                                       verticalAccuracyMeters: 3)
            halfHzResult = halfHz.update(altitudeFeet: altitude,
                                         timestamp: Self.t0.addingTimeInterval(Double(i) * 2),
                                         verticalAccuracyMeters: 3)
        }
        #expect(abs(oneHzResult - 600) < 10)
        #expect(abs(halfHzResult - 300) < 10)
    }

    @Test func descentIsNegative() {
        var estimator = VerticalSpeedEstimator()
        var last = 0.0
        for i in 0...20 {
            last = estimator.update(altitudeFeet: 3000 - Double(i) * 10,
                                    timestamp: Self.t0.addingTimeInterval(Double(i)),
                                    verticalAccuracyMeters: 3)
        }
        #expect(abs(last + 600) < 10)
    }

    @Test func invalidVerticalAccuracyIsIgnored() {
        var estimator = VerticalSpeedEstimator()
        for i in 0...10 {
            estimator.update(altitudeFeet: 100 + Double(i) * 10,
                             timestamp: Self.t0.addingTimeInterval(Double(i)),
                             verticalAccuracyMeters: 3)
        }
        let before = estimator.verticalSpeedFPM
        // Garbage altitude with negative accuracy must not disturb the estimate
        let held = estimator.update(altitudeFeet: 50_000,
                                    timestamp: Self.t0.addingTimeInterval(11),
                                    verticalAccuracyMeters: -1)
        #expect(held == before)
        #expect(estimator.verticalSpeedFPM == before)
    }

    @Test func smoothingDampsSingleFixJitter() {
        var estimator = VerticalSpeedEstimator()
        for i in 0...10 {
            estimator.update(altitudeFeet: 1000,
                             timestamp: Self.t0.addingTimeInterval(Double(i)),
                             verticalAccuracyMeters: 3)
        }
        // One 10 ft (3 m) jump in a single second is +600 fpm raw; EMA must show far less.
        let spike = estimator.update(altitudeFeet: 1010,
                                     timestamp: Self.t0.addingTimeInterval(11),
                                     verticalAccuracyMeters: 3)
        #expect(spike > 0)
        #expect(spike < 200)
    }

    @Test func duplicateTimestampDoesNotDivideByZero() {
        var estimator = VerticalSpeedEstimator()
        estimator.update(altitudeFeet: 100, timestamp: Self.t0, verticalAccuracyMeters: 3)
        let result = estimator.update(altitudeFeet: 200, timestamp: Self.t0, verticalAccuracyMeters: 3)
        #expect(result == 0)
        #expect(result.isFinite)
    }
}
