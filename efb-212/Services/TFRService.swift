//
//  TFRService.swift
//  efb-212
//
//  Live TFRs from the FAA (tfr.faa.gov), no API key required.
//
//  - Geometry: FAA TFR GeoServer WFS (GeoJSON, one Polygon per TFR area, [lon, lat] order).
//    Properties: NOTAM_KEY "6/4240-1-FDC-F", TITLE, LEGAL (category), STATE, CNS_LOCATION_ID,
//    LAST_MODIFICATION_DATETIME "yyyyMMddHHmm" (UTC).
//  - Schedule and altitudes: per-NOTAM XNOTAM detail at /download/detail_<yr>_<seq>.xml.
//    NOTAM-level <dateEffective>/<dateExpire> are UTC regardless of <codeTimeZone> (checked
//    against the NOTAM text); missing dateEffective = "effective immediately", missing
//    dateExpire = "until further notice". Each <aseTFRArea> carries its own floor/ceiling
//    and is linked by codeId to an <abdMergedArea> boundary, which is matched to WFS polygons.
//  - /tfrapi/getTfrList only repeats id/type/state/description, so it is not used.
//
//  Last good fetch is cached in memory and refetched at most every 10 minutes. NOTAM
//  details are cached per NOTAM and refetched only when LAST_MODIFICATION_DATETIME changes.
//

import Foundation
import CoreLocation
import os

// MARK: - Protocol

protocol TFRServiceProtocol: Sendable {
    /// All published TFRs and when they were fetched. Served from cache when the last
    /// fetch is under 10 minutes old; if a refresh fails, the last good snapshot is
    /// returned (its `fetchedAt` exposes the age). Throws only when nothing was ever fetched.
    func currentTFRs() async throws -> TFRSnapshot
}

/// TFRs plus the time they were fetched from the FAA, for data-age display.
nonisolated struct TFRSnapshot: Equatable, Sendable {
    let tfrs: [TFR]
    let fetchedAt: Date
}

// MARK: - Source Records

/// One polygon from the FAA WFS layer TFR:V_TFR_LOC.
nonisolated struct TFRFeature: Equatable, Sendable {
    let notamID: String                  // "6/4240" (from NOTAM_KEY "6/4240-1-FDC-F")
    let title: String
    let type: TFRType
    let state: String?
    let facility: String?                // CNS_LOCATION_ID, the ARTCC
    let lastModifiedRaw: String?         // "yyyyMMddHHmm" UTC, used as the detail cache key
    let lastModified: Date?
    let ring: [[Double]]                 // [lat, lon] (converted from GeoJSON [lon, lat])
}

/// Schedule and per-area altitudes from the FAA XNOTAM detail XML.
nonisolated struct TFRDetail: Equatable, Sendable {
    nonisolated struct Area: Equatable, Sendable {
        let id: String                   // aseTFRArea codeId
        let name: String?
        let floor: TFRAltitude?
        let ceiling: TFRAltitude?
        let ring: [[Double]]             // [lat, lon] from abdMergedArea, empty if unpublished
    }

    let notamID: String?
    let effectiveDate: Date?             // UTC; nil = effective immediately
    let expirationDate: Date?            // UTC; nil = until further notice
    let areas: [Area]
}

// MARK: - Parsing

nonisolated enum TFRParser {

    /// Parse the WFS GeoJSON FeatureCollection. Features without a NOTAM key or polygon are skipped.
    static func parseFeatures(_ data: Data) throws -> [TFRFeature] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = root["features"] as? [[String: Any]] else {
            throw EFBError.tfrFetchFailed(underlying: URLError(.cannotParseResponse))
        }

        let modifiedFormatter = utcFormatter("yyyyMMddHHmm")
        var result: [TFRFeature] = []

        for feature in features {
            guard let properties = feature["properties"] as? [String: Any],
                  let notamKey = properties["NOTAM_KEY"] as? String,
                  let notamID = notamKey.split(separator: "-").first.map(String.init),
                  !notamID.isEmpty,
                  let geometry = feature["geometry"] as? [String: Any] else { continue }

            let lastModifiedRaw = trimmed(properties["LAST_MODIFICATION_DATETIME"])
            let lastModified = lastModifiedRaw.flatMap { modifiedFormatter.date(from: $0) }

            for lonLatRing in outerRings(of: geometry) {
                let ring = lonLatRing.compactMap { position -> [Double]? in
                    position.count >= 2 ? [position[1], position[0]] : nil  // [lon, lat] -> [lat, lon]
                }
                guard ring.count >= 3 else { continue }
                result.append(TFRFeature(
                    notamID: notamID,
                    title: trimmed(properties["TITLE"]) ?? "TFR \(notamID)",
                    type: TFRType(faaType: trimmed(properties["LEGAL"]) ?? ""),
                    state: trimmed(properties["STATE"]),
                    facility: trimmed(properties["CNS_LOCATION_ID"]),
                    lastModifiedRaw: lastModifiedRaw,
                    lastModified: lastModified,
                    ring: ring
                ))
            }
        }
        return result
    }

    /// Parse an FAA XNOTAM detail document. Returns nil if the XML is malformed.
    static func parseDetail(_ data: Data) -> TFRDetail? {
        let delegate = XNOTAMParserDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else { return nil }

        let dateFormatter = utcFormatter("yyyy-MM-dd'T'HH:mm:ss")
        let areas = delegate.areas.map { area in
            TFRDetail.Area(
                id: area.id,
                name: area.name,
                floor: altitude(code: area.lowerCode, value: area.lowerValue, unit: area.lowerUnit),
                ceiling: altitude(code: area.upperCode, value: area.upperValue, unit: area.upperUnit),
                ring: delegate.mergedRings[area.id] ?? []
            )
        }
        return TFRDetail(
            notamID: delegate.localName,
            effectiveDate: delegate.effective.flatMap { dateFormatter.date(from: $0) },
            expirationDate: delegate.expire.flatMap { dateFormatter.date(from: $0) },
            areas: areas
        )
    }

    /// XNOTAM vertical limit: code ALT = MSL, HEI = AGL, STD or unit FL = flight level.
    static func altitude(code: String?, value: String?, unit: String?) -> TFRAltitude? {
        guard let value, let number = Double(value) else { return nil }
        let intValue = Int(number.rounded())
        if unit?.uppercased() == "FL" || code?.uppercased() == "STD" {
            return TFRAltitude(value: intValue, reference: .flightLevel)
        }
        switch code?.uppercased() {
        case "ALT": return TFRAltitude(value: intValue, reference: .msl)   // feet MSL
        case "HEI": return TFRAltitude(value: intValue, reference: .agl)   // feet AGL
        default: return nil
        }
    }

    /// Join WFS polygons with NOTAM details. Every polygon becomes one `TFR`; fields the
    /// detail does not provide (or could not be matched) stay nil.
    static func join(features: [TFRFeature], details: [String: TFRDetail]) -> [TFR] {
        var areaIndex: [String: Int] = [:]
        return features.map { feature in
            let index = areaIndex[feature.notamID, default: 0]
            areaIndex[feature.notamID] = index + 1

            let detail = details[feature.notamID]
            let area = detail.flatMap { matchArea(for: feature.ring, in: $0.areas) }

            return TFR(
                id: "\(feature.notamID)#\(index)",
                notamID: feature.notamID,
                type: feature.type,
                title: feature.title,
                state: feature.state,
                facility: feature.facility,
                effectiveDate: detail?.effectiveDate,
                expirationDate: detail?.expirationDate,
                boundaries: feature.ring,
                floor: area?.floor,
                ceiling: area?.ceiling,
                lastModified: feature.lastModified
            )
        }
    }

    /// Largest centroid offset accepted when matching a WFS polygon to a detail area.
    static let maxMatchOffsetDegrees: Double = 0.2          // degrees (~12 NM)
    /// Detail areas whose centroids are this close to the best match are indistinguishable.
    static let ambiguousOffsetDegrees: Double = 0.005       // degrees (~0.3 NM)

    /// Find the detail area for a WFS polygon. Prefers areas with the same vertex count
    /// (the FAA publishes both from the same boundary), then the nearest centroid. Returns
    /// nil when two indistinguishable areas publish different altitudes (e.g. FDC 6/3002
    /// Areas C and E share one footprint), so the UI says "See NOTAM" rather than guessing.
    static func matchArea(for ring: [[Double]], in areas: [TFRDetail.Area]) -> TFRDetail.Area? {
        if areas.count == 1 { return areas.first }
        guard let center = PolygonGeometry.centroid(of: ring) else { return nil }

        let sameShape = areas.filter { $0.ring.count == ring.count }
        let candidates = sameShape.isEmpty ? areas : sameShape
        let cosLat = cos(center.latitude * .pi / 180.0)

        let scored: [(area: TFRDetail.Area, offset: Double)] = candidates.compactMap { area -> (area: TFRDetail.Area, offset: Double)? in
            guard let areaCenter = PolygonGeometry.centroid(of: area.ring) else { return nil }
            let offset = hypot(
                areaCenter.latitude - center.latitude,
                (areaCenter.longitude - center.longitude) * cosLat
            )
            return (area, offset)
        }.sorted { $0.offset < $1.offset }

        guard let best = scored.first, best.offset <= maxMatchOffsetDegrees else { return nil }
        let indistinguishable = scored.filter { $0.offset - best.offset <= ambiguousOffsetDegrees }
        let conflicting = indistinguishable.contains {
            $0.area.floor != best.area.floor || $0.area.ceiling != best.area.ceiling
        }
        return conflicting ? nil : best.area
    }

    // MARK: Helpers

    private static func outerRings(of geometry: [String: Any]) -> [[[Double]]] {
        switch geometry["type"] as? String {
        case "Polygon":
            guard let rings = geometry["coordinates"] as? [[[Double]]], let outer = rings.first else { return [] }
            return [outer]
        case "MultiPolygon":
            guard let polygons = geometry["coordinates"] as? [[[[Double]]]] else { return [] }
            return polygons.compactMap { $0.first }
        default:
            return []
        }
    }

    private static func trimmed(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let result = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    private static func utcFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = format
        return formatter
    }
}

// MARK: - XNOTAM XML Delegate

/// Collects NOTAM dates, TFR areas (with vertical limits) and merged-area boundaries.
/// Boundary vertices are only read inside <abdMergedArea>; <aseShapes> repeats them as
/// unmerged construction geometry.
private nonisolated final class XNOTAMParserDelegate: NSObject, XMLParserDelegate {

    nonisolated struct AreaBuilder {
        var id = ""
        var name: String?
        var upperCode: String?
        var upperValue: String?
        var upperUnit: String?
        var lowerCode: String?
        var lowerValue: String?
        var lowerUnit: String?
    }

    private(set) var localName: String?
    private(set) var effective: String?
    private(set) var expire: String?
    private(set) var areas: [AreaBuilder] = []
    private(set) var mergedRings: [String: [[Double]]] = [:]

    private var path: [String] = []
    private var text = ""
    private var currentArea: AreaBuilder?
    private var mergedID: String?
    private var mergedRing: [[Double]] = []
    private var vertexLat: Double?
    private var vertexLon: Double?

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        path.append(elementName)
        text = ""
        switch elementName {
        case "aseTFRArea": currentArea = AreaBuilder()
        case "abdMergedArea":
            mergedID = nil
            mergedRing = []
        case "Avx":
            vertexLat = nil
            vertexLon = nil
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        text += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let parent = path.count >= 2 ? path[path.count - 2] : ""
        defer {
            if !path.isEmpty { path.removeLast() }
            text = ""
        }

        switch (elementName, parent) {
        case ("txtLocalName", "NotUid"): localName = value
        case ("dateEffective", "Not"): effective = value
        case ("dateExpire", "Not"): expire = value

        case ("aseTFRArea", _):
            if let currentArea { areas.append(currentArea) }
            currentArea = nil
        case ("codeId", "AseUid") where pathEnds(with: ["aseTFRArea", "AseUid", "codeId"]):
            currentArea?.id = value
        case ("txtName", "aseTFRArea"): currentArea?.name = value
        case ("codeDistVerUpper", "aseTFRArea"): currentArea?.upperCode = value
        case ("valDistVerUpper", "aseTFRArea"): currentArea?.upperValue = value
        case ("uomDistVerUpper", "aseTFRArea"): currentArea?.upperUnit = value
        case ("codeDistVerLower", "aseTFRArea"): currentArea?.lowerCode = value
        case ("valDistVerLower", "aseTFRArea"): currentArea?.lowerValue = value
        case ("uomDistVerLower", "aseTFRArea"): currentArea?.lowerUnit = value

        case ("codeId", "AseUid") where pathEnds(with: ["abdMergedArea", "AbdUid", "AseUid", "codeId"]):
            mergedID = value
        case ("geoLat", "Avx") where path.contains("abdMergedArea"):
            vertexLat = Self.coordinate(value)
        case ("geoLong", "Avx") where path.contains("abdMergedArea"):
            vertexLon = Self.coordinate(value)
        case ("Avx", _) where path.contains("abdMergedArea"):
            if let vertexLat, let vertexLon { mergedRing.append([vertexLat, vertexLon]) }
        case ("abdMergedArea", _):
            if let mergedID { mergedRings[mergedID] = mergedRing }
            mergedID = nil
            mergedRing = []
        default: break
        }
    }

    private func pathEnds(with suffix: [String]) -> Bool {
        path.count >= suffix.count && Array(path.suffix(suffix.count)) == suffix
    }

    /// "40.71669911N" / "105.55833333W" -> signed decimal degrees.
    static func coordinate(_ value: String) -> Double? {
        guard let hemisphere = value.last?.uppercased(), let magnitude = Double(value.dropLast()) else {
            return nil
        }
        switch hemisphere {
        case "N", "E": return magnitude
        case "S", "W": return -magnitude
        default: return nil
        }
    }
}

// MARK: - Service

actor TFRService: TFRServiceProtocol {

    nonisolated static let wfsURLString =
        "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json"
    nonisolated static let refreshInterval: TimeInterval = 600  // 10 minutes
    nonisolated static let maxConcurrentDetailFetches = 6

    /// XNOTAM detail URL, e.g. "6/4348" -> https://tfr.faa.gov/download/detail_6_4348.xml
    nonisolated static func detailURL(for notamID: String) -> URL? {
        URL(string: "https://tfr.faa.gov/download/detail_\(notamID.replacingOccurrences(of: "/", with: "_")).xml")
    }

    nonisolated private struct CachedDetail {
        let lastModifiedRaw: String?
        let detail: TFRDetail
    }

    private let session: URLSession
    private let now: @Sendable () -> Date
    private var snapshot: TFRSnapshot?
    private var details: [String: CachedDetail] = [:]
    private var inFlight: Task<TFRSnapshot, Error>?

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "TFRService")

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts.
    ///   - now: Clock override for tests of the refresh interval.
    init(session: URLSession? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 60
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        self.now = now
    }

    // MARK: TFRServiceProtocol

    func currentTFRs() async throws -> TFRSnapshot {
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
                logger.warning("TFR refresh failed, serving cache from \(snapshot.fetchedAt): \(error.localizedDescription)")
                return snapshot
            }
            throw error
        }
    }

    // MARK: Fetching

    private func refresh() async throws -> TFRSnapshot {
        guard let url = URL(string: Self.wfsURLString) else {
            throw EFBError.tfrFetchFailed(underlying: URLError(.badURL))
        }

        let result: (Data, URLResponse)
        do {
            result = try await session.data(from: url)
        } catch {
            throw EFBError.tfrFetchFailed(underlying: error)
        }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw EFBError.tfrFetchFailed(underlying: URLError(.badServerResponse))
        }

        let features = try TFRParser.parseFeatures(data)

        // NOTAM id -> last-modified stamp; refetch details that are new or changed
        var modified: [String: String?] = [:]
        for feature in features where modified[feature.notamID] == nil {
            modified[feature.notamID] = feature.lastModifiedRaw
        }
        let stale = modified.keys.sorted().filter { id in
            guard let cached = details[id], let stamp = modified[id] else { return true }
            return cached.lastModifiedRaw != stamp
        }

        let fetched = await fetchDetails(for: stale)
        for (id, detail) in fetched {
            details[id] = CachedDetail(lastModifiedRaw: modified[id] ?? nil, detail: detail)
        }
        details = details.filter { modified[$0.key] != nil }  // drop cancelled NOTAMs

        let missing = stale.count - fetched.count
        if missing > 0 {
            logger.warning("\(missing) TFR NOTAM details unavailable; altitudes/times shown as See NOTAM")
        }

        let tfrs = TFRParser.join(features: features, details: details.mapValues(\.detail))
        return TFRSnapshot(tfrs: tfrs, fetchedAt: now())
    }

    /// Fetch XNOTAM details with bounded concurrency. Failed fetches are omitted (retried next refresh).
    private func fetchDetails(for notamIDs: [String]) async -> [String: TFRDetail] {
        guard !notamIDs.isEmpty else { return [:] }
        let session = self.session

        return await withTaskGroup(of: (String, TFRDetail?).self) { group in
            var results: [String: TFRDetail] = [:]
            var next = 0

            while next < min(Self.maxConcurrentDetailFetches, notamIDs.count) {
                let id = notamIDs[next]
                group.addTask { (id, await Self.fetchDetail(notamID: id, session: session)) }
                next += 1
            }

            while let result = await group.next() {
                if let detail = result.1 {
                    results[result.0] = detail
                }
                if next < notamIDs.count {
                    let id = notamIDs[next]
                    group.addTask { (id, await Self.fetchDetail(notamID: id, session: session)) }
                    next += 1
                }
            }
            return results
        }
    }

    private nonisolated static func fetchDetail(notamID: String, session: URLSession) async -> TFRDetail? {
        guard let url = detailURL(for: notamID) else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            return TFRParser.parseDetail(data)
        } catch {
            return nil
        }
    }
}
