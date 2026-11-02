//
//  IsraelAviationModels.swift
//  efb-212
//
//  Value types read from the bundled israel-aviation.sqlite (built by tools/caai-importer from the
//  CAAI GIS layers). Units: degrees WGS-84, feet MSL, nautical miles, metres where named.
//  Pure, nonisolated, Sendable.
//

import Foundation
import CoreLocation

// MARK: - Bounds

/// A latitude/longitude box for spatial queries (degrees, WGS-84).
nonisolated struct IsraelGeoBounds: Equatable, Sendable {
    let minLatitude: Double   // degrees
    let maxLatitude: Double   // degrees
    let minLongitude: Double  // degrees
    let maxLongitude: Double  // degrees

    /// Everything the database covers: Israel and its FIR with a margin.
    static let wholeCountry = IsraelGeoBounds(minLatitude: 28.0, maxLatitude: 34.5, minLongitude: 33.5, maxLongitude: 36.5)

    /// The box around `center` that contains a circle of `radiusNM`.
    init(center: CLLocationCoordinate2D, radiusNM: Double) {
        let latDelta = radiusNM / 60.0  // 1 degree of latitude = 60 NM
        let cosLat = max(cos(center.latitude * .pi / 180.0), 0.01)
        let lonDelta = radiusNM / (60.0 * cosLat)
        self.init(
            minLatitude: center.latitude - latDelta, maxLatitude: center.latitude + latDelta,
            minLongitude: center.longitude - lonDelta, maxLongitude: center.longitude + lonDelta
        )
    }

    init(minLatitude: Double, maxLatitude: Double, minLongitude: Double, maxLongitude: Double) {
        self.minLatitude = minLatitude
        self.maxLatitude = maxLatitude
        self.minLongitude = minLongitude
        self.maxLongitude = maxLongitude
    }
}

// MARK: - Reporting points

nonisolated enum IsraelPointKind: String, Sendable {
    case compulsory
    case onRequest
    case arp          // aerodrome reference point
}

nonisolated struct IsraelReportingPoint: Identifiable, Hashable, Sendable {
    let id: Int
    /// Five-letter point code ("TAVOR") or four-letter aerodrome ICAO ("LLHZ"). Not unique: the source
    /// publishes "LLNV" for two ARPs (Nevatim and Negav).
    let code: String
    let nameEnglish: String?
    let nameHebrew: String?
    let kind: IsraelPointKind
    let latitude: Double    // degrees
    let longitude: Double   // degrees

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

// MARK: - Route segments

/// The altitude CAAI publishes for one direction of a segment.
nonisolated struct IsraelRouteAltitude: Hashable, Sendable {
    /// The published value verbatim ("3500", or "2500/3500" where it changes along the leg).
    let published: String
    /// Feet MSL (flown on the controlling unit's QNH). nil when the published value is two numbers:
    /// don't pick one, show `published`.
    let feet: Int?
}

nonisolated struct IsraelRouteSegment: Identifiable, Hashable, Sendable {
    let id: Int
    /// Code order as published; the polyline and bearings run from -> to.
    let fromCode: String
    let toCode: String
    let fromPointID: Int
    let toPointID: Int
    let nameEnglish: String?
    let nameHebrew: String?
    let lengthNM: Double?        // nautical miles
    let isCivil: Bool
    let isMilitary: Bool         // blue route: civil use only with IAF approval
    let isByRequest: Bool        // dashed route: real-time ATC approval needed
    let bearingTrue: Double      // degrees true, from -> to
    /// Altitude when flying from -> to; nil when CAAI publishes none for that direction.
    let altitudeForward: IsraelRouteAltitude?
    /// Altitude when flying to -> from; nil when CAAI publishes none for that direction.
    let altitudeReverse: IsraelRouteAltitude?
    let lowerAltitudeFeet: Int?  // feet MSL
    let mapSheet: String?        // "N", "S", "N/S"
    let polyline: [CLLocationCoordinate2D]

    /// Identity is the database row: two segments are equal when they are the same row.
    static func == (lhs: IsraelRouteSegment, rhs: IsraelRouteSegment) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Published altitude for travelling `fromCode` -> `toCode` (`forward`) or back.
    func altitude(forward: Bool) -> IsraelRouteAltitude? { forward ? altitudeForward : altitudeReverse }
}

// MARK: - Airspace

nonisolated enum IsraelAirspaceKind: String, Sendable, CaseIterable {
    case ctr = "CTR"
    case atz = "ATZ"
    case cta = "CTA"
    case tma = "TMA"
    case prohibited = "P"
    case restricted = "R"
    case danger = "D"
    case fir = "FIR"
}

nonisolated enum IsraelAirspaceAuthority: String, Sendable {
    case civil
    case military
}

nonisolated enum IsraelAltitudeReference: String, Sendable {
    case surface = "SFC"
    case msl = "MSL"
    case agl = "AGL"
    case flightLevel = "FL"
    case unlimited = "UNL"
}

/// One vertical limit of an airspace.
nonisolated struct IsraelAirspaceLimit: Hashable, Sendable {
    /// Feet; nil when the layer publishes no value (treated as "may apply": see `containsAltitude`).
    let feet: Int?
    let reference: IsraelAltitudeReference?
    /// Verbatim when the layer publishes two numbers ("3000/3500"); `feet` then holds the larger volume
    /// (lowest floor, highest ceiling).
    let publishedText: String?
}

nonisolated struct IsraelAirspace: Identifiable, Hashable, Sendable {
    let id: Int
    let kind: IsraelAirspaceKind
    let code: String?            // "LLHA", "LLP07", "LLBG" (TMA label prefix)
    let nameEnglish: String?
    let nameHebrew: String?
    let label: String?           // TMA chart label, e.g. "LLBG TMA 2 500 - 8 000"
    let authority: IsraelAirspaceAuthority?
    let floor: IsraelAirspaceLimit
    let ceiling: IsraelAirspaceLimit
    /// polygons[polygon][ring][vertex]; ring 0 is the outer boundary, further rings are holes.
    let polygons: [[[CLLocationCoordinate2D]]]

    static func == (lhs: IsraelAirspace, rhs: IsraelAirspace) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Whether the point is inside the lateral boundary (holes excluded).
    func containsLaterally(_ point: CLLocationCoordinate2D) -> Bool {
        polygons.contains { rings in
            guard let outer = rings.first, Self.ring(outer, contains: point) else { return false }
            return !rings.dropFirst().contains { Self.ring($0, contains: point) }
        }
    }

    /// Whether `feetMSL` lies between floor and ceiling, limits inclusive. Surface floors and unlimited
    /// ceilings always match. A limit that is unpublished, or whose reference (AGL, FL) can't be
    /// compared with an MSL altitude, counts as matching: the airspace is never reported smaller
    /// than the data allows.
    func containsAltitude(feetMSL: Double) -> Bool {
        if let floorFeet = floor.feet, floor.reference == .msl, feetMSL < Double(floorFeet) { return false }
        if let ceilingFeet = ceiling.feet, ceiling.reference == .msl, feetMSL > Double(ceilingFeet) { return false }
        return true
    }

    /// Even-odd ray cast on a [lat, lon] ring.
    private static func ring(_ ring: [CLLocationCoordinate2D], contains point: CLLocationCoordinate2D) -> Bool {
        guard ring.count >= 3 else { return false }
        var inside = false
        var j = ring.count - 1
        for i in 0..<ring.count {
            let a = ring[i], b = ring[j]
            if (a.latitude > point.latitude) != (b.latitude > point.latitude) {
                let crossLon = (b.longitude - a.longitude) * (point.latitude - a.latitude) / (b.latitude - a.latitude) + a.longitude
                if point.longitude < crossLon { inside.toggle() }
            }
            j = i
        }
        return inside
    }
}

// MARK: - Runways

nonisolated struct IsraelRunway: Identifiable, Hashable, Sendable {
    let id: Int
    let aerodrome: String?       // ICAO; nil for rows CAAI publishes without an aerodrome code
    let nameEnglish: String?
    let nameHebrew: String?
    let designatorA: String?     // "08"; nil where the layer has none
    let designatorB: String?     // "26"
    let headingA: Double?        // degrees, as published
    let headingB: Double?        // degrees, as published
    let lengthMetres: Int?       // metres
    let widthMetres: Int?        // metres
    let surface: String?         // CAAI text (Hebrew)
    let endA: CLLocationCoordinate2D
    let endB: CLLocationCoordinate2D

    static func == (lhs: IsraelRunway, rhs: IsraelRunway) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Aerodromes (IL-4)

/// Curated aerodromes: airports, airstrips and heliports from the domestic AIP, the eAIP and the CAAI GIS
/// layers (tools/caai-importer/curated/aerodromes-il.csv). Every group of values names its source and the
/// whole row stays `unreviewed` until the owner has checked it against the AIP.

nonisolated enum IsraelAerodromeType: String, Sendable {
    case airport, airstrip, heliport
}

nonisolated enum IsraelAerodromeUse: String, Sendable {
    case civil
    case military       // IAF base: emergency use only
    case uas            // unmanned-aircraft strip: not for manned landings without CAAI approval
    case agricultural   // crop-spraying strip run by an operator
    case hospital       // hospital helipad
    case foreign        // outside Israel, drawn for orientation only
    case ultralight     // ultralight (מז"ם / אז"ם) strip: not for conventional GA aircraft
}

/// Prior-permission-required status as the AIP states it. `unknown` = the AIP says nothing general.
nonisolated enum IsraelPPR: String, Sendable {
    case yes, no, unknown
}

nonisolated enum IsraelAerodromeReviewStatus: String, Sendable {
    case unreviewed, reviewed
}

/// Where each group of values came from, e.g. "AIP 1/26 ch.ה p293,294".
nonisolated struct IsraelAerodromeSources: Hashable, Sendable {
    let identity: String
    let runways: String?
    let frequencies: String?
    let circuit: String?
    let hours: String?
    let remarks: String?
}

nonisolated struct IsraelAerodromeRunway: Identifiable, Hashable, Sendable {
    let id: Int
    let designator: String      // "10/28"; "?" when the AIP gives none
    let lengthMetres: Double    // metres
    let widthMetres: Double     // metres
    let surface: String         // asphalt, concrete, dirt, gravel, grass, unknown
    let headingA: Double?       // degrees, as published
    let headingB: Double?       // degrees, as published
    let headingIsTrue: Bool?    // true = true heading, false = magnetic, nil = no heading published

    var lengthFeet: Int { Int((lengthMetres * 3.28084).rounded()) }   // feet
    var widthFeet: Int { Int((widthMetres * 3.28084).rounded()) }     // feet
}

nonisolated struct IsraelAerodromeFrequency: Identifiable, Hashable, Sendable {
    let id: Int
    let mhz: String             // "122.200", as published
    let service: String         // "TWR primary"
    let callsignHebrew: String?

    var megahertz: Double? { Double(mhz) }
}

nonisolated struct IsraelAerodrome: Identifiable, Hashable, Sendable {
    let id: Int
    let code: String            // ICAO where one exists, else a short slug
    let nameHebrew: String
    let nameEnglish: String
    let type: IsraelAerodromeType
    let use: IsraelAerodromeUse
    let latitude: Double        // degrees, WGS-84
    let longitude: Double       // degrees, WGS-84
    let elevationFeet: Int?     // feet MSL, negative below sea level
    let circuitAltitudeFeet: Int?   // feet MSL (QNH)
    let circuitDirection: String?
    let hours: String?
    let ppr: IsraelPPR
    let pprText: String?
    let remarks: String?
    let sources: IsraelAerodromeSources
    /// Field groups the curator was unsure about: identity, runways, frequencies, circuit, hours, elevation_ft.
    let uncertainGroups: [String]
    let notes: String?
    let reviewStatus: IsraelAerodromeReviewStatus
    let runways: [IsraelAerodromeRunway]
    let frequencies: [IsraelAerodromeFrequency]

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
    var isReviewed: Bool { reviewStatus == .reviewed }

    static func == (lhs: IsraelAerodrome, rhs: IsraelAerodrome) -> Bool { lhs.code == rhs.code }
    func hash(into hasher: inout Hasher) { hasher.combine(code) }
}

// MARK: - Metadata

nonisolated struct IsraelAviationMetadata: Equatable, Sendable {
    let schemaVersion: Int
    let source: String
    let sourceURLs: [String]
    let aipAmendment: String?     // nil unless the importer was told the amendment: never guessed
    let effectiveDate: String?    // YYYY-MM-DD, only with a known amendment
    let sourceDataDate: String    // YYYY-MM-DD, newest timestamp in the CAAI download
    let downloadDate: String      // YYYY-MM-DD
    let dataLastModified: String  // YYYY-MM-DD, newest Modified date in the CAAI layers
    let importDate: String        // YYYY-MM-DD
    /// Line for Settings > About: "Aeronautical data: Civil Aviation Authority of Israel (CAAI), data of 25 Oct 2026",
    /// with ", AIP amendment N" appended only when the amendment is known.
    let attribution: String
}
