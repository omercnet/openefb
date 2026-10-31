//
//  WeatherParsingTests.swift
//  efb-212Tests
//
//  Real NOAA aviationweather.gov response shapes against WeatherService parsing and cache.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Weather Parsing Tests")
struct WeatherParsingTests {

    /// Shape captured from https://aviationweather.gov/api/data/metar?ids=KPAO&format=json
    /// (obsTime is epoch seconds, reportTime is ISO-8601 with fractional seconds, visib "10+").
    static let kpaoJSON = """
    [{"icaoId":"KPAO","obsTime":1793332020,"reportTime":"2026-10-30T04:00:00.000Z",
      "temp":14,"dewp":9.4,"wdir":330,"wspd":6,"visib":"10+","fltCat":"VFR",
      "rawOb":"METAR KPAO 300253Z 33006KT 10SM BKN180 14/09 A3002",
      "clouds":[{"cover":"BKN","base":18000}]}]
    """.data(using: .utf8)!

    static func makeService() -> WeatherService {
        WeatherService(session: StubURLProtocol.session { _ in (200, kpaoJSON) })
    }

    @Test func parsesEpochObsTimeAsObservationTime() throws {
        let entries = try WeatherService().parseMetarResponse(Self.kpaoJSON)
        let wx = try #require(entries.first)
        #expect(wx.observationTime == Date(timeIntervalSince1970: 1793332020))
        #expect(wx.stationID == "KPAO")
        #expect(wx.ceiling == 18000)
        #expect(wx.visibility == "10+")
        #expect(wx.flightCategory == .vfr)
        #expect(wx.windDirection == 330)
    }

    @Test func fallsBackToReportTimeWhenObsTimeMissing() throws {
        let json = #"[{"icaoId":"KSQL","reportTime":"2026-10-30T04:00:00.000Z","fltCat":"MVFR"}]"#
        let wx = try #require(try WeatherService().parseMetarResponse(Data(json.utf8)).first)
        #expect(wx.observationTime == ISO8601DateFormatter().date(from: "2026-10-30T04:00:00Z"))
        #expect(wx.flightCategory == .mvfr)
    }

    @Test func missingTimesLeaveObservationTimeNil() throws {
        let json = #"[{"icaoId":"KSQL"}]"#
        let wx = try #require(try WeatherService().parseMetarResponse(Data(json.utf8)).first)
        #expect(wx.observationTime == nil)
    }

    @Test func computesCategoryFromLowestCeilingWhenNoFltCat() throws {
        let json = #"[{"icaoId":"KSFO","visib":10,"clouds":[{"cover":"FEW","base":400},{"cover":"OVC","base":800}]}]"#
        let wx = try #require(try WeatherService().parseMetarResponse(Data(json.utf8)).first)
        #expect(wx.ceiling == 800)          // FEW is not a ceiling
        #expect(wx.flightCategory == .ifr)  // 500-999 ft
    }

    @Test func cachedWeatherReturnsEntryStoredByFetchUntilCleared() async throws {
        let service = Self.makeService()
        #expect(service.cachedWeather(for: "KPAO") == nil)

        let fetched = try await service.fetchMETAR(for: "KPAO")
        #expect(service.cachedWeather(for: "KPAO") == fetched)

        await service.clearCache(for: "KPAO")
        #expect(service.cachedWeather(for: "KPAO") == nil)
    }
}
