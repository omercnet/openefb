//
//  Types.swift
//  efb-212
//
//  Shared enums and lightweight types used across the app.
//  All types are Sendable for safe use across concurrency domains.
//

import Foundation
import CoreLocation

// MARK: - Navigation

/// Tab bar: Map / Flights / Settings. Logbook lives in Flights (History / Logbook / Plans) and
/// Aircraft & Pilot under Settings (T22, efb-77r.22/.23).
nonisolated enum AppTab: String, CaseIterable, Sendable {
    case map, flights, settings

    var title: String {
        switch self {
        case .map: return "Map"
        case .flights: return "Flights"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .map: return "map"
        case .flights: return "airplane"
        case .settings: return "gear"
        }
    }
}

enum MapMode: String, CaseIterable, Sendable {
    case northUp    // Map always oriented north
    case trackUp    // Map rotates to heading
}

/// Map visual style — distinct from MapMode (north-up/track-up orientation).
/// Controls the base map layer rendering.
enum MapStyle: String, CaseIterable, Sendable {
    case vfrSectional   // FAA VFR sectional chart raster overlay
    case street         // Street map base layer
}

enum MapLayer: String, CaseIterable, Sendable {
    case sectional      // VFR sectional chart overlay
    case airports       // Airport dots/icons
    case airspace       // Airspace boundaries
    case tfrs           // TFRs
    case advisories     // AIRMET / SIGMET / G-AIRMET areas
    case weatherDots    // Color-coded weather dots
    case navaids        // VOR/NDB icons
    case route          // Active flight plan route line
    case ownship        // Own aircraft position
    // Israel CVFR chart (IL-3)
    case cvfrRoutes     // Route segments + altitude labels
    case cvfrPoints     // Reporting points
    case cvfrAirspace   // CTR/ATZ/TMA and P/R/D
    case cvfrRunways    // Runway lines
    case cvfrClosures   // NOTAM route closures
    // Israel sport-aviation (LSA) routes, drawn by `IsraelLSAOverlay`
    case lsaRoutes      // LSA route lines and points

    /// The Israel CVFR chart layers (drawn by `IsraelChartOverlay`, not by `MapService`).
    static let cvfrChart: [MapLayer] = [.cvfrRoutes, .cvfrPoints, .cvfrAirspace, .cvfrRunways, .cvfrClosures]
    var isCVFRChart: Bool { Self.cvfrChart.contains(self) }
}

// MARK: - Power

enum PowerState: String, CaseIterable, Sendable {
    case normal           // Full functionality
    case batteryConscious // < 20% -- reduce non-essential services
    case emergency        // < 10% -- minimum viable operation

    var gpsUpdateInterval: TimeInterval {
        switch self {
        case .normal: return 1.0              // 1 Hz
        case .batteryConscious: return 3.0    // 0.33 Hz
        case .emergency: return 5.0           // 0.2 Hz
        }
    }

    var mapTargetFPS: Int {
        switch self {
        case .normal: return 60
        case .batteryConscious: return 30
        case .emergency: return 15
        }
    }

    var weatherRefreshInterval: TimeInterval {
        switch self {
        case .normal: return 900              // 15 minutes
        case .batteryConscious: return 1800   // 30 minutes
        case .emergency: return .infinity     // No refresh
        }
    }
}

// MARK: - Aviation Enums

enum AirportType: String, Codable, CaseIterable, Sendable {
    case airport
    case heliport
    case seaplane
    case ultralight
}

enum OwnershipType: String, Codable, CaseIterable, Sendable {
    case publicOwned = "public"
    case privateOwned = "private"
    case military
}

enum SurfaceType: String, Codable, CaseIterable, Sendable {
    case asphalt
    case concrete
    case turf
    case gravel
    case water
    case dirt
    case other
}

enum LightingType: String, Codable, CaseIterable, Sendable {
    case none
    case partTime
    case fullTime
}

/// Raw values match the `frequencies.type` column written by tools/nasr-importer.
enum FrequencyType: String, Codable, CaseIterable, Sendable {
    case ctaf
    case tower
    case ground
    case clearance
    case approach
    case departure
    case atis
    case awos
    case asos
    case unicom
    case multicom
    case center         // ARTCC
    case fss            // Flight Service Station / RCO
    case other
}

/// Raw values match the `navaids.type` column written by tools/nasr-importer.
enum NavaidType: String, Codable, CaseIterable, Sendable {
    case vor
    case vortac
    case vorDme = "vor_dme"
    case tacan
    case dme
    case ndb
    case ndbDme = "ndb_dme"
}

/// Raw values are the FAA TFR `LEGAL` / list `type` strings from tfr.faa.gov.
nonisolated enum TFRType: String, Codable, CaseIterable, Sendable {
    case security = "SECURITY"                       // 14 CFR 99.7 national security
    case vip = "VIP"                                 // 14 CFR 91.141 presidential/VIP movement
    case hazard = "HAZARDS"                          // 14 CFR 91.137 firefighting, disaster, etc.
    case airShowSports = "AIR SHOWS/SPORTS"          // 14 CFR 91.145 air shows, stadium events
    case spaceOperations = "SPACE OPERATIONS"        // 14 CFR 91.143 space launch/recovery
    case uasPublicGathering = "UAS PUBLIC GATHERING" // 49 USC 44812 drone restrictions
    case special = "SPECIAL"                         // Special security instructions
    case other = "OTHER"                             // Unrecognized FAA category

    /// Map an FAA category string; unknown values become `.other`.
    init(faaType: String) {
        let normalized = faaType.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        self = TFRType(rawValue: normalized) ?? .other
    }

    var displayName: String {
        switch self {
        case .security: return "Security"
        case .vip: return "VIP"
        case .hazard: return "Hazards"
        case .airShowSports: return "Air Show / Sports"
        case .spaceOperations: return "Space Operations"
        case .uasPublicGathering: return "UAS Public Gathering"
        case .special: return "Special"
        case .other: return "Other"
        }
    }
}

enum AirspaceClass: String, Codable, CaseIterable, Sendable {
    case bravo
    case charlie
    case delta
    case echo
    case golf
    case prohibited
    case restricted
    case moa
    case alert
    case warning
    case tfr
}

nonisolated enum FlightCategory: String, Codable, CaseIterable, Sendable {
    case vfr      // Ceiling > 3000 AGL AND visibility > 5 SM
    case mvfr     // Ceiling 1000-3000 AGL OR visibility 3-5 SM
    case ifr      // Ceiling 500-999 AGL OR visibility 1-3 SM
    case lifr     // Ceiling < 500 AGL OR visibility < 1 SM

    var colorName: String {
        switch self {
        case .vfr: return "green"
        case .mvfr: return "blue"
        case .ifr: return "red"
        case .lifr: return "magenta"
        }
    }
}

enum WaypointType: String, Codable, CaseIterable, Sendable {
    case airport
    case navaid
    case fix
    case userWaypoint
    case latLon
}

// MARK: - Error Severity

nonisolated enum ErrorSeverity: Sendable {
    case critical   // Red banner, persistent until resolved
    case error      // Red toast, auto-dismiss after 5s
    case warning    // Yellow toast, auto-dismiss after 3s
    case info       // Blue toast, auto-dismiss after 2s
}

// MARK: - Lightweight Structs

nonisolated struct WindInfo: Codable, Equatable, Sendable {
    let direction: Int       // degrees true (0 = variable)
    let speed: Int           // knots
    let gusts: Int?          // knots (nil if no gusts)
    let isVariable: Bool
}

nonisolated struct BoundingBox: Codable, Equatable, Sendable {
    let minLatitude: Double
    let maxLatitude: Double
    let minLongitude: Double
    let maxLongitude: Double

    func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.latitude >= minLatitude &&
        coordinate.latitude <= maxLatitude &&
        coordinate.longitude >= minLongitude &&
        coordinate.longitude <= maxLongitude
    }
}

nonisolated struct VSpeeds: Codable, Equatable, Sendable {
    var vr: Int?     // Rotation speed -- knots
    var vx: Int?     // Best angle of climb -- knots
    var vy: Int?     // Best rate of climb -- knots
    var va: Int?     // Maneuvering speed -- knots
    var vne: Int?    // Never exceed -- knots
    var vfe: Int?    // Max flap extended -- knots
    var vs0: Int?    // Stall speed landing config -- knots
    var vs1: Int?    // Stall speed clean -- knots
}

enum MedicalClass: String, Codable, CaseIterable, Sendable {
    case first
    case second
    case third
    case basicMed
}

enum CertificateType: String, Codable, CaseIterable, Sendable {
    case student
    case sport
    case recreational
    case privatePilot = "private"
    case commercial
    case atp
}

/// Currency status for FAR 61.23 (medical), 61.56 (flight review), 61.57 (night).
enum CurrencyStatus: String, Codable, CaseIterable, Sendable {
    case current    // green: > 30 days remaining
    case warning    // yellow: <= 30 days remaining
    case expired    // red: past expiration
}

// MARK: - Recording Types

/// Recording lifecycle state.
nonisolated enum RecordingStatus: Equatable, Sendable {
    case idle
    case countdown(remaining: Int)   // auto-start 3-second countdown
    case recording
    case paused
    case stopping
}

/// Flight phase detected by speed + altitude state machine.
/// Raw String values for GRDB storage.
enum FlightPhaseType: String, Codable, CaseIterable, Sendable {
    case preflight
    case taxi
    case takeoff
    case departure
    case cruise
    case approach
    case landing
    case postflight
}

/// Audio recording quality profile per user decision D-01 (two profiles, Standard default).
nonisolated enum AudioQualityProfile: String, Codable, CaseIterable, Sendable {
    case standard   // 16kHz, 32kbps AAC (~14 MB/hr)
    case high       // 22kHz, 64kbps AAC (~28 MB/hr)

    var sampleRate: Double {
        switch self {
        case .standard: return 16_000
        case .high: return 22_050
        }
    }

    var bitRate: Int {
        switch self {
        case .standard: return 32_000
        case .high: return 64_000
        }
    }

    var estimatedMBPerHour: Double {
        switch self {
        case .standard: return 14
        case .high: return 28
        }
    }
}

/// Reason for a gap in the audio recording (interruption).
enum InterruptionGapReason: Codable, Sendable, Equatable {
    case phoneCall
    case siri
    case headphoneDisconnect
    case other(String)
}

// MARK: - Airspace Geometry

nonisolated enum AirspaceGeometry: Codable, Equatable, Sendable {
    case polygon(coordinates: [[Double]])  // Array of [lat, lon] pairs
    case circle(center: [Double], radiusNM: Double)  // [lat, lon], radius in NM

    // Explicit nonisolated Codable to avoid MainActor isolation warnings in GRDB context
    nonisolated init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let coordinates = try container.decodeIfPresent([[Double]].self, forKey: .coordinates) {
            self = .polygon(coordinates: coordinates)
        } else if let center = try container.decodeIfPresent([Double].self, forKey: .center),
                  let radiusNM = try container.decodeIfPresent(Double.self, forKey: .radiusNM) {
            self = .circle(center: center, radiusNM: radiusNM)
        } else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Invalid AirspaceGeometry")
            )
        }
    }

    nonisolated func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .polygon(let coordinates):
            try container.encode(coordinates, forKey: .coordinates)
        case .circle(let center, let radiusNM):
            try container.encode(center, forKey: .center)
            try container.encode(radiusNM, forKey: .radiusNM)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case coordinates, center, radiusNM
    }
}
