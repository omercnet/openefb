//
//  AviationDatabaseTests.swift
//  efb-212Tests
//
//  Query behaviour of AviationDatabase against a temporary GRDB database carrying the full
//  bundled schema (airports, runways, frequencies, navaids, airspaces, R-trees, FTS5):
//  row decoding with fallbacks, bounding-box edges, airspace containment geometry.
//
//  Nearest-airport ordering, FTS escaping and bundled-file refresh are covered by
//  AviationDatabaseRobustnessTests.
//

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

@Suite("AviationDatabase Query Tests")
@MainActor
struct AviationDatabaseTests {

    // MARK: - Fixture

    struct AirportRow {
        var icao: String
        var name: String
        var lat: Double
        var lon: Double
        var type: String = "airport"
        var ownership: String = "public"
        var fuelTypes: String? = "[]"
        var hasBeacon: Int = 0
    }

    struct RunwayRow {
        var airport: String
        var id: String
        var length: Int
        var surface: String = "asphalt"
        var lighting: String = "fullTime"
    }

    struct FrequencyRow {
        var airport: String
        var id: String
        var type: String
        var name: String
        var frequency: Double
    }

    struct NavaidRow {
        var id: String
        var name: String
        var type: String
        var lat: Double
        var lon: Double
        var elevation: Double? = nil
    }

    struct AirspaceRow {
        var id: String
        var name: String
        var classification: String
        var floor: Int = 0
        var ceiling: Int = 4000
        var center: (lat: Double, lon: Double)? = nil
        var radiusNM: Double? = nil
        var coordinatesJSON: String? = nil
        var box: (minLat: Double, maxLat: Double, minLon: Double, maxLon: Double)
    }

    /// Build a temporary database with the bundled schema and the given rows.
    static func makeDatabase(
        airports: [AirportRow] = [],
        runways: [RunwayRow] = [],
        frequencies: [FrequencyRow] = [],
        navaids: [NavaidRow] = [],
        airspaces: [AirspaceRow] = []
    ) throws -> AviationDatabase {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("efb-avdb-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let pool = try DatabasePool(path: dir.appendingPathComponent("aviation.sqlite").path)

        try pool.write { db in
            try db.execute(sql: """
                CREATE TABLE airports (
                    icao TEXT PRIMARY KEY, faa_id TEXT, name TEXT NOT NULL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL,
                    elevation REAL NOT NULL DEFAULT 0,
                    type TEXT NOT NULL DEFAULT 'airport', ownership TEXT NOT NULL DEFAULT 'public',
                    ctaf_frequency REAL, unicom_frequency REAL, artcc_id TEXT, fss_id TEXT,
                    magnetic_variation REAL, pattern_altitude INTEGER,
                    fuel_types TEXT DEFAULT '[]', has_beacon_light INTEGER DEFAULT 0
                );
                CREATE TABLE runways (
                    id TEXT NOT NULL, airport_icao TEXT NOT NULL,
                    length INTEGER NOT NULL, width INTEGER NOT NULL,
                    surface TEXT NOT NULL DEFAULT 'asphalt', lighting TEXT NOT NULL DEFAULT 'none',
                    base_end_id TEXT NOT NULL, reciprocal_end_id TEXT NOT NULL,
                    base_end_latitude REAL NOT NULL DEFAULT 0, base_end_longitude REAL NOT NULL DEFAULT 0,
                    reciprocal_end_latitude REAL NOT NULL DEFAULT 0, reciprocal_end_longitude REAL NOT NULL DEFAULT 0
                );
                CREATE TABLE frequencies (
                    id TEXT NOT NULL, airport_icao TEXT NOT NULL,
                    type TEXT NOT NULL, name TEXT NOT NULL, frequency REAL NOT NULL
                );
                CREATE TABLE navaids (
                    id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'vor', name TEXT NOT NULL,
                    latitude REAL NOT NULL, longitude REAL NOT NULL,
                    frequency REAL NOT NULL DEFAULT 0, elevation REAL, magnetic_variation REAL
                );
                CREATE TABLE airspaces (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL,
                    floor_altitude INTEGER NOT NULL DEFAULT 0, ceiling_altitude INTEGER NOT NULL DEFAULT 18000,
                    center_latitude REAL, center_longitude REAL, radius_nm REAL, coordinates TEXT,
                    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL
                );
                CREATE VIRTUAL TABLE airports_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
                CREATE VIRTUAL TABLE navaids_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
                CREATE VIRTUAL TABLE airspaces_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
                CREATE VIRTUAL TABLE airports_fts USING fts5(icao, name, faa_id, content=airports, content_rowid=rowid);
                """)

            for a in airports {
                try db.execute(
                    sql: """
                        INSERT INTO airports (icao, name, latitude, longitude, type, ownership, fuel_types, has_beacon_light)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                    arguments: [a.icao, a.name, a.lat, a.lon, a.type, a.ownership, a.fuelTypes, a.hasBeacon]
                )
                try db.execute(
                    sql: "INSERT INTO airports_rtree VALUES (?, ?, ?, ?, ?)",
                    arguments: [db.lastInsertedRowID, a.lat, a.lat, a.lon, a.lon]
                )
            }
            for r in runways {
                try db.execute(
                    sql: """
                        INSERT INTO runways (id, airport_icao, length, width, surface, lighting, base_end_id, reciprocal_end_id)
                        VALUES (?, ?, ?, 75, ?, ?, '13', '31')
                        """,
                    arguments: [r.id, r.airport, r.length, r.surface, r.lighting]
                )
            }
            for f in frequencies {
                try db.execute(
                    sql: "INSERT INTO frequencies (id, airport_icao, type, name, frequency) VALUES (?, ?, ?, ?, ?)",
                    arguments: [f.id, f.airport, f.type, f.name, f.frequency]
                )
            }
            for n in navaids {
                try db.execute(
                    sql: "INSERT INTO navaids (id, type, name, latitude, longitude, frequency, elevation) VALUES (?, ?, ?, ?, ?, 113.0, ?)",
                    arguments: [n.id, n.type, n.name, n.lat, n.lon, n.elevation]
                )
                try db.execute(
                    sql: "INSERT INTO navaids_rtree VALUES (?, ?, ?, ?, ?)",
                    arguments: [db.lastInsertedRowID, n.lat, n.lat, n.lon, n.lon]
                )
            }
            for s in airspaces {
                try db.execute(
                    sql: """
                        INSERT INTO airspaces (id, name, class, floor_altitude, ceiling_altitude,
                            center_latitude, center_longitude, radius_nm, coordinates,
                            min_lat, max_lat, min_lon, max_lon)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                    arguments: [
                        s.id, s.name, s.classification, s.floor, s.ceiling,
                        s.center?.lat, s.center?.lon, s.radiusNM, s.coordinatesJSON,
                        s.box.minLat, s.box.maxLat, s.box.minLon, s.box.maxLon,
                    ]
                )
                try db.execute(
                    sql: "INSERT INTO airspaces_rtree VALUES (?, ?, ?, ?, ?)",
                    arguments: [db.lastInsertedRowID, s.box.minLat, s.box.maxLat, s.box.minLon, s.box.maxLon]
                )
            }
            try db.execute(sql: "INSERT INTO airports_fts(airports_fts) VALUES ('rebuild')")
        }
        return AviationDatabase(dbPool: pool)
    }

    static let kpao = AirportRow(icao: "KPAO", name: "Palo Alto", lat: 37.4611, lon: -122.1150,
                                 fuelTypes: "[\"100LL\",\"Jet-A\"]", hasBeacon: 1)
    static let ksql = AirportRow(icao: "KSQL", name: "San Carlos", lat: 37.5119, lon: -122.2494)
    static let paoCoord = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

    // MARK: - Airport detail lookup

    @Test func airportByICAOLoadsRunwaysFrequenciesAndDecodesJSONFields() throws {
        let db = try Self.makeDatabase(
            airports: [Self.kpao, Self.ksql],
            runways: [
                RunwayRow(airport: "KPAO", id: "13/31", length: 2443),
                RunwayRow(airport: "KSQL", id: "12/30", length: 2600),
            ],
            frequencies: [
                FrequencyRow(airport: "KPAO", id: UUID().uuidString, type: "tower", name: "Palo Alto Tower", frequency: 118.6),
                FrequencyRow(airport: "KSQL", id: UUID().uuidString, type: "tower", name: "San Carlos Tower", frequency: 119.0),
            ]
        )

        let airport = try #require(try db.airport(byICAO: "KPAO"))
        #expect(airport.fuelTypes == ["100LL", "Jet-A"])
        #expect(airport.hasBeaconLight)
        // Only KPAO's own rows, not KSQL's.
        #expect(airport.runways.map(\.id) == ["13/31"])
        #expect(airport.runways.first?.length == 2443)   // feet
        #expect(airport.runways.first?.lighting == .fullTime)
        #expect(airport.frequencies.map(\.frequency) == [118.6])   // MHz
        #expect(airport.frequencies.first?.type == .tower)
    }

    @Test func airportByICAOIsExactMatchAndNilWhenMissing() throws {
        let db = try Self.makeDatabase(airports: [Self.kpao])
        #expect(try db.airport(byICAO: "KPA") == nil)
        #expect(try db.airport(byICAO: "KXYZ") == nil)
        #expect(try db.airport(byICAO: "KPAO")?.icao == "KPAO")
    }

    @Test func unknownEnumRawValuesDecodeToFallbacksInsteadOfFailing() throws {
        var weird = Self.kpao
        weird.type = "spaceport"
        weird.ownership = "coop"
        weird.fuelTypes = "not json"
        let db = try Self.makeDatabase(
            airports: [weird],
            runways: [RunwayRow(airport: "KPAO", id: "13/31", length: 2443, surface: "lava", lighting: "disco")],
            frequencies: [FrequencyRow(airport: "KPAO", id: "not-a-uuid", type: "telepathy", name: "X", frequency: 1)]
        )

        let airport = try #require(try db.airport(byICAO: "KPAO"))
        #expect(airport.type == .airport)
        #expect(airport.ownership == .publicOwned)
        #expect(airport.fuelTypes.isEmpty)
        #expect(airport.runways.first?.surface == .other)
        #expect(airport.runways.first?.lighting == LightingType.none)
        #expect(airport.frequencies.first?.type == .other)
    }

    // MARK: - Bounding-box queries

    /// 1 NM of latitude is 1/60 degree; the box edge is inclusive.
    @Test func airportsNearIncludesBoxEdgeAndExcludesJustOutside() throws {
        let onEdge = AirportRow(icao: "EDGE", name: "On Edge", lat: 37.0 + 10.0 / 60.0, lon: -122.0)
        let outside = AirportRow(icao: "OUTS", name: "Outside", lat: 37.0 + 10.001 / 60.0, lon: -122.0)
        let db = try Self.makeDatabase(airports: [onEdge, outside])

        let found = try db.airports(near: CLLocationCoordinate2D(latitude: 37.0, longitude: -122.0), radiusNM: 10.0)
        #expect(found.map(\.icao) == ["EDGE"])
    }

    @Test func airportsNearWidensLongitudeBoxWithLatitude() throws {
        // At 60N one degree of longitude is only 30 NM, so a 20 NM box spans 2/3 of a degree.
        let center = CLLocationCoordinate2D(latitude: 60.0, longitude: -150.0)
        let inside = AirportRow(icao: "INSD", name: "Inside", lat: 60.0, lon: -150.0 - 0.6)
        let outside = AirportRow(icao: "OUTS", name: "Outside", lat: 60.0, lon: -150.0 - 0.7)
        let db = try Self.makeDatabase(airports: [inside, outside])

        let found = try db.airports(near: center, radiusNM: 20.0)
        #expect(found.map(\.icao) == ["INSD"])
    }

    @Test func airportsNearReturnsNoRunwaysAndEmptyForEmptyRegion() throws {
        let db = try Self.makeDatabase(
            airports: [Self.kpao],
            runways: [RunwayRow(airport: "KPAO", id: "13/31", length: 2443)]
        )
        let nearby = try db.airports(near: Self.paoCoord, radiusNM: 5)
        #expect(nearby.count == 1)
        #expect(nearby.first?.runways.isEmpty == true)   // list query skips runway loading

        let farAway = CLLocationCoordinate2D(latitude: 40.6413, longitude: -73.7781)
        #expect(try db.airports(near: farAway, radiusNM: 50).isEmpty)
    }

    @Test func navaidsNearFiltersByBoxAndDecodesOptionalElevation() throws {
        let db = try Self.makeDatabase(navaids: [
            NavaidRow(id: "SJC", name: "San Jose", type: "vor_dme", lat: 37.3626, lon: -121.9291, elevation: 56),
            NavaidRow(id: "OAK", name: "Oakland", type: "vortac", lat: 37.7213, lon: -122.2208),
        ])
        let sjc = CLLocationCoordinate2D(latitude: 37.3626, longitude: -121.9291)

        let close = try db.navaids(near: sjc, radiusNM: 5)
        #expect(close.map(\.id) == ["SJC"])
        #expect(close.first?.type == .vorDme)
        #expect(close.first?.elevation == 56)   // feet MSL

        let wide = try db.navaids(near: sjc, radiusNM: 40)
        #expect(Set(wide.map(\.id)) == ["SJC", "OAK"])
        #expect(wide.first { $0.id == "OAK" }?.elevation == nil)
    }

    // MARK: - Airspace geometry

    static let sjcClassC = AirspaceRow(
        id: UUID().uuidString, name: "SJC Class C", classification: "charlie", ceiling: 4000,
        center: (37.3626, -121.9291), radiusNM: 5.0,
        box: (37.27, 37.45, -122.04, -121.82)
    )

    /// Square roughly 8 NM on a side around SFO.
    static let sfoClassB = AirspaceRow(
        id: UUID().uuidString, name: "SFO Class B Inner", classification: "bravo", ceiling: 10000,
        coordinatesJSON: "[[37.55,-122.45],[37.55,-122.30],[37.68,-122.30],[37.68,-122.45],[37.55,-122.45]]",
        box: (37.55, 37.68, -122.45, -122.30)
    )

    @Test func circleAirspaceContainsPointsInsideRadiusOnly() throws {
        let db = try Self.makeDatabase(airspaces: [Self.sjcClassC])
        let center = CLLocationCoordinate2D(latitude: 37.3626, longitude: -121.9291)

        #expect(try db.airspacesContaining(point: center).map(\.name) == ["SJC Class C"])

        // 4.9 NM north: inside. 5.1 NM north: outside, even though the R-tree box still matches.
        let inside = CLLocationCoordinate2D(latitude: 37.3626 + 4.9 / 60.0, longitude: -121.9291)
        let outside = CLLocationCoordinate2D(latitude: 37.3626 + 5.1 / 60.0, longitude: -121.9291)
        #expect(try db.airspacesContaining(point: inside).count == 1)
        #expect(try db.airspacesContaining(point: outside).isEmpty)
    }

    @Test func polygonAirspaceUsesRayCastingNotBoundingBox() throws {
        // Triangle: the bounding box covers the whole square, the polygon only its lower-left half.
        let triangle = AirspaceRow(
            id: UUID().uuidString, name: "Tri", classification: "delta",
            coordinatesJSON: "[[37.0,-122.0],[37.0,-121.0],[38.0,-122.0],[37.0,-122.0]]",
            box: (37.0, 38.0, -122.0, -121.0)
        )
        let db = try Self.makeDatabase(airspaces: [triangle])

        let inTriangle = CLLocationCoordinate2D(latitude: 37.2, longitude: -121.8)
        let inBoxOnly = CLLocationCoordinate2D(latitude: 37.8, longitude: -121.2)
        #expect(try db.airspacesContaining(point: inTriangle).map(\.name) == ["Tri"])
        #expect(try db.airspacesContaining(point: inBoxOnly).isEmpty)
    }

    @Test func overlappingAirspacesAreAllReported() throws {
        let paoClassD = AirspaceRow(
            id: UUID().uuidString, name: "PAO Class D", classification: "delta", ceiling: 2500,
            center: (37.4611, -122.1150), radiusNM: 4.0,
            box: (37.39, 37.53, -122.20, -122.03)
        )
        let overlappingC = AirspaceRow(
            id: UUID().uuidString, name: "Big Class C", classification: "charlie",
            center: (37.4611, -122.1150), radiusNM: 10.0,
            box: (37.29, 37.63, -122.33, -121.90)
        )
        let db = try Self.makeDatabase(airspaces: [paoClassD, overlappingC, Self.sfoClassB])

        let names = Set(try db.airspacesContaining(point: Self.paoCoord).map(\.name))
        #expect(names == ["PAO Class D", "Big Class C"])
    }

    @Test func airspaceRowsDecodeClassFloorCeilingAndPreferCircleOverPolygon() throws {
        var both = Self.sjcClassC
        both.coordinatesJSON = Self.sfoClassB.coordinatesJSON
        both.floor = 1500
        let db = try Self.makeDatabase(airspaces: [both])

        let airspace = try #require(try db.airspaces(near: Self.paoCoord, radiusNM: 30).first)
        #expect(airspace.classification == .charlie)
        #expect(airspace.floor == 1500)     // feet MSL
        #expect(airspace.ceiling == 4000)   // feet MSL
        guard case .circle(_, let radius) = airspace.geometry else {
            Issue.record("expected circle geometry when radius_nm > 0")
            return
        }
        #expect(radius == 5.0)   // nautical miles
    }

    @Test func airspaceRowsWithoutUsableGeometryAreDropped() throws {
        let noGeometry = AirspaceRow(
            id: UUID().uuidString, name: "Broken", classification: "delta",
            box: (37.0, 38.0, -123.0, -122.0)
        )
        let zeroRadiusBadJSON = AirspaceRow(
            id: UUID().uuidString, name: "Broken2", classification: "delta",
            center: (37.5, -122.5), radiusNM: 0, coordinatesJSON: "[]",
            box: (37.0, 38.0, -123.0, -122.0)
        )
        let db = try Self.makeDatabase(airspaces: [noGeometry, zeroRadiusBadJSON, Self.sfoClassB])

        let found = try db.airspaces(near: CLLocationCoordinate2D(latitude: 37.6, longitude: -122.4), radiusNM: 30)
        #expect(found.map(\.name) == ["SFO Class B Inner"])
    }

    // MARK: - Towered airports (low-zoom layer)

    @Test func toweredAirportsReturnsOnlyPublicFixedWingFieldsWithATowerFrequency() throws {
        let db = try Self.makeDatabase(
            airports: [
                AirportRow(icao: "KPAO", name: "Palo Alto", lat: 37.46, lon: -122.11),            // CTAF only
                AirportRow(icao: "KSFO", name: "San Francisco Intl", lat: 37.62, lon: -122.38),  // towered
                AirportRow(icao: "KSQL", name: "San Carlos", lat: 37.51, lon: -122.25),          // towered
                AirportRow(icao: "KNUQ", name: "Moffett", lat: 37.42, lon: -122.05, ownership: "military"),
                AirportRow(icao: "4CA4", name: "Private Tower", lat: 37.40, lon: -122.00, ownership: "private"),
                AirportRow(icao: "CA01", name: "Hospital", lat: 37.45, lon: -122.15, type: "heliport"),
                AirportRow(icao: "KFAR", name: "Far Away Towered", lat: 47.0, lon: -100.0),
            ],
            frequencies: [
                FrequencyRow(airport: "KPAO", id: "f1", type: "ctaf", name: "CTAF", frequency: 118.6),
                FrequencyRow(airport: "KSFO", id: "f2", type: "tower", name: "Tower", frequency: 120.5),
                FrequencyRow(airport: "KSQL", id: "f3", type: "tower", name: "Tower", frequency: 119.0),
                FrequencyRow(airport: "KNUQ", id: "f4", type: "tower", name: "Tower", frequency: 126.0),
                FrequencyRow(airport: "4CA4", id: "f5", type: "tower", name: "Tower", frequency: 121.0),
                FrequencyRow(airport: "CA01", id: "f6", type: "tower", name: "Tower", frequency: 122.0),
                FrequencyRow(airport: "KFAR", id: "f7", type: "tower", name: "Tower", frequency: 123.0),
            ]
        )
        let center = CLLocationCoordinate2D(latitude: 37.5, longitude: -122.2)

        let near = try db.toweredAirports(near: center, radiusNM: 100)
        #expect(Set(near.map(\.icao)) == ["KSFO", "KSQL"])

        let wide = try db.toweredAirports(near: center, radiusNM: 1500)
        #expect(Set(wide.map(\.icao)) == ["KSFO", "KSQL", "KFAR"])
    }
}
