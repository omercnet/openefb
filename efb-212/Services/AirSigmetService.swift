//
//  AirSigmetService.swift
//  efb-212
//
//  SIGMETs, AIRMETs and CONUS G-AIRMETs from aviationweather.gov (keyless).
//
//  - /api/data/airsigmet?format=json: [{airSigmetType "SIGMET"/"AIRMET", hazard "CONVECTIVE"/
//    "TURB"/"ICE"/"IFR"/"MTN OBSCN", validTimeFrom/validTimeTo epoch seconds,
//    altitudeLow1/altitudeHi1 feet MSL (null = surface/unspecified), coords [{lat, lon}], rawAirSigmet}]
//  - /api/data/gairmet?format=json: the current G-AIRMET snapshot [{product SIERRA/TANGO/ZULU,
//    tag, hazard "IFR"/"MT_OBSC"/"TURB-HI"/"TURB-LO"/"ICE"/"FZLVL"/"M_FZLVL"/..., validTime ISO-8601,
//    expireTime epoch seconds, base/top hundreds of feet as strings ("SFC", "FZL", "080"),
//    fzlbase/fzltop, geometryType AREA/LINE, coords [{lat, lon}] as strings}].
//    A G-AIRMET snapshot represents conditions 90 minutes either side of its validTime.
//
//  Last good fetch is cached in memory and refetched at most every 10 minutes. Validity
//  filtering happens at display time so a cached snapshot never shows expired advisories.
//

import Foundation
import os

// MARK: - Protocol

protocol AirSigmetServiceProtocol: Sendable {
    /// All advisories from the last fetch (including not-yet-valid ones) and the fetch time.
    /// Cached for 10 minutes; a failed refresh returns the last good snapshot. Throws only
    /// when nothing was ever fetched. Filter with `isValid(at:)` before display.
    func currentAdvisories() async throws -> AdvisorySnapshot
}

// MARK: - Models

nonisolated enum AdvisoryKind: String, Sendable {
    case sigmet = "SIGMET"
    case airmet = "AIRMET"
    case gAirmet = "G-AIRMET"
}

nonisolated enum AdvisoryHazard: String, Sendable, CaseIterable {
    case convective
    case ifr
    case mountainObscuration
    case turbulence
    case icing
    case other

    /// Map aviationweather.gov hazard codes from both endpoints.
    init(apiCode: String) {
        let code = apiCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        switch code {
        case "CONVECTIVE", "TS": self = .convective
        case "IFR": self = .ifr
        case "MTN OBSCN", "MT_OBSC", "MTN OBSC", "MT OBSC": self = .mountainObscuration
        case "LLWS": self = .turbulence
        default:
            if code.hasPrefix("TURB") {
                self = .turbulence
            } else if code.hasPrefix("ICE") || code.hasPrefix("ICING") {
                self = .icing
            } else {
                self = .other
            }
        }
    }

    var displayName: String {
        switch self {
        case .convective: return "Convective"
        case .ifr: return "IFR"
        case .mountainObscuration: return "Mountain Obscuration"
        case .turbulence: return "Turbulence"
        case .icing: return "Icing"
        case .other: return "Other"
        }
    }
}

nonisolated struct AviationAdvisory: Identifiable, Equatable, Sendable {
    let id: String
    let kind: AdvisoryKind
    let hazard: AdvisoryHazard
    let hazardCode: String               // API hazard code as published, e.g. "MTN OBSCN"
    let validFrom: Date                  // UTC
    let validTo: Date                    // UTC
    let floorFeet: Int?                  // feet MSL; nil = surface or unspecified
    let ceilingFeet: Int?                // feet MSL; nil = unspecified
    let boundaries: [[Double]]           // [lat, lon]
    let text: String?                    // Raw SIGMET/AIRMET text, or G-AIRMET "due to" summary

    func isValid(at date: Date) -> Bool {
        validFrom <= date && date <= validTo
    }

    /// Fill/line color for the map layer.
    var colorHex: String { AdvisoryStyle.colorHex(kind: kind, hazard: hazard) }
}

nonisolated enum AdvisoryStyle {
    static let red = "#FF3B30"           // SIGMETs and convective
    static let purple = "#AF52DE"        // IFR
    static let orange = "#FF9500"        // Turbulence / LLWS
    static let blue = "#007AFF"          // Icing
    static let brown = "#A2845E"         // Mountain obscuration
    static let gray = "#8E8E93"          // Anything else

    /// Any SIGMET (convective or not) is red; AIRMETs/G-AIRMETs are colored by hazard.
    static func colorHex(kind: AdvisoryKind, hazard: AdvisoryHazard) -> String {
        if kind == .sigmet { return red }
        switch hazard {
        case .convective: return red
        case .ifr: return purple
        case .turbulence: return orange
        case .icing: return blue
        case .mountainObscuration: return brown
        case .other: return gray
        }
    }
}

/// Advisories plus the time they were fetched, for data-age display.
nonisolated struct AdvisorySnapshot: Equatable, Sendable {
    let advisories: [AviationAdvisory]
    let fetchedAt: Date

    /// Advisories in effect at `date`.
    func valid(at date: Date) -> [AviationAdvisory] {
        advisories.filter { $0.isValid(at: date) }
    }
}

// MARK: - Parsing

nonisolated enum AirSigmetParser {

    /// Half-width of a G-AIRMET snapshot's valid window around its validTime.
    static let gAirmetHalfWindow: TimeInterval = 90 * 60  // 90 minutes

    /// G-AIRMET hazards that are informational contours, not hazard areas.
    static let excludedGAirmetHazards: Set<String> = ["FZLVL", "M_FZLVL"]

    /// Parse /api/data/airsigmet JSON. Empty body (HTTP 204) means no advisories.
    static func parseAirSigmets(_ data: Data) throws -> [AviationAdvisory] {
        guard !data.isEmpty else { return [] }
        guard let entries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        return entries.enumerated().compactMap { index, entry -> AviationAdvisory? in
            guard let typeString = (entry["airSigmetType"] as? String)?.uppercased(),
                  let kind = AdvisoryKind(rawValue: typeString),
                  let from = number(entry["validTimeFrom"]),
                  let to = number(entry["validTimeTo"]) else { return nil }
            let ring = ringFrom(entry["coords"])
            guard ring.count >= 3 else { return nil }

            let hazardCode = (entry["hazard"] as? String) ?? ""
            let series = (entry["seriesId"] as? String) ?? "\(index)"
            let issuer = (entry["icaoId"] as? String) ?? ""
            return AviationAdvisory(
                id: "\(kind.rawValue)-\(issuer)-\(series)-\(Int(from))",
                kind: kind,
                hazard: AdvisoryHazard(apiCode: hazardCode),
                hazardCode: hazardCode,
                validFrom: Date(timeIntervalSince1970: from),  // epoch seconds UTC
                validTo: Date(timeIntervalSince1970: to),
                floorFeet: number(entry["altitudeLow1"]).map { Int($0) },   // feet MSL
                ceilingFeet: number(entry["altitudeHi1"]).map { Int($0) },  // feet MSL
                boundaries: ring,
                text: entry["rawAirSigmet"] as? String
            )
        }
    }

    /// Parse /api/data/gairmet JSON. Only AREA geometries of hazard types are kept.
    static func parseGAirmets(_ data: Data) throws -> [AviationAdvisory] {
        guard !data.isEmpty else { return [] }
        guard let entries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plainFormatter = ISO8601DateFormatter()

        return entries.enumerated().compactMap { index, entry -> AviationAdvisory? in
            guard let hazardCode = entry["hazard"] as? String,
                  !excludedGAirmetHazards.contains(hazardCode.uppercased()),
                  ((entry["geometryType"] as? String) ?? (entry["geom"] as? String))?.uppercased() == "AREA",
                  let validString = entry["validTime"] as? String,
                  let validTime = isoFormatter.date(from: validString) ?? plainFormatter.date(from: validString)
            else { return nil }
            let ring = ringFrom(entry["coords"])
            guard ring.count >= 3 else { return nil }

            var validTo = validTime.addingTimeInterval(gAirmetHalfWindow)
            if let expire = number(entry["expireTime"]) {
                validTo = min(validTo, Date(timeIntervalSince1970: expire))  // epoch seconds UTC
            }

            let product = (entry["product"] as? String) ?? ""
            let tag = (entry["tag"] as? String) ?? "\(index)"
            return AviationAdvisory(
                // One tag can publish several polygons for the same hazard; the index keeps ids unique
                id: "G-AIRMET-\(product)-\(tag)-\(hazardCode)-\(Int(validTime.timeIntervalSince1970))-\(index)",
                kind: .gAirmet,
                hazard: AdvisoryHazard(apiCode: hazardCode),
                hazardCode: hazardCode,
                validFrom: validTime.addingTimeInterval(-gAirmetHalfWindow),
                validTo: validTo,
                floorFeet: gAirmetLevel(entry["base"], freezingLevel: entry["fzlbase"]),
                ceilingFeet: gAirmetLevel(entry["top"], freezingLevel: entry["fzltop"]),
                boundaries: ring,
                text: entry["due_to"] as? String
            )
        }
    }

    /// G-AIRMET level in hundreds of feet ("080" = 8,000 ft MSL). "SFC" = 0. "FZL" uses the
    /// published freezing-level bound. Returns feet MSL, or nil when unspecified.
    static func gAirmetLevel(_ value: Any?, freezingLevel: Any?) -> Int? {
        guard let raw = (value as? String)?.trimmingCharacters(in: .whitespaces).uppercased(),
              !raw.isEmpty else { return nil }
        if raw == "SFC" { return 0 }
        if raw == "FZL" {
            return number(freezingLevel).map { Int($0) * 100 }
        }
        return Double(raw).map { Int($0) * 100 }
    }

    // MARK: Helpers

    /// Numbers arrive as JSON numbers or numeric strings depending on endpoint.
    static func number(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let string = value as? String { return Double(string.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    /// [{lat, lon}] -> [[lat, lon]]
    static func ringFrom(_ value: Any?) -> [[Double]] {
        guard let coords = value as? [[String: Any]] else { return [] }
        return coords.compactMap { point in
            guard let lat = number(point["lat"]), let lon = number(point["lon"]) else { return nil }
            return [lat, lon]
        }
    }
}

// MARK: - Service

actor AirSigmetService: AirSigmetServiceProtocol {

    nonisolated static let airSigmetURLString = "https://aviationweather.gov/api/data/airsigmet?format=json"
    nonisolated static let gAirmetURLString = "https://aviationweather.gov/api/data/gairmet?format=json"
    nonisolated static let refreshInterval: TimeInterval = 600  // 10 minutes

    private let session: URLSession
    private let now: @Sendable () -> Date
    private var snapshot: AdvisorySnapshot?
    private var inFlight: Task<AdvisorySnapshot, Error>?

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "AirSigmetService")

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - now: Clock override for tests of the refresh interval.
    init(session: URLSession? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 30
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        self.now = now
    }

    func currentAdvisories() async throws -> AdvisorySnapshot {
        if let snapshot, now().timeIntervalSince(snapshot.fetchedAt) < Self.refreshInterval {
            return snapshot
        }
        if let inFlight {
            return try await inFlight.value
        }

        let task = Task { try await self.refresh() }
        inFlight = task
        defer { inFlight = nil }

        do {
            let fresh = try await task.value
            snapshot = fresh
            return fresh
        } catch {
            if let snapshot {
                logger.warning("Advisory refresh failed, serving cache from \(snapshot.fetchedAt): \(error.localizedDescription)")
                return snapshot
            }
            throw error
        }
    }

    /// Both feeds must succeed; a partial picture (e.g. SIGMETs without AIRMETs) is not published.
    private func refresh() async throws -> AdvisorySnapshot {
        async let sigmetData = fetch(Self.airSigmetURLString)
        async let gAirmetData = fetch(Self.gAirmetURLString)

        let advisories = try AirSigmetParser.parseAirSigmets(try await sigmetData)
            + AirSigmetParser.parseGAirmets(try await gAirmetData)
        return AdvisorySnapshot(advisories: advisories, fetchedAt: now())
    }

    private func fetch(_ urlString: String) async throws -> Data {
        guard let url = URL(string: urlString) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badURL))
        }
        let result: (Data, URLResponse)
        do {
            result = try await session.data(from: url)
        } catch {
            throw EFBError.weatherFetchFailed(underlying: error)
        }
        guard let http = result.1 as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }
        return result.0  // empty for HTTP 204 (no advisories)
    }
}
