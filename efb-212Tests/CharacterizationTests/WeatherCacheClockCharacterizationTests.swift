//
//  WeatherCacheClockCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization tests (docs/TESTING.md, CQ-1): pin the WeatherService cache window and what
//  it serves when the network fails, through the `now:` clock seam. Existing tests only proved
//  "within 15 minutes is cached" and "clearCache refetches"; the 900 s boundary itself and the
//  stale-on-failure behavior were unpinned.
//

import Testing
import Foundation
@testable import efb_212

/// A clock tests advance by hand. Locked so the @Sendable closure can read it from the actor.
nonisolated final class AdvancingClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) { current = start }

    var now: Date { lock.withLock { current } }
    func advance(by seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
}

@Suite("WeatherService cache window characterization")
@MainActor
struct WeatherCacheClockCharacterizationTests {

    static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    /// A session answering with one VFR METAR per requested station, or a status when `failing`.
    static func session(log: RequestLog, failing: FailureSwitch) -> URLSession {
        StubURLProtocol.session { request in
            log.record(request.url)
            if failing.isOn { return (500, Data()) }
            return (200, WeatherServiceTests.metarJSON(for: WeatherServiceTests.requestedIDs(request)))
        }
    }

    nonisolated final class FailureSwitch: @unchecked Sendable {
        private let lock = NSLock()
        private var on = false
        var isOn: Bool { lock.withLock { on } }
        func set(_ value: Bool) { lock.withLock { on = value } }
    }

    // MARK: - Window boundary

    @Test func fetchStampsFetchedAtFromTheInjectedClock() async throws {
        let clock = AdvancingClock(Self.t0)
        let service = WeatherService(session: Self.session(log: RequestLog(), failing: FailureSwitch()), now: { clock.now })

        let wx = try await service.fetchMETAR(for: "KPAO")
        #expect(wx.fetchedAt == Self.t0)
    }

    @Test func entryIsServedFromCacheAt899SecondsAndRefetchedAtExactly900() async throws {
        let clock = AdvancingClock(Self.t0)
        let log = RequestLog()
        let service = WeatherService(session: Self.session(log: log, failing: FailureSwitch()), now: { clock.now })

        _ = try await service.fetchMETAR(for: "KPAO")
        #expect(log.count == 1)

        clock.advance(by: 899)   // seconds
        _ = try await service.fetchMETAR(for: "KPAO")
        #expect(log.count == 1)

        clock.advance(by: 1)     // exactly 900 s: the comparison is strictly "<", so this refetches
        _ = try await service.fetchMETAR(for: "KPAO")
        #expect(log.count == 2)
    }

    @Test func batchPathUsesTheSameBoundary() async throws {
        let clock = AdvancingClock(Self.t0)
        let log = RequestLog()
        let service = WeatherService(session: Self.session(log: log, failing: FailureSwitch()), now: { clock.now })

        _ = try await service.fetchWeatherForStations(["KPAO", "KSQL"])
        #expect(log.count == 1)

        clock.advance(by: 899)
        _ = try await service.fetchWeatherForStations(["KPAO", "KSQL"])
        #expect(log.count == 1)

        clock.advance(by: 1)
        _ = try await service.fetchWeatherForStations(["KPAO", "KSQL"])
        #expect(log.count == 2)
    }

    // MARK: - Failure after expiry

    @Test func singleFetchAfterExpiryThrowsOnNetworkFailureInsteadOfServingTheStaleEntry() async throws {
        let clock = AdvancingClock(Self.t0)
        let failing = FailureSwitch()
        let service = WeatherService(session: Self.session(log: RequestLog(), failing: failing), now: { clock.now })

        _ = try await service.fetchMETAR(for: "KPAO")
        clock.advance(by: 901)
        failing.set(true)

        await #expect(throws: (any Error).self) {
            _ = try await service.fetchMETAR(for: "KPAO")
        }
        // The stale entry is still there for callers that ask for it explicitly (the sheet's fallback).
        #expect(service.cachedWeather(for: "KPAO")?.fetchedAt == Self.t0)
    }

    @Test func batchAfterExpiryServesStaleStationsFromCacheWhenTheBatchFails() async throws {
        let clock = AdvancingClock(Self.t0)
        let failing = FailureSwitch()
        let service = WeatherService(session: Self.session(log: RequestLog(), failing: failing), now: { clock.now })

        _ = try await service.fetchWeatherForStations(["KPAO", "KSQL"])
        clock.advance(by: 901)
        failing.set(true)

        let results = try await service.fetchWeatherForStations(["KPAO", "KSQL"])

        // efb-dv5: offline, expired stations are returned with their original fetch time (the map shows old
        // dots with an OLD badge) instead of being dropped.
        #expect(Set(results.map(\.stationID)) == ["KPAO", "KSQL"])
        #expect(results.allSatisfy { $0.fetchedAt == Self.t0 })
    }

    @Test func partialBatchResultKeepsFreshStationsAndServesTheFailedExpiredOneFromCache() async throws {
        let clock = AdvancingClock(Self.t0)
        let failing = FailureSwitch()
        let service = WeatherService(session: Self.session(log: RequestLog(), failing: failing), now: { clock.now })

        _ = try await service.fetchWeatherForStations(["KPAO"])
        clock.advance(by: 500)
        _ = try await service.fetchWeatherForStations(["KSQL"])   // fetched later, so still fresh below
        clock.advance(by: 401)                                     // KPAO 901 s old, KSQL 401 s old
        failing.set(true)

        let results = try await service.fetchWeatherForStations(["KPAO", "KSQL"])
        // The fresh station first, then the expired one served from cache (efb-dv5): its age badge says how old it is.
        #expect(results.map(\.stationID) == ["KSQL", "KPAO"])
        #expect(results.first { $0.stationID == "KPAO" }?.fetchedAt == Self.t0)
    }

    // MARK: - Cache reads never age out

    @Test func cachedWeatherServesEntriesOfAnyAge() async throws {
        let clock = AdvancingClock(Self.t0)
        let service = WeatherService(session: Self.session(log: RequestLog(), failing: FailureSwitch()), now: { clock.now })

        _ = try await service.fetchMETAR(for: "KPAO")
        clock.advance(by: 10 * 3600)   // ten hours

        let stale = try #require(service.cachedWeather(for: "KPAO"))
        #expect(stale.fetchedAt == Self.t0)
    }
}
