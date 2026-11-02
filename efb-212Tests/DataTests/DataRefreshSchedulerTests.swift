//
//  DataRefreshSchedulerTests.swift
//  efb-212Tests
//
//  efb-zfm.13: in-flight refresh timing: interval per product, Low Power Mode, offline, layer off, backoff.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Data refresh scheduler")
struct DataRefreshSchedulerTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func due(_ scheduler: DataRefreshScheduler, ageMinutes: Double, wanted: Set<RefreshProduct> = Set(RefreshProduct.allCases),
                     lowPower: Bool = false, network: Bool = true) -> Set<RefreshProduct> {
        let data = Dictionary(uniqueKeysWithValues: RefreshProduct.allCases.map { ($0, now.addingTimeInterval(-ageMinutes * 60)) })
        return Set(scheduler.due(wanted: wanted, lastData: data, now: now, lowPower: lowPower, networkAvailable: network))
    }

    @Test func eachProductRefreshesWhenItsDataIsAsOldAsItsCache() {
        let scheduler = DataRefreshScheduler()
        #expect(due(scheduler, ageMinutes: 9).isEmpty)
        #expect(due(scheduler, ageMinutes: 10) == [.tfr, .advisories])
        #expect(due(scheduler, ageMinutes: 15) == [.weather, .tfr, .advisories])
    }

    @Test func neverLoadedDataIsDueImmediately() {
        let scheduler = DataRefreshScheduler()
        let result = scheduler.due(wanted: [.tfr], lastData: [:], now: now, lowPower: false, networkAvailable: true)
        #expect(result == [.tfr])
    }

    @Test func lowPowerModeDoublesTheIntervals() {
        let scheduler = DataRefreshScheduler()
        #expect(due(scheduler, ageMinutes: 19, lowPower: true).isEmpty)
        #expect(due(scheduler, ageMinutes: 20, lowPower: true) == [.tfr, .advisories])
    }

    @Test func nothingRefreshesOffline() {
        #expect(due(DataRefreshScheduler(), ageMinutes: 600, network: false).isEmpty)
    }

    @Test func onlyLayersThatAreOnRefresh() {
        #expect(due(DataRefreshScheduler(), ageMinutes: 600, wanted: [.tfr]) == [.tfr])
        #expect(due(DataRefreshScheduler(), ageMinutes: 600, wanted: []).isEmpty)
    }

    @Test func aFailedAttemptBacksOffAndASuccessResets() {
        var scheduler = DataRefreshScheduler()
        let data: [RefreshProduct: Date] = [.tfr: now.addingTimeInterval(-3600)]
        scheduler.recordAttempt(.tfr, at: now, success: false)
        #expect(scheduler.interval(for: .tfr, lowPower: false) == 20 * 60)  // 2x
        #expect(scheduler.due(wanted: [.tfr], lastData: data, now: now.addingTimeInterval(19 * 60), lowPower: false, networkAvailable: true).isEmpty)
        #expect(scheduler.due(wanted: [.tfr], lastData: data, now: now.addingTimeInterval(20 * 60), lowPower: false, networkAvailable: true) == [.tfr])

        scheduler.recordAttempt(.tfr, at: now, success: false)
        scheduler.recordAttempt(.tfr, at: now, success: false)
        scheduler.recordAttempt(.tfr, at: now, success: false)
        #expect(scheduler.interval(for: .tfr, lowPower: false) == 40 * 60)  // capped at 4x

        scheduler.recordAttempt(.tfr, at: now, success: true)
        #expect(scheduler.interval(for: .tfr, lowPower: false) == 10 * 60)
    }
}
