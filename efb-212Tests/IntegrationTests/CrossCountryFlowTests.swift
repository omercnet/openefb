//
//  CrossCountryFlowTests.swift
//  efb-212Tests
//
//  Planning flow across view models: pick KPAO -> KSQL, load weather for both ends, and check
//  the pieces stay consistent and degrade safely (weather failure never blocks the plan and
//  never turns old data into "current" data). No UI or map view involved.
//

import Testing
import Foundation
import SwiftData
@testable import efb_212

@Suite("Cross-Country Flow Integration Tests")
@MainActor
struct CrossCountryFlowTests {

    static let kpao = FlightPlanViewModelTests.kpao
    static let ksql = FlightPlanViewModelTests.ksql

    static func makeWeather(_ station: String, category: FlightCategory, age: TimeInterval) -> WeatherCache {
        WeatherCache(
            stationID: station,
            rawMETAR: "\(station) 121855Z 31008KT 10SM FEW040 20/10 A3012",
            temperature: 20, dewpoint: 10,
            windDirection: 310, windSpeed: 8,
            visibility: "10+", ceiling: nil,
            flightCategory: category,
            fetchedAt: Date(timeIntervalSinceNow: -age)
        )
    }

    @Test func planThenWeatherForBothEndsStaysConsistent() async throws {
        let h = try FlightPlanViewModelTests.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)

        let service = MockWeatherService()
        service.mockWeather["KPAO"] = Self.makeWeather("KPAO", category: .vfr, age: 60)
        service.mockWeather["KSQL"] = Self.makeWeather("KSQL", category: .mvfr, age: 60)
        let departureWx = WeatherViewModel(weatherService: service)
        let destinationWx = WeatherViewModel(weatherService: service)

        await departureWx.loadWeather(for: try #require(h.appState.activePlanDeparture))
        await destinationWx.loadWeather(for: try #require(h.appState.activePlanDestination))

        #expect(departureWx.currentWeather?.stationID == "KPAO")
        #expect(departureWx.currentWeather?.flightCategory == .vfr)
        #expect(destinationWx.currentWeather?.stationID == "KSQL")
        #expect(destinationWx.currentWeather?.flightCategory == .mvfr)
        #expect(departureWx.error == nil && destinationWx.error == nil)
        #expect(departureWx.currentWeather?.isStale == false)
    }

    @Test func weatherOutageDoesNotBlockPlanAndSurfacesAnError() async throws {
        let h = try FlightPlanViewModelTests.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)

        let service = MockWeatherService()
        service.shouldFail = true
        let weather = WeatherViewModel(weatherService: service)
        await weather.loadWeather(for: "KPAO")

        #expect(h.appState.activeFlightPlan, "route stays active without weather")
        #expect(h.vm.distanceNM > 0)
        #expect(weather.error != nil)
        #expect(weather.currentWeather == nil)   // nothing to show rather than invented data
        #expect(weather.currentTAF == nil)
    }

    @Test func outageFallsBackToCachedWeatherThatIsFlaggedStale() async {
        let service = MockWeatherService()
        service.mockWeather["KPAO"] = Self.makeWeather("KPAO", category: .vfr, age: 2 * 3600)
        service.shouldFail = true
        let weather = WeatherViewModel(weatherService: service)

        await weather.loadWeather(for: "KPAO")

        // The old report is still available to the pilot, but it must be marked stale and the
        // fetch error must be visible alongside it.
        #expect(weather.error != nil)
        let shown = weather.currentWeather
        #expect(shown?.stationID == "KPAO")
        #expect(shown?.isStale == true)
    }

    @Test func clearingThePlanLeavesWeatherStateIndependent() async throws {
        let h = try FlightPlanViewModelTests.makeHarness()
        h.vm.selectDeparture(Self.kpao)
        h.vm.selectDestination(Self.ksql)

        let service = MockWeatherService()
        service.mockWeather["KPAO"] = Self.makeWeather("KPAO", category: .vfr, age: 0)
        let weather = WeatherViewModel(weatherService: service)
        await weather.loadWeather(for: "KPAO")

        h.vm.clearPlan()

        #expect(h.appState.activeFlightPlan == false)
        #expect(weather.currentWeather?.stationID == "KPAO")
    }
}
