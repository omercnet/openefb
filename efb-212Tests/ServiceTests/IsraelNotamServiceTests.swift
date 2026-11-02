//
//  IsraelNotamServiceTests.swift
//  efb-212Tests
//
//  IsraelNotamService against StubURLProtocol. The wire format is the output of web/notam-relay;
//  the real relay output saved from a live scrape is decoded too, so a contract drift fails here.
//

import Testing
import Foundation
import os
@testable import efb_212

@Suite("Israel NOTAM Service Tests", .serialized)
@MainActor
struct IsraelNotamServiceTests {

    // MARK: - Fixtures

    static let feedURL = URL(string: "https://relay.example/api/notams")
    static let generatedAt = Date(timeIntervalSince1970: 1_793_534_400)  // 2026-11-01T12:00:00Z

    /// One NOTAM with a closure, in the relay's JSON (JavaScript ISO dates with milliseconds).
    nonisolated static func feedJSON(generatedAt: String = "2026-11-01T12:00:00.000Z") -> Data {
        Data("""
        {
          "generatedAt": "\(generatedAt)",
          "source": { "name": "IAA AeroInfo", "listUrl": "https://x", "detailUrlTemplate": "https://y" },
          "items": [{
            "rowId": "2074111", "id": "C2269/26", "type": "NOTAMN", "references": null,
            "location": "LLLL", "locationDescription": "Tel-Aviv FIR", "created": "2026-10-25T14:31:00.000Z",
            "q": { "fir": "LLLL", "code": "QARLC", "traffic": "IV", "purpose": "NBO", "scope": "E",
                   "lower": 10, "upper": 25, "centre": { "lat": 32.716667, "lon": 34.966667 }, "radiusNM": 8 },
            "a": "LLLL", "validFrom": "2026-10-28T07:45:00.000Z", "validTo": "2026-10-28T13:30:00.000Z",
            "permanent": false, "estimated": false, "d": "0745-1030 1230-1330",
            "e": "HEL RTE CLSD GALIM-DAROM.", "f": null, "g": null,
            "geometry": { "polygon": null, "circle": { "centre": { "lat": 32.716667, "lon": 34.966667 }, "radiusNM": 8 } },
            "closures": [{ "notamId": "C2269/26", "routeKind": "HEL", "routeName": null, "chain": ["GALIM", "DAROM"],
                           "validFrom": "2026-10-28T07:45:00.000Z", "validTo": "2026-10-28T13:30:00.000Z",
                           "schedule": "0745-1030 1230-1330" }],
            "cancelledBy": null, "replacedBy": null, "parsed": true, "raw": "(C2269/26 NOTAMN ..."
          }],
          "closures": [{ "notamId": "C2269/26", "routeKind": "HEL", "routeName": null, "chain": ["GALIM", "DAROM"],
                         "validFrom": "2026-10-28T07:45:00.000Z", "validTo": null, "schedule": null }]
        }
        """.utf8)
    }

    final class Requests: @unchecked Sendable {
        private let lock = NSLock()
        private var storage: [URLRequest] = []
        func add(_ request: URLRequest) { lock.withLock { storage.append(request) } }
        var all: [URLRequest] { lock.withLock { storage } }
    }

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var date: Date
        init(_ date: Date) { self.date = date }
        var now: Date { lock.withLock { date } }
        func advance(_ seconds: TimeInterval) { lock.withLock { date = date.addingTimeInterval(seconds) } }
    }

    static func makeService(
        clock: Clock = Clock(generatedAt),
        requests: Requests = Requests(),
        url: URL? = feedURL,
        handler: @escaping @Sendable (URLRequest) throws -> (Int, Data)
    ) -> IsraelNotamService {
        IsraelNotamService(
            session: StubURLProtocol.session { request in
                requests.add(request)
                return try handler(request)
            },
            feedURL: { url },
            now: { clock.now }
        )
    }

    // MARK: - Decoding

    @Test func decodesTheRelayFeedIncludingMillisecondDates() async throws {
        let service = Self.makeService { _ in (200, Self.feedJSON()) }
        let report = try await service.fetchFeed(forceRefresh: false)

        #expect(report.feed.generatedAt == Self.generatedAt)
        #expect(report.feed.items.count == 1)
        let item = try #require(report.feed.items.first)
        #expect(item.id == "C2269/26")
        #expect(item.type == "NOTAMN")
        #expect(item.q?.lower == 10)
        #expect(item.q?.radiusNM == 8)
        #expect(item.validTo == Date(timeIntervalSince1970: 1_793_194_200))  // 2026-10-28T13:30Z
        #expect(item.geometry.circle?.radiusNM == 8)
        #expect(item.geometry.polygon == nil)
        #expect(item.parsed)
        #expect(item.isSuperseded == false)

        let closure = try #require(report.feed.closures.first)
        #expect(closure.chain == ["GALIM", "DAROM"])
        #expect(closure.validTo == nil)
        #expect(closure.hasSchedule == false)
        #expect(item.closures.first?.hasSchedule == true)
    }

    @Test func decodesDatesWithoutFractionalSeconds() async throws {
        let service = Self.makeService { _ in (200, Self.feedJSON(generatedAt: "2026-11-01T12:00:00Z")) }
        let report = try await service.fetchFeed(forceRefresh: false)
        #expect(report.feed.generatedAt == Self.generatedAt)
    }

    @Test func decodesTheRealRelayOutputSavedFromALiveScrape() throws {
        // web/notam-relay output on 2026-11-01 (docs/research/israel-cvfr-samples).
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let sample = root.appendingPathComponent("docs/research/israel-cvfr-samples/il-notam-relay-notams-2026-11-01.json")
        let feed = try IsraelNotamService.decoder.decode(IsraelNotamFeed.self, from: Data(contentsOf: sample))

        #expect(feed.items.count == 125)
        #expect(feed.items.allSatisfy { $0.parsed })
        #expect(feed.closures.count == 26)
        let c2267 = try #require(feed.closures.first { $0.notamId == "C2267/26" })
        #expect(c2267.routeKind == "CVFR")
        #expect(c2267.chain == ["GALIM", "DAROM", "HOTRM", "BOREN", "FRDIS"])
        let ats = try #require(feed.closures.first { $0.notamId == "A0849/26" })
        #expect(ats.routeName == "P68")
        #expect(feed.items.contains { $0.geometry.polygon != nil })
    }

    // MARK: - Saved copy (efb-zfm.12)

    private static func tempStorage() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("il-notam-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("last-feed.json")
    }

    private static func service(storage: URL, clock: Clock, handler: @escaping @Sendable (URLRequest) throws -> (Int, Data))
        -> IsraelNotamService {
        let url = feedURL
        return IsraelNotamService(session: StubURLProtocol.session { try handler($0) }, feedURL: { url },
                                  now: { clock.now }, storageURL: storage)
    }

    @Test func aRelaunchedOfflineServiceServesTheSavedFeedAsStale() async throws {
        let storage = Self.tempStorage()
        defer { try? FileManager.default.removeItem(at: storage.deletingLastPathComponent()) }
        let clock = Clock(Self.generatedAt)
        let first = Self.service(storage: storage, clock: clock) { _ in (200, Self.feedJSON()) }
        _ = try await first.fetchFeed(forceRefresh: false)

        // New process: empty memory, no signal.
        clock.advance(1_800)
        let relaunched = Self.service(storage: storage, clock: clock) { _ in throw URLError(.notConnectedToInternet) }
        let report = try await relaunched.fetchFeed(forceRefresh: false)

        #expect(report.refreshFailed)
        #expect(report.feed.items.count == 1)
        #expect(report.feed.closures.count == 1)
        #expect(report.fetchedAt == Self.generatedAt)  // the original download time, not now
        #expect(report.feed.generatedAt == Self.generatedAt)
    }

    @Test func withoutASavedFeedAnOfflineFirstFetchStillFails() async throws {
        let storage = Self.tempStorage()
        let service = Self.service(storage: storage, clock: Clock(Self.generatedAt)) { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: (any Error).self) { _ = try await service.fetchFeed(forceRefresh: false) }
    }

    @Test func anUnreadableSavedFeedIsIgnoredNotServed() async throws {
        let storage = Self.tempStorage()
        defer { try? FileManager.default.removeItem(at: storage.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: storage)
        let service = Self.service(storage: storage, clock: Clock(Self.generatedAt)) { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: (any Error).self) { _ = try await service.fetchFeed(forceRefresh: false) }
    }

    // MARK: - Requests and cache

    @Test func requestsTheConfiguredURLAsJSON() async throws {
        let requests = Requests()
        let service = Self.makeService(requests: requests) { _ in (200, Self.feedJSON()) }
        _ = try await service.fetchFeed(forceRefresh: false)
        let request = try #require(requests.all.first)
        #expect(request.url == Self.feedURL)
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
    }

    @Test func servesTheCachedFeedForFiveMinutesThenRefreshes() async throws {
        let requests = Requests()
        let clock = Clock(Self.generatedAt)
        let service = Self.makeService(clock: clock, requests: requests) { _ in (200, Self.feedJSON()) }

        _ = try await service.fetchFeed(forceRefresh: false)
        clock.advance(299)
        _ = try await service.fetchFeed(forceRefresh: false)
        #expect(requests.all.count == 1)

        clock.advance(2)
        let refreshed = try await service.fetchFeed(forceRefresh: false)
        #expect(requests.all.count == 2)
        #expect(refreshed.fetchedAt == clock.now)
    }

    @Test func forceRefreshBypassesTheCache() async throws {
        let requests = Requests()
        let service = Self.makeService(requests: requests) { _ in (200, Self.feedJSON()) }
        _ = try await service.fetchFeed(forceRefresh: false)
        _ = try await service.fetchFeed(forceRefresh: true)
        #expect(requests.all.count == 2)
    }

    // MARK: - Failure handling

    @Test func notConfiguredThrowsBeforeAnyRequest() async {
        let requests = Requests()
        let service = Self.makeService(requests: requests, url: nil) { _ in (200, Self.feedJSON()) }
        await #expect(throws: IsraelNotamError.notConfigured) {
            _ = try await service.fetchFeed(forceRefresh: false)
        }
        #expect(requests.all.isEmpty)
    }

    @Test func nonOKStatusIsReportedWithTheCode() async {
        let service = Self.makeService { _ in (503, Data("no feed yet".utf8)) }
        await #expect(throws: IsraelNotamError.badStatus(503)) {
            _ = try await service.fetchFeed(forceRefresh: false)
        }
    }

    @Test func undecodableBodyIsAnError() async {
        let service = Self.makeService { _ in (200, Data("<html>blocked</html>".utf8)) }
        await #expect(throws: IsraelNotamError.undecodable) {
            _ = try await service.fetchFeed(forceRefresh: false)
        }
    }

    @Test func offlineMapsToNetworkUnavailable() async {
        let service = Self.makeService { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await service.fetchFeed(forceRefresh: false)
            Issue.record("expected a throw")
        } catch let error as EFBError {
            #expect(error.id == EFBError.networkUnavailable.id)
        } catch {
            Issue.record("unexpected error \(error)")
        }
    }

    @Test func failedRefreshServesTheLastCopyFlaggedAndKeepsItsAge() async throws {
        let status = OSAllocatedUnfairLock(initialState: 200)
        let clock = Clock(Self.generatedAt)
        let service = Self.makeService(clock: clock) { _ in (status.withLock { $0 }, Self.feedJSON()) }

        let first = try await service.fetchFeed(forceRefresh: false)
        status.withLock { $0 = 503 }
        clock.advance(600)
        let second = try await service.fetchFeed(forceRefresh: false)

        #expect(first.refreshFailed == false)
        #expect(second.refreshFailed)
        #expect(second.feed == first.feed)
        #expect(second.fetchedAt == first.fetchedAt)

        // And it keeps retrying instead of treating the stale copy as fresh.
        status.withLock { $0 = 200 }
        let third = try await service.fetchFeed(forceRefresh: false)
        #expect(third.refreshFailed == false)
        #expect(third.fetchedAt == clock.now)
    }

    // MARK: - Staleness

    @Test func freshnessFollowsTheRelaysScrapeTimeNotTheDownloadTime() async throws {
        let service = Self.makeService { _ in (200, Self.feedJSON()) }
        let report = try await service.fetchFeed(forceRefresh: false)
        let scraped = report.feed.generatedAt

        let fresh = report.freshness(now: scraped.addingTimeInterval(10 * 60))
        #expect(fresh.level == .fresh)
        #expect(fresh.text == "10 min")

        let old = report.freshness(now: scraped.addingTimeInterval(2 * 3600))
        #expect(old.level == .old)
        #expect(old.text == "OLD 2h")

        let expired = report.freshness(now: scraped.addingTimeInterval(7 * 3600))
        #expect(expired.level == .expired)
        #expect(expired.text == "EXPIRED")
    }

    @Test func aDeadRelayCannotMakeOldDataLookCurrentOnAFreshDownload() {
        // Downloaded just now, but the relay last scraped 8 hours ago.
        let feed = IsraelNotamFeed(generatedAt: Self.generatedAt, items: [], closures: [])
        let downloadedNow = Self.generatedAt.addingTimeInterval(8 * 3600)
        let report = IsraelNotamReport(feed: feed, fetchedAt: downloadedNow, refreshFailed: false)
        #expect(report.freshness(now: downloadedNow).level == .expired)
    }

    // MARK: - Closure validity

    @Test func closureValidityWindow() throws {
        let closure = IsraelRouteClosure(
            notamId: "C2269/26", routeKind: "HEL", routeName: nil, chain: ["GALIM", "DAROM", "ATLIT"],
            validFrom: Date(timeIntervalSince1970: 1_000), validTo: Date(timeIntervalSince1970: 2_000), schedule: nil)
        #expect(closure.isValid(at: Date(timeIntervalSince1970: 999)) == false)
        #expect(closure.isValid(at: Date(timeIntervalSince1970: 1_000)))
        #expect(closure.isValid(at: Date(timeIntervalSince1970: 2_000)))
        #expect(closure.isValid(at: Date(timeIntervalSince1970: 2_001)) == false)
        #expect(closure.legs.map { "\($0.from)>\($0.to)" } == ["GALIM>DAROM", "DAROM>ATLIT"])
    }

    @Test func permanentClosureHasNoEnd() {
        let closure = IsraelRouteClosure(
            notamId: "C0005/26", routeKind: "CVFR", routeName: nil, chain: ["A", "B"],
            validFrom: Date(timeIntervalSince1970: 1_000), validTo: nil, schedule: nil)
        #expect(closure.isValid(at: Date(timeIntervalSince1970: 9_999_999_999)))
    }

    // MARK: - Closure conditions (relay NOTAM-2)

    private static func closureJSON(_ extra: String) -> Data {
        Data("""
        {"notamId":"C2981/25","routeKind":"CVFR","routeName":null,"chain":["EIRON","ZMGID"],
         "validFrom":"2026-11-01T06:00:00.000Z","validTo":null,"schedule":null\(extra)}
        """.utf8)
    }

    @Test func decodesAltitudeConditionsExceptionsAndKinds() throws {
        let json = Self.closureJSON("""
        ,"routeKinds":["CVFR","HEL"],
         "closedAltitudes":[{"op":"AT","lowerFt":2500,"upperFt":2500,"ref":"AMSL"}],
         "availableAltitudes":[{"op":"AT","lowerFt":3000,"upperFt":3000,"ref":"AMSL","direction":"BIDIRECTIONAL"}],
         "exceptions":["PPR FLT FM IAF"],"partial":true,"parsed":true,"raw":"CVFR RTE CLSD AT 2,500FT AMSL"
        """)
        let closure = try IsraelNotamService.decoder.decode(IsraelRouteClosure.self, from: json)
        #expect(closure.kinds == ["CVFR", "HEL"])
        #expect(closure.covers("cvfr") && closure.covers("HEL") && !closure.covers("ATS"))
        #expect(closure.closedAltitudes?.map(\.chartText) == ["2500"])
        #expect(closure.availableAltitudes?.first?.limit.chartText == "3000")
        #expect(closure.availableAltitudes?.first?.direction == "BIDIRECTIONAL")
        #expect(closure.exceptions == ["PPR FLT FM IAF"])
        #expect(closure.severity == .partial)
    }

    @Test func aFeedFromAnOlderRelayReadsAsAFullClosureOfItsKind() throws {
        let closure = try IsraelNotamService.decoder.decode(IsraelRouteClosure.self, from: Self.closureJSON(""))
        #expect(closure.severity == .full)
        #expect(closure.kinds == ["CVFR"])
        #expect(closure.closedAltitudes == nil && closure.exceptions == nil)
    }

    @Test func unreadClosureIsCheckNotamAndAnUnreadableParsedFlagNeverMeansFullyRead() throws {
        let unread = try IsraelNotamService.decoder.decode(IsraelRouteClosure.self, from: Self.closureJSON(#","parsed":false,"raw":"CVFR RTE CLSD""#))
        #expect(unread.severity == .check)
        let garbled = try IsraelNotamService.decoder.decode(IsraelRouteClosure.self, from: Self.closureJSON(#","parsed":"maybe""#))
        #expect(garbled.severity == .check)
    }

    @Test func aMalformedConditionNeverCostsTheWholeClosure() throws {
        let closure = try IsraelNotamService.decoder.decode(IsraelRouteClosure.self, from: Self.closureJSON(#","closedAltitudes":"nonsense","partial":true"#))
        #expect(closure.chain == ["EIRON", "ZMGID"])
        #expect(closure.closedAltitudes == nil)
        #expect(closure.severity == .partial)
    }

    @Test func altitudeLimitsReadAsChartText() {
        #expect(IsraelAltitudeLimit(op: "AT", lowerFt: 1200, upperFt: 1200, ref: "AMSL").chartText == "1200")
        #expect(IsraelAltitudeLimit(op: "BLW", lowerFt: nil, upperFt: 1500, ref: "AMSL").chartText == "BLW 1500")
        #expect(IsraelAltitudeLimit(op: "ABV", lowerFt: 10_000, upperFt: nil, ref: "FL").chartText == "ABV FL100")
        #expect(IsraelAltitudeLimit(op: "BTN", lowerFt: 1000, upperFt: 2000, ref: "AMSL").chartText == "1000-2000")
        #expect(IsraelAltitudeLimit(op: "AT", lowerFt: 800, upperFt: 800, ref: "AGL").chartText == "800 AGL")
    }
}
