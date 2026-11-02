//
//  WeatherService.swift
//  efb-212
//
//  NOAA Aviation Weather API client with 15-minute in-memory cache.
//  Fetches METAR and TAF data from aviationweather.gov.
//  Actor-isolated for thread-safe cache access.
//

import Foundation
import os

actor WeatherService: WeatherServiceProtocol {

    // MARK: - Properties

    /// Lock-protected so `cachedWeather(for:)` can be read synchronously (protocol contract)
    /// without hopping onto the actor.
    nonisolated private let cache = OSAllocatedUnfairLock<[String: WeatherCache]>(initialState: [:])
    private let session: URLSession
    /// Clock for cache expiry and `fetchedAt`. Tests inject a fixed or advancing clock.
    nonisolated private let now: @Sendable () -> Date
    nonisolated private static let metarURL = "https://aviationweather.gov/api/data/metar"
    nonisolated private static let tafURL = "https://aviationweather.gov/api/data/taf"
    nonisolated private static let cacheExpiry: TimeInterval = 900  // 15 minutes

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "WeatherService")

    // MARK: - Init

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - now: Clock; defaults to the wall clock.
    init(session: URLSession? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 30
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - METAR

    func fetchMETAR(for stationID: String) async throws -> WeatherCache {
        // Check cache -- return if fresh (< 15 minutes old)
        if let cached = cachedWeather(for: stationID), now().timeIntervalSince(cached.fetchedAt) < Self.cacheExpiry {
            return cached
        }

        let urlString = "\(Self.metarURL)?ids=\(stationID)&format=json"
        guard let url = URL(string: urlString) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badURL))
        }

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }

        let entries = try parseMetarResponse(data)
        guard let entry = entries.first else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        store(entry)
        return entry
    }

    // MARK: - TAF

    func fetchTAF(for stationID: String) async throws -> String {
        let urlString = "\(Self.tafURL)?ids=\(stationID)&format=json"
        guard let url = URL(string: urlString) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badURL))
        }

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }

        // NOAA TAF endpoint returns JSON array with rawTAF field
        guard let jsonArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let first = jsonArray.first,
              let rawTAF = first["rawTAF"] as? String else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        return rawTAF
    }

    // MARK: - Batch Fetch

    func fetchWeatherForStations(_ stationIDs: [String]) async throws -> [WeatherCache] {
        guard !stationIDs.isEmpty else { return [] }

        // Separate recently cached from needing fetch
        var results: [WeatherCache] = []
        var needsFetch: [String] = []

        for id in stationIDs {
            if let cached = cachedWeather(for: id), now().timeIntervalSince(cached.fetchedAt) < Self.cacheExpiry {
                results.append(cached)
            } else {
                needsFetch.append(id)
            }
        }

        // Batch remaining into groups of 40 (URL length safety)
        let batchSize = 40
        for batchStart in stride(from: 0, to: needsFetch.count, by: batchSize) {
            let batchEnd = min(batchStart + batchSize, needsFetch.count)
            let batch = Array(needsFetch[batchStart..<batchEnd])
            let idsParam = batch.joined(separator: ",")

            let urlString = "\(Self.metarURL)?ids=\(idsParam)&format=json"
            guard let url = URL(string: urlString) else { continue }

            do {
                let (data, response) = try await session.data(from: url)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    continue
                }

                let entries = try parseMetarResponse(data)
                for entry in entries {
                    store(entry)
                    results.append(entry)
                }
            } catch {
                logger.warning("Batch weather fetch failed for \(batch.count) stations: \(error.localizedDescription)")
                // Continue with other batches
            }
        }

        // A station the network did not answer for (offline, failed batch, no report) is served from the
        // last cached report, however old, so the map keeps its dots and the age badge says how old they are.
        let answered = Set(results.map(\.stationID))
        for id in needsFetch where !answered.contains(id) {
            if let stale = cachedWeather(for: id) { results.append(stale) }
        }

        return results
    }

    // MARK: - Cache Access

    /// Return the last fetched weather for a station, including entries older than the
    /// fresh-cache window, so callers can show stale data (with an age badge) when offline.
    nonisolated func cachedWeather(for stationID: String) -> WeatherCache? {
        cache.withLock { $0[stationID] }
    }

    nonisolated private func store(_ entry: WeatherCache) {
        cache.withLock { $0[entry.stationID] = entry }
    }

    /// Force-clear cache for a station (used by manual refresh).
    func clearCache(for stationID: String) {
        cache.withLock { _ = $0.removeValue(forKey: stationID) }
    }

    /// Clear all cached weather data.
    func clearAllCache() {
        cache.withLock { $0.removeAll() }
    }

    // MARK: - NOAA JSON Parsing

    /// Parse NOAA METAR JSON response into WeatherCache array.
    /// NOAA API returns: [{icaoId, rawOb, temp, dewp, wdir, wspd, wgst, visib, clouds, obsTime, fltCat}, ...]
    nonisolated func parseMetarResponse(_ data: Data) throws -> [WeatherCache] {
        guard let jsonArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        // NOAA `obsTime` is epoch seconds (number); `reportTime` is an ISO-8601 string with
        // fractional seconds. Use obsTime, fall back to reportTime.
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return jsonArray.compactMap { entry -> WeatherCache? in
            guard let icaoId = entry["icaoId"] as? String else { return nil }

            let rawOb = entry["rawOb"] as? String
            let temp = parseDouble(entry["temp"])
            let dewp = parseDouble(entry["dewp"])
            let wdir = parseInt(entry["wdir"])
            let wspd = parseInt(entry["wspd"])
            let wgst = parseInt(entry["wgst"])

            // Visibility can be numeric or string
            let visib: String?
            if let visNum = entry["visib"] as? Double {
                visib = visNum >= 10.0 ? "10+" : String(format: "%.1f", visNum)
            } else if let visStr = entry["visib"] as? String {
                visib = visStr
            } else {
                visib = nil
            }

            // Ceiling: lowest cloud base with cover BKN or OVC
            let ceiling = parseCeiling(from: entry["clouds"])

            // Flight category from NOAA (or compute from ceiling/visibility)
            let fltCat: FlightCategory
            if let catString = entry["fltCat"] as? String {
                fltCat = FlightCategory(rawValue: catString.lowercased()) ?? computeFlightCategory(ceiling: ceiling, visibility: visib)
            } else {
                fltCat = computeFlightCategory(ceiling: ceiling, visibility: visib)
            }

            // Altimeter: aviationweather.gov sends `altim` in hPa (e.g. 1017 for Q1017). A value
            // under 100 can only be inHg, so convert rather than show 30 hPa.
            let altimeterHPa: Double? = parseDouble(entry["altim"]).map {
                $0 < 100 ? $0 * Region.hPaPerInHg : $0
            }

            // Observation time
            let obsTime: Date?
            if let epoch = parseDouble(entry["obsTime"]) {
                obsTime = Date(timeIntervalSince1970: epoch)  // seconds since 1970 UTC
            } else if let reportTime = entry["reportTime"] as? String {
                obsTime = isoFormatter.date(from: reportTime)
            } else {
                obsTime = nil
            }

            return WeatherCache(
                stationID: icaoId,
                rawMETAR: rawOb,
                temperature: temp,
                dewpoint: dewp,
                windDirection: wdir,
                windSpeed: wspd,
                windGust: wgst,
                visibility: visib,
                ceiling: ceiling,
                flightCategory: fltCat,
                observationTime: obsTime,
                altimeterHPa: altimeterHPa,
                fetchedAt: now()
            )
        }
    }

    // MARK: - Flight Category Computation

    /// Compute flight category from ceiling and visibility per FAA standards.
    /// VFR: ceiling >3000 AND vis >5
    /// MVFR: ceiling 1000-3000 OR vis 3-5
    /// IFR: ceiling 500-999 OR vis 1-3 (exclusive)
    /// LIFR: ceiling <500 OR vis <1
    nonisolated private func computeFlightCategory(ceiling: Int?, visibility: String?) -> FlightCategory {
        let vis = parseVisibilityFloat(visibility)

        let ceilingCat: FlightCategory
        if let ceil = ceiling {
            if ceil < 500 { ceilingCat = .lifr }
            else if ceil < 1000 { ceilingCat = .ifr }
            else if ceil <= 3000 { ceilingCat = .mvfr }
            else { ceilingCat = .vfr }
        } else {
            ceilingCat = .vfr  // No ceiling = clear sky
        }

        let visCat: FlightCategory
        if let v = vis {
            if v < 1.0 { visCat = .lifr }
            else if v < 3.0 { visCat = .ifr }
            else if v <= 5.0 { visCat = .mvfr }
            else { visCat = .vfr }
        } else {
            visCat = .vfr  // No visibility data = assume VFR
        }

        // Return the worst (lowest) category
        let categories: [FlightCategory] = [.lifr, .ifr, .mvfr, .vfr]
        for cat in categories {
            if ceilingCat == cat || visCat == cat { return cat }
        }
        return .vfr
    }

    // MARK: - Parsing Helpers

    nonisolated private func parseDouble(_ value: Any?) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let s = value as? String { return Double(s) }
        return nil
    }

    nonisolated private func parseInt(_ value: Any?) -> Int? {
        if let i = value as? Int { return i }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String { return Int(s) }
        return nil
    }

    /// Parse ceiling from NOAA clouds array.
    /// Clouds format: [{cover: "BKN", base: 2500}, {cover: "OVC", base: 5000}]
    /// Returns lowest base with BKN or OVC cover.
    nonisolated private func parseCeiling(from clouds: Any?) -> Int? {
        guard let cloudArray = clouds as? [[String: Any]] else { return nil }

        var lowestCeiling: Int?
        for cloud in cloudArray {
            guard let cover = cloud["cover"] as? String,
                  cover == "BKN" || cover == "OVC" else { continue }
            if let base = cloud["base"] as? Int {
                if lowestCeiling == nil || base < lowestCeiling! {
                    lowestCeiling = base
                }
            }
        }
        return lowestCeiling
    }

    /// Parse visibility string to float (e.g., "10+" -> 10.0, "3" -> 3.0)
    nonisolated private func parseVisibilityFloat(_ visibility: String?) -> Double? {
        guard let vis = visibility else { return nil }
        let cleaned = vis.replacingOccurrences(of: "+", with: "")
        return Double(cleaned)
    }
}
