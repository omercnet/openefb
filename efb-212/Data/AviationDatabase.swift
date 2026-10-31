//
//  AviationDatabase.swift
//  efb-212
//
//  GRDB-backed aviation database with R-tree spatial indexes and FTS5 full-text search.
//  Wraps a DatabasePool for thread-safe concurrent reads with WAL mode.
//  The bundled SQLite is copied to Application Support on first run and re-copied whenever
//  the bundled data fingerprint (data version + file size) changes, so app updates refresh it.
//
//  All query methods are nonisolated -- GRDB DatabasePool handles thread safety internally.
//  Marked @unchecked Sendable because DatabasePool is inherently thread-safe.
//

import Foundation
import CoreLocation
import GRDB

final class AviationDatabase: @unchecked Sendable {

    private let dbPool: DatabasePool

    // MARK: - Bundled Data Version

    /// Version of the bundled aviation.sqlite. Bump this whenever tools/nasr-importer regenerates
    /// the file. The install fingerprint also includes the bundled file size, so a regenerated
    /// file with a forgotten bump is still re-copied in most cases.
    nonisolated static let bundledDataVersion = "2026-10-30"

    /// Name of the installed database file and its version marker (both in the install directory).
    nonisolated static let installedFileName = "aviation.sqlite"
    nonisolated static let versionMarkerFileName = "aviation.sqlite.version"

    // MARK: - Initialization

    /// Open the production database: the bundled aviation.sqlite installed into
    /// Application Support/efb-212, refreshed when the bundled data fingerprint changes.
    /// Throws EFBError.databaseCorrupted if the bundled database is missing.
    nonisolated convenience init() throws {
        let fileManager = FileManager.default
        guard let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw EFBError.databaseCorrupted
        }
        guard let bundledURL = Bundle.main.url(forResource: "aviation", withExtension: "sqlite") else {
            throw EFBError.databaseCorrupted
        }
        let installDirectory = appSupport.appendingPathComponent("efb-212", isDirectory: true)
        try self.init(bundledURL: bundledURL, installDirectory: installDirectory, dataVersion: Self.bundledDataVersion)
    }

    /// Open the database at `bundledURL` after installing it into `installDirectory`.
    /// Exposed for tests; production uses `init()`.
    nonisolated init(bundledURL: URL, installDirectory: URL, dataVersion: String) throws {
        let installedURL = try Self.installBundledDatabase(
            from: bundledURL,
            into: installDirectory,
            dataVersion: dataVersion
        )

        var config = Configuration()
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA journal_mode = WAL")
        }
        do {
            dbPool = try DatabasePool(path: installedURL.path, configuration: config)
        } catch {
            throw EFBError.databaseMigrationFailed(underlying: error)
        }
    }

    /// Copy the bundled database into `directory` when it is missing or its fingerprint differs
    /// from the installed marker. Removes the old file and its -wal/-shm sidecars before copying
    /// so a stale write-ahead log can never be applied to the fresh file.
    /// Returns the URL of the installed database.
    /// Throws EFBError.databaseCorrupted if the bundled file does not exist.
    @discardableResult
    nonisolated static func installBundledDatabase(
        from bundledURL: URL,
        into directory: URL,
        dataVersion: String
    ) throws -> URL {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: bundledURL.path) else {
            throw EFBError.databaseCorrupted
        }

        let installedURL = directory.appendingPathComponent(installedFileName)
        let markerURL = directory.appendingPathComponent(versionMarkerFileName)
        let fingerprint = try installFingerprint(bundledURL: bundledURL, dataVersion: dataVersion)

        let installedMarker = try? String(contentsOf: markerURL, encoding: .utf8)
        let upToDate = fileManager.fileExists(atPath: installedURL.path) && installedMarker == fingerprint
        if upToDate {
            return installedURL
        }

        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        for suffix in ["", "-wal", "-shm"] {
            let stale = directory.appendingPathComponent(installedFileName + suffix)
            if fileManager.fileExists(atPath: stale.path) {
                try fileManager.removeItem(at: stale)
            }
        }
        try fileManager.copyItem(at: bundledURL, to: installedURL)
        try fingerprint.write(to: markerURL, atomically: true, encoding: .utf8)
        return installedURL
    }

    /// Fingerprint written to the version marker: "<dataVersion>|<bundled file size in bytes>".
    nonisolated static func installFingerprint(bundledURL: URL, dataVersion: String) throws -> String {
        let attributes = try FileManager.default.attributesOfItem(atPath: bundledURL.path)
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        return "\(dataVersion)|\(size)"
    }

    /// Internal init for testing with an explicit database pool.
    nonisolated init(dbPool: DatabasePool) {
        self.dbPool = dbPool
    }

    // MARK: - Airport Queries

    /// Fetch a single airport by ICAO identifier with full runway and frequency data.
    nonisolated func airport(byICAO icao: String) throws -> Airport? {
        try dbPool.read { db in
            guard let row = try Row.fetchOne(db, sql: """
                SELECT * FROM airports WHERE icao = ?
                """, arguments: [icao]) else {
                return nil
            }

            let runways = try self.fetchRunways(db: db, airportICAO: icao)
            let frequencies = try self.fetchFrequencies(db: db, airportICAO: icao)
            return self.airportFromRow(row, runways: runways, frequencies: frequencies)
        }
    }

    /// Fetch airports within a radius of a coordinate using R-tree spatial index.
    /// Returns basic Airport structs without runways/frequencies for performance.
    nonisolated func airports(near center: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        let latDelta = radiusNM / 60.0
        let lonDelta = radiusNM / (60.0 * cos(center.latitude * .pi / 180.0))

        let minLat = center.latitude - latDelta
        let maxLat = center.latitude + latDelta
        let minLon = center.longitude - lonDelta
        let maxLon = center.longitude + lonDelta

        return try dbPool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT a.* FROM airports a
                INNER JOIN airports_rtree r ON a.rowid = r.rowid
                WHERE r.min_lat <= ? AND r.max_lat >= ?
                  AND r.min_lon <= ? AND r.max_lon >= ?
                """, arguments: [maxLat, minLat, maxLon, minLon])

            return rows.map { self.airportFromRow($0, runways: [], frequencies: []) }
        }
    }

    /// Initial search radius for nearestAirports, doubled until enough airports are found.
    nonisolated static let nearestInitialRadiusNM: Double = 25.0   // nautical miles
    /// Largest circle nearestAirports will search before returning fewer than requested.
    nonisolated static let nearestMaxRadiusNM: Double = 400.0      // nautical miles

    /// Fetch the N nearest airports to a coordinate, sorted by great-circle distance.
    /// Includes runways for emergency HUD display.
    ///
    /// Searches a circle, not a box: the R-tree box that covers the circle is queried, each
    /// candidate's true great-circle distance is computed, and only airports inside the circle
    /// are accepted. The radius doubles until `count` airports are inside it, so an airport at
    /// the corner of the box can never outrank a closer one just outside the box.
    nonisolated func nearestAirports(to center: CLLocationCoordinate2D, count: Int) throws -> [Airport] {
        guard count > 0 else { return [] }

        var radiusNM = Self.nearestInitialRadiusNM
        var withinCircle: [(airport: Airport, distanceNM: Double)] = []

        while true {
            let candidates = try airports(near: center, radiusNM: radiusNM)
            withinCircle = candidates
                .map { (airport: $0, distanceNM: Self.haversineDistanceNM(from: center, to: $0.coordinate)) }
                .filter { $0.distanceNM <= radiusNM }
            if withinCircle.count >= count || radiusNM >= Self.nearestMaxRadiusNM {
                break
            }
            radiusNM = min(radiusNM * 2.0, Self.nearestMaxRadiusNM)
        }

        let topN = withinCircle
            .sorted { $0.distanceNM < $1.distanceNM }
            .prefix(count)
            .map(\.airport)

        // Load runways for the nearest airports (needed for emergency HUD)
        return try dbPool.read { db in
            try topN.map { airport in
                let runways = try self.fetchRunways(db: db, airportICAO: airport.icao)
                let frequencies = try self.fetchFrequencies(db: db, airportICAO: airport.icao)
                return Airport(
                    icao: airport.icao,
                    faaID: airport.faaID,
                    name: airport.name,
                    latitude: airport.latitude,
                    longitude: airport.longitude,
                    elevation: airport.elevation,
                    type: airport.type,
                    ownership: airport.ownership,
                    ctafFrequency: airport.ctafFrequency,
                    unicomFrequency: airport.unicomFrequency,
                    artccID: airport.artccID,
                    fssID: airport.fssID,
                    magneticVariation: airport.magneticVariation,
                    patternAltitude: airport.patternAltitude,
                    fuelTypes: airport.fuelTypes,
                    hasBeaconLight: airport.hasBeaconLight,
                    runways: runways,
                    frequencies: frequencies
                )
            }
        }
    }

    /// Build a safe FTS5 MATCH expression from raw user text.
    /// Splits on non-alphanumerics, quotes each token and adds prefix matching, so quotes,
    /// dashes and other FTS5 syntax in the input can never cause a parse error.
    /// `KPAO-1` -> `"KPAO"* "1"*`. Returns nil when the input has no alphanumeric token.
    nonisolated static func ftsMatchExpression(from query: String) -> String? {
        let tokens = query
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return nil }
        return tokens.map { "\"\($0)\"*" }.joined(separator: " ")
    }

    /// Search airports by ICAO identifier, name, or FAA ID using FTS5 full-text search.
    /// Empty input (or input with no alphanumeric characters) returns no results.
    nonisolated func searchAirports(query: String, limit: Int = 20) throws -> [Airport] {
        guard let ftsQuery = Self.ftsMatchExpression(from: query) else { return [] }

        return try dbPool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT a.* FROM airports a
                INNER JOIN airports_fts fts ON a.rowid = fts.rowid
                WHERE airports_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """, arguments: [ftsQuery, limit])

            return rows.map { self.airportFromRow($0, runways: [], frequencies: []) }
        }
    }

    // MARK: - Airspace Queries

    /// Fetch airspaces within a radius of a coordinate using R-tree spatial index.
    nonisolated func airspaces(near center: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airspace] {
        let latDelta = radiusNM / 60.0
        let lonDelta = radiusNM / (60.0 * cos(center.latitude * .pi / 180.0))

        let minLat = center.latitude - latDelta
        let maxLat = center.latitude + latDelta
        let minLon = center.longitude - lonDelta
        let maxLon = center.longitude + lonDelta

        return try dbPool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT a.* FROM airspaces a
                INNER JOIN airspaces_rtree r ON a.rowid = r.rowid
                WHERE r.min_lat <= ? AND r.max_lat >= ?
                  AND r.min_lon <= ? AND r.max_lon >= ?
                """, arguments: [maxLat, minLat, maxLon, minLon])

            return rows.compactMap { self.airspaceFromRow($0) }
        }
    }

    /// Fetch airspaces that contain a specific point (for proximity alerts).
    /// Uses R-tree bounding box filter, then ray-casting point-in-polygon or distance check.
    nonisolated func airspacesContaining(point: CLLocationCoordinate2D) throws -> [Airspace] {
        // First get candidates from bounding box
        let candidates = try airspaces(near: point, radiusNM: 30.0)

        return candidates.filter { airspace in
            switch airspace.geometry {
            case .polygon(let coordinates):
                return Self.pointInPolygon(
                    point: point,
                    polygon: coordinates.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) }
                )
            case .circle(let center, let radiusNM):
                let centerCoord = CLLocationCoordinate2D(latitude: center[0], longitude: center[1])
                let distanceNM = Self.haversineDistanceNM(from: point, to: centerCoord)
                return distanceNM <= radiusNM
            }
        }
    }

    // MARK: - Navaid Queries

    /// Fetch navaids within a radius of a coordinate using R-tree spatial index.
    nonisolated func navaids(near center: CLLocationCoordinate2D, radiusNM: Double) throws -> [Navaid] {
        let latDelta = radiusNM / 60.0
        let lonDelta = radiusNM / (60.0 * cos(center.latitude * .pi / 180.0))

        let minLat = center.latitude - latDelta
        let maxLat = center.latitude + latDelta
        let minLon = center.longitude - lonDelta
        let maxLon = center.longitude + lonDelta

        return try dbPool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT * FROM navaids n
                INNER JOIN navaids_rtree r ON n.rowid = r.rowid
                WHERE r.min_lat <= ? AND r.max_lat >= ?
                  AND r.min_lon <= ? AND r.max_lon >= ?
                """, arguments: [maxLat, minLat, maxLon, minLon])

            return rows.map { self.navaidFromRow($0) }
        }
    }

    // MARK: - Private Helpers

    /// Build an Airport from a database row.
    private nonisolated func airportFromRow(_ row: Row, runways: [Runway], frequencies: [Frequency]) -> Airport {
        let fuelTypesJSON: String = row["fuel_types"] ?? "[]"
        let fuelTypes = (try? JSONDecoder().decode([String].self, from: Data(fuelTypesJSON.utf8))) ?? []

        return Airport(
            icao: row["icao"],
            faaID: row["faa_id"],
            name: row["name"],
            latitude: row["latitude"],
            longitude: row["longitude"],
            elevation: row["elevation"],
            type: AirportType(rawValue: row["type"] ?? "airport") ?? .airport,
            ownership: OwnershipType(rawValue: row["ownership"] ?? "public") ?? .publicOwned,
            ctafFrequency: row["ctaf_frequency"],
            unicomFrequency: row["unicom_frequency"],
            artccID: row["artcc_id"],
            fssID: row["fss_id"],
            magneticVariation: row["magnetic_variation"],
            patternAltitude: row["pattern_altitude"],
            fuelTypes: fuelTypes,
            hasBeaconLight: (row["has_beacon_light"] as Int?) == 1,
            runways: runways,
            frequencies: frequencies
        )
    }

    /// Fetch runways for a given airport ICAO.
    private nonisolated func fetchRunways(db: Database, airportICAO: String) throws -> [Runway] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT * FROM runways WHERE airport_icao = ?
            """, arguments: [airportICAO])

        return rows.map { row in
            Runway(
                id: row["id"],
                length: row["length"],
                width: row["width"],
                surface: SurfaceType(rawValue: row["surface"] ?? "other") ?? .other,
                lighting: LightingType(rawValue: row["lighting"] ?? "none") ?? .none,
                baseEndID: row["base_end_id"],
                reciprocalEndID: row["reciprocal_end_id"],
                baseEndLatitude: row["base_end_latitude"],
                baseEndLongitude: row["base_end_longitude"],
                reciprocalEndLatitude: row["reciprocal_end_latitude"],
                reciprocalEndLongitude: row["reciprocal_end_longitude"]
            )
        }
    }

    /// Fetch frequencies for a given airport ICAO.
    private nonisolated func fetchFrequencies(db: Database, airportICAO: String) throws -> [Frequency] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT * FROM frequencies WHERE airport_icao = ?
            """, arguments: [airportICAO])

        return rows.map { row in
            let idString: String = row["id"] ?? UUID().uuidString
            return Frequency(
                id: UUID(uuidString: idString) ?? UUID(),
                type: FrequencyType(rawValue: row["type"] ?? "other") ?? .other,
                frequency: row["frequency"],
                name: row["name"]
            )
        }
    }

    /// Build an Airspace from a database row.
    private nonisolated func airspaceFromRow(_ row: Row) -> Airspace? {
        let coordinatesJSON: String? = row["coordinates"]
        let centerLat: Double? = row["center_latitude"]
        let centerLon: Double? = row["center_longitude"]
        let radiusNM: Double? = row["radius_nm"]

        let geometry: AirspaceGeometry
        if let radiusNM = radiusNM, radiusNM > 0,
           let centerLat = centerLat, let centerLon = centerLon {
            geometry = .circle(center: [centerLat, centerLon], radiusNM: radiusNM)
        } else if let json = coordinatesJSON,
                  let data = json.data(using: .utf8),
                  let coords = try? JSONDecoder().decode([[Double]].self, from: data),
                  !coords.isEmpty {
            geometry = .polygon(coordinates: coords)
        } else {
            return nil
        }

        let idString: String = row["id"] ?? UUID().uuidString
        let classString: String = row["class"] ?? "echo"

        return Airspace(
            id: UUID(uuidString: idString) ?? UUID(),
            classification: AirspaceClass(rawValue: classString) ?? .echo,
            name: row["name"] ?? "Unknown",
            floor: row["floor_altitude"] ?? 0,
            ceiling: row["ceiling_altitude"] ?? 18000,
            geometry: geometry
        )
    }

    /// Build a Navaid from a database row.
    private nonisolated func navaidFromRow(_ row: Row) -> Navaid {
        Navaid(
            id: row["id"],
            name: row["name"],
            type: NavaidType(rawValue: row["type"] ?? "vor") ?? .vor,
            latitude: row["latitude"],
            longitude: row["longitude"],
            frequency: row["frequency"],
            magneticVariation: row["magnetic_variation"],
            elevation: row["elevation"]
        )
    }

    // MARK: - Geometry Utilities

    /// Ray-casting point-in-polygon test.
    /// Returns true if the point is inside the polygon.
    private nonisolated static func pointInPolygon(
        point: CLLocationCoordinate2D,
        polygon: [CLLocationCoordinate2D]
    ) -> Bool {
        guard polygon.count >= 3 else { return false }

        var inside = false
        var j = polygon.count - 1

        for i in 0..<polygon.count {
            let xi: Double = polygon[i].longitude, yi: Double = polygon[i].latitude
            let xj: Double = polygon[j].longitude, yj: Double = polygon[j].latitude

            let straddlesLatitude: Bool = (yi > point.latitude) != (yj > point.latitude)
            let slope: Double = (xj - xi) * (point.latitude - yi) / (yj - yi)
            let crossingLongitude: Double = slope + xi
            let intersect: Bool = straddlesLatitude && (point.longitude < crossingLongitude)

            if intersect {
                inside.toggle()
            }
            j = i
        }

        return inside
    }

    /// Haversine great-circle distance in nautical miles.
    private nonisolated static func haversineDistanceNM(
        from: CLLocationCoordinate2D,
        to: CLLocationCoordinate2D
    ) -> Double {
        let earthRadiusNM = 3440.065  // Earth radius in nautical miles
        let dLat = (to.latitude - from.latitude) * .pi / 180.0
        let dLon = (to.longitude - from.longitude) * .pi / 180.0
        let lat1 = from.latitude * .pi / 180.0
        let lat2 = to.latitude * .pi / 180.0

        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return earthRadiusNM * c
    }
}
