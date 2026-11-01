//
//  DataFreshnessTests.swift
//  efb-212Tests
//
//  Per-product freshness thresholds (F12): neutral when fresh, amber OLD / EXPIRED past the
//  product's useful life, red only where using the data is unsafe.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Data Freshness Tests")
struct DataFreshnessTests {

    static let now = Date(timeIntervalSince1970: 1_793_332_020)

    private func age(_ product: DataProduct, minutes: Double) -> DataFreshness {
        DataFreshness.evaluate(product, observed: Self.now.addingTimeInterval(-minutes * 60), now: Self.now)
    }

    // MARK: Age-based products

    @Test("METAR: fresh under 75 min, OLD from 75 min, EXPIRED from 3 h")
    func metarThresholds() {
        #expect(age(.metar, minutes: 74).level == .fresh)
        #expect(age(.metar, minutes: 75).level == .old)
        #expect(age(.metar, minutes: 179).level == .old)
        #expect(age(.metar, minutes: 180).level == .expired)
    }

    @Test("PIREP: OLD from 60 min, EXPIRED from 2 h (matches the 2 h query window)")
    func pirepThresholds() {
        #expect(age(.pirep, minutes: 59).level == .fresh)
        #expect(age(.pirep, minutes: 60).level == .old)
        #expect(age(.pirep, minutes: 120).level == .expired)
    }

    @Test("NOTAM: OLD from 60 min, EXPIRED from 6 h")
    func notamThresholds() {
        #expect(age(.notam, minutes: 59).level == .fresh)
        #expect(age(.notam, minutes: 60).level == .old)
        #expect(age(.notam, minutes: 360).level == .expired)
    }

    @Test("AIRMET/SIGMET layer: OLD from 30 min, EXPIRED from 2 h, never red")
    func airSigmetThresholds() {
        #expect(age(.airmetSigmet, minutes: 29).level == .fresh)
        #expect(age(.airmetSigmet, minutes: 30).level == .old)
        #expect(age(.airmetSigmet, minutes: 120).level == .expired)
    }

    @Test("TFR layer: OLD from 30 min, red (unsafe) from 2 h")
    func tfrThresholds() {
        #expect(age(.tfr, minutes: 29).level == .fresh)
        #expect(age(.tfr, minutes: 30).level == .old)
        #expect(age(.tfr, minutes: 119).level == .old)
        #expect(age(.tfr, minutes: 120).level == .unsafe)
    }

    @Test("Only TFR data ever reads unsafe; every other age-based product tops out at amber")
    func onlyTFRIsRed() {
        for product in DataProduct.allCases where product != .tfr {
            #expect(age(product, minutes: 100_000).level < .unsafe)
        }
    }

    // MARK: Window-based products

    @Test("Winds aloft: judged by the FOR USE window, not time since issue")
    func windsAloftWindow() {
        let start = Self.now.addingTimeInterval(-3600)
        let end = Self.now.addingTimeInterval(3600)
        // Issued 5 h ago but still inside its window: not old.
        #expect(DataFreshness.evaluate(.windsAloft, validFrom: start, validUntil: end, now: Self.now).level == .fresh)
        // Window ended.
        #expect(DataFreshness.evaluate(.windsAloft, validFrom: start, validUntil: Self.now.addingTimeInterval(-1), now: Self.now)
            .level == .expired)
        // Window not yet open: not expired.
        let future = Self.now.addingTimeInterval(1800)
        #expect(DataFreshness.evaluate(.windsAloft, validFrom: future, validUntil: future.addingTimeInterval(3600), now: Self.now)
            .text == "NOT YET VALID")
    }

    @Test("Winds aloft without a parseable window is unknown, never current")
    func windsAloftUnknown() {
        let result = DataFreshness.evaluate(.windsAloft, now: Self.now)
        #expect(result.level == .unknown)
        #expect(result.text == "N/A")
    }

    @Test("Chart cycle: neutral until 7 days left, amber OLD countdown, amber EXPIRED after")
    func chartCycleWindow() {
        func result(daysLeft: Double) -> DataFreshness {
            DataFreshness.evaluate(.chartCycle, validUntil: Self.now.addingTimeInterval(daysLeft * 86_400), now: Self.now)
        }
        #expect(result(daysLeft: 8).level == .fresh)
        #expect(result(daysLeft: 7).level == .old)
        #expect(result(daysLeft: 3).text == "EXPIRES 3d")
        #expect(result(daysLeft: -0.1).level == .expired)
        #expect(result(daysLeft: -30).level != .unsafe)
    }

    @Test("TAF: the valid period decides, not the age")
    func tafValidPeriod() {
        let issued = Self.now.addingTimeInterval(-5 * 3600)
        let validEnd = Self.now.addingTimeInterval(3600)
        #expect(DataFreshness.evaluate(.taf, observed: issued, validUntil: validEnd, now: Self.now).level == .fresh)
        #expect(DataFreshness.evaluate(.taf, observed: issued, validUntil: Self.now.addingTimeInterval(-60), now: Self.now)
            .level == .expired)
    }

    // MARK: Text and edge cases

    @Test("Missing timestamp is N/A, not current")
    func missingTimestamp() {
        let result = DataFreshness.evaluate(.metar, observed: nil, now: Self.now)
        #expect(result.level == .unknown)
        #expect(result.text == "N/A")
    }

    @Test("Clock skew (observation in the future) reads as fresh, not negative")
    func futureObservation() {
        let result = DataFreshness.evaluate(.metar, observed: Self.now.addingTimeInterval(300), now: Self.now)
        #expect(result.level == .fresh)
        #expect(result.text == "<1 min")
    }

    @Test("Age text formats minutes and hours")
    func ageText() {
        #expect(DataFreshness.ageText(30) == "<1 min")
        #expect(DataFreshness.ageText(15 * 60) == "15 min")
        #expect(DataFreshness.ageText(60 * 60) == "1h")
        #expect(DataFreshness.ageText(90 * 60) == "1h 30m")
        #expect(age(.metar, minutes: 80).text == "OLD 1h 20m")
    }
}
