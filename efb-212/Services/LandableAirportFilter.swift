//
//  LandableAirportFilter.swift
//  efb-212
//
//  Decides which airports a fixed-wing pilot can actually land at. The nearest-airport
//  HUD and list use this so an emergency never points at a hospital helipad or a
//  seaplane base (design finding F1).
//
//  Pure, nonisolated logic so it can be unit tested off the main actor.
//

import Foundation

nonisolated enum LandableAirportFilter {

    /// Minimum usable runway length when the aircraft profile has no field for it.
    /// Covers typical light single-engine piston landing distances with margin.
    static let defaultMinimumRunwayLengthFeet: Int = 1_500   // feet

    /// Surfaces a wheeled light aircraft can use. Gravel, dirt, water and unknown are excluded.
    static let landableSurfaces: Set<SurfaceType> = [.asphalt, .concrete, .turf]

    /// Airport types that can never take a fixed-wing landing.
    static let excludedTypes: Set<AirportType> = [.heliport, .seaplane]

    /// True when the airport is a fixed-wing field with at least one runway that has a
    /// landable surface and is at least `minimumRunwayLengthFeet` long.
    static func isLandable(
        _ airport: Airport,
        minimumRunwayLengthFeet: Int = defaultMinimumRunwayLengthFeet
    ) -> Bool {
        guard !excludedTypes.contains(airport.type) else { return false }
        return airport.runways.contains { runway in
            landableSurfaces.contains(runway.surface) && runway.length >= minimumRunwayLengthFeet
        }
    }

    /// Filter to landable airports, preserving order.
    static func landable(
        _ airports: [Airport],
        minimumRunwayLengthFeet: Int = defaultMinimumRunwayLengthFeet
    ) -> [Airport] {
        airports.filter { isLandable($0, minimumRunwayLengthFeet: minimumRunwayLengthFeet) }
    }

    /// The longest runway with a landable surface, or the longest runway of any kind if none
    /// qualify (so the UI can still show why a field was excluded).
    static func longestRunway(_ airport: Airport) -> Runway? {
        let usable = airport.runways.filter { landableSurfaces.contains($0.surface) }
        let pool = usable.isEmpty ? airport.runways : usable
        return pool.max { $0.length < $1.length }
    }

    /// Private-use fields need prior permission; flag them so the pilot knows.
    /// Note: the bundled database currently records every airport as public.
    static func isPrivateUse(_ airport: Airport) -> Bool {
        airport.ownership == .privateOwned
    }
}

// MARK: - Surface abbreviations

extension SurfaceType {
    /// Standard FAA chart-supplement abbreviation.
    nonisolated var abbreviation: String {
        switch self {
        case .asphalt: return "ASPH"
        case .concrete: return "CONC"
        case .turf: return "TURF"
        case .gravel: return "GRVL"
        case .dirt: return "DIRT"
        case .water: return "WATER"
        case .other: return "OTHER"
        }
    }
}
