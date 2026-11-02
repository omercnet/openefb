//
//  NotamServiceTests.swift
//  efb-212Tests
//
//  FAA NOTAM API parsing, effective-window filtering, closure-first ordering,
//  credential gating, auth headers, and pagination.
//
//  Fixtures are BUILT FROM THE DOCUMENTED SCHEMA (FAA NOTAM API docs as republished in the
//  Microsoft Power Platform FAANotam connector OpenAPI definition), not captured live:
//  no FAA key was available when these were written. Field names and nesting follow
//  items[].properties.coreNOTAMData.{notam, notamTranslation}; values are realistic
//  KPAO domestic NOTAMs with ISO-8601 UTC times and "PERM" for permanent end times.
//

import Testing
import Foundation
@testable import efb_212

/// Thread-safe log of requests that reached a StubURLProtocol session.
private final class NotamRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [URLRequest] = []

    func record(_ request: URLRequest) {
        lock.lock()
        storage.append(request)
        lock.unlock()
    }

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

@Suite("NOTAM Service Tests", .serialized)
@MainActor
struct NotamServiceTests {

    // MARK: - Fixtures

    /// Reference time for window tests: 2026-10-30 18:00Z.
    static let now = Date(timeIntervalSince1970: 1_793_383_200)

    static let kpao = Airport(
        icao: "KPAO", faaID: "PAO", name: "Palo Alto",
        latitude: 37.4611, longitude: -122.1151, elevation: 7,
        type: .airport, ownership: .publicOwned
    )

    /// Documented-format page (built from docs, see file header) for icaoLocation=KPAO.
    nonisolated static let kpaoPage = #"""
    {
      "pageSize": 100, "pageNum": 1, "totalCount": 6, "totalPages": 1,
      "items": [
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_74102233", "series": "", "number": "10/101", "type": "N",
              "issued": "2026-10-28T15:10:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QMXLC",
              "traffic": "IV", "purpose": "M", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2026-10-28T15:10:00.000Z",
              "effectiveEnd": "2026-11-15T23:59:00.000Z",
              "text": "TWY B BTN RWY 13/31 AND TWY C CLSD", "classification": "DOM", "accountId": "PAO",
              "lastUpdated": "2026-10-28T15:10:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 10/101 PAO TWY B BTN RWY 13/31 AND TWY C CLSD 2610281510-2611152359" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        },
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_74120871", "series": "", "number": "10/118", "type": "N",
              "issued": "2026-10-29T22:41:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QMRLC",
              "traffic": "IV", "purpose": "NBO", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2026-10-30T14:00:00.000Z",
              "effectiveEnd": "2026-10-31T02:00:00.000Z",
              "text": "RWY 13/31 CLSD", "classification": "DOM", "accountId": "PAO",
              "lastUpdated": "2026-10-29T22:41:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 10/118 PAO RWY 13/31 CLSD 2610301400-2610310200" },
              { "type": "ICAO", "formattedText": "A2345/26 NOTAMN\nQ) KZOA/QMRLC/IV/NBO/A/000/999/3727N12207W005\nA) KPAO\nB) 2610301400\nC) 2610310200\nE) RWY 13/31 CLSD" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        },
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_74121502", "series": "", "number": "10/120", "type": "N",
              "issued": "2026-10-30T15:02:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QFALC",
              "traffic": "IV", "purpose": "NBO", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2026-10-30T16:00:00.000Z",
              "effectiveEnd": "2026-10-30T20:00:00.000Z",
              "text": "AD AP CLSD", "classification": "DOM", "accountId": "PAO",
              "lastUpdated": "2026-10-30T15:02:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 10/120 PAO AD AP CLSD 2610301600-2610302000" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        },
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_71230045", "series": "", "number": "02/007", "type": "N",
              "issued": "2025-02-03T17:20:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QFWXX",
              "traffic": "IV", "purpose": "M", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2025-02-03T17:20:00.000Z", "effectiveEnd": "PERM",
              "text": "AD AP WINDCONE FOR RWY 13 RELOCATED 200FT S OF RWY 13 THR", "classification": "DOM",
              "accountId": "PAO", "lastUpdated": "2025-02-03T17:20:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 02/007 PAO AD AP WINDCONE FOR RWY 13 RELOCATED 200FT S OF RWY 13 THR 2502031720-PERM" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        },
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_74088810", "series": "", "number": "10/090", "type": "N",
              "issued": "2026-10-25T13:00:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QLPAS",
              "traffic": "IV", "purpose": "BO", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2026-10-25T13:00:00.000Z",
              "effectiveEnd": "2026-10-29T23:59:00.000Z",
              "text": "RWY 31 PAPI U/S", "classification": "DOM", "accountId": "PAO",
              "lastUpdated": "2026-10-25T13:00:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 10/090 PAO RWY 31 PAPI U/S 2610251300-2610292359" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        },
        {
          "type": "Feature",
          "properties": { "coreNOTAMData": {
            "notamEvent": { "scenario": "6000" },
            "notam": {
              "id": "NOTAM_1_74125566", "series": "", "number": "10/125", "type": "N",
              "issued": "2026-10-30T16:45:00.000Z", "affectedFIR": "KZOA", "selectionCode": "QFALC",
              "traffic": "IV", "purpose": "NBO", "scope": "A", "minimumFL": "000", "maximumFL": "999",
              "location": "PAO", "effectiveStart": "2026-11-05T15:00:00.000Z",
              "effectiveEnd": "2026-11-05T23:00:00.000Z",
              "text": "AD AP CLSD", "classification": "DOM", "accountId": "PAO",
              "lastUpdated": "2026-10-30T16:45:00.000Z", "icaoLocation": "KPAO",
              "coordinates": "3727N12207W", "radius": "005"
            },
            "notamTranslation": [
              { "type": "LOCAL_FORMAT", "simpleText": "!PAO 10/125 PAO AD AP CLSD 2611051500-2611052300" }
            ]
          } },
          "geometry": { "type": "GeometryCollection", "geometries": [ { "type": "Point", "coordinates": [-122.1151, 37.4611] } ] }
        }
      ]
    }
    """#.data(using: .utf8)!

    /// One-item documented-format page with a permanent NOTAM, for network tests run at wall-clock time.
    nonisolated static func permanentPage(number: String, pageNum: Int, totalPages: Int) -> Data {
        let json = """
        {"pageSize":100,"pageNum":\(pageNum),"totalCount":\(totalPages),"totalPages":\(totalPages),
         "items":[{"type":"Feature","properties":{"coreNOTAMData":{
           "notamEvent":{"scenario":"6000"},
           "notam":{"id":"NOTAM_1_\(number.replacingOccurrences(of: "/", with: ""))","series":"","number":"\(number)",
             "type":"N","issued":"2020-01-02T10:00:00.000Z","selectionCode":"QFAXX","location":"PAO",
             "effectiveStart":"2020-01-02T10:00:00.000Z","effectiveEnd":"PERM",
             "text":"AD AP BCN OPS CHANGED","classification":"DOM","icaoLocation":"KPAO"},
           "notamTranslation":[]}},
           "geometry":{"type":"GeometryCollection","geometries":[]}}]}
        """
        return Data(json.utf8)
    }

    static func makeService(
        credentials: NotamCredentials? = NotamCredentials(clientID: "test-id", clientSecret: "test-secret"),
        handler: @escaping StubURLProtocol.Handler
    ) -> NotamService {
        NotamService(session: StubURLProtocol.session(handler: handler), credentials: { credentials })
    }

    static func iso(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: string)
    }

    // MARK: - Decoding

    @Test func decodesDocumentedGeoJsonPage() throws {
        let page = try NotamService.parseResponse(Self.kpaoPage)
        #expect(page.pageNum == 1)
        #expect(page.totalPages == 1)
        #expect(page.totalCount == 6)
        #expect(page.notams.count == 6)

        let rwy = try #require(page.notams.first { $0.number == "10/118" })
        #expect(rwy.id == "NOTAM_1_74120871")
        #expect(rwy.text == "RWY 13/31 CLSD")
        #expect(rwy.selectionCode == "QMRLC")
        #expect(rwy.icaoLocation == "KPAO")
        #expect(rwy.location == "PAO")
        #expect(rwy.classification == "DOM")
        #expect(rwy.effectiveStart == Self.iso("2026-10-30T14:00:00Z"))
        #expect(rwy.effectiveEnd == Self.iso("2026-10-31T02:00:00Z"))
        #expect(rwy.isPermanent == false)
        // LOCAL_FORMAT translation preferred over the ICAO rendering
        #expect(rwy.fullText == "!PAO 10/118 PAO RWY 13/31 CLSD 2610301400-2610310200")

        let perm = try #require(page.notams.first { $0.number == "02/007" })
        #expect(perm.isPermanent)
        #expect(perm.effectiveEnd == nil)
        #expect(perm.effectiveWindowDescription == "Feb 3 1720Z – PERM")
    }

    @Test func classifiesClosuresByQCodeAndText() throws {
        let page = try NotamService.parseResponse(Self.kpaoPage)
        func closure(_ number: String) -> NotamClosure? {
            page.notams.first { $0.number == number }?.closure
        }
        #expect(closure("10/120") == .aerodrome)
        #expect(closure("10/118") == .runway)
        #expect(closure("10/101") == nil)   // taxiway closure that merely mentions RWY 13/31
        #expect(closure("02/007") == nil)   // "AD AP" without CLSD

        // Text-only detection when the Q-code is absent
        let textOnlyRunway = Notam(id: "x", number: "1/1", effectiveStart: nil, effectiveEnd: nil,
                                   text: "RWY 31R CLSD EXC TAXI")
        let textOnlyAirport = Notam(id: "y", number: "1/2", effectiveStart: nil, effectiveEnd: nil,
                                    text: "AD AP CLSD TO NON PPR ACFT")
        #expect(textOnlyRunway.closure == .runway)
        #expect(textOnlyAirport.closure == .aerodrome)
    }

    // MARK: - Effective window

    @Test func keepsOnlyNotamsEffectiveNow() throws {
        let page = try NotamService.parseResponse(Self.kpaoPage)
        let active = Set(NotamService.activeSorted(page.notams, at: Self.now).map(\.number))
        #expect(active == ["10/101", "10/118", "10/120", "02/007"])
        #expect(!active.contains("10/090"))   // expired 10-29 2359Z
        #expect(!active.contains("10/125"))   // starts 11-05
    }

    @Test func effectiveWindowBoundaries() {
        let start = Self.now
        let end = Self.now.addingTimeInterval(3600)
        let notam = Notam(id: "b", number: "10/200", effectiveStart: start, effectiveEnd: end, text: "TWY A CLSD")
        #expect(notam.isEffective(at: start))                              // start is inclusive
        #expect(!notam.isEffective(at: start.addingTimeInterval(-1)))
        #expect(notam.isEffective(at: end.addingTimeInterval(-1)))
        #expect(!notam.isEffective(at: end))                               // end is exclusive

        let cancellation = Notam(id: "c", number: "10/201", type: "C", effectiveStart: start,
                                 effectiveEnd: end, text: "TWY A CLSD")
        #expect(NotamService.activeSorted([cancellation], at: start).isEmpty)
    }

    // MARK: - Ordering

    @Test func sortsAerodromeThenRunwayClosuresFirst() throws {
        let page = try NotamService.parseResponse(Self.kpaoPage)
        let ordered = NotamService.activeSorted(page.notams, at: Self.now).map(\.number)
        // AD closure, RWY closure, then the rest newest-effective first
        #expect(ordered == ["10/120", "10/118", "10/101", "02/007"])
    }

    // MARK: - Location query

    @Test func usesIcaoLocationForIcaoIdentsAndDomesticOtherwise() {
        let icao = NotamService.locationQuery(for: Self.kpao)
        #expect(icao.name == "icaoLocation")
        #expect(icao.value == "KPAO")

        let small = Airport(icao: "0Q5", faaID: "0Q5", name: "Shelter Cove", latitude: 40.03,
                            longitude: -124.07, elevation: 400, type: .airport, ownership: .publicOwned)
        let domestic = NotamService.locationQuery(for: small)
        #expect(domestic.name == "domesticLocation")
        #expect(domestic.value == "0Q5")
    }

    // MARK: - Network behavior

    @Test func missingKeyThrowsNotConfiguredWithoutNetworkCall() async {
        let recorder = NotamRequestRecorder()
        let service = Self.makeService(credentials: nil) { request in
            recorder.record(request)
            return (200, Self.kpaoPage)
        }

        await #expect(throws: NotamError.notConfigured) {
            _ = try await service.fetchNotams(for: Self.kpao)
        }
        #expect(recorder.requests.isEmpty)
    }

    @Test func sendsAuthHeadersFollowsPaginationAndCaches() async throws {
        let recorder = NotamRequestRecorder()
        let service = Self.makeService { request in
            recorder.record(request)
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let pageNum = Int(items.first { $0.name == "pageNum" }?.value ?? "") ?? 0
            return (200, Self.permanentPage(number: "0\(pageNum)/001", pageNum: pageNum, totalPages: 2))
        }

        let report = try await service.fetchNotams(for: Self.kpao)
        #expect(Set(report.notams.map(\.number)) == ["01/001", "02/001"])
        #expect(report.location == "KPAO")

        let requests = recorder.requests
        #expect(requests.count == 2)
        for (index, request) in requests.enumerated() {
            #expect(request.value(forHTTPHeaderField: "client_id") == "test-id")
            #expect(request.value(forHTTPHeaderField: "client_secret") == "test-secret")
            let url = try #require(request.url)
            #expect(url.host == "external-api.faa.gov")
            #expect(url.path == "/notamapi/v1/notams")
            let query = Dictionary(
                uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
                    .map { ($0.name, $0.value ?? "") }
            )
            #expect(query["icaoLocation"] == "KPAO")
            #expect(query["responseFormat"] == "geoJson")
            #expect(query["pageNum"] == String(index + 1))
            #expect(query["pageSize"] == String(NotamService.pageSize))
        }

        // Second fetch within 10 minutes is served from cache
        let cached = try await service.fetchNotams(for: Self.kpao)
        #expect(cached.fetchedAt == report.fetchedAt)
        #expect(recorder.requests.count == 2)
    }

    @Test func unauthorizedResponseThrowsCredentialsRejected() async {
        let service = Self.makeService { _ in (401, Data(#"{"error":"invalid_client"}"#.utf8)) }

        await #expect(throws: NotamError.credentialsRejected) {
            _ = try await service.fetchNotams(for: Self.kpao)
        }
    }

    // MARK: - Reliability (efb-zfm.15)

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var date = Date()
        var now: Date { lock.withLock { date } }
        func advance(_ seconds: TimeInterval) { lock.withLock { date = date.addingTimeInterval(seconds) } }
    }

    nonisolated private static func pageNumber(_ request: URLRequest) -> Int {
        let items = URLComponents(url: request.url ?? URL(fileURLWithPath: "/"), resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Int(items.first { $0.name == "pageNum" }?.value ?? "") ?? 0
    }

    @Test func aFailedRefreshServesTheLastGoodCopyFlaggedWithItsOriginalAge() async throws {
        let clock = Clock()
        let failing = NotamRequestRecorder()
        let service = NotamService(
            session: StubURLProtocol.session { request in
                if failing.requests.contains(where: { $0.url?.host == "fail" }) { throw URLError(.timedOut) }
                return (200, Self.permanentPage(number: "01/001", pageNum: 1, totalPages: 1))
            },
            credentials: { NotamCredentials(clientID: "a", clientSecret: "b") },
            now: { clock.now })
        let good = try await service.fetchNotams(for: Self.kpao)
        #expect(good.refreshFailed == false)

        failing.record(URLRequest(url: URL(string: "https://fail/")!))  // flips the stub to failing
        clock.advance(1_200)  // cache (10 min) has expired, so a refresh is attempted
        let stale = try await service.fetchNotams(for: Self.kpao)

        #expect(stale.refreshFailed)
        #expect(stale.notams == good.notams)
        #expect(stale.fetchedAt == good.fetchedAt)  // the badge ages from the last good download
    }

    @Test func aFailureWithNothingSavedStillThrows() async {
        let service = Self.makeService { _ in throw URLError(.timedOut) }
        await #expect(throws: (any Error).self) { _ = try await service.fetchNotams(for: Self.kpao) }
    }

    @Test func theNumberOfSequentialPagesIsCappedAndTheListIsMarkedIncomplete() async throws {
        let recorder = NotamRequestRecorder()
        let service = Self.makeService { request in
            recorder.record(request)
            return (200, Self.permanentPage(number: "0\(Self.pageNumber(request))/001", pageNum: Self.pageNumber(request), totalPages: 20))
        }
        let report = try await service.fetchNotams(for: Self.kpao)
        #expect(recorder.requests.count == NotamService.maxPages)
        #expect(report.isIncomplete)
    }

    @Test func aCompleteListIsNotMarkedIncomplete() async throws {
        let service = Self.makeService { request in
            (200, Self.permanentPage(number: "0\(Self.pageNumber(request))/001", pageNum: Self.pageNumber(request), totalPages: 2))
        }
        #expect(try await service.fetchNotams(for: Self.kpao).isIncomplete == false)
    }

    @Test func theTimeBudgetStopsFurtherPagesAndMarksTheListIncomplete() async throws {
        let clock = Clock()
        let recorder = NotamRequestRecorder()
        let service = NotamService(
            session: StubURLProtocol.session { request in
                recorder.record(request)
                clock.advance(NotamService.fetchBudget)  // the first page used the whole budget
                return (200, Self.permanentPage(number: "01/001", pageNum: 1, totalPages: 4))
            },
            credentials: { NotamCredentials(clientID: "a", clientSecret: "b") },
            now: { clock.now })
        let report = try await service.fetchNotams(for: Self.kpao)
        #expect(recorder.requests.count == 1)
        #expect(report.isIncomplete)
    }
}
