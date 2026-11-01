//
//  WeatherServiceTests.swift
//  efb-212Tests
//
//  WeatherService behaviour that WeatherParsingTests does not cover: flight-category
//  thresholds when NOAA omits fltCat, HTTP/transport failure handling, the 15-minute cache,
//  station batching and partial-batch failure, TAF extraction, and WeatherCache staleness.
//

import Testing
import Foundation
@testable import efb_212

/// Thread-safe request log for stub handlers (the handler closure is @Sendable).
nonisolated final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []

    func record(_ url: URL?) {
        guard let url else { return }
        lock.withLock { urls.append(url) }
    }
    var count: Int { lock.withLock { urls.count } }
    var all: [URL] { lock.withLock { urls } }
}

@Suite("Weather Service Tests")
@MainActor
struct WeatherServiceTests {

    // MARK: - Helpers

    /// `ids` query parameter of a request, split on commas.
    nonisolated static func requestedIDs(_ request: URLRequest) -> [String] {
        guard let url = request.url,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let ids = items.first(where: { $0.name == "ids" })?.value else { return [] }
        return ids.split(separator: ",").map(String.init)
    }

    /// A METAR JSON array with one VFR entry per requested id.
    nonisolated static func metarJSON(for ids: [String]) -> Data {
        let entries = ids.map { #"{"icaoId":"\#($0)","fltCat":"VFR","visib":"10+"}"# }
        return Data("[\(entries.joined(separator: ","))]".utf8)
    }

    /// Parse one synthetic METAR without a NOAA flight category, so the service must compute it.
    static func computedCategory(ceilingFeet: Int?, visibilitySM: String?) throws -> FlightCategory {
        var fields = [#""icaoId":"KTST""#]
        if let visibilitySM { fields.append(#""visib":"\#(visibilitySM)""#) }
        if let ceilingFeet { fields.append(#""clouds":[{"cover":"BKN","base":\#(ceilingFeet)}]"#) }
        let json = Data("[{\(fields.joined(separator: ","))}]".utf8)
        return try #require(try WeatherService().parseMetarResponse(json).first).flightCategory
    }

    // MARK: - Flight category thresholds (FAA: ceiling and visibility, worst wins)

    @Test(arguments: [
        (3001, "VFR"), (3000, "MVFR"), (1000, "MVFR"), (999, "IFR"), (500, "IFR"), (499, "LIFR"),
    ] as [(Int, String)])
    func ceilingBoundaries(ceiling: Int, expected: String) throws {
        let category = try Self.computedCategory(ceilingFeet: ceiling, visibilitySM: "10")
        #expect(category.rawValue == expected.lowercased(), "ceiling \(ceiling) ft")
    }

    @Test(arguments: [
        ("6", "VFR"), ("5", "MVFR"), ("3", "MVFR"), ("2.9", "IFR"), ("1", "IFR"), ("0.5", "LIFR"),
    ] as [(String, String)])
    func visibilityBoundaries(visibility: String, expected: String) throws {
        let category = try Self.computedCategory(ceilingFeet: nil, visibilitySM: visibility)
        #expect(category.rawValue == expected.lowercased(), "visibility \(visibility) SM")
    }

    @Test func worseOfCeilingAndVisibilityWins() throws {
        // Ceiling alone would be VFR, visibility alone IFR.
        #expect(try Self.computedCategory(ceilingFeet: 8000, visibilitySM: "2") == .ifr)
        // Ceiling alone LIFR, visibility alone VFR.
        #expect(try Self.computedCategory(ceilingFeet: 300, visibilitySM: "10") == .lifr)
    }

    @Test func noCeilingAndNoVisibilityDefaultsToVFR() throws {
        #expect(try Self.computedCategory(ceilingFeet: nil, visibilitySM: nil) == .vfr)
    }

    @Test func noaaFlightCategoryOverridesComputedOne() throws {
        // NOAA says LIFR even though the numbers alone would say VFR; the report is authoritative.
        let json = Data(#"[{"icaoId":"KTST","fltCat":"LIFR","visib":"10"}]"#.utf8)
        let wx = try #require(try WeatherService().parseMetarResponse(json).first)
        #expect(wx.flightCategory == .lifr)
    }

    @Test func entriesWithoutStationIdAreDropped() throws {
        let json = Data(#"[{"fltCat":"VFR"},{"icaoId":"KPAO","fltCat":"VFR"}]"#.utf8)
        #expect(try WeatherService().parseMetarResponse(json).map(\.stationID) == ["KPAO"])
    }

    @Test func nonArrayPayloadThrowsWeatherFetchFailed() {
        let service = WeatherService()
        #expect(throws: EFBError.self) {
            try service.parseMetarResponse(Data(#"{"error":"nope"}"#.utf8))
        }
    }

    // MARK: - fetchMETAR failures

    @Test func serverErrorThrowsAndLeavesCacheEmpty() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (500, Data()) })

        await #expect(throws: EFBError.self) { try await service.fetchMETAR(for: "KPAO") }
        #expect(service.cachedWeather(for: "KPAO") == nil)
    }

    @Test func emptyArrayForUnknownStationThrows() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, Data("[]".utf8)) })

        await #expect(throws: EFBError.self) { try await service.fetchMETAR(for: "KZZZ") }
    }

    @Test func transportFailureSurfacesAsAnError() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in throw URLError(.notConnectedToInternet) })

        await #expect(throws: (any Error).self) { try await service.fetchMETAR(for: "KPAO") }
    }

    // MARK: - Cache

    @Test func secondFetchWithinFifteenMinutesIsServedFromCache() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            return (200, Self.metarJSON(for: Self.requestedIDs(request)))
        })

        let first = try await service.fetchMETAR(for: "KPAO")
        let second = try await service.fetchMETAR(for: "KPAO")

        #expect(log.count == 1)
        #expect(second == first)
    }

    @Test func clearingCacheForcesANetworkFetch() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            return (200, Self.metarJSON(for: Self.requestedIDs(request)))
        })

        _ = try await service.fetchMETAR(for: "KPAO")
        await service.clearCache(for: "KPAO")
        _ = try await service.fetchMETAR(for: "KPAO")

        #expect(log.count == 2)
    }

    // MARK: - Batch fetch

    @Test func emptyStationListMakesNoRequest() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            return (200, Data("[]".utf8))
        })

        #expect(try await service.fetchWeatherForStations([]).isEmpty)
        #expect(log.count == 0)
    }

    @Test func largeStationListIsSplitIntoBatchesOfForty() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            return (200, Self.metarJSON(for: Self.requestedIDs(request)))
        })
        let ids = (0..<45).map { String(format: "K%03d", $0) }

        let results = try await service.fetchWeatherForStations(ids)

        #expect(results.count == 45)
        #expect(log.count == 2)
        let sizes = log.all.map { url in
            (URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "ids" }?.value?.split(separator: ",").count) ?? 0
        }
        #expect(sizes == [40, 5])
    }

    @Test func batchFetchSkipsCachedStationsAndOnlyRequestsTheRest() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            return (200, Self.metarJSON(for: Self.requestedIDs(request)))
        })
        _ = try await service.fetchMETAR(for: "KPAO")

        let results = try await service.fetchWeatherForStations(["KPAO", "KSQL"])

        #expect(Set(results.map(\.stationID)) == ["KPAO", "KSQL"])
        #expect(log.count == 2)
        #expect(Self.requestedIDs(URLRequest(url: log.all[1])) == ["KSQL"])
    }

    @Test func failedBatchDoesNotLoseTheOtherBatch() async throws {
        let log = RequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.record(request.url)
            // First batch fails, second succeeds.
            return log.count == 1 ? (503, Data()) : (200, Self.metarJSON(for: Self.requestedIDs(request)))
        })
        let ids = (0..<45).map { String(format: "K%03d", $0) }

        let results = try await service.fetchWeatherForStations(ids)

        #expect(results.count == 5)
        #expect(Set(results.map(\.stationID)) == Set(ids.suffix(5)))
    }

    // MARK: - TAF

    @Test func fetchTAFReturnsRawText() async throws {
        let body = Data(#"[{"icaoId":"KPAO","rawTAF":"TAF KPAO 301130Z 3012/3112 33008KT P6SM SKC"}]"#.utf8)
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, body) })

        #expect(try await service.fetchTAF(for: "KPAO") == "TAF KPAO 301130Z 3012/3112 33008KT P6SM SKC")
    }

    @Test func fetchTAFWithoutRawTextThrows() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, Data(#"[{"icaoId":"KPAO"}]"#.utf8)) })

        await #expect(throws: EFBError.self) { try await service.fetchTAF(for: "KPAO") }
    }

    @Test func fetchTAFHTTPErrorThrows() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (404, Data()) })

        await #expect(throws: EFBError.self) { try await service.fetchTAF(for: "KPAO") }
    }

    // MARK: - WeatherCache staleness

    @Test func stalenessThresholdIsSixtyMinutes() {
        let justFresh = WeatherCache(stationID: "KPAO", fetchedAt: Date(timeIntervalSinceNow: -3590))
        let justStale = WeatherCache(stationID: "KPAO", fetchedAt: Date(timeIntervalSinceNow: -3610))
        #expect(!justFresh.isStale)
        #expect(justStale.isStale)
    }

    @Test func ageGrowsWithTimeSinceFetch() {
        let weather = WeatherCache(stationID: "KPAO", fetchedAt: Date(timeIntervalSinceNow: -7200))
        #expect(weather.age > 7195 && weather.age < 7210)   // seconds
    }
}
