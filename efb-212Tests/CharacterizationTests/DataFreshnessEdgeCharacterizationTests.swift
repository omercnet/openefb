//
//  DataFreshnessEdgeCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization: pins what DataFreshness.evaluate returns at the boundaries DataFreshnessTests
//  leaves open: TAF age rule, last minute before each EXPIRED threshold, `validUntil` versus
//  age-based products, the EXPIRES countdown text, and the spoken product names.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Data Freshness Edge Characterization")
struct DataFreshnessEdgeCharacterizationTests {

    static let now = Date(timeIntervalSince1970: 1_793_332_020)

    /// Evaluate `product` observed `minutes` ago, with an optional validity end `validInMinutes` from now.
    static func eval(_ product: DataProduct, minutes: Double, validInMinutes: Double? = nil) -> DataFreshness {
        DataFreshness.evaluate(
            product,
            observed: now.addingTimeInterval(-minutes * 60),
            validUntil: validInMinutes.map { now.addingTimeInterval($0 * 60) },
            now: now
        )
    }

    static func chart(daysLeft: Double) -> DataFreshness {
        DataFreshness.evaluate(.chartCycle, validUntil: now.addingTimeInterval(daysLeft * 86_400), now: now)
    }

    // MARK: - TAF age rule (oldAfter 7 h, no expiredAfter)

    @Test func tafWithoutValidPeriodIsFreshAt6h59mAndOldAt7h() {
        let before = Self.eval(.taf, minutes: 419)
        #expect(before.level == .fresh)
        #expect(before.text == "6h 59m")
        let at = Self.eval(.taf, minutes: 420)
        #expect(at.level == .old)
        #expect(at.text == "OLD 7h")
    }

    @Test func tafInsideItsValidPeriodStillReadsOldFrom7hOfAge() {
        // Valid period ends 10 h from now: the age rule runs first, the window never reads VALID.
        let before = Self.eval(.taf, minutes: 419, validInMinutes: 600)
        #expect(before.level == .fresh)
        #expect(before.text == "6h 59m")
        let at = Self.eval(.taf, minutes: 420, validInMinutes: 600)
        #expect(at.level == .old)
        #expect(at.text == "OLD 7h")
    }

    @Test func tafWithoutValidPeriodExpiresByAgeAt30h() {
        // efb-8d4: a TAF with no usable validity end still reads EXPIRED once it is older than the longest valid period.
        let before = Self.eval(.taf, minutes: 30 * 60 - 1)
        #expect(before.level == .old)
        let result = Self.eval(.taf, minutes: 48 * 60)
        #expect(result.level == .expired)
        #expect(result.text == "EXPIRED")
    }

    // MARK: - Last minute before EXPIRED

    @Test func notamAt359MinutesIsOldAndAt360IsExpired() {
        let before = Self.eval(.notam, minutes: 359)
        #expect(before.level == .old)
        #expect(before.text == "OLD 5h 59m")
        let at = Self.eval(.notam, minutes: 360)
        #expect(at.level == .expired)
        #expect(at.text == "EXPIRED")
    }

    @Test func pirepAt119MinutesIsOld() {
        let result = Self.eval(.pirep, minutes: 119)
        #expect(result.level == .old)
        #expect(result.text == "OLD 1h 59m")
    }

    // MARK: - validUntil versus age-based products

    @Test func tfrWithPastValidUntilAndFreshFetchIsRedExpired() {
        // Fetched 10 min ago (fresh by age) but validUntil passed 1 min ago: validity end wins.
        let result = Self.eval(.tfr, minutes: 10, validInMinutes: -1)
        #expect(result.level == .unsafe)
        #expect(result.text == "EXPIRED")
    }

    @Test func tfrWithFutureValidUntilFollowsTheAgeRule() {
        let fresh = Self.eval(.tfr, minutes: 10, validInMinutes: 60)
        #expect(fresh.level == .fresh)
        #expect(fresh.text == "10 min")
        let stale = Self.eval(.tfr, minutes: 180, validInMinutes: 60)
        #expect(stale.level == .unsafe)
        #expect(stale.text == "EXPIRED")
    }

    @Test func metarWithFutureValidUntilIsJudgedByAge() {
        let fresh = Self.eval(.metar, minutes: 10, validInMinutes: 60)
        #expect(fresh.level == .fresh)
        #expect(fresh.text == "10 min")
        let old = Self.eval(.metar, minutes: 240, validInMinutes: 60)
        #expect(old.level == .expired)
        #expect(old.text == "EXPIRED")
    }

    @Test func metarWithPastValidUntilIsExpiredEvenWhenJustObserved() {
        let result = Self.eval(.metar, minutes: 1, validInMinutes: -1)
        #expect(result.level == .expired)
        #expect(result.text == "EXPIRED")
    }

    @Test func validUntilEqualToNowIsNotYetExpired() {
        // Strict `now > validUntil`: the exact end instant still counts as valid.
        let result = Self.eval(.metar, minutes: 10, validInMinutes: 0)
        #expect(result.level == .fresh)
        #expect(result.text == "10 min")
    }

    @Test func windsAloftWithOnlyAnObservedTimeIsUnknown() {
        // No oldAfter for winds: an observed time alone falls through to N/A.
        let result = Self.eval(.windsAloft, minutes: 1)
        #expect(result.level == .unknown)
        #expect(result.text == "N/A")
    }

    // MARK: - EXPIRES countdown

    @Test func chartCycleExactlySevenDaysLeftReadsExpires7d() {
        let result = Self.chart(daysLeft: 7)
        #expect(result.level == .old)
        #expect(result.text == "EXPIRES 7d")
    }

    @Test func chartCycleJustOverSevenDaysLeftReadsValid() {
        let result = DataFreshness.evaluate(
            .chartCycle, validUntil: Self.now.addingTimeInterval(7 * 86_400 + 1), now: Self.now
        )
        #expect(result.level == .fresh)
        #expect(result.text == "VALID")
    }

    @Test func chartCycleFractionalDaysRoundUp() {
        #expect(Self.chart(daysLeft: 2.5).text == "EXPIRES 3d")
        #expect(Self.chart(daysLeft: 6.01).text == "EXPIRES 7d")
        #expect(Self.chart(daysLeft: 0.1).text == "EXPIRES 1d")
    }

    @Test func chartCycleAtTheExactEndInstantReadsExpires0d() {
        let result = Self.chart(daysLeft: 0)
        #expect(result.level == .old)
        #expect(result.text == "EXPIRES 0d")
    }

    @Test func chartCycleIgnoresAnObservedTime() {
        let result = DataFreshness.evaluate(
            .chartCycle,
            observed: Self.now.addingTimeInterval(-365 * 86_400),
            validUntil: Self.now.addingTimeInterval(30 * 86_400),
            now: Self.now
        )
        #expect(result.level == .fresh)
        #expect(result.text == "VALID")
    }

    // MARK: - Spoken names

    @Test func displayNameForEveryProduct() {
        let names = Dictionary(uniqueKeysWithValues: DataProduct.allCases.map { ($0, $0.displayName) })
        #expect(names == [
            .metar: "METAR",
            .taf: "TAF",
            .pirep: "PIREP",
            .windsAloft: "Winds aloft",
            .tfr: "TFR data",
            .airmetSigmet: "AIRMET/SIGMET data",
            .notam: "NOTAM data",
            .chartCycle: "Chart cycle",
        ])
    }
}
