//
//  IsraelAviationDatabase.swift
//  efb-212
//
//  Read-only GRDB access to the bundled israel-aviation.sqlite (tools/caai-importer, CAAI GIS
//  layers, WGS-84). Opened in place from the app bundle: the file is never written, so there is
//  nothing to install or migrate. R-tree indexes serve the spatial lookups; point-in-polygon runs
//  on the few candidates they return.
//
//  Also the `IsraelRouteSegmentLookup` IL-6's NOTAM closure mapper runs against.
//

import Foundation
import CoreLocation
import GRDB

nonisolated final class IsraelAviationDatabase: IsraelAviationDatabaseProtocol, IsraelRouteSegmentLookup, @unchecked Sendable {

    /// Bundled file name, without extension.
    static let resourceName = "israel-aviation"
    /// Schema version this code reads (`metadata.schema_version`).
    static let supportedSchemaVersion = 3

    typealias Segment = IsraelRouteSegment

    private let dbQueue: DatabaseQueue

    // MARK: - Initialization

    /// Open the database bundled with the app.
    /// Throws `EFBError.regionDataUnavailable` when the file is not in the bundle and
    /// `EFBError.databaseCorrupted` when it can't be read or has an unsupported schema.
    static func bundled(bundle: Bundle = .main) throws -> IsraelAviationDatabase {
        guard let url = bundle.url(forResource: resourceName, withExtension: "sqlite") else {
            throw EFBError.regionDataUnavailable(Region.israel.displayName)
        }
        return try IsraelAviationDatabase(url: url)
    }

    /// Open the database file at `url`, read-only.
    init(url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw EFBError.regionDataUnavailable(Region.israel.displayName)
        }
        var configuration = Configuration()
        configuration.readonly = true
        do {
            dbQueue = try DatabaseQueue(path: url.path, configuration: configuration)
            let version = try dbQueue.read { db in
                try String.fetchOne(db, sql: "SELECT value FROM metadata WHERE key = 'schema_version'")
            }
            guard version == String(Self.supportedSchemaVersion) else { throw EFBError.databaseCorrupted }
        } catch let error as EFBError {
            throw error
        } catch {
            throw EFBError.databaseCorrupted
        }
    }

    // MARK: - Metadata

    func metadata() throws -> IsraelAviationMetadata {
        let values: [String: String?] = try dbQueue.read { db in
            var result: [String: String?] = [:]
            for row in try Row.fetchAll(db, sql: "SELECT key, value FROM metadata") {
                result[row["key"] as String] = row["value"] as String?
            }
            return result
        }
        func text(_ key: String) -> String? { values[key].flatMap { $0 } }
        guard
            let schema = text("schema_version").flatMap(Int.init),
            let source = text("source"),
            let sourceData = text("source_data_date"),
            let download = text("download_date"),
            let modified = text("data_last_modified"),
            let imported = text("import_date"),
            let attribution = text("attribution")
        else { throw EFBError.databaseCorrupted }
        let urls = text("source_urls").flatMap { try? JSONDecoder().decode([String].self, from: Data($0.utf8)) } ?? []
        let weekendRule = text("lsa_weekend_rule").flatMap { try? JSONDecoder().decode(IsraelLSAWeekendRule.self, from: Data($0.utf8)) }
        return IsraelAviationMetadata(
            schemaVersion: schema, source: source, sourceURLs: urls,
            aipAmendment: text("aip_amendment"), effectiveDate: text("effective_date"),
            sourceDataDate: sourceData, downloadDate: download, dataLastModified: modified,
            importDate: imported, attribution: attribution, lsaWeekendRule: weekendRule
        )
    }

    // MARK: - Reporting points

    func reportingPoint(code: String, network: IsraelRouteNetwork) throws -> IsraelReportingPoint? {
        try dbQueue.read { db in
            let row = try Row.fetchOne(db, sql: """
                SELECT p.* FROM reporting_points p
                WHERE p.network = ? AND p.code = ?
                ORDER BY EXISTS (SELECT 1 FROM route_segments s WHERE s.from_point_id = p.id OR s.to_point_id = p.id) DESC, p.id
                LIMIT 1
                """, arguments: [network.rawValue, code.uppercased()])
            return row.map(Self.point)
        }
    }

    func reportingPoints(in bounds: IsraelGeoBounds, network: IsraelRouteNetwork) throws -> [IsraelReportingPoint] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT p.* FROM reporting_points p
                JOIN reporting_points_rtree r ON r.rowid = p.id
                WHERE p.network = ? AND r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY p.id
                """, arguments: StatementArguments([network.rawValue]) + Self.boxArguments(bounds)).map(Self.point)
        }
    }

    // MARK: - Route segments

    func routeSegments(in bounds: IsraelGeoBounds, network: IsraelRouteNetwork) throws -> [IsraelRouteSegment] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT s.* FROM route_segments s
                JOIN route_segments_rtree r ON r.rowid = s.id
                WHERE s.network = ? AND r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY s.id
                """, arguments: StatementArguments([network.rawValue]) + Self.boxArguments(bounds)).map(Self.segment)
        }
    }

    func routeSegment(from: String, to: String, network: IsraelRouteNetwork) throws -> IsraelRouteSegment? {
        try dbQueue.read { db in
            try Row.fetchOne(
                db,
                sql: "SELECT * FROM route_segments WHERE network = ? AND from_code = ? AND to_code = ?",
                arguments: [network.rawValue, from.uppercased(), to.uppercased()]
            ).map(Self.segment)
        }
    }

    // MARK: - IsraelRouteSegmentLookup (CVFR; the LSA planner builds an `IsraelChartNetwork` from its own points)

    /// A lookup failure answers "unknown"; the closure mapper reports unknown codes to the pilot.
    func knowsPoint(_ code: String) -> Bool {
        let found = try? dbQueue.read { db in
            try Bool.fetchOne(db, sql: "SELECT EXISTS (SELECT 1 FROM reporting_points WHERE network = 'cvfr' AND code = ?)", arguments: [code.uppercased()])
        }
        return found ?? false
    }

    func segment(from: String, to: String) -> IsraelRouteSegment? {
        (try? routeSegment(from: from, to: to, network: .cvfr)) ?? nil
    }

    // MARK: - Airspace

    func airspaces(containing coordinate: CLLocationCoordinate2D, altitudeFeetMSL: Double?) throws -> [IsraelAirspace] {
        let candidates = try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT a.* FROM airspaces a
                JOIN airspaces_rtree r ON r.rowid = a.id
                WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY a.id
                """, arguments: [coordinate.latitude, coordinate.latitude, coordinate.longitude, coordinate.longitude])
        }
        return try candidates.map(Self.airspace).filter { airspace in
            airspace.containsLaterally(coordinate) && (altitudeFeetMSL.map(airspace.containsAltitude(feetMSL:)) ?? true)
        }
    }

    func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [IsraelAirspace] {
        let bounds = IsraelGeoBounds(center: coordinate, radiusNM: radiusNM)
        return try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT a.* FROM airspaces a
                JOIN airspaces_rtree r ON r.rowid = a.id
                WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY a.id
                """, arguments: Self.boxArguments(bounds)).map(Self.airspace)
        }
    }

    func airspaces(ofKind kind: IsraelAirspaceKind) throws -> [IsraelAirspace] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM airspaces WHERE kind = ? ORDER BY id", arguments: [kind.rawValue])
                .map(Self.airspace)
        }
    }

    // MARK: - Runways

    func runways(aerodrome: String) throws -> [IsraelRunway] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM runways WHERE aerodrome = ? ORDER BY id", arguments: [aerodrome.uppercased()])
                .map(Self.runway)
        }
    }

    func runways(in bounds: IsraelGeoBounds) throws -> [IsraelRunway] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT w.* FROM runways w
                JOIN runways_rtree r ON r.rowid = w.id
                WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY w.id
                """, arguments: Self.boxArguments(bounds)).map(Self.runway)
        }
    }

    // MARK: - Aerodromes (IL-4)

    func aerodrome(code: String) throws -> IsraelAerodrome? {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: "SELECT * FROM aerodromes WHERE code = ?", arguments: [code.uppercased()])
            return try Self.aerodromes(db, rows: rows).first
        }
    }

    func aerodromes(in bounds: IsraelGeoBounds) throws -> [IsraelAerodrome] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT a.* FROM aerodromes a
                JOIN aerodromes_rtree r ON r.rowid = a.id
                WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?
                ORDER BY a.code
                """, arguments: Self.boxArguments(bounds))
            return try Self.aerodromes(db, rows: rows)
        }
    }

    func nearestAerodromes(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [IsraelAerodrome] {
        guard count > 0 else { return [] }
        // Equirectangular ordering is exact enough to rank a country-sized table; callers compute true distances.
        let cosLat = cos(coordinate.latitude * .pi / 180.0)
        return try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT * FROM aerodromes
                ORDER BY (lat - ?) * (lat - ?) + ((lon - ?) * ?) * ((lon - ?) * ?), code
                LIMIT ?
                """, arguments: [
                    coordinate.latitude, coordinate.latitude,
                    coordinate.longitude, cosLat, coordinate.longitude, cosLat, count
                ])
            return try Self.aerodromes(db, rows: rows)
        }
    }

    func searchAerodromes(query: String, limit: Int) throws -> [IsraelAerodrome] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, limit > 0 else { return [] }
        let escaped = trimmed
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
        let prefix = escaped + "%"
        let contains = "%" + escaped + "%"
        return try dbQueue.read { db in
            // SQLite LIKE folds ASCII case only: the codes and English names are ASCII, Hebrew has no case.
            let rows = try Row.fetchAll(db, sql: """
                SELECT a.*, CASE
                    WHEN upper(a.code) = upper(?) THEN 0
                    WHEN a.code LIKE ? ESCAPE '\\' THEN 1
                    WHEN a.name_en LIKE ? ESCAPE '\\' OR a.name_he LIKE ? ESCAPE '\\' THEN 2
                    ELSE 3 END AS rank
                FROM aerodromes a
                WHERE a.code LIKE ? ESCAPE '\\' OR a.name_en LIKE ? ESCAPE '\\' OR a.name_he LIKE ? ESCAPE '\\'
                ORDER BY rank, a.code
                LIMIT ?
                """, arguments: [trimmed, prefix, prefix, prefix, prefix, contains, contains, limit])
            return try Self.aerodromes(db, rows: rows)
        }
    }

    /// Attach runways and frequencies to each aerodrome row with two queries, however many rows there are.
    private static func aerodromes(_ db: Database, rows: [Row]) throws -> [IsraelAerodrome] {
        guard !rows.isEmpty else { return [] }
        let codes: [String] = rows.map { $0["code"] }
        let marks = Array(repeating: "?", count: codes.count).joined(separator: ",")
        var runways: [String: [IsraelAerodromeRunway]] = [:]
        for row in try Row.fetchAll(db, sql: "SELECT * FROM aerodrome_runways WHERE aerodrome IN (\(marks)) ORDER BY id", arguments: StatementArguments(codes)) {
            let heading: String? = row["heading_ref"]
            runways[row["aerodrome"], default: []].append(IsraelAerodromeRunway(
                id: row["id"], designator: row["designator"], lengthMetres: row["length_m"], widthMetres: row["width_m"],
                surface: row["surface"], headingA: row["heading_a"], headingB: row["heading_b"],
                headingIsTrue: heading.map { $0 == "T" }
            ))
        }
        var frequencies: [String: [IsraelAerodromeFrequency]] = [:]
        for row in try Row.fetchAll(db, sql: "SELECT * FROM aerodrome_frequencies WHERE aerodrome IN (\(marks)) ORDER BY id", arguments: StatementArguments(codes)) {
            frequencies[row["aerodrome"], default: []].append(IsraelAerodromeFrequency(
                id: row["id"], mhz: row["mhz"], service: row["service"], callsignHebrew: row["callsign_he"]
            ))
        }
        return try rows.map { row in
            let code: String = row["code"]
            return try aerodrome(row, runways: runways[code] ?? [], frequencies: frequencies[code] ?? [])
        }
    }

    private static func aerodrome(_ row: Row, runways: [IsraelAerodromeRunway], frequencies: [IsraelAerodromeFrequency]) throws -> IsraelAerodrome {
        guard
            let type = IsraelAerodromeType(rawValue: row["type"]),
            let use = IsraelAerodromeUse(rawValue: row["use"]),
            let ppr = IsraelPPR(rawValue: row["ppr"]),
            let review = IsraelAerodromeReviewStatus(rawValue: row["review_status"])
        else { throw EFBError.databaseCorrupted }
        let uncertain: String? = row["uncertain"]
        return IsraelAerodrome(
            id: row["id"], code: row["code"], nameHebrew: row["name_he"], nameEnglish: row["name_en"],
            type: type, use: use, latitude: row["lat"], longitude: row["lon"],
            elevationFeet: row["elevation_ft"], circuitAltitudeFeet: row["circuit_altitude_ft"],
            circuitDirection: row["circuit_direction"], hours: row["hours"], ppr: ppr, pprText: row["ppr_text"],
            remarks: row["remarks"],
            sources: IsraelAerodromeSources(
                identity: row["source_identity"], runways: row["source_runways"], frequencies: row["source_frequencies"],
                circuit: row["source_circuit"], hours: row["source_hours"], remarks: row["source_remarks"]
            ),
            uncertainGroups: uncertain?.split(separator: ",").map(String.init) ?? [],
            notes: row["notes"], reviewStatus: review, runways: runways, frequencies: frequencies
        )
    }

    // MARK: - Row mapping

    /// R-tree overlap arguments in the order the queries use: maxLat, minLat, maxLon, minLon.
    private static func boxArguments(_ bounds: IsraelGeoBounds) -> StatementArguments {
        [bounds.maxLatitude, bounds.minLatitude, bounds.maxLongitude, bounds.minLongitude]
    }

    private static func point(_ row: Row) -> IsraelReportingPoint {
        IsraelReportingPoint(
            id: row["id"], code: row["code"], nameEnglish: row["name_en"], nameHebrew: row["name_he"],
            kind: IsraelPointKind(rawValue: row["kind"]) ?? .onRequest,
            latitude: row["lat"], longitude: row["lon"],
            network: IsraelRouteNetwork(rawValue: row["network"]) ?? .cvfr
        )
    }

    private static func segment(_ row: Row) throws -> IsraelRouteSegment {
        let polyline: [[Double]] = try decodeJSON(row["polyline"])
        return IsraelRouteSegment(
            id: row["id"], fromCode: row["from_code"], toCode: row["to_code"],
            fromPointID: row["from_point_id"], toPointID: row["to_point_id"],
            nameEnglish: row["name_en"], nameHebrew: row["name_he"], lengthNM: row["length_nm"],
            isCivil: (row["civil"] as Int) != 0, isMilitary: (row["military"] as Int) != 0,
            isByRequest: (row["by_request"] as Int) != 0, bearingTrue: row["bearing_true"],
            altitudeForward: routeAltitude(text: row["alt_forward_text"], feet: row["alt_forward_ft"]),
            altitudeReverse: routeAltitude(text: row["alt_reverse_text"], feet: row["alt_reverse_ft"]),
            lowerAltitudeFeet: row["lower_alt_ft"], mapSheet: row["map_sheet"],
            polyline: polyline.compactMap(coordinate),
            network: IsraelRouteNetwork(rawValue: row["network"]) ?? .cvfr,
            activity: (row["activity"] as String?).flatMap(IsraelRouteActivity.init(rawValue:)) ?? .unspecified,
            activitySource: row["activity_source"],
            smallOnly: ((row["small_only"] as Int?) ?? 0) != 0
        )
    }

    private static func routeAltitude(text: String?, feet: Int?) -> IsraelRouteAltitude? {
        text.map { IsraelRouteAltitude(published: $0, feet: feet) }
    }

    private static func airspace(_ row: Row) throws -> IsraelAirspace {
        guard let kind = IsraelAirspaceKind(rawValue: row["kind"]) else { throw EFBError.databaseCorrupted }
        let polygons: [[[[Double]]]] = try decodeJSON(row["polygons"])
        return IsraelAirspace(
            id: row["id"], kind: kind, code: row["code"], nameEnglish: row["name_en"], nameHebrew: row["name_he"],
            label: row["label"], authority: (row["authority"] as String?).flatMap(IsraelAirspaceAuthority.init(rawValue:)),
            floor: limit(feet: row["floor_ft"], reference: row["floor_ref"], text: row["floor_text"]),
            ceiling: limit(feet: row["ceiling_ft"], reference: row["ceiling_ref"], text: row["ceiling_text"]),
            polygons: polygons.map { $0.map { $0.compactMap(coordinate) } }
        )
    }

    private static func limit(feet: Int?, reference: String?, text: String?) -> IsraelAirspaceLimit {
        IsraelAirspaceLimit(feet: feet, reference: reference.flatMap(IsraelAltitudeReference.init(rawValue:)), publishedText: text)
    }

    private static func runway(_ row: Row) -> IsraelRunway {
        IsraelRunway(
            id: row["id"], aerodrome: row["aerodrome"], nameEnglish: row["name_en"], nameHebrew: row["name_he"],
            designatorA: row["designator_a"], designatorB: row["designator_b"],
            headingA: row["heading_a"], headingB: row["heading_b"],
            lengthMetres: row["length_m"], widthMetres: row["width_m"], surface: row["surface"],
            endA: CLLocationCoordinate2D(latitude: row["a_lat"], longitude: row["a_lon"]),
            endB: CLLocationCoordinate2D(latitude: row["b_lat"], longitude: row["b_lon"])
        )
    }

    /// [lat, lon] pair from the importer's JSON.
    private static func coordinate(_ pair: [Double]) -> CLLocationCoordinate2D? {
        pair.count == 2 ? CLLocationCoordinate2D(latitude: pair[0], longitude: pair[1]) : nil
    }

    private static func decodeJSON<T: Decodable>(_ text: String) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: Data(text.utf8))
        } catch {
            throw EFBError.databaseCorrupted
        }
    }
}
