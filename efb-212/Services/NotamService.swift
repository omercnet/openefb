//
//  NotamService.swift
//  efb-212
//
//  FAA NOTAM API client (https://external-api.faa.gov/notamapi/v1/notams) with a
//  10-minute per-airport in-memory cache. Requires a free FAA developer key
//  (client_id + client_secret request headers) stored in the Keychain from Settings.
//
//  Response schema source: the FAA NOTAM API documentation on the FAA developer portal
//  (https://api.faa.gov/s/), as republished field-for-field in the Microsoft Power Platform
//  "FAANotam" connector OpenAPI definition
//  (github.com/microsoft/PowerPlatformConnectors, independent-publisher-connectors/FAANotam/
//  apiDefinition.swagger.json; reference page https://learn.microsoft.com/connectors/faanotam/):
//    { pageSize, pageNum, totalCount, totalPages,
//      items: [ { type: "Feature",
//                 properties: { coreNOTAMData: {
//                   notamEvent: { scenario },
//                   notam: { id, series, number, type, issued, affectedFIR, selectionCode,
//                            traffic, purpose, scope, minimumFL, maximumFL, location,
//                            effectiveStart, effectiveEnd, text, classification, accountId,
//                            lastUpdated, icaoLocation, coordinates, radius, schedule,
//                            lowerLimit, upperLimit },
//                   notamTranslation: [ { type, simpleText?, formattedText? } ] } },
//                 geometry: { type, geometries: [...] } } ] }
//  Query parameters used: icaoLocation (or domesticLocation for non-ICAO idents),
//  responseFormat=geoJson, pageSize, pageNum.
//  Not verified against the live API (no key available when written).
//

import Foundation
import os

// MARK: - Protocol

protocol NotamServiceProtocol: Sendable {
    /// Currently effective NOTAMs for an airport, closures first.
    /// Throws `NotamError.notConfigured` (before any network access) when no FAA key is stored.
    func fetchNotams(for airport: Airport) async throws -> NotamReport
}

// MARK: - Errors

nonisolated enum NotamError: LocalizedError, Equatable {
    /// No FAA NOTAM API client ID / secret saved in Settings.
    case notConfigured
    /// FAA returned 401/403 for the stored credentials.
    case credentialsRejected

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "NOTAMs need a free FAA API key. Add it in Settings › NOTAM API."
        case .credentialsRejected:
            return "The FAA rejected the NOTAM API key. Check the client ID and secret in Settings › NOTAM API."
        }
    }
}

// MARK: - Credentials

nonisolated struct NotamCredentials: Sendable, Equatable {
    let clientID: String
    let clientSecret: String

    nonisolated static let keychain = KeychainStore(service: "quartermint.efb-212.faa-notam-api")
    nonisolated static let clientIDAccount = "client_id"
    nonisolated static let clientSecretAccount = "client_secret"

    /// FAA developer portal where the free NOTAM API key is requested.
    nonisolated static let registrationURL = URL(string: "https://api.faa.gov/s/")

    init(clientID: String, clientSecret: String) {
        self.clientID = clientID
        self.clientSecret = clientSecret
    }

    /// Stored credentials, or nil when either value is missing or blank.
    static func load(from store: KeychainStore = NotamCredentials.keychain) -> NotamCredentials? {
        guard let id = store.string(forAccount: clientIDAccount)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty,
              let secret = store.string(forAccount: clientSecretAccount)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !secret.isEmpty
        else { return nil }
        return NotamCredentials(clientID: id, clientSecret: secret)
    }

    func save(to store: KeychainStore = NotamCredentials.keychain) throws {
        try store.setString(clientID, forAccount: Self.clientIDAccount)
        try store.setString(clientSecret, forAccount: Self.clientSecretAccount)
    }

    static func remove(from store: KeychainStore = NotamCredentials.keychain) throws {
        try store.removeValue(forAccount: clientIDAccount)
        try store.removeValue(forAccount: clientSecretAccount)
    }
}

// MARK: - Models

nonisolated enum NotamClosure: Int, Sendable, Comparable {
    case aerodrome = 0   // whole airport closed (Q-code QFALC, "AD AP CLSD")
    case runway = 1      // runway closed (Q-code QMRLC, "RWY 13/31 CLSD")

    static func < (lhs: NotamClosure, rhs: NotamClosure) -> Bool { lhs.rawValue < rhs.rawValue }

    var label: String {
        switch self {
        case .aerodrome: return "AD CLSD"
        case .runway: return "RWY CLSD"
        }
    }
}

nonisolated struct Notam: Identifiable, Equatable, Hashable, Sendable {
    let id: String                  // FAA NOTAM id, e.g. "NOTAM_1_74012345"
    let number: String              // e.g. "10/045"
    let series: String?
    let type: String?               // N = new, R = replace, C = cancel
    let issued: Date?               // UTC
    let effectiveStart: Date?       // UTC; nil = unknown (treated as already effective)
    let effectiveEnd: Date?         // UTC; nil = permanent ("PERM") or unspecified
    let isPermanent: Bool
    let text: String                // NOTAM body, e.g. "RWY 13/31 CLSD"
    let fullText: String?           // LOCAL_FORMAT simpleText or ICAO formattedText translation
    let classification: String?     // DOM, FDC, INTL, MIL, LMIL
    let location: String?           // FAA location, e.g. "PAO"
    let icaoLocation: String?       // e.g. "KPAO"
    let selectionCode: String?      // ICAO Q-code, e.g. "QMRLC"
    let schedule: String?

    init(
        id: String,
        number: String,
        series: String? = nil,
        type: String? = nil,
        issued: Date? = nil,
        effectiveStart: Date?,
        effectiveEnd: Date?,
        isPermanent: Bool = false,
        text: String,
        fullText: String? = nil,
        classification: String? = nil,
        location: String? = nil,
        icaoLocation: String? = nil,
        selectionCode: String? = nil,
        schedule: String? = nil
    ) {
        self.id = id
        self.number = number
        self.series = series
        self.type = type
        self.issued = issued
        self.effectiveStart = effectiveStart
        self.effectiveEnd = effectiveEnd
        self.isPermanent = isPermanent
        self.text = text
        self.fullText = fullText
        self.classification = classification
        self.location = location
        self.icaoLocation = icaoLocation
        self.selectionCode = selectionCode
        self.schedule = schedule
    }

    /// A cancellation NOTAM ("C") only announces that another NOTAM ended.
    var isCancellation: Bool { type?.uppercased() == "C" }

    /// Effective at `date`: started (or start unknown) and not yet ended (or permanent).
    func isEffective(at date: Date) -> Bool {
        if let start = effectiveStart, start > date { return false }
        if let end = effectiveEnd, end <= date { return false }
        return true
    }

    var closure: NotamClosure? {
        let code = selectionCode?.uppercased() ?? ""
        if code.hasPrefix("QFALC") { return .aerodrome }
        if code.hasPrefix("QMRLC") { return .runway }

        let body = text.uppercased()
        if body.range(of: #"\bAD\s+AP\s+CLSD\b|\bA[DP]\s+CLSD\b"#, options: .regularExpression) != nil {
            return .aerodrome
        }
        if body.range(
            of: #"\bRWY\s+\d{1,2}[LRC]?(/\d{1,2}[LRC]?)?\s+CLSD\b"#,
            options: .regularExpression
        ) != nil {
            return .runway
        }
        return nil
    }

    /// Briefing order: aerodrome closures, then runway closures, then everything else;
    /// within a group the most recently effective first.
    static func briefingOrder(_ lhs: Notam, _ rhs: Notam) -> Bool {
        switch (lhs.closure, rhs.closure) {
        case let (l?, r?) where l != r: return l < r
        case (.some, .none): return true
        case (.none, .some): return false
        default: break
        }
        let lStart = lhs.effectiveStart ?? .distantPast
        let rStart = rhs.effectiveStart ?? .distantPast
        if lStart != rStart { return lStart > rStart }
        return lhs.number < rhs.number
    }

    /// e.g. "Oct 30 1400Z – Oct 31 0200Z" or "Oct 30 1400Z – PERM". Times are UTC.
    var effectiveWindowDescription: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MMM d HHmm'Z'"
        let start = effectiveStart.map { formatter.string(from: $0) } ?? "—"
        let end: String
        if let effectiveEnd {
            end = formatter.string(from: effectiveEnd)
        } else {
            end = isPermanent ? "PERM" : "UFN"
        }
        return "\(start) – \(end)"
    }
}

/// One airport's effective NOTAMs plus when they were fetched from the FAA.
nonisolated struct NotamReport: Sendable, Equatable {
    let location: String
    let notams: [Notam]
    /// When the FAA last answered with this data. A fallback copy keeps its original time, so the
    /// data-age badge shows the true age rather than the time of the failed refresh.
    let fetchedAt: Date
    /// The latest refresh failed; `notams` is the last good copy.
    var refreshFailed = false
    /// The page cap or time budget stopped the download: later pages (possibly closures) are missing.
    var isIncomplete = false
}

/// One decoded page of the FAA response.
nonisolated struct NotamPage: Sendable, Equatable {
    let notams: [Notam]
    let pageNum: Int
    let totalPages: Int
    let totalCount: Int
}

// MARK: - Service

actor NotamService: NotamServiceProtocol {

    nonisolated static let endpoint = "https://external-api.faa.gov/notamapi/v1/notams"
    nonisolated static let cacheExpiry: TimeInterval = 600  // 10 minutes
    nonisolated static let pageSize = 100                    // FAA allows up to 1000
    nonisolated static let maxPages = 5                      // cap on sequential pages (500 NOTAMs)
    nonisolated static let fetchBudget: TimeInterval = 30    // seconds for all pages of one airport

    private let session: URLSession
    private let credentialsProvider: @Sendable () -> NotamCredentials?
    private let clock: @Sendable () -> Date
    /// All parsed NOTAMs per location query value; filtered for effectiveness on every read.
    private var cache: [String: (notams: [Notam], fetchedAt: Date, incomplete: Bool)] = [:]

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "NotamService")

    // MARK: - Init

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - credentials: Override for tests; defaults to reading the Keychain on every fetch.
    ///   - now: Override for tests (cache age, fetch time budget).
    init(session: URLSession? = nil, credentials: (@Sendable () -> NotamCredentials?)? = nil,
         now: @escaping @Sendable () -> Date = { Date() }) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 60
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        self.credentialsProvider = credentials ?? { NotamCredentials.load() }
        self.clock = now
    }

    // MARK: - Fetch

    func fetchNotams(for airport: Airport) async throws -> NotamReport {
        guard let credentials = credentialsProvider() else {
            throw NotamError.notConfigured
        }

        let query = Self.locationQuery(for: airport)
        let location = query.value ?? airport.icao
        let now = clock()
        if let cached = cache[location], now.timeIntervalSince(cached.fetchedAt) < Self.cacheExpiry {
            return NotamReport(
                location: location,
                notams: Self.activeSorted(cached.notams, at: now),
                fetchedAt: cached.fetchedAt,
                isIncomplete: cached.incomplete
            )
        }

        var all: [Notam] = []
        var incomplete = false
        do {
            var pageNum = 1
            var lastPage = 1
            repeat {
                let page = try await fetchPage(query: query, pageNum: pageNum, credentials: credentials)
                all.append(contentsOf: page.notams)
                lastPage = page.totalPages
                pageNum += 1
                if pageNum <= lastPage, pageNum > Self.maxPages || clock().timeIntervalSince(now) >= Self.fetchBudget {
                    incomplete = true  // never present a cut-off list as complete
                    break
                }
            } while pageNum <= lastPage
        } catch {
            // Fail honestly: serve the last good copy for this airport, flagged, with its true age.
            if let previous = cache[location] {
                logger.error("NOTAM refresh failed for \(location, privacy: .public), serving the copy from \(previous.fetchedAt): \(error.localizedDescription, privacy: .public)")
                return NotamReport(
                    location: location,
                    notams: Self.activeSorted(previous.notams, at: now),
                    fetchedAt: previous.fetchedAt,
                    refreshFailed: true,
                    isIncomplete: previous.incomplete
                )
            }
            throw error
        }

        let fetchedAt = clock()
        cache[location] = (all, fetchedAt, incomplete)
        logger.info("Fetched \(all.count) NOTAMs for \(location, privacy: .public)\(incomplete ? " (incomplete)" : "")")
        return NotamReport(
            location: location,
            notams: Self.activeSorted(all, at: fetchedAt),
            fetchedAt: fetchedAt,
            isIncomplete: incomplete
        )
    }

    func clearCache() {
        cache.removeAll()
    }

    private func fetchPage(
        query: URLQueryItem,
        pageNum: Int,
        credentials: NotamCredentials
    ) async throws -> NotamPage {
        var components = URLComponents(string: Self.endpoint)
        components?.queryItems = [
            query,
            URLQueryItem(name: "responseFormat", value: "geoJson"),
            URLQueryItem(name: "pageSize", value: String(Self.pageSize)),
            URLQueryItem(name: "pageNum", value: String(pageNum))
        ]
        guard let url = components?.url else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badURL))
        }

        var request = URLRequest(url: url)
        request.setValue(credentials.clientID, forHTTPHeaderField: "client_id")
        request.setValue(credentials.clientSecret, forHTTPHeaderField: "client_secret")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let result: (Data, URLResponse)
        do {
            result = try await session.data(for: request)
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw EFBError.networkUnavailable
        } catch {
            throw EFBError.weatherFetchFailed(underlying: error)
        }
        let (data, response) = result

        guard let http = response as? HTTPURLResponse else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }
        switch http.statusCode {
        case 200...299:
            break
        case 401, 403:
            throw NotamError.credentialsRejected
        default:
            logger.error("NOTAM API HTTP \(http.statusCode)")
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }

        do {
            return try Self.parseResponse(data)
        } catch {
            throw EFBError.weatherFetchFailed(underlying: error)
        }
    }

    // MARK: - Pure helpers (unit-tested)

    /// `icaoLocation` for 4-letter ICAO idents (KPAO), otherwise `domesticLocation` with the FAA LID (0Q5).
    nonisolated static func locationQuery(for airport: Airport) -> URLQueryItem {
        let icao = airport.icao.uppercased()
        if icao.count == 4, icao.allSatisfy({ $0.isLetter }) {
            return URLQueryItem(name: "icaoLocation", value: icao)
        }
        return URLQueryItem(name: "domesticLocation", value: (airport.faaID ?? airport.icao).uppercased())
    }

    /// Drops cancellations and NOTAMs not effective at `date`, then sorts closures first.
    nonisolated static func activeSorted(_ notams: [Notam], at date: Date) -> [Notam] {
        notams
            .filter { !$0.isCancellation && $0.isEffective(at: date) }
            .sorted(by: Notam.briefingOrder)
    }

    /// Decode one geoJson page of the FAA NOTAM API response.
    nonisolated static func parseResponse(_ data: Data) throws -> NotamPage {
        let dto = try JSONDecoder().decode(NotamResponseDTO.self, from: data)

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        func date(_ string: String?) -> Date? {
            guard var value = string?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
            if value.uppercased().hasSuffix("EST") {
                value = String(value.dropLast(3)).trimmingCharacters(in: .whitespaces)
            }
            return fractional.date(from: value) ?? plain.date(from: value)
        }

        let notams: [Notam] = (dto.items ?? []).compactMap { item in
            guard let core = item.properties?.coreNOTAMData,
                  let raw = core.notam,
                  let id = raw.id ?? raw.number
            else { return nil }

            let translations = core.notamTranslation ?? []
            let fullText = translations.first(where: { $0.type == "LOCAL_FORMAT" })?.simpleText
                ?? translations.first(where: { $0.type == "ICAO" })?.formattedText
                ?? translations.compactMap({ $0.simpleText ?? $0.formattedText }).first

            let endRaw = raw.effectiveEnd?.trimmingCharacters(in: .whitespaces).uppercased()
            let isPermanent = endRaw == "PERM"

            return Notam(
                id: id,
                number: raw.number ?? id,
                series: raw.series,
                type: raw.type,
                issued: date(raw.issued),
                effectiveStart: date(raw.effectiveStart),
                effectiveEnd: isPermanent ? nil : date(raw.effectiveEnd),
                isPermanent: isPermanent,
                text: (raw.text ?? fullText ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                fullText: fullText,
                classification: raw.classification,
                location: raw.location,
                icaoLocation: raw.icaoLocation,
                selectionCode: raw.selectionCode,
                schedule: raw.schedule
            )
        }

        return NotamPage(
            notams: notams,
            pageNum: dto.pageNum ?? 1,
            totalPages: dto.totalPages ?? 1,
            totalCount: dto.totalCount ?? notams.count
        )
    }
}

// MARK: - Wire format (see schema citation at top of file)

private nonisolated struct NotamResponseDTO: Decodable {
    let pageSize: Int?
    let pageNum: Int?
    let totalCount: Int?
    let totalPages: Int?
    let items: [NotamItemDTO]?
}

private nonisolated struct NotamItemDTO: Decodable {
    let type: String?
    let properties: NotamPropertiesDTO?
}

private nonisolated struct NotamPropertiesDTO: Decodable {
    let coreNOTAMData: NotamCoreDTO?
}

private nonisolated struct NotamCoreDTO: Decodable {
    let notam: NotamFieldsDTO?
    let notamTranslation: [NotamTranslationDTO]?
}

private nonisolated struct NotamFieldsDTO: Decodable {
    let id: String?
    let series: String?
    let number: String?
    let type: String?
    let issued: String?
    let selectionCode: String?
    let location: String?
    let effectiveStart: String?
    let effectiveEnd: String?
    let text: String?
    let classification: String?
    let icaoLocation: String?
    let schedule: String?
}

private nonisolated struct NotamTranslationDTO: Decodable {
    let type: String?
    let simpleText: String?
    let formattedText: String?
}
