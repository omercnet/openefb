//
//  PirepService.swift
//  efb-212
//
//  Pilot reports (PIREPs/AIREPs) from the NOAA Aviation Weather Center data API.
//  Keyless endpoint: https://aviationweather.gov/api/data/pirep?bbox=...&age=2&format=json
//  Returns a JSON array (HTTP 204 with an empty body when nothing matches).
//

import Foundation
import CoreLocation
import os

// MARK: - Protocol

protocol PirepServiceProtocol: Sendable {
    /// PIREPs within `radiusNM` nautical miles of `coordinate` observed no more than `maxAge`
    /// seconds ago, newest first.
    func fetchPireps(
        near coordinate: CLLocationCoordinate2D,
        radiusNM: Double,
        maxAge: TimeInterval
    ) async throws -> [Pirep]
}

// MARK: - Model

nonisolated struct Pirep: Identifiable, Equatable, Sendable {
    /// Cloud layer reported in the `/SK` group.
    nonisolated struct CloudLayer: Equatable, Sendable {
        let cover: String                // "BKN", "OVC", "SCT", "IMC", "CLR" ...
        let base: Int?                   // feet MSL, nil when not reported
        let top: Int?                    // feet MSL, nil when not reported
    }

    /// Turbulence or icing group (`/TB`, `/IC`).
    nonisolated struct Condition: Equatable, Sendable {
        let intensity: String            // "LGT", "MOD", "SEV", "NEG" ...
        let type: String?                // "CHOP", "CAT", "RIME", "MIXED" ...
        let frequency: String?           // "CONT", "INT", "OCNL" (turbulence only)
        let base: Int?                   // feet MSL
        let top: Int?                    // feet MSL
    }

    var id: String { "\(observationTime.timeIntervalSince1970)-\(rawText)" }

    let observationTime: Date
    let reportType: String               // "PIREP", "Urgent PIREP", "AIREP"
    let aircraftType: String?
    let latitude: Double                 // degrees
    let longitude: Double                // degrees
    let altitude: Int?                   // feet MSL, nil when unknown or reported only as DURC/DURD
    let altitudeQualifier: String?       // "DURC" (during climb), "DURD" (during descent), "UNKN"
    let clouds: [CloudLayer]
    let weather: String?                 // present weather, e.g. "-RA", "FU"
    let temperature: Int?                // degrees Celsius
    let windDirection: Int?              // degrees true
    let windSpeed: Int?                  // knots
    let turbulence: [Condition]
    let icing: [Condition]
    let rawText: String

    var isUrgent: Bool {
        reportType.localizedCaseInsensitiveContains("urgent") || rawText.contains(" UUA ")
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    // MARK: Display summaries

    var altitudeText: String {
        let qualifier: String? = switch altitudeQualifier ?? "" {
        case "DURC": "climbing"
        case "DURD": "descending"
        default: nil
        }
        if let altitude {
            let feet = "\(altitude.formatted()) ft MSL"
            return qualifier.map { "\(feet) (\($0))" } ?? feet
        }
        if let qualifier { return qualifier.capitalized }
        return "Alt unknown"
    }

    var turbulenceSummary: String? { Self.summary(of: turbulence) }
    var icingSummary: String? { Self.summary(of: icing) }

    var skySummary: String? {
        guard !clouds.isEmpty else { return nil }
        return clouds.map { layer in
            var text = layer.cover
            if let base = layer.base { text += " \(base.formatted()) ft" }
            if let top = layer.top { text += " tops \(top.formatted()) ft" }
            return text
        }.joined(separator: ", ")
    }

    var windSummary: String? {
        guard let windSpeed else { return nil }
        let direction = windDirection.map { String(format: "%03d°", $0) } ?? "VRB"
        return "\(direction) \(windSpeed) kt"
    }

    private static func summary(of conditions: [Condition]) -> String? {
        guard !conditions.isEmpty else { return nil }
        return conditions.map { condition in
            var parts = [condition.intensity]
            if let frequency = condition.frequency { parts.append(frequency) }
            if let type = condition.type { parts.append(type) }
            var text = parts.joined(separator: " ")
            switch (condition.base, condition.top) {
            case let (base?, top?): text += " \(base.formatted())–\(top.formatted()) ft"
            case let (base?, nil): text += " from \(base.formatted()) ft"
            case let (nil, top?): text += " to \(top.formatted()) ft"
            case (nil, nil): break
            }
            return text
        }.joined(separator: ", ")
    }
}

// MARK: - Parsing & Filtering

nonisolated enum PirepParser {

    static let earthRadiusNM = 3440.065  // nautical miles

    /// Parse the AWC `pirep` JSON array. Entries without a position, observation time or raw
    /// text are dropped. An empty body (HTTP 204) yields an empty array.
    static func parse(_ data: Data) throws -> [Pirep] {
        guard !data.isEmpty else { return [] }
        guard let array = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }
        return array.compactMap(parseEntry)
    }

    static func parseEntry(_ entry: [String: Any]) -> Pirep? {
        guard let epoch = double(entry["obsTime"]),
              let lat = double(entry["lat"]),
              let lon = double(entry["lon"]),
              let raw = string(entry["rawOb"]) else { return nil }

        // fltLvl is hundreds of feet MSL. DURC/DURD reports often carry fltLvl 0 = not given.
        let levelType = string(entry["fltLvlType"])
        let flightLevel = int(entry["fltLvl"])
        let altitude: Int?
        if levelType == "UNKN" {
            altitude = nil
        } else if let flightLevel, flightLevel > 0 || levelType == "OTHER" || levelType == nil {
            altitude = flightLevel * 100  // feet MSL
        } else {
            altitude = nil
        }
        let qualifier = (levelType == "OTHER") ? nil : levelType

        let clouds: [Pirep.CloudLayer] = (entry["clouds"] as? [[String: Any]] ?? []).compactMap { layer in
            guard let cover = string(layer["cover"]) else { return nil }
            // AWC encodes "not reported" base/top as 0.
            return Pirep.CloudLayer(cover: cover, base: positive(layer["base"]), top: positive(layer["top"]))
        }

        let turbulence = [1, 2].compactMap { index in
            condition(entry, prefix: "tb", index: index, hasFrequency: true)
        }
        let icing = [1, 2].compactMap { index in
            condition(entry, prefix: "icg", index: index, hasFrequency: false)
        }

        return Pirep(
            observationTime: Date(timeIntervalSince1970: epoch),  // epoch seconds UTC
            reportType: string(entry["pirepType"]) ?? "PIREP",
            aircraftType: string(entry["acType"]),
            latitude: lat,
            longitude: lon,
            altitude: altitude,
            altitudeQualifier: qualifier,
            clouds: clouds,
            weather: string(entry["wxString"]),
            temperature: int(entry["temp"]),     // degrees Celsius
            windDirection: int(entry["wdir"]),   // degrees true
            windSpeed: int(entry["wspd"]),       // knots
            turbulence: turbulence,
            icing: icing,
            rawText: raw
        )
    }

    /// Keep reports within `radiusNM` (inclusive) and no older than `maxAge` (inclusive),
    /// sorted newest first. Reports time-stamped more than 5 minutes in the future are dropped.
    static func filter(
        _ pireps: [Pirep],
        near coordinate: CLLocationCoordinate2D,
        radiusNM: Double,
        maxAge: TimeInterval,
        now: Date
    ) -> [Pirep] {
        pireps
            .filter { pirep in
                let age = now.timeIntervalSince(pirep.observationTime)
                return age <= maxAge && age >= -300
                    && distanceNM(from: coordinate, to: pirep.coordinate) <= radiusNM
            }
            .sorted { $0.observationTime > $1.observationTime }
    }

    /// Haversine great-circle distance in nautical miles.
    static func distanceNM(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = lat2 - lat1
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusNM * asin(min(1, sqrt(h)))
    }

    /// Bounding box `minLat,minLon,maxLat,maxLon` (degrees) enclosing a `radiusNM` circle.
    static func boundingBox(around coordinate: CLLocationCoordinate2D, radiusNM: Double) -> String {
        let dLat = radiusNM / 60.0  // 1° latitude ≈ 60 NM
        let cosLat = max(cos(coordinate.latitude * .pi / 180), 0.01)
        let dLon = min(radiusNM / (60.0 * cosLat), 180)
        let minLat = max(coordinate.latitude - dLat, -90)
        let maxLat = min(coordinate.latitude + dLat, 90)
        let minLon = max(coordinate.longitude - dLon, -180)
        let maxLon = min(coordinate.longitude + dLon, 180)
        return String(format: "%.3f,%.3f,%.3f,%.3f", minLat, minLon, maxLat, maxLon)
    }

    // MARK: Helpers

    private static func condition(
        _ entry: [String: Any], prefix: String, index: Int, hasFrequency: Bool
    ) -> Pirep.Condition? {
        guard let intensity = string(entry["\(prefix)Int\(index)"]) else { return nil }
        return Pirep.Condition(
            intensity: intensity.uppercased(),
            type: string(entry["\(prefix)Type\(index)"]),
            frequency: hasFrequency ? string(entry["\(prefix)Freq\(index)"]) : nil,
            // Bases/tops are hundreds of feet MSL.
            base: int(entry["\(prefix)Bas\(index)"]).map { $0 * 100 },
            top: int(entry["\(prefix)Top\(index)"]).map { $0 * 100 }
        )
    }

    /// Non-empty trimmed string, nil for null/"" values.
    private static func string(_ value: Any?) -> String? {
        guard let s = value as? String else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func double(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String { return Double(s) }
        return nil
    }

    private static func int(_ value: Any?) -> Int? {
        double(value).map { Int($0.rounded()) }
    }

    private static func positive(_ value: Any?) -> Int? {
        guard let v = int(value), v > 0 else { return nil }
        return v
    }
}

// MARK: - Service

actor PirepService: PirepServiceProtocol {

    nonisolated private static let baseURL = "https://aviationweather.gov/api/data/pirep"
    private let session: URLSession
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "PirepService")

    /// - Parameter session: Override for tests; defaults to a session with short timeouts.
    init(session: URLSession? = nil) {
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

    func fetchPireps(
        near coordinate: CLLocationCoordinate2D,
        radiusNM: Double,
        maxAge: TimeInterval
    ) async throws -> [Pirep] {
        // Query a bounding box around the circle, then filter precisely by great-circle distance.
        // The API's own `id`+`distance` radius is loosely enforced and needs a reporting station id,
        // which private strips lack.
        let bbox = PirepParser.boundingBox(around: coordinate, radiusNM: radiusNM)
        let ageHours = String(format: "%.2f", max(maxAge, 60) / 3600)
        var components = URLComponents(string: Self.baseURL)
        components?.queryItems = [
            URLQueryItem(name: "bbox", value: bbox),
            URLQueryItem(name: "age", value: ageHours),
            URLQueryItem(name: "format", value: "json"),
        ]
        guard let url = components?.url else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badURL))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw EFBError.networkUnavailable
        } catch {
            throw EFBError.weatherFetchFailed(underlying: error)
        }

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }

        let parsed = try PirepParser.parse(data)
        let result = PirepParser.filter(parsed, near: coordinate, radiusNM: radiusNM, maxAge: maxAge, now: Date())
        logger.debug("PIREPs: \(parsed.count) in bbox, \(result.count) within \(radiusNM) NM")
        return result
    }
}
