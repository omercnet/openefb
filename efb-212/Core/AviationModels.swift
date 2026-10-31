//
//  AviationModels.swift
//  efb-212
//
//  Shared aviation data structures used across the app.
//  Airport/Runway/Frequency/Navaid/Airspace are used with GRDB for aviation database.
//  FlightPlan/Waypoint/WeatherCache/ChartRegion are used across services and views.
//
//  All structs use nonisolated init for GRDB FetchableRecord compatibility.
//  GRDB conformances (FetchableRecord, PersistableRecord, TableRecord) are declared
//  here but GRDB import is deferred to the database layer to avoid coupling.
//

import Foundation
import CoreLocation

// MARK: - Airport

struct Airport: Identifiable, Codable, Equatable, Hashable, Sendable {
    var id: String { icao }
    let icao: String                     // ICAO identifier (e.g., "KPAO")
    let faaID: String?                   // FAA LID if different (e.g., "PAO")
    let name: String                     // "Palo Alto"
    let latitude: Double                 // degrees
    let longitude: Double                // degrees
    let elevation: Double                // feet MSL
    let type: AirportType
    let ownership: OwnershipType
    let ctafFrequency: Double?           // MHz
    let unicomFrequency: Double?         // MHz
    let artccID: String?                 // Controlling ARTCC
    let fssID: String?                   // Flight service station
    let magneticVariation: Double?       // degrees (W negative)
    let patternAltitude: Int?            // feet AGL
    let fuelTypes: [String]
    let hasBeaconLight: Bool
    let runways: [Runway]
    let frequencies: [Frequency]

    nonisolated init(
        icao: String,
        faaID: String? = nil,
        name: String,
        latitude: Double,
        longitude: Double,
        elevation: Double,
        type: AirportType,
        ownership: OwnershipType,
        ctafFrequency: Double? = nil,
        unicomFrequency: Double? = nil,
        artccID: String? = nil,
        fssID: String? = nil,
        magneticVariation: Double? = nil,
        patternAltitude: Int? = nil,
        fuelTypes: [String] = [],
        hasBeaconLight: Bool = false,
        runways: [Runway] = [],
        frequencies: [Frequency] = []
    ) {
        self.icao = icao
        self.faaID = faaID
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation
        self.type = type
        self.ownership = ownership
        self.ctafFrequency = ctafFrequency
        self.unicomFrequency = unicomFrequency
        self.artccID = artccID
        self.fssID = fssID
        self.magneticVariation = magneticVariation
        self.patternAltitude = patternAltitude
        self.fuelTypes = fuelTypes
        self.hasBeaconLight = hasBeaconLight
        self.runways = runways
        self.frequencies = frequencies
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(icao)
    }

    static func == (lhs: Airport, rhs: Airport) -> Bool {
        lhs.icao == rhs.icao
    }
}

// MARK: - Runway

struct Runway: Identifiable, Codable, Equatable, Sendable {
    let id: String                       // e.g., "13/31"
    let length: Int                      // feet
    let width: Int                       // feet
    let surface: SurfaceType
    let lighting: LightingType
    let baseEndID: String                // "13"
    let reciprocalEndID: String          // "31"
    let baseEndLatitude: Double          // degrees
    let baseEndLongitude: Double         // degrees
    let reciprocalEndLatitude: Double    // degrees
    let reciprocalEndLongitude: Double   // degrees
    let baseEndElevation: Double?        // feet MSL (TDZE)
    let reciprocalEndElevation: Double?  // feet MSL (TDZE)

    nonisolated init(
        id: String, length: Int, width: Int,
        surface: SurfaceType, lighting: LightingType,
        baseEndID: String, reciprocalEndID: String,
        baseEndLatitude: Double, baseEndLongitude: Double,
        reciprocalEndLatitude: Double, reciprocalEndLongitude: Double,
        baseEndElevation: Double? = nil, reciprocalEndElevation: Double? = nil
    ) {
        self.id = id
        self.length = length
        self.width = width
        self.surface = surface
        self.lighting = lighting
        self.baseEndID = baseEndID
        self.reciprocalEndID = reciprocalEndID
        self.baseEndLatitude = baseEndLatitude
        self.baseEndLongitude = baseEndLongitude
        self.reciprocalEndLatitude = reciprocalEndLatitude
        self.reciprocalEndLongitude = reciprocalEndLongitude
        self.baseEndElevation = baseEndElevation
        self.reciprocalEndElevation = reciprocalEndElevation
    }
}

// MARK: - Frequency

struct Frequency: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    let type: FrequencyType
    let frequency: Double                // MHz (e.g., 118.6)
    let name: String                     // "Palo Alto Tower"

    nonisolated init(id: UUID = UUID(), type: FrequencyType, frequency: Double, name: String) {
        self.id = id
        self.type = type
        self.frequency = frequency
        self.name = name
    }
}

// MARK: - Navaid

struct Navaid: Identifiable, Codable, Equatable, Hashable, Sendable {
    let id: String                       // e.g., "SJC"
    let name: String                     // "San Jose"
    let type: NavaidType
    let latitude: Double                 // degrees
    let longitude: Double                // degrees
    let frequency: Double                // MHz (VOR) or kHz (NDB)
    let magneticVariation: Double?       // degrees (W negative)
    let elevation: Double?               // feet MSL

    nonisolated init(
        id: String,
        name: String,
        type: NavaidType,
        latitude: Double,
        longitude: Double,
        frequency: Double,
        magneticVariation: Double? = nil,
        elevation: Double? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.latitude = latitude
        self.longitude = longitude
        self.frequency = frequency
        self.magneticVariation = magneticVariation
        self.elevation = elevation
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Airspace

struct Airspace: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    let classification: AirspaceClass
    let name: String                     // "SFO Class B"
    let floor: Int                       // feet MSL (0 = surface)
    let ceiling: Int                     // feet MSL
    let geometry: AirspaceGeometry

    nonisolated init(
        id: UUID = UUID(),
        classification: AirspaceClass,
        name: String,
        floor: Int,
        ceiling: Int,
        geometry: AirspaceGeometry
    ) {
        self.id = id
        self.classification = classification
        self.name = name
        self.floor = floor
        self.ceiling = ceiling
        self.geometry = geometry
    }
}

// MARK: - TFR (Temporary Flight Restriction)

/// One TFR area. A NOTAM with several areas (e.g. FDC 6/4348 Areas A and B) becomes several
/// `TFR` values sharing `notamID`, each with its own boundary and altitudes.
/// Optional schedule/altitude fields are nil when tfr.faa.gov does not publish them or the
/// NOTAM detail could not be fetched; the UI shows "See NOTAM" instead of a guessed value.
nonisolated struct TFR: Identifiable, Codable, Equatable, Sendable {
    let id: String                       // Unique per area: "<notamID>#<area index>"
    let notamID: String                  // FDC NOTAM number, e.g. "6/4348"
    let type: TFRType
    let title: String                    // FAA title, e.g. "GRAND FORKS AFB, ND, Sunday, March 8, 2026 ..."
    let state: String?                   // US state code, e.g. "ND"
    let facility: String?                // Responsible ARTCC, e.g. "ZMP"
    let effectiveDate: Date?             // UTC; nil = effective immediately (or unknown)
    let expirationDate: Date?            // UTC; nil = until further notice (or unknown)
    let boundaries: [[Double]]           // Outer ring as [lat, lon] pairs
    let floor: TFRAltitude?              // nil = see NOTAM
    let ceiling: TFRAltitude?            // nil = see NOTAM
    let lastModified: Date?              // UTC, FAA LAST_MODIFICATION_DATETIME

    /// Whether the TFR is in effect at `date`. Missing dates are treated as open-ended,
    /// so a TFR with unknown times is conservatively considered active.
    func isActive(at date: Date) -> Bool {
        if let effectiveDate, date < effectiveDate { return false }
        if let expirationDate, date > expirationDate { return false }
        return true
    }

    var isActive: Bool { isActive(at: Date()) }

    /// Vertex centroid of the boundary, for labels and coarse distance sorting.
    var coordinate: CLLocationCoordinate2D {
        PolygonGeometry.centroid(of: boundaries) ?? CLLocationCoordinate2D(latitude: 0, longitude: 0)
    }

    /// "SFC-2400' MSL", "1000' AGL-FL180", or "See NOTAM" when altitudes are unpublished.
    var altitudeDescription: String {
        guard let floor, let ceiling else { return "See NOTAM" }
        return "\(floor.displayString)-\(ceiling.displayString)"
    }

    /// Public FAA detail page for this NOTAM.
    var detailURL: URL? {
        URL(string: "https://tfr.faa.gov/tfr3/?page=detail_\(notamID.replacingOccurrences(of: "/", with: "_"))")
    }

    init(
        id: String,
        notamID: String,
        type: TFRType,
        title: String,
        state: String? = nil,
        facility: String? = nil,
        effectiveDate: Date? = nil,
        expirationDate: Date? = nil,
        boundaries: [[Double]],
        floor: TFRAltitude? = nil,
        ceiling: TFRAltitude? = nil,
        lastModified: Date? = nil
    ) {
        self.id = id
        self.notamID = notamID
        self.type = type
        self.title = title
        self.state = state
        self.facility = facility
        self.effectiveDate = effectiveDate
        self.expirationDate = expirationDate
        self.boundaries = boundaries
        self.floor = floor
        self.ceiling = ceiling
        self.lastModified = lastModified
    }
}

/// A TFR vertical limit as published in the FAA XNOTAM detail.
nonisolated struct TFRAltitude: Codable, Equatable, Sendable {
    nonisolated enum Reference: String, Codable, Sendable {
        case msl            // XNOTAM "ALT" with FT: feet MSL
        case agl            // XNOTAM "HEI": feet AGL
        case flightLevel    // XNOTAM uom "FL": value is the flight level (hundreds of feet, pressure altitude)
    }

    let value: Int          // feet (MSL or AGL), or flight level number for .flightLevel
    let reference: Reference

    /// Approximate feet for comparisons: flight levels converted at 100 ft per level.
    var feet: Int { reference == .flightLevel ? value * 100 : value }

    var displayString: String {
        switch reference {
        case .flightLevel: return "FL\(String(format: "%03d", value))"
        case .agl: return value == 0 ? "SFC" : "\(value)' AGL"
        case .msl: return value == 0 ? "SFC" : "\(value)' MSL"
        }
    }

    init(value: Int, reference: Reference) {
        self.value = value
        self.reference = reference
    }
}

// MARK: - Flight Plan

struct FlightPlan: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    var name: String?
    var departure: String                // ICAO
    var destination: String              // ICAO
    var waypoints: [Waypoint]
    var cruiseAltitude: Int              // feet MSL
    var cruiseSpeed: Double              // knots TAS
    var fuelBurnRate: Double?            // GPH
    var totalDistance: Double             // nautical miles (computed)
    var estimatedTime: TimeInterval      // seconds (computed)
    var estimatedFuel: Double?           // gallons (computed)
    var createdAt: Date
    var notes: String?

    nonisolated init(
        id: UUID = UUID(),
        name: String? = nil,
        departure: String,
        destination: String,
        waypoints: [Waypoint] = [],
        cruiseAltitude: Int = 3000,
        cruiseSpeed: Double = 100,
        fuelBurnRate: Double? = nil,
        totalDistance: Double = 0,
        estimatedTime: TimeInterval = 0,
        estimatedFuel: Double? = nil,
        createdAt: Date = Date(),
        notes: String? = nil
    ) {
        self.id = id
        self.name = name
        self.departure = departure
        self.destination = destination
        self.waypoints = waypoints
        self.cruiseAltitude = cruiseAltitude
        self.cruiseSpeed = cruiseSpeed
        self.fuelBurnRate = fuelBurnRate
        self.totalDistance = totalDistance
        self.estimatedTime = estimatedTime
        self.estimatedFuel = estimatedFuel
        self.createdAt = createdAt
        self.notes = notes
    }
}

// MARK: - Waypoint

struct Waypoint: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    var identifier: String               // ICAO, navaid ID, or lat/lon
    var name: String
    var latitude: Double                 // degrees
    var longitude: Double                // degrees
    var altitude: Int?                   // feet MSL (optional per-waypoint)
    var type: WaypointType

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    nonisolated init(
        id: UUID = UUID(),
        identifier: String,
        name: String,
        latitude: Double,
        longitude: Double,
        altitude: Int? = nil,
        type: WaypointType = .airport
    ) {
        self.id = id
        self.identifier = identifier
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.type = type
    }
}

// MARK: - Weather Cache

struct WeatherCache: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    var stationID: String                // ICAO (e.g., "KPAO")
    var rawMETAR: String?                // Raw METAR text
    var rawTAF: String?                  // Raw TAF text
    var temperature: Double?             // Celsius
    var dewpoint: Double?                // Celsius
    var windDirection: Int?              // degrees true
    var windSpeed: Int?                  // knots
    var windGust: Int?                   // knots
    var visibility: String?              // statute miles (string to handle "10+" etc.)
    var ceiling: Int?                    // feet AGL
    var flightCategory: FlightCategory
    var observationTime: Date?           // When observation was taken
    var fetchedAt: Date                  // When data was retrieved

    /// Age of the weather data in seconds since fetch.
    nonisolated var age: TimeInterval {
        Date().timeIntervalSince(fetchedAt)
    }

    /// Whether data is considered stale (> 60 minutes from fetch).
    nonisolated var isStale: Bool {
        age > 3600  // 60 minutes
    }

    nonisolated init(
        id: UUID = UUID(),
        stationID: String,
        rawMETAR: String? = nil,
        rawTAF: String? = nil,
        temperature: Double? = nil,
        dewpoint: Double? = nil,
        windDirection: Int? = nil,
        windSpeed: Int? = nil,
        windGust: Int? = nil,
        visibility: String? = nil,
        ceiling: Int? = nil,
        flightCategory: FlightCategory = .vfr,
        observationTime: Date? = nil,
        fetchedAt: Date = Date()
    ) {
        self.id = id
        self.stationID = stationID
        self.rawMETAR = rawMETAR
        self.rawTAF = rawTAF
        self.temperature = temperature
        self.dewpoint = dewpoint
        self.windDirection = windDirection
        self.windSpeed = windSpeed
        self.windGust = windGust
        self.visibility = visibility
        self.ceiling = ceiling
        self.flightCategory = flightCategory
        self.observationTime = observationTime
        self.fetchedAt = fetchedAt
    }
}

// MARK: - Chart Region

struct ChartRegion: Identifiable, Codable, Equatable, Sendable {
    let id: String                       // e.g., "San_Francisco"
    let name: String                     // "San Francisco"
    let effectiveDate: Date
    let expirationDate: Date
    let boundingBox: BoundingBox
    let fileSizeMB: Double               // mbtiles file size
    var isDownloaded: Bool
    var localPath: URL?

    var isExpired: Bool {
        expirationDate < Date()
    }

    nonisolated init(
        id: String,
        name: String,
        effectiveDate: Date,
        expirationDate: Date,
        boundingBox: BoundingBox,
        fileSizeMB: Double,
        isDownloaded: Bool = false,
        localPath: URL? = nil
    ) {
        self.id = id
        self.name = name
        self.effectiveDate = effectiveDate
        self.expirationDate = expirationDate
        self.boundingBox = boundingBox
        self.fileSizeMB = fileSizeMB
        self.isDownloaded = isDownloaded
        self.localPath = localPath
    }
}
