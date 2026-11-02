//
//  WeatherRefreshFailureTests.swift
//  efb-212Tests
//
//  efb-zfm.14, efb-bgb, efb-8d4: a failed weather refresh is never silent, a TAF carries its own
//  freshness, and a TAF past its valid period reads EXPIRED.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Weather refresh failures")
@MainActor
struct WeatherRefreshFailureTests {

    private static let taf = "TAF KPAO 021720Z 0218/0324 27008KT P6SM FEW040"

    // MARK: - View model

    @Test func aFailedMetarRefreshKeepsTheCachedReportAndTheError() async {
        let service = MockWeatherService()
        service.mockWeather["KPAO"] = WeatherCache(stationID: "KPAO", fetchedAt: Date(timeIntervalSinceNow: -7200))
        service.shouldFail = true
        let vm = WeatherViewModel(weatherService: service)

        await vm.loadWeather(for: "KPAO")

        #expect(vm.currentWeather?.stationID == "KPAO")  // the old report is still shown ...
        #expect(vm.error != nil)                          // ... and the sheet can say the refresh failed
    }

    @Test func aFailedTafRefreshKeepsThePreviousTafAndSaysSo() async {
        let service = MockWeatherService()
        service.mockWeather["KPAO"] = WeatherCache(stationID: "KPAO", fetchedAt: Date())
        service.mockTAF = Self.taf
        let vm = WeatherViewModel(weatherService: service)
        await vm.loadWeather(for: "KPAO")
        #expect(vm.currentTAF == Self.taf)
        #expect(!vm.tafFailed)

        service.tafShouldFail = true
        await vm.loadWeather(for: "KPAO")

        #expect(vm.currentTAF == Self.taf)
        #expect(vm.tafFailed)
    }

    @Test func aTafFromAnotherStationIsNeverShownForThisOne() async {
        let service = MockWeatherService()
        service.mockWeather["KPAO"] = WeatherCache(stationID: "KPAO", fetchedAt: Date())
        service.mockWeather["KSQL"] = WeatherCache(stationID: "KSQL", fetchedAt: Date())
        let vm = WeatherViewModel(weatherService: service)
        await vm.loadWeather(for: "KPAO")
        service.tafShouldFail = true

        await vm.loadWeather(for: "KSQL")

        #expect(vm.currentTAF == nil)
        #expect(vm.tafFailed)
    }

    // MARK: - Israel stations without a METAR (UX-IL)

    @Test func aTafOnlyIsraeliStationIsNotAskedForAMetarAndShowsNoError() async {
        let service = MockWeatherService()
        service.mockTAF = "TAF LLHZ 021720Z 0218/0324 27008KT CAVOK"
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel

        await vm.loadWeather(for: "LLHZ")

        #expect(service.fetchMETARCallCount == 0)
        #expect(vm.error == nil)                    // not a "download failed" banner
        #expect(vm.currentWeather == nil)
        #expect(!vm.metarPublished)
        #expect(vm.currentTAF?.hasPrefix("TAF LLHZ") == true)
    }

    @Test func anIsraeliAerodromeOutsideTheStationListGetsNoRequestsAtAll() async {
        let service = MockWeatherService()
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel

        await vm.loadWeather(for: "LLBO")

        #expect(service.fetchMETARCallCount == 0)
        #expect(service.fetchTAFCallCount == 0)
        #expect(vm.error == nil)
        #expect(!vm.tafFailed)
        #expect(!vm.metarPublished && !vm.tafPublished)
    }

    @Test func anIsraeliStationWithBothProductsStillFetchesBoth() async {
        let service = MockWeatherService()
        service.mockWeather["LLBG"] = WeatherCache(stationID: "LLBG", fetchedAt: Date())
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel

        await vm.loadWeather(for: "LLBG")

        #expect(service.fetchMETARCallCount == 1)
        #expect(service.fetchTAFCallCount == 1)
        #expect(vm.currentWeather?.stationID == "LLBG")
    }

    // MARK: - TAF validity

    private func utc(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso) ?? .distantPast
    }

    @Test func readsTheEndOfTheValidPeriodFromTheTafText() {
        let now = utc("2026-11-02T18:00:00Z")
        #expect(TAFValidity.validUntil(rawTAF: "TAF KPAO 021720Z 0218/0306 27008KT", now: now) == utc("2026-11-03T06:00:00Z"))
    }

    @Test func hour24MeansMidnightAtTheEndOfThatDay() {
        let now = utc("2026-11-02T18:00:00Z")
        #expect(TAFValidity.validUntil(rawTAF: "TAF KPAO 021720Z 0218/0324 27008KT", now: now) == utc("2026-11-04T00:00:00Z"))
    }

    @Test func aValidPeriodAcrossAMonthBoundaryResolvesToTheNextMonth() {
        let now = utc("2026-11-30T20:00:00Z")
        #expect(TAFValidity.validUntil(rawTAF: "TAF KPAO 301720Z 3018/0124 27008KT", now: now) == utc("2026-12-02T00:00:00Z"))
    }

    @Test func aTafWithoutAValidPeriodHasNoEnd() {
        #expect(TAFValidity.validUntil(rawTAF: "no forecast here 1/2SM", now: Date()) == nil)
    }

    @Test func aTafPastItsValidPeriodReadsExpiredEvenWhenJustFetched() {
        let service = MockWeatherService()
        service.mockTAF = "TAF KPAO 011720Z 0118/0224 27008KT"  // ended 2 Nov 24Z
        let vm = WeatherViewModel(weatherService: service)
        vm.currentTAF = service.mockTAF
        vm.tafFetchedAt = utc("2026-11-03T12:00:00Z")

        let freshness = vm.tafFreshness(now: utc("2026-11-03T12:05:00Z"))

        #expect(freshness?.text == "EXPIRED")
        #expect(freshness?.level == .expired)
    }

    @Test func aTafInsideItsValidPeriodIsNotExpired() {
        let service = MockWeatherService()
        let vm = WeatherViewModel(weatherService: service)
        vm.currentTAF = Self.taf  // valid to 4 Nov 00Z
        vm.tafFetchedAt = utc("2026-11-02T18:00:00Z")

        #expect(vm.tafFreshness(now: utc("2026-11-02T18:30:00Z"))?.level == .fresh)
    }
}
