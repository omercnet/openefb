//
//  IsraelNotamService.swift
//  efb-212
//
//  Client for the OpenEFB Israel NOTAM relay (web/notam-relay, a Cloudflare Worker): a small server scrapes the IAA
//  NOTAM page every 15 minutes and publishes `notams.json`. The app never contacts the IAA site.
//  Wire format: web/notam-relay/src/types.ts (NotamsFeed). The feed URL is configurable
//  (UserDefaults key `IsraelNotamService.feedURLDefaultsKey`); region wiring is IL-2's job.
//
//  Freshness is judged on the feed's `generatedAt` (when the relay last scraped the IAA), not on
//  when this device downloaded it, so a dead relay can't make old closures look current.
//

import Foundation
import os

// MARK: - Protocol

protocol IsraelNotamServiceProtocol: Sendable {
    /// The relay's current feed. Serves the in-memory copy while it is younger than
    /// `IsraelNotamService.cacheExpiry`; on a failed refresh returns the last copy flagged
    /// `refreshFailed`, and throws only when there is nothing cached.
    func fetchFeed(forceRefresh: Bool) async throws -> IsraelNotamReport
}

// MARK: - Errors

nonisolated enum IsraelNotamError: LocalizedError, Equatable {
    /// No relay URL set.
    case notConfigured
    /// Relay answered with a non-200 status (503 = no feed published yet).
    case badStatus(Int)
    /// Body was not a valid notams.json.
    case undecodable

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Israel NOTAMs need the relay address, which is not set in this build."
        case .badStatus(let code):
            return "The Israel NOTAM relay answered HTTP \(code)."
        case .undecodable:
            return "The Israel NOTAM relay sent data this version of OpenEFB can't read."
        }
    }
}

// MARK: - Models (mirror web/notam-relay/src/types.ts)

nonisolated struct IsraelLatLon: Codable, Equatable, Hashable, Sendable {
    let lat: Double  // degrees, WGS-84
    let lon: Double  // degrees, east positive
}

nonisolated struct IsraelNotamQLine: Codable, Equatable, Sendable {
    let fir: String
    let code: String
    let traffic: String
    let purpose: String
    let scope: String
    let lower: Int  // flight level, 0 = surface
    let upper: Int  // flight level, 999 = unlimited
    let centre: IsraelLatLon?
    let radiusNM: Double?  // nautical miles
}

nonisolated struct IsraelNotamCircle: Codable, Equatable, Sendable {
    let centre: IsraelLatLon
    let radiusNM: Double  // nautical miles
}

nonisolated struct IsraelNotamGeometry: Codable, Equatable, Sendable {
    /// Ring of positions from E); at least three points, not closed.
    let polygon: [IsraelLatLon]?
    let circle: IsraelNotamCircle?
}

/// One ordered chain of published point codes closed by a NOTAM ("CVFR RTE CLSD GALIM-DAROM-HOTRM").
nonisolated struct IsraelRouteClosure: Codable, Equatable, Hashable, Sendable {
    let notamId: String
    /// CVFR, HEL, ULTRALIGHT, ATS, ... as written before "RTE CLSD".
    let routeKind: String
    /// ATS route designator ("P68 BTN A-B"), otherwise nil.
    let routeName: String?
    /// Ordered point codes (5-letter reporting points; 4-letter ICAO codes for airfields).
    let chain: [String]
    let validFrom: Date?  // UTC
    /// nil when the NOTAM is permanent or its end couldn't be read.
    let validTo: Date?  // UTC
    /// D) text: the closure applies only at these times within the validity window.
    let schedule: String?

    /// Inside the validity window (ignores `schedule`; check `hasSchedule`).
    func isValid(at date: Date) -> Bool {
        if let validFrom, date < validFrom { return false }
        if let validTo, date > validTo { return false }
        return true
    }

    var hasSchedule: Bool { schedule != nil }

    /// Consecutive point pairs along the chain.
    var legs: [(from: String, to: String)] {
        zip(chain, chain.dropFirst()).map { (from: $0, to: $1) }
    }
}

nonisolated struct IsraelNotam: Codable, Equatable, Identifiable, Sendable {
    let rowId: String
    let id: String  // e.g. "C2269/26"
    let type: String?  // NOTAMN / NOTAMR / NOTAMC
    let references: String?
    let location: String  // ICAO location indicator
    let locationDescription: String?
    let created: Date?
    let q: IsraelNotamQLine?
    let a: String?
    let validFrom: Date?
    let validTo: Date?
    let permanent: Bool
    let estimated: Bool
    let d: String?
    let e: String?
    let f: String?
    let g: String?
    let geometry: IsraelNotamGeometry
    let closures: [IsraelRouteClosure]
    /// false: the relay could not read the ICAO fields; show `raw`.
    let parsed: Bool
    let cancelledBy: String?
    let replacedBy: String?
    let raw: String

    var isSuperseded: Bool { cancelledBy != nil || replacedBy != nil }
}

nonisolated struct IsraelNotamFeed: Codable, Equatable, Sendable {
    /// When the relay scraped the IAA.
    let generatedAt: Date
    let items: [IsraelNotam]
    /// Closures from non-cancelled items, flattened.
    let closures: [IsraelRouteClosure]
}

/// The feed plus how old it is.
nonisolated struct IsraelNotamReport: Equatable, Sendable {
    let feed: IsraelNotamFeed
    /// When this device downloaded it.
    let fetchedAt: Date
    /// The last refresh failed; `feed` is the previous copy.
    let refreshFailed: Bool

    /// Badge for the NOTAM page and route alerts, on the relay's scrape time.
    func freshness(now: Date = Date()) -> DataFreshness {
        DataFreshness.evaluate(.notam, observed: feed.generatedAt, now: now)
    }
}

// MARK: - Service

actor IsraelNotamService: IsraelNotamServiceProtocol {

    nonisolated static let feedURLDefaultsKey = "israelNotamFeedURL"
    /// The deployed relay (web/notam-relay, Cloudflare Worker). The `feedURLDefaultsKey` setting overrides it.
    nonisolated static let defaultFeedURL = URL(string: "https://openefb-notam-relay.omerc.workers.dev/notams.json")
    nonisolated static let cacheExpiry: TimeInterval = 300  // the relay's edge cache is 5 min

    private let session: URLSession
    private let feedURLProvider: @Sendable () -> URL?
    private let now: @Sendable () -> Date
    private var cached: IsraelNotamReport?

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "IsraelNotamService")

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - feedURL: Override for tests; defaults to the URL stored under `feedURLDefaultsKey`.
    ///   - now: Override for tests.
    init(session: URLSession? = nil, feedURL: (@Sendable () -> URL?)? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 60
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        self.feedURLProvider = feedURL ?? {
            UserDefaults.standard.string(forKey: IsraelNotamService.feedURLDefaultsKey).flatMap(URL.init(string:))
                ?? IsraelNotamService.defaultFeedURL
        }
    }

    func fetchFeed(forceRefresh: Bool = false) async throws -> IsraelNotamReport {
        guard let url = feedURLProvider() else { throw IsraelNotamError.notConfigured }
        if !forceRefresh, let cached, !cached.refreshFailed, now().timeIntervalSince(cached.fetchedAt) < Self.cacheExpiry {
            return cached
        }
        do {
            let feed = try await download(url)
            let report = IsraelNotamReport(feed: feed, fetchedAt: now(), refreshFailed: false)
            cached = report
            logger.info("Fetched \(feed.items.count) Israel NOTAMs, \(feed.closures.count) route closures")
            return report
        } catch {
            if let cached {
                logger.error("Israel NOTAM refresh failed, serving cached copy: \(error.localizedDescription, privacy: .public)")
                let stale = IsraelNotamReport(feed: cached.feed, fetchedAt: cached.fetchedAt, refreshFailed: true)
                self.cached = stale
                return stale
            }
            throw error
        }
    }

    private func download(_ url: URL) async throws -> IsraelNotamFeed {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .notConnectedToInternet || error.code == .networkConnectionLost {
            throw EFBError.networkUnavailable
        }
        guard let http = response as? HTTPURLResponse else { throw IsraelNotamError.undecodable }
        guard http.statusCode == 200 else { throw IsraelNotamError.badStatus(http.statusCode) }
        do {
            return try Self.decoder.decode(IsraelNotamFeed.self, from: data)
        } catch {
            throw IsraelNotamError.undecodable
        }
    }

    /// ISO 8601 with or without fractional seconds (JavaScript's `toISOString()` writes milliseconds).
    nonisolated static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(text, strategy: .iso8601) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        return decoder
    }
}
