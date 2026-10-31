//
//  WindsAloftService.swift
//  efb-212
//
//  Winds and temperatures aloft (FD/FB bulletin) from the NOAA Aviation Weather Center.
//  Keyless endpoint: https://aviationweather.gov/api/data/windtemp?region=all&level=low&fcst=06
//  Returns the plain-text bulletin:
//
//    FBUS31 KWNO 301400
//    FD1US1
//    DATA BASED ON 301200Z
//    VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000
//
//    FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
//    ABI      1330+09 1533+05 1918+03 2022-09 2232-19 223735 223747 226160
//
//  Each level is a fixed-width field whose header label is right-aligned to the field end;
//  groups start at the field start (a 4-character "DDSS" sits left in a 7-character field).
//  Blank fields are levels within 1,500 ft of the station elevation (not forecast).
//

import Foundation
import CoreLocation
import os

// MARK: - Protocol

protocol WindsAloftServiceProtocol: Sendable {
    /// Winds aloft from the FD station nearest to `coordinate` for the given forecast period.
    func fetchWindsAloft(
        near coordinate: CLLocationCoordinate2D,
        forecast: WindsAloftForecast
    ) async throws -> WindsAloftReport
}

// MARK: - Models

/// AWC `region` query values; each bulletin covers a disjoint station set.
nonisolated enum WindsAloftRegion: String, Sendable {
    case conus = "all"
    case alaska = "alaska"
    case hawaii = "hawaii"
    case pacific = "other_pac"
}

nonisolated enum WindsAloftForecast: Int, CaseIterable, Identifiable, Sendable {
    case sixHour = 6
    case twelveHour = 12
    case twentyFourHour = 24

    var id: Int { rawValue }
    var queryValue: String { String(format: "%02d", rawValue) }
    var label: String { "\(rawValue) h" }
}

nonisolated struct WindsAloftStation: Equatable, Sendable {
    let id: String                       // FD station identifier, e.g. "SFO"
    let name: String
    let latitude: Double                 // degrees
    let longitude: Double                // degrees
    let elevation: Int                   // feet MSL
    let region: WindsAloftRegion

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

nonisolated struct WindsAloftLevel: Equatable, Sendable {
    let altitude: Int                    // feet MSL
    let direction: Int?                  // degrees true; nil when light and variable or not forecast
    let speed: Int?                      // knots; nil when not forecast
    let temperature: Int?                // degrees Celsius; nil when not forecast at this level
    let isLightAndVariable: Bool         // "9900" group: less than 5 knots

    /// False for blank columns (level within 1,500 ft of the station elevation).
    var isForecast: Bool { isLightAndVariable || speed != nil }

    static func blank(altitude: Int) -> WindsAloftLevel {
        WindsAloftLevel(altitude: altitude, direction: nil, speed: nil, temperature: nil, isLightAndVariable: false)
    }
}

nonisolated struct WindsAloftBulletin: Equatable, Sendable {
    let issued: Date?                    // bulletin issue time (WMO header)
    let basedOn: Date?                   // model data time ("DATA BASED ON")
    let validTime: Date?
    let forUseStart: Date?
    let forUseEnd: Date?
    let levels: [Int]                    // feet MSL, header order
    let rows: [String: [WindsAloftLevel]] // station id -> one entry per header level
}

nonisolated struct WindsAloftReport: Equatable, Sendable {
    let station: WindsAloftStation
    let distanceNM: Double               // nautical miles from the requested coordinate
    let forecast: WindsAloftForecast
    let issued: Date?
    let basedOn: Date?
    let validTime: Date?
    let forUseStart: Date?
    let forUseEnd: Date?
    let levels: [WindsAloftLevel]

    /// True when `date` falls inside the bulletin's FOR USE window.
    func isInForUsePeriod(at date: Date) -> Bool {
        guard let forUseStart, let forUseEnd else { return false }
        return date >= forUseStart && date <= forUseEnd
    }
}

// MARK: - Decoding

nonisolated enum WindsAloftDecoder {

    static let earthRadiusNM = 3440.065  // nautical miles

    /// Decode one FD group at `altitude` (feet MSL).
    /// - `DDSS`: direction (tens of degrees true) + speed (knots), no temperature.
    /// - `DDSS±TT`: with signed temperature (°C).
    /// - `DDSSTT`: sign omitted — negative ("TEMPS NEG ABV 24000").
    /// - `9900`: light and variable. Direction 51–86 encodes speed + 100 knots (7315 = 230° 115 kt).
    static func decodeGroup(_ group: String, altitude: Int) -> WindsAloftLevel? {
        let chars = Array(group)
        guard [4, 6, 7].contains(chars.count),
              chars[0...3].allSatisfy(\.isNumber),
              let dd = Int(String(chars[0...1])),
              let ss = Int(String(chars[2...3])) else { return nil }

        var temperature: Int?
        if chars.count == 6 {
            guard chars[4...5].allSatisfy(\.isNumber), let t = Int(String(chars[4...5])) else { return nil }
            temperature = -t  // degrees Celsius, implied negative
        } else if chars.count == 7 {
            guard chars[4] == "+" || chars[4] == "-",
                  chars[5...6].allSatisfy(\.isNumber),
                  let t = Int(String(chars[4...6])) else { return nil }
            temperature = t  // degrees Celsius
        }

        if dd == 99 && ss == 0 {
            return WindsAloftLevel(
                altitude: altitude, direction: nil, speed: 0,
                temperature: temperature, isLightAndVariable: true
            )
        }

        var tens = dd
        var speed = ss  // knots
        if (51...86).contains(tens) {
            tens -= 50
            speed += 100
        }
        guard (0...36).contains(tens) else { return nil }
        let direction = tens == 0 ? 360 : tens * 10  // degrees true

        return WindsAloftLevel(
            altitude: altitude, direction: direction, speed: speed,
            temperature: temperature, isLightAndVariable: false
        )
    }

    /// Parse a full FD bulletin. Day-of-month timestamps are resolved to the month nearest
    /// `reference`.
    static func parseBulletin(_ text: String, reference: Date) throws -> WindsAloftBulletin {
        var issued: Date?
        var basedOn: Date?
        var validTime: Date?
        var forUseStart: Date?
        var forUseEnd: Date?
        var columns: [(altitude: Int, start: Int, end: Int)] = []
        var rows: [String: [WindsAloftLevel]] = [:]

        for line in text.components(separatedBy: .newlines) {
            let chars = Array(line)
            let tokens = tokenize(chars)
            guard let first = tokens.first else { continue }

            if first.text == "FT" {
                columns = []
                // Field i spans from one past field i-1's end to its own label end; the first
                // field starts where its label starts (right after the 3-character station id).
                for token in tokens.dropFirst() {
                    guard let altitude = Int(token.text) else { continue }  // feet MSL
                    let start = columns.last.map { $0.end + 1 } ?? token.start
                    columns.append((altitude: altitude, start: start, end: token.end))
                }
                continue
            }

            if issued == nil, let time = issueTime(in: tokens.map(\.text)) {
                issued = resolve(ddhhmm: time, reference: reference)
            }

            if line.hasPrefix("DATA BASED ON"), tokens.count >= 4 {
                basedOn = resolve(ddhhmm: tokens[3].text, reference: reference)
                continue
            }

            if first.text == "VALID", tokens.count >= 2 {
                validTime = resolve(ddhhmm: tokens[1].text, reference: reference)
                if let validTime,
                   let useIndex = tokens.firstIndex(where: { $0.text == "USE" }),
                   useIndex + 1 < tokens.count {
                    (forUseStart, forUseEnd) = forUsePeriod(tokens[useIndex + 1].text, valid: validTime)
                }
                continue
            }

            guard !columns.isEmpty, isStationRow(chars) else { continue }

            var levels = columns.map { WindsAloftLevel.blank(altitude: $0.altitude) }
            for token in tokens.dropFirst() {
                guard let index = columns.firstIndex(where: { token.start >= $0.start && token.start < $0.end }),
                      let level = decodeGroup(token.text, altitude: columns[index].altitude) else { continue }
                levels[index] = level
            }
            rows[first.text] = levels
        }

        guard !columns.isEmpty else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        return WindsAloftBulletin(
            issued: issued,
            basedOn: basedOn,
            validTime: validTime,
            forUseStart: forUseStart,
            forUseEnd: forUseEnd,
            levels: columns.map(\.altitude),
            rows: rows
        )
    }

    /// Nearest station to `coordinate` (great-circle) with its distance in nautical miles.
    static func nearestStation(
        to coordinate: CLLocationCoordinate2D,
        among stations: [WindsAloftStation]
    ) -> (station: WindsAloftStation, distanceNM: Double)? {
        stations
            .map { (station: $0, distanceNM: distanceNM(from: coordinate, to: $0.coordinate)) }
            .min { $0.distanceNM < $1.distanceNM }
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

    // MARK: Helpers

    private static var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    private static func tokenize(_ chars: [Character]) -> [(text: String, start: Int, end: Int)] {
        var tokens: [(text: String, start: Int, end: Int)] = []
        var start: Int?
        for (index, char) in chars.enumerated() {
            if char.isWhitespace {
                if let s = start { tokens.append((String(chars[s..<index]), s, index)) }
                start = nil
            } else if start == nil {
                start = index
            }
        }
        if let s = start { tokens.append((String(chars[s..<chars.count]), s, chars.count)) }
        return tokens
    }

    /// Three-character uppercase alphanumeric identifier followed by whitespace or end of line.
    private static func isStationRow(_ chars: [Character]) -> Bool {
        guard chars.count >= 3,
              chars[0...2].allSatisfy({ ($0.isUppercase || $0.isNumber) && $0.isASCII }) else { return false }
        return chars.count == 3 || chars[3].isWhitespace
    }

    /// Time from the WMO header, e.g. `FBUS31 KWNO 301400`.
    private static func issueTime(in tokens: [String]) -> String? {
        for (index, token) in tokens.enumerated() where token.hasPrefix("FB") && index + 2 < tokens.count {
            let time = tokens[index + 2].trimmingCharacters(in: CharacterSet(charactersIn: ")"))
            if time.count == 6, time.allSatisfy(\.isNumber) { return time }
        }
        return nil
    }

    /// `DDHHMM` or `DDHHMMZ` resolved to the calendar month nearest `reference`.
    static func resolve(ddhhmm: String, reference: Date) -> Date? {
        let digits = ddhhmm.hasSuffix("Z") ? String(ddhhmm.dropLast()) : ddhhmm
        guard digits.count == 6, digits.allSatisfy(\.isNumber),
              let day = Int(digits.prefix(2)),
              let hour = Int(digits.dropFirst(2).prefix(2)),
              let minute = Int(digits.suffix(2)),
              (1...31).contains(day), hour < 24, minute < 60 else { return nil }

        let calendar = utcCalendar
        let month = calendar.dateComponents([.year, .month], from: reference)
        guard let monthStart = calendar.date(from: month) else { return nil }

        return (-1...1)
            .compactMap { offset -> Date? in
                guard let shifted = calendar.date(byAdding: .month, value: offset, to: monthStart) else { return nil }
                var components = calendar.dateComponents([.year, .month], from: shifted)
                components.day = day
                components.hour = hour
                components.minute = minute
                guard let date = calendar.date(from: components),
                      calendar.component(.day, from: date) == day else { return nil }  // e.g. 31st in a 30-day month
                return date
            }
            .min { abs($0.timeIntervalSince(reference)) < abs($1.timeIntervalSince(reference)) }
    }

    /// `1400-2100Z.` relative to the valid time: start is the latest HHMM at or before valid,
    /// end the earliest HHMM at or after valid (handles windows spanning midnight).
    static func forUsePeriod(_ text: String, valid: Date) -> (Date?, Date?) {
        let cleaned = text.trimmingCharacters(in: CharacterSet(charactersIn: ".Z"))
        let parts = cleaned.split(separator: "-").map(String.init)
        guard parts.count == 2 else { return (nil, nil) }

        func time(_ hhmm: String, onDayOf date: Date) -> Date? {
            guard hhmm.count == 4, let hour = Int(hhmm.prefix(2)), let minute = Int(hhmm.suffix(2)),
                  hour <= 24, minute < 60 else { return nil }
            let calendar = utcCalendar
            let dayStart = calendar.startOfDay(for: date)
            return dayStart.addingTimeInterval(TimeInterval(hour * 3600 + minute * 60))
        }

        var start = time(parts[0], onDayOf: valid)
        if let s = start, s > valid { start = s.addingTimeInterval(-86_400) }
        var end = time(parts[1].replacingOccurrences(of: "Z", with: ""), onDayOf: valid)
        if let e = end, e < valid { end = e.addingTimeInterval(86_400) }
        return (start, end)
    }
}

// MARK: - Service

actor WindsAloftService: WindsAloftServiceProtocol {

    nonisolated private static let baseURL = "https://aviationweather.gov/api/data/windtemp"
    nonisolated private static let cacheExpiry: TimeInterval = 1800  // 30 minutes

    private let session: URLSession
    private let stations: [WindsAloftStation]
    private var cache: [String: (bulletin: WindsAloftBulletin, fetchedAt: Date)] = [:]
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "WindsAloftService")

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - stations: FD forecast points; defaults to the bundled NWS station table.
    init(session: URLSession? = nil, stations: [WindsAloftStation] = WindsAloftDecoder.stations) {
        self.stations = stations
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

    func fetchWindsAloft(
        near coordinate: CLLocationCoordinate2D,
        forecast: WindsAloftForecast
    ) async throws -> WindsAloftReport {
        guard let nearest = WindsAloftDecoder.nearestStation(to: coordinate, among: stations) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.resourceUnavailable))
        }
        let region = nearest.station.region
        let bulletin = try await bulletin(region: region, forecast: forecast)

        // The nearest table station may be missing from this issuance; fall back to the nearest
        // station that the bulletin actually contains.
        let available = stations.filter { $0.region == region && bulletin.rows[$0.id] != nil }
        guard let pick = WindsAloftDecoder.nearestStation(to: coordinate, among: available),
              let levels = bulletin.rows[pick.station.id] else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        return WindsAloftReport(
            station: pick.station,
            distanceNM: pick.distanceNM,
            forecast: forecast,
            issued: bulletin.issued,
            basedOn: bulletin.basedOn,
            validTime: bulletin.validTime,
            forUseStart: bulletin.forUseStart,
            forUseEnd: bulletin.forUseEnd,
            levels: levels
        )
    }

    private func bulletin(region: WindsAloftRegion, forecast: WindsAloftForecast) async throws -> WindsAloftBulletin {
        let key = "\(region.rawValue)-\(forecast.queryValue)"
        let now = Date()
        if let cached = cache[key],
           now.timeIntervalSince(cached.fetchedAt) < Self.cacheExpiry,
           cached.bulletin.forUseEnd.map({ now <= $0 }) ?? true {
            return cached.bulletin
        }

        var components = URLComponents(string: Self.baseURL)
        components?.queryItems = [
            URLQueryItem(name: "region", value: region.rawValue),
            URLQueryItem(name: "level", value: "low"),
            URLQueryItem(name: "fcst", value: forecast.queryValue),
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

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let text = String(data: data, encoding: .utf8) else {
            throw EFBError.weatherFetchFailed(underlying: URLError(.badServerResponse))
        }

        let bulletin = try WindsAloftDecoder.parseBulletin(text, reference: now)
        cache[key] = (bulletin, now)
        logger.debug("Winds aloft \(key): \(bulletin.rows.count) stations")
        return bulletin
    }
}

// MARK: - Station Table

extension WindsAloftDecoder {
    /// FD forecast points from the NWS winds-aloft station list (233 stations across the
    /// conus/alaska/hawaii/other_pac bulletins). Region membership verified against live
    /// bulletins 2026-10-30. SAT corrected to the San Antonio VORTAC from the aviation DB.
    nonisolated static let stations: [WindsAloftStation] = [
        WindsAloftStation(id: "2XG", name: "Gauge", latitude: 30.3333, longitude: -78.5000, elevation: 0, region: .conus),
        WindsAloftStation(id: "4J3", name: "S Apalachicola South", latitude: 28.5000, longitude: -85.0000, elevation: 0, region: .conus),
        WindsAloftStation(id: "5AB", name: "5AB", latitude: 52.4167, longitude: 176.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "5AC", name: "5AC", latitude: 52.0000, longitude: -135.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "5AD", name: "5AD", latitude: 54.0000, longitude: -145.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "5AE", name: "5AE", latitude: 55.0000, longitude: -155.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "5AF", name: "5AF", latitude: 56.0000, longitude: -137.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "5AG", name: "5AG", latitude: 58.0000, longitude: -142.0000, elevation: 0, region: .alaska),
        WindsAloftStation(id: "ABI", name: "Abilene", latitude: 32.4667, longitude: -99.8500, elevation: 1790, region: .conus),
        WindsAloftStation(id: "ABQ", name: "Albuquerque", latitude: 35.0333, longitude: -106.8000, elevation: 5352, region: .conus),
        WindsAloftStation(id: "ABR", name: "Aberdeen", latitude: 45.4167, longitude: -98.3667, elevation: 1301, region: .conus),
        WindsAloftStation(id: "ACK", name: "Nantucket", latitude: 41.2667, longitude: -70.0167, elevation: 48, region: .conus),
        WindsAloftStation(id: "ACY", name: "Atlantic City", latitude: 39.4500, longitude: -74.5667, elevation: 76, region: .conus),
        WindsAloftStation(id: "ADK", name: "Adakak", latitude: 51.9333, longitude: -176.4167, elevation: 133, region: .alaska),
        WindsAloftStation(id: "ADQ", name: "Kodiak", latitude: 57.7667, longitude: -152.5833, elevation: 112, region: .alaska),
        WindsAloftStation(id: "AFM", name: "Ambler", latitude: 67.1000, longitude: -157.8500, elevation: 289, region: .alaska),
        WindsAloftStation(id: "AGC", name: "Pittsburgh", latitude: 40.2667, longitude: -80.0333, elevation: 1252, region: .conus),
        WindsAloftStation(id: "AKN", name: "King Salmon", latitude: 58.7333, longitude: -156.7500, elevation: 49, region: .alaska),
        WindsAloftStation(id: "ALB", name: "Albany", latitude: 42.7333, longitude: -73.8000, elevation: 285, region: .conus),
        WindsAloftStation(id: "ALS", name: "Alamosa", latitude: 37.3333, longitude: -105.8000, elevation: 7535, region: .conus),
        WindsAloftStation(id: "AMA", name: "Amarillo", latitude: 35.2833, longitude: -101.6333, elevation: 3605, region: .conus),
        WindsAloftStation(id: "ANC", name: "Anchorage", latitude: 61.2333, longitude: -149.5500, elevation: 131, region: .alaska),
        WindsAloftStation(id: "ANN", name: "Annette Island", latitude: 55.0500, longitude: -131.6167, elevation: 112, region: .alaska),
        WindsAloftStation(id: "AST", name: "Astoria", latitude: 46.1500, longitude: -123.8667, elevation: 11, region: .conus),
        WindsAloftStation(id: "ATL", name: "Atlanta", latitude: 33.6167, longitude: -84.4333, elevation: 1026, region: .conus),
        WindsAloftStation(id: "AVP", name: "Wilkes-Barre/Scranton", latitude: 41.2667, longitude: -75.6833, elevation: 957, region: .conus),
        WindsAloftStation(id: "AWK", name: "Wake Island", latitude: 19.2833, longitude: 166.6500, elevation: 14, region: .pacific),
        WindsAloftStation(id: "AXN", name: "Alexandria", latitude: 45.9500, longitude: -95.2167, elevation: 1425, region: .conus),
        WindsAloftStation(id: "BAM", name: "Battle Mountain", latitude: 40.5667, longitude: -116.9167, elevation: 4532, region: .conus),
        WindsAloftStation(id: "BCE", name: "Bryce Canyon", latitude: 37.6833, longitude: -112.3000, elevation: 7586, region: .conus),
        WindsAloftStation(id: "BDL", name: "Windsor Locks", latitude: 41.9333, longitude: -72.6833, elevation: 174, region: .conus),
        WindsAloftStation(id: "BET", name: "Bethel", latitude: 60.5833, longitude: -161.5833, elevation: 51, region: .alaska),
        WindsAloftStation(id: "BFF", name: "Scottsbluff", latitude: 41.8833, longitude: -103.4667, elevation: 3965, region: .conus),
        WindsAloftStation(id: "BGR", name: "Bangor", latitude: 44.8333, longitude: -68.8667, elevation: 192, region: .conus),
        WindsAloftStation(id: "BHM", name: "Birmingham", latitude: 33.5500, longitude: -86.7333, elevation: 620, region: .conus),
        WindsAloftStation(id: "BIH", name: "Bishop", latitude: 37.3667, longitude: -118.3500, elevation: 4120, region: .conus),
        WindsAloftStation(id: "BIL", name: "Billings", latitude: 45.8000, longitude: -108.6167, elevation: 3605, region: .conus),
        WindsAloftStation(id: "BLH", name: "Blythe", latitude: 33.5833, longitude: -114.7500, elevation: 397, region: .conus),
        WindsAloftStation(id: "BML", name: "Berlin", latitude: 44.6333, longitude: -71.1833, elevation: 1158, region: .conus),
        WindsAloftStation(id: "BNA", name: "Nashville", latitude: 36.1167, longitude: -86.6667, elevation: 599, region: .conus),
        WindsAloftStation(id: "BOI", name: "Boise", latitude: 43.5667, longitude: -116.2333, elevation: 2858, region: .conus),
        WindsAloftStation(id: "BOS", name: "Boston", latitude: 42.3500, longitude: -70.9833, elevation: 20, region: .conus),
        WindsAloftStation(id: "BRL", name: "Burlington", latitude: 40.7167, longitude: -90.9167, elevation: 698, region: .conus),
        WindsAloftStation(id: "BRO", name: "Brownsville", latitude: 25.9167, longitude: -97.3667, elevation: 22, region: .conus),
        WindsAloftStation(id: "BRW", name: "Barrow", latitude: 71.2833, longitude: -156.5167, elevation: 13, region: .alaska),
        WindsAloftStation(id: "BTI", name: "Barter Island", latitude: 70.1667, longitude: -143.9167, elevation: 49, region: .alaska),
        WindsAloftStation(id: "BTT", name: "Bettles", latitude: 66.9000, longitude: -151.5000, elevation: 673, region: .alaska),
        WindsAloftStation(id: "BUF", name: "Buffalo", latitude: 42.9167, longitude: -78.6333, elevation: 725, region: .conus),
        WindsAloftStation(id: "CAE", name: "Columbia", latitude: 33.8500, longitude: -81.0500, elevation: 236, region: .conus),
        WindsAloftStation(id: "CAR", name: "Caribou", latitude: 46.8667, longitude: -68.0167, elevation: 623, region: .conus),
        WindsAloftStation(id: "CDB", name: "Cold Bay", latitude: 55.1833, longitude: -162.3667, elevation: 102, region: .alaska),
        WindsAloftStation(id: "CGI", name: "Cape Girardeau", latitude: 37.2167, longitude: -89.5667, elevation: 342, region: .conus),
        WindsAloftStation(id: "CHS", name: "Charleston", latitude: 32.8833, longitude: -80.0333, elevation: 45, region: .conus),
        WindsAloftStation(id: "CLE", name: "Cleveland", latitude: 41.3500, longitude: -82.1500, elevation: 792, region: .conus),
        WindsAloftStation(id: "CLL", name: "College Station", latitude: 30.6000, longitude: -96.4167, elevation: 319, region: .conus),
        WindsAloftStation(id: "CMH", name: "Columbus", latitude: 39.9833, longitude: -82.9167, elevation: 816, region: .conus),
        WindsAloftStation(id: "COU", name: "Columbia", latitude: 38.8000, longitude: -92.2167, elevation: 889, region: .conus),
        WindsAloftStation(id: "CRP", name: "Corpus Christi", latitude: 27.9000, longitude: -97.4333, elevation: 44, region: .conus),
        WindsAloftStation(id: "CRW", name: "Charleston", latitude: 38.3333, longitude: -81.7667, elevation: 982, region: .conus),
        WindsAloftStation(id: "CSG", name: "Columbus", latitude: 32.6000, longitude: -85.0167, elevation: 397, region: .conus),
        WindsAloftStation(id: "CVG", name: "Covington", latitude: 39.0000, longitude: -84.7000, elevation: 891, region: .conus),
        WindsAloftStation(id: "CZF", name: "Cape Romanzof", latitude: 61.7833, longitude: -166.0333, elevation: 457, region: .alaska),
        WindsAloftStation(id: "CZI", name: "Crazy Woman", latitude: 43.9833, longitude: -106.4333, elevation: 4798, region: .conus),
        WindsAloftStation(id: "DAL", name: "Dallas", latitude: 32.8333, longitude: -96.8500, elevation: 487, region: .conus),
        WindsAloftStation(id: "DBQ", name: "Dubuque", latitude: 42.4000, longitude: -90.7000, elevation: 1076, region: .conus),
        WindsAloftStation(id: "DEN", name: "Denver", latitude: 39.8000, longitude: -104.8833, elevation: 5333, region: .conus),
        WindsAloftStation(id: "DIK", name: "Dickinson", latitude: 46.8500, longitude: -102.7667, elevation: 2589, region: .conus),
        WindsAloftStation(id: "DLH", name: "Duluth", latitude: 46.8000, longitude: -92.2000, elevation: 1428, region: .conus),
        WindsAloftStation(id: "DLN", name: "Dillon", latitude: 45.2333, longitude: -112.5333, elevation: 5238, region: .conus),
        WindsAloftStation(id: "DRT", name: "Del Rio", latitude: 29.3667, longitude: -100.9167, elevation: 999, region: .conus),
        WindsAloftStation(id: "DSM", name: "Des Moines", latitude: 41.4333, longitude: -93.6333, elevation: 957, region: .conus),
        WindsAloftStation(id: "ECK", name: "Peck", latitude: 43.2500, longitude: -82.7167, elevation: 810, region: .conus),
        WindsAloftStation(id: "EHM", name: "Cape Newenham", latitude: 58.6500, longitude: -162.0667, elevation: 541, region: .alaska),
        WindsAloftStation(id: "EKN", name: "Elkins", latitude: 38.9000, longitude: -80.0833, elevation: 1987, region: .conus),
        WindsAloftStation(id: "ELP", name: "El Paso", latitude: 31.8000, longitude: -106.2667, elevation: 3956, region: .conus),
        WindsAloftStation(id: "ELY", name: "Ely", latitude: 39.2833, longitude: -114.8333, elevation: 6255, region: .conus),
        WindsAloftStation(id: "EMI", name: "Westminster", latitude: 39.4833, longitude: -76.9667, elevation: 820, region: .conus),
        WindsAloftStation(id: "EVV", name: "Evansville", latitude: 38.0333, longitude: -87.5167, elevation: 418, region: .conus),
        WindsAloftStation(id: "EYW", name: "Key West", latitude: 24.5833, longitude: -81.8000, elevation: 4, region: .conus),
        WindsAloftStation(id: "FAI", name: "Fairbanks", latitude: 64.7167, longitude: -148.1833, elevation: 453, region: .alaska),
        WindsAloftStation(id: "FAT", name: "Fresno", latitude: 36.8833, longitude: -119.8000, elevation: 332, region: .conus),
        WindsAloftStation(id: "FLO", name: "Florence", latitude: 34.2167, longitude: -79.6500, elevation: 147, region: .conus),
        WindsAloftStation(id: "FMN", name: "Farmington", latitude: 36.7333, longitude: -108.0833, elevation: 5503, region: .conus),
        WindsAloftStation(id: "FOT", name: "Fortuna", latitude: 40.6667, longitude: -124.2333, elevation: 390, region: .conus),
        WindsAloftStation(id: "FSD", name: "Sioux Falls", latitude: 43.6333, longitude: -96.7667, elevation: 1429, region: .conus),
        WindsAloftStation(id: "FSM", name: "Fort Smith", latitude: 35.3833, longitude: -94.2667, elevation: 468, region: .conus),
        WindsAloftStation(id: "FWA", name: "Fort Wayne", latitude: 40.9667, longitude: -85.1833, elevation: 800, region: .conus),
        WindsAloftStation(id: "FYU", name: "Fort Yukon", latitude: 66.5833, longitude: -145.0833, elevation: 431, region: .alaska),
        WindsAloftStation(id: "GAG", name: "gage", latitude: 36.3333, longitude: -99.8667, elevation: 2223, region: .conus),
        WindsAloftStation(id: "GAL", name: "Galena", latitude: 64.7333, longitude: -156.9333, elevation: 152, region: .alaska),
        WindsAloftStation(id: "GCK", name: "Garden City", latitude: 37.9167, longitude: -100.7167, elevation: 2888, region: .conus),
        WindsAloftStation(id: "GEG", name: "Spokane", latitude: 47.5500, longitude: -117.6167, elevation: 2372, region: .conus),
        WindsAloftStation(id: "GFK", name: "Grand Forks", latitude: 47.9500, longitude: -97.1833, elevation: 844, region: .conus),
        WindsAloftStation(id: "GGW", name: "Glasgow", latitude: 48.2000, longitude: -106.6167, elevation: 2293, region: .conus),
        WindsAloftStation(id: "GJT", name: "Grand Junction", latitude: 39.0500, longitude: -108.7833, elevation: 4858, region: .conus),
        WindsAloftStation(id: "GKN", name: "Gulkana", latitude: 62.1500, longitude: -145.4500, elevation: 21, region: .alaska),
        WindsAloftStation(id: "GLD", name: "Goodland", latitude: 39.3833, longitude: -101.6833, elevation: 3654, region: .conus),
        WindsAloftStation(id: "GPI", name: "Kalispell", latitude: 48.2000, longitude: -114.1667, elevation: 2972, region: .conus),
        WindsAloftStation(id: "GRB", name: "Green Bay", latitude: 44.5500, longitude: -88.1833, elevation: 695, region: .conus),
        WindsAloftStation(id: "GRI", name: "Grand Island", latitude: 40.9833, longitude: -98.3000, elevation: 1846, region: .conus),
        WindsAloftStation(id: "GRO", name: "Rota", latitude: 14.1833, longitude: 145.2333, elevation: 607, region: .pacific),
        WindsAloftStation(id: "GSN", name: "Saipan", latitude: 15.1167, longitude: 145.7333, elevation: 215, region: .pacific),
        WindsAloftStation(id: "GSP", name: "Greer", latitude: 34.8833, longitude: -82.2167, elevation: 972, region: .conus),
        WindsAloftStation(id: "GTF", name: "Great Falls", latitude: 47.4500, longitude: -111.4000, elevation: 3674, region: .conus),
        WindsAloftStation(id: "GUM", name: "Guam", latitude: 13.4833, longitude: 144.8000, elevation: 298, region: .pacific),
        WindsAloftStation(id: "H51", name: "Bay City", latitude: 26.5000, longitude: -95.0000, elevation: 0, region: .conus),
        WindsAloftStation(id: "H52", name: "Mid Gulf", latitude: 26.0000, longitude: -89.5000, elevation: 0, region: .conus),
        WindsAloftStation(id: "H61", name: "W Fort Myers West", latitude: 26.5000, longitude: -84.0000, elevation: 0, region: .conus),
        WindsAloftStation(id: "HAT", name: "Cape Hatteras", latitude: 35.2667, longitude: -75.5500, elevation: 11, region: .conus),
        WindsAloftStation(id: "HNL", name: "Honolulu", latitude: 21.3167, longitude: -157.9167, elevation: 13, region: .hawaii),
        WindsAloftStation(id: "HOM", name: "Homer", latitude: 59.6500, longitude: -151.4833, elevation: 78, region: .alaska),
        WindsAloftStation(id: "HOU", name: "Houston", latitude: 29.6333, longitude: -95.2667, elevation: 47, region: .conus),
        WindsAloftStation(id: "HSV", name: "Huntsville", latitude: 34.5500, longitude: -86.7667, elevation: 629, region: .conus),
        WindsAloftStation(id: "ICT", name: "Wichita", latitude: 37.7167, longitude: -97.4500, elevation: 1332, region: .conus),
        WindsAloftStation(id: "IKO", name: "Nikolski", latitude: 52.9500, longitude: -168.8500, elevation: 73, region: .alaska),
        WindsAloftStation(id: "ILM", name: "Wilmington", latitude: 34.3500, longitude: -77.8667, elevation: 32, region: .conus),
        WindsAloftStation(id: "IMB", name: "Kimberly", latitude: 44.6333, longitude: -119.7000, elevation: 5220, region: .conus),
        WindsAloftStation(id: "IND", name: "Indianapolis", latitude: 39.8000, longitude: -86.3667, elevation: 797, region: .conus),
        WindsAloftStation(id: "INK", name: "Wink", latitude: 31.8667, longitude: -103.2333, elevation: 2818, region: .conus),
        WindsAloftStation(id: "INL", name: "International Falls", latitude: 48.5500, longitude: -93.4000, elevation: 1184, region: .conus),
        WindsAloftStation(id: "ITO", name: "Hilo", latitude: 19.7167, longitude: -155.0500, elevation: 38, region: .hawaii),
        WindsAloftStation(id: "JAN", name: "Jackson", latitude: 32.5000, longitude: -90.1667, elevation: 346, region: .conus),
        WindsAloftStation(id: "JAX", name: "Jacksonville", latitude: 30.4333, longitude: -81.5500, elevation: 30, region: .conus),
        WindsAloftStation(id: "JFK", name: "New York", latitude: 40.6167, longitude: -73.7667, elevation: 12, region: .conus),
        WindsAloftStation(id: "JNU", name: "Juneau", latitude: 58.4333, longitude: -134.6833, elevation: 23, region: .alaska),
        WindsAloftStation(id: "JON", name: "Johnston Island", latitude: 16.7333, longitude: -169.5333, elevation: 7, region: .pacific),
        WindsAloftStation(id: "JOT", name: "Joliet", latitude: 41.5333, longitude: -88.3167, elevation: 582, region: .conus),
        WindsAloftStation(id: "KOA", name: "Kailua-Kona", latitude: 19.7333, longitude: -156.0500, elevation: 47, region: .hawaii),
        WindsAloftStation(id: "KWA", name: "Kwajalein", latitude: 8.7167, longitude: 167.7333, elevation: 16, region: .pacific),
        WindsAloftStation(id: "LAS", name: "Las Vegas", latitude: 36.0667, longitude: -115.1500, elevation: 2174, region: .conus),
        WindsAloftStation(id: "LBB", name: "Lubbock", latitude: 33.7000, longitude: -101.9000, elevation: 3281, region: .conus),
        WindsAloftStation(id: "LCH", name: "Lake Charles", latitude: 30.1333, longitude: -93.1000, elevation: 16, region: .conus),
        WindsAloftStation(id: "LIH", name: "Lihue", latitude: 21.9833, longitude: -159.3333, elevation: 153, region: .hawaii),
        WindsAloftStation(id: "LIT", name: "Little Rock", latitude: 34.6667, longitude: -92.1667, elevation: 258, region: .conus),
        WindsAloftStation(id: "LKV", name: "Lakeview", latitude: 42.4833, longitude: -120.5000, elevation: 4728, region: .conus),
        WindsAloftStation(id: "LND", name: "Lander", latitude: 42.8000, longitude: -108.7167, elevation: 5586, region: .conus),
        WindsAloftStation(id: "LNY", name: "Lanai", latitude: 20.7833, longitude: -156.9500, elevation: 1308, region: .hawaii),
        WindsAloftStation(id: "LOU", name: "Louisville", latitude: 38.1000, longitude: -85.5667, elevation: 546, region: .conus),
        WindsAloftStation(id: "LRD", name: "Laredo", latitude: 27.4667, longitude: -99.4167, elevation: 508, region: .conus),
        WindsAloftStation(id: "LSE", name: "La Crosse", latitude: 43.8667, longitude: -91.2500, elevation: 653, region: .conus),
        WindsAloftStation(id: "LUR", name: "Cape Lisburne", latitude: 68.8833, longitude: -166.1167, elevation: 12, region: .alaska),
        WindsAloftStation(id: "LWS", name: "Lewiston", latitude: 46.3667, longitude: -116.8667, elevation: 1438, region: .conus),
        WindsAloftStation(id: "MAJ", name: "Majuro", latitude: 7.0667, longitude: 171.2667, elevation: 6, region: .pacific),
        WindsAloftStation(id: "MBW", name: "Medicine Bow", latitude: 41.8333, longitude: -106.0000, elevation: 7000, region: .conus),
        WindsAloftStation(id: "MCG", name: "McGrath", latitude: 62.8167, longitude: -155.4000, elevation: 338, region: .alaska),
        WindsAloftStation(id: "MCW", name: "Mason City", latitude: 43.0833, longitude: -93.3167, elevation: 1213, region: .conus),
        WindsAloftStation(id: "MDO", name: "Middleton Island", latitude: 59.5000, longitude: -146.3000, elevation: 72, region: .alaska),
        WindsAloftStation(id: "MDY", name: "Midway Island", latitude: 28.2000, longitude: -177.3833, elevation: 13, region: .pacific),
        WindsAloftStation(id: "MEM", name: "Memphis", latitude: 35.0500, longitude: -89.9667, elevation: 332, region: .conus),
        WindsAloftStation(id: "MGM", name: "Montgomery", latitude: 32.2167, longitude: -86.3167, elevation: 221, region: .conus),
        WindsAloftStation(id: "MIA", name: "Miami", latitude: 25.9500, longitude: -80.4500, elevation: 10, region: .conus),
        WindsAloftStation(id: "MKC", name: "Kansas City", latitude: 39.2667, longitude: -94.5833, elevation: 758, region: .conus),
        WindsAloftStation(id: "MKG", name: "Muskegon", latitude: 43.1667, longitude: -86.0333, elevation: 628, region: .conus),
        WindsAloftStation(id: "MLB", name: "Melbourne", latitude: 28.1000, longitude: -80.6333, elevation: 33, region: .conus),
        WindsAloftStation(id: "MLS", name: "Miles City", latitude: 46.3667, longitude: -105.9500, elevation: 2628, region: .conus),
        WindsAloftStation(id: "MOB", name: "Mobile", latitude: 30.6833, longitude: -88.2333, elevation: 190, region: .conus),
        WindsAloftStation(id: "MOT", name: "Minot", latitude: 48.2500, longitude: -101.2833, elevation: 1715, region: .conus),
        WindsAloftStation(id: "MQT", name: "Marquette", latitude: 46.5167, longitude: -87.5833, elevation: 1419, region: .conus),
        WindsAloftStation(id: "MRF", name: "Marfa", latitude: 30.2833, longitude: -103.6167, elevation: 4848, region: .conus),
        WindsAloftStation(id: "MSP", name: "Minneapolis-St Paul", latitude: 45.1333, longitude: -93.3667, elevation: 841, region: .conus),
        WindsAloftStation(id: "MSY", name: "New Orleans", latitude: 30.0167, longitude: -90.1667, elevation: 4, region: .conus),
        WindsAloftStation(id: "OGG", name: "Kahului", latitude: 20.9000, longitude: -156.4333, elevation: 54, region: .hawaii),
        WindsAloftStation(id: "OKC", name: "Oklahoma City", latitude: 35.4000, longitude: -97.6333, elevation: 1295, region: .conus),
        WindsAloftStation(id: "OMA", name: "Omaha", latitude: 41.1667, longitude: -95.7333, elevation: 983, region: .conus),
        WindsAloftStation(id: "OME", name: "Nome", latitude: 64.6167, longitude: -165.0833, elevation: 23, region: .alaska),
        WindsAloftStation(id: "ONL", name: "O'Neill", latitude: 42.4667, longitude: -98.6833, elevation: 2030, region: .conus),
        WindsAloftStation(id: "ONT", name: "Ontario", latitude: 34.0500, longitude: -117.6000, elevation: 952, region: .conus),
        WindsAloftStation(id: "ORF", name: "Norfolk", latitude: 36.8833, longitude: -76.2000, elevation: 27, region: .conus),
        WindsAloftStation(id: "ORT", name: "Northway", latitude: 63.0667, longitude: -142.0667, elevation: 1722, region: .alaska),
        WindsAloftStation(id: "OTH", name: "North Bend", latitude: 43.4000, longitude: -124.1667, elevation: 14, region: .conus),
        WindsAloftStation(id: "OTZ", name: "Kotzebue", latitude: 66.6500, longitude: -162.9000, elevation: 16, region: .alaska),
        WindsAloftStation(id: "PDX", name: "Portland", latitude: 45.7333, longitude: -122.5833, elevation: 26, region: .conus),
        WindsAloftStation(id: "PFN", name: "Panama City", latitude: 30.2000, longitude: -85.6667, elevation: 20, region: .conus),
        WindsAloftStation(id: "PHX", name: "Phoenix", latitude: 33.4167, longitude: -111.8833, elevation: 1132, region: .conus),
        WindsAloftStation(id: "PIE", name: "St. Petersburg", latitude: 27.9000, longitude: -82.6833, elevation: 11, region: .conus),
        WindsAloftStation(id: "PIH", name: "Pocatello", latitude: 42.8667, longitude: -112.6500, elevation: 4448, region: .conus),
        WindsAloftStation(id: "PIR", name: "Pierre", latitude: 44.3833, longitude: -100.1500, elevation: 1742, region: .conus),
        WindsAloftStation(id: "PLB", name: "Plattsburgh", latitude: 44.8000, longitude: -73.4000, elevation: 371, region: .conus),
        WindsAloftStation(id: "PNI", name: "Pohnpei, FSM", latitude: 6.9833, longitude: 158.2167, elevation: 8, region: .pacific),
        WindsAloftStation(id: "PPG", name: "Pago Pago", latitude: -14.3333, longitude: -170.7167, elevation: 30, region: .pacific),
        WindsAloftStation(id: "PRC", name: "Prescott", latitude: 34.7000, longitude: -112.4667, elevation: 5042, region: .conus),
        WindsAloftStation(id: "PSB", name: "Phillipsburg", latitude: 40.9000, longitude: -77.9833, elevation: 1948, region: .conus),
        WindsAloftStation(id: "PSX", name: "Palacios", latitude: 28.7500, longitude: -96.3000, elevation: 15, region: .conus),
        WindsAloftStation(id: "PUB", name: "Pueblo", latitude: 38.2833, longitude: -104.4167, elevation: 4726, region: .conus),
        WindsAloftStation(id: "PWM", name: "Portland", latitude: 43.6333, longitude: -70.3000, elevation: 74, region: .conus),
        WindsAloftStation(id: "RAP", name: "Rapid City", latitude: 43.9667, longitude: -103.0000, elevation: 3182, region: .conus),
        WindsAloftStation(id: "RBL", name: "Red Bluff", latitude: 40.0833, longitude: -122.2333, elevation: 354, region: .conus),
        WindsAloftStation(id: "RDM", name: "Redmond", latitude: 44.2500, longitude: -121.3000, elevation: 3077, region: .conus),
        WindsAloftStation(id: "RDU", name: "Raleigh-Durham", latitude: 35.8667, longitude: -78.7833, elevation: 437, region: .conus),
        WindsAloftStation(id: "RIC", name: "Richmond", latitude: 37.5000, longitude: -77.3167, elevation: 168, region: .conus),
        WindsAloftStation(id: "RKS", name: "Rock Springs", latitude: 41.5833, longitude: -109.0000, elevation: 6760, region: .conus),
        WindsAloftStation(id: "RNO", name: "Reno", latitude: 39.5167, longitude: -119.6500, elevation: 4412, region: .conus),
        WindsAloftStation(id: "ROA", name: "Roanoke", latitude: 37.3333, longitude: -80.0667, elevation: 1175, region: .conus),
        WindsAloftStation(id: "ROR", name: "Koror, Palau", latitude: 7.3667, longitude: 134.5500, elevation: 176, region: .pacific),
        WindsAloftStation(id: "ROW", name: "Roswell", latitude: 33.3333, longitude: -104.6167, elevation: 3669, region: .conus),
        WindsAloftStation(id: "SAC", name: "Sacramento", latitude: 38.4333, longitude: -121.5500, elevation: 21, region: .conus),
        WindsAloftStation(id: "SAN", name: "San Diego", latitude: 32.7333, longitude: -117.1833, elevation: 15, region: .conus),
        WindsAloftStation(id: "SAT", name: "San Antonio", latitude: 29.6440, longitude: -98.4613, elevation: 809, region: .conus),
        WindsAloftStation(id: "SAV", name: "Savannah", latitude: 32.1500, longitude: -81.1000, elevation: 50, region: .conus),
        WindsAloftStation(id: "SBA", name: "Santa Barbara", latitude: 34.5000, longitude: -119.7667, elevation: 10, region: .conus),
        WindsAloftStation(id: "SEA", name: "Seattle", latitude: 47.4333, longitude: -122.3000, elevation: 429, region: .conus),
        WindsAloftStation(id: "SFO", name: "San Francisco", latitude: 37.6167, longitude: -122.3667, elevation: 11, region: .conus),
        WindsAloftStation(id: "SGF", name: "Springfield", latitude: 37.3500, longitude: -93.3333, elevation: 1267, region: .conus),
        WindsAloftStation(id: "SHV", name: "Shreveport", latitude: 32.7667, longitude: -93.8000, elevation: 258, region: .conus),
        WindsAloftStation(id: "SIY", name: "Montague", latitude: 41.7833, longitude: -122.4500, elevation: 2648, region: .conus),
        WindsAloftStation(id: "SLC", name: "Salt Lake City", latitude: 40.8500, longitude: -111.9667, elevation: 4227, region: .conus),
        WindsAloftStation(id: "SLN", name: "Salina", latitude: 38.8667, longitude: -97.6167, elevation: 1272, region: .conus),
        WindsAloftStation(id: "SNP", name: "St. Paul", latitude: 57.1500, longitude: -170.6167, elevation: 30, region: .alaska),
        WindsAloftStation(id: "SPI", name: "Springfield", latitude: 39.8333, longitude: -89.6667, elevation: 597, region: .conus),
        WindsAloftStation(id: "SPS", name: "Wichita Falls", latitude: 33.9833, longitude: -98.5833, elevation: 1015, region: .conus),
        WindsAloftStation(id: "SSM", name: "Sault Ste. Marie", latitude: 46.4000, longitude: -84.3000, elevation: 690, region: .conus),
        WindsAloftStation(id: "STL", name: "St. Louis", latitude: 38.8500, longitude: -90.4667, elevation: 589, region: .conus),
        WindsAloftStation(id: "SYR", name: "Syracuse", latitude: 43.1500, longitude: -76.2000, elevation: 421, region: .conus),
        WindsAloftStation(id: "T01", name: "West Cameron", latitude: 28.5000, longitude: -93.5000, elevation: 0, region: .conus),
        WindsAloftStation(id: "T06", name: "Ship Shoal", latitude: 28.5000, longitude: -91.0000, elevation: 0, region: .conus),
        WindsAloftStation(id: "T07", name: "S Mobile South", latitude: 28.5000, longitude: -88.0000, elevation: 0, region: .conus),
        WindsAloftStation(id: "T11", name: "Yap, FSM", latitude: 9.5000, longitude: 138.0833, elevation: 91, region: .pacific),
        WindsAloftStation(id: "TCC", name: "Tucumcari", latitude: 35.1667, longitude: -103.5833, elevation: 4063, region: .conus),
        WindsAloftStation(id: "TKA", name: "Talkeetna", latitude: 62.3167, longitude: -150.1000, elevation: 358, region: .alaska),
        WindsAloftStation(id: "TKK", name: "Chuuk, FSM", latitude: 7.4667, longitude: 151.8500, elevation: 10, region: .pacific),
        WindsAloftStation(id: "TLH", name: "Tallahassee", latitude: 30.5500, longitude: -84.3667, elevation: 81, region: .conus),
        WindsAloftStation(id: "TNI", name: "West Tinian", latitude: 15.0000, longitude: 145.6167, elevation: 271, region: .pacific),
        WindsAloftStation(id: "TRI", name: "Bristol/Johnson", latitude: 36.4667, longitude: -82.4000, elevation: 1519, region: .conus),
        WindsAloftStation(id: "TTK", name: "Kosrae", latitude: 5.3500, longitude: 162.9667, elevation: 11, region: .pacific),
        WindsAloftStation(id: "TUL", name: "Tulsa", latitude: 36.1833, longitude: -95.7833, elevation: 676, region: .conus),
        WindsAloftStation(id: "TUS", name: "Tucson", latitude: 32.1167, longitude: -110.8167, elevation: 2630, region: .conus),
        WindsAloftStation(id: "TVC", name: "Traverse City", latitude: 44.6667, longitude: -85.5333, elevation: 624, region: .conus),
        WindsAloftStation(id: "TYS", name: "Knoxville", latitude: 35.9000, longitude: -83.8833, elevation: 981, region: .conus),
        WindsAloftStation(id: "UNK", name: "Unalakleet", latitude: 63.8833, longitude: -160.8000, elevation: 21, region: .alaska),
        WindsAloftStation(id: "WJF", name: "Lancaster", latitude: 34.7333, longitude: -118.2167, elevation: 2347, region: .conus),
        WindsAloftStation(id: "YAK", name: "Yakutat", latitude: 59.6167, longitude: -139.5000, elevation: 30, region: .alaska),
        WindsAloftStation(id: "YKM", name: "Yakima", latitude: 46.5667, longitude: -120.4333, elevation: 1095, region: .conus),
        WindsAloftStation(id: "ZUN", name: "Zuni", latitude: 34.9500, longitude: -109.1500, elevation: 6454, region: .conus),
    ]
}
