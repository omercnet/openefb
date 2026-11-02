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

/// One altitude limit, in feet, from a NOTAM closure clause: "AT 2,500FT AMSL", "BLW 1,500FT", "BTN 1,000 AND 2,000FT".
nonisolated struct IsraelAltitudeLimit: Codable, Equatable, Hashable, Sendable {
    /// AT, BLW, ABV or BTN (a String so a future op can never fail the whole feed's decoding).
    let op: String
    let lowerFt: Int?  // feet; nil = unbounded below
    let upperFt: Int?  // feet; nil = unbounded above
    /// AMSL, AGL, or FL when written as a flight level (already converted to feet).
    let ref: String?

    /// Chart text: "2500", "BLW 1500", "ABV FL100", "1000-2000", "800 AGL".
    var chartText: String {
        func value(_ feet: Int) -> String { ref == "FL" ? "FL\(feet / 100)" : String(feet) }
        let suffix = ref == "AGL" ? " AGL" : ""
        switch (op, lowerFt, upperFt) {
        case ("BTN", let lo?, let hi?): return "\(value(lo))-\(value(hi))\(suffix)"
        case ("BLW", _, let hi?): return "BLW \(value(hi))\(suffix)"
        case ("ABV", let lo?, _): return "ABV \(value(lo))\(suffix)"
        case (_, let lo?, _): return value(lo) + suffix
        case (_, _, let hi?): return value(hi) + suffix
        default: return op
        }
    }
}

/// "AVBL BIDIRECTIONAL AT 3,000FT AMSL": an altitude at which the chain stays open. Same fields as the limit plus the direction.
nonisolated struct IsraelAvailableAltitude: Codable, Equatable, Hashable, Sendable {
    let op: String
    let lowerFt: Int?  // feet
    let upperFt: Int?  // feet
    let ref: String?
    /// BIDIRECTIONAL when written, otherwise nil.
    let direction: String?

    var limit: IsraelAltitudeLimit { IsraelAltitudeLimit(op: op, lowerFt: lowerFt, upperFt: upperFt, ref: ref) }
}

/// How a closure is drawn: red = closed, amber = closed only at some altitudes or with exceptions, amber "check NOTAM" = not read in full.
nonisolated enum IsraelClosureSeverity: String, Sendable {
    case full
    case partial
    case check
}

/// One ordered chain of published point codes closed by a NOTAM ("CVFR RTE CLSD GALIM-DAROM-HOTRM").
/// The fields after `schedule` come from relay builds that read closure conditions; they are nil in older feeds,
/// which then read as full closures (what those feeds meant).
nonisolated struct IsraelRouteClosure: Codable, Equatable, Hashable, Sendable {
    let notamId: String
    /// CVFR, HEL, ULTRALIGHT, ATS, ... as written before "RTE CLSD". CVFR when the clause covers CVFR.
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
    /// Every kind of the clause ("CVFR AND HEL RTE CLSD" -> CVFR, HEL).
    var routeKinds: [String]? = nil
    /// Altitudes at which the chain is closed; empty = closed at all altitudes.
    var closedAltitudes: [IsraelAltitudeLimit]? = nil
    /// Altitudes at which the chain stays open.
    var availableAltitudes: [IsraelAvailableAltitude]? = nil
    /// Raw exception text ("PPR FLT FM IAF"): the closure does not apply to these flights.
    var exceptions: [String]? = nil
    /// Closed only at some altitudes, or with exceptions.
    var partial: Bool? = nil
    /// false: looks like a closure but the relay could not read it in full. Show "check NOTAM".
    var parsed: Bool? = nil
    /// The clause text the relay read this closure from.
    var raw: String? = nil

    enum CodingKeys: String, CodingKey {
        case notamId, routeKind, routeName, chain, validFrom, validTo, schedule
        case routeKinds, closedAltitudes, availableAltitudes, exceptions, partial, parsed, raw
    }

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

    /// Kinds this closure applies to, upper-cased; falls back to `routeKind` for feeds without `routeKinds`.
    var kinds: [String] {
        let listed = (routeKinds ?? []).map { $0.uppercased() }
        return listed.isEmpty ? [routeKind.uppercased()] : listed
    }

    func covers(_ kind: String) -> Bool { kinds.contains(kind.uppercased()) }

    var severity: IsraelClosureSeverity {
        if parsed == false { return .check }
        return partial == true ? .partial : .full
    }
}

extension IsraelRouteClosure {
    /// The conditions are decoded leniently: a malformed optional field must never cost the pilot the whole feed.
    nonisolated init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notamId = try c.decode(String.self, forKey: .notamId)
        routeKind = try c.decode(String.self, forKey: .routeKind)
        routeName = try c.decodeIfPresent(String.self, forKey: .routeName)
        chain = try c.decode([String].self, forKey: .chain)
        validFrom = try c.decodeIfPresent(Date.self, forKey: .validFrom)
        validTo = try c.decodeIfPresent(Date.self, forKey: .validTo)
        schedule = try c.decodeIfPresent(String.self, forKey: .schedule)
        routeKinds = try? c.decodeIfPresent([String].self, forKey: .routeKinds)
        closedAltitudes = try? c.decodeIfPresent([IsraelAltitudeLimit].self, forKey: .closedAltitudes)
        availableAltitudes = try? c.decodeIfPresent([IsraelAvailableAltitude].self, forKey: .availableAltitudes)
        exceptions = try? c.decodeIfPresent([String].self, forKey: .exceptions)
        partial = try? c.decodeIfPresent(Bool.self, forKey: .partial)
        // A `parsed` we cannot read must not turn into "fully read": treat it as unread.
        if c.contains(.parsed) { parsed = (try? c.decode(Bool.self, forKey: .parsed)) ?? false }
        raw = try? c.decodeIfPresent(String.self, forKey: .raw)
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
    /// Where the last good feed is kept so an offline relaunch still has it; nil: memory only (tests).
    private let storageURL: URL?
    private var cached: IsraelNotamReport?

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "IsraelNotamService")

    /// Application Support/IsraelNotam/last-feed.json
    nonisolated static var defaultStorageURL: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return support.appendingPathComponent("IsraelNotam", isDirectory: true).appendingPathComponent("last-feed.json")
    }

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - feedURL: Override for tests; defaults to the URL stored under `feedURLDefaultsKey`.
    ///   - now: Override for tests.
    ///   - storageURL: Override for tests. When omitted, the production service (no `session` override)
    ///     persists to `defaultStorageURL`; a service with an injected session stays memory-only.
    init(session: URLSession? = nil, feedURL: (@Sendable () -> URL?)? = nil, now: @escaping @Sendable () -> Date = { Date() },
         storageURL: URL? = nil) {
        self.now = now
        self.storageURL = storageURL ?? (session == nil ? Self.defaultStorageURL : nil)
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
            persist(report)
            logger.info("Fetched \(feed.items.count) Israel NOTAMs, \(feed.closures.count) route closures")
            return report
        } catch {
            if let previous = cached ?? loadPersisted() {
                logger.error("Israel NOTAM refresh failed, serving the saved copy: \(error.localizedDescription, privacy: .public)")
                let stale = IsraelNotamReport(feed: previous.feed, fetchedAt: previous.fetchedAt, refreshFailed: true)
                self.cached = stale
                return stale
            }
            throw error
        }
    }

    // MARK: Persistence

    private struct SavedFeed: Codable {
        let feed: IsraelNotamFeed
        let fetchedAt: Date
    }

    /// Writes the last good feed (atomic). A failure to save never blocks the feed.
    private func persist(_ report: IsraelNotamReport) {
        guard let storageURL else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(SavedFeed(feed: report.feed, fetchedAt: report.fetchedAt)).write(to: storageURL, options: .atomic)
        } catch {
            logger.error("Could not save the Israel NOTAM feed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The saved feed, or nil when none exists or it cannot be read. Display age comes from the feed's own
    /// `generatedAt`, so a copy that is too old is still gated by the existing freshness rules.
    private func loadPersisted() -> IsraelNotamReport? {
        guard let storageURL, let data = try? Data(contentsOf: storageURL) else { return nil }
        guard let saved = try? Self.decoder.decode(SavedFeed.self, from: data) else {
            logger.error("Saved Israel NOTAM feed is unreadable; ignoring it")
            return nil
        }
        return IsraelNotamReport(feed: saved.feed, fetchedAt: saved.fetchedAt, refreshFailed: true)
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
