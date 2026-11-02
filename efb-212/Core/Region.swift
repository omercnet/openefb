//
//  Region.swift
//  efb-212
//
//  Operating region (IL-2). Every data source used to assume the US; the app now reads the
//  region's configuration (map home, altimeter unit, weather stations, which data layers
//  exist) instead of hard-coding FAA/NOAA sources. Persisted in UserSettings; a fresh install
//  starts in Israel (IL-DEFAULT); a stored choice is never overridden.
//

import Foundation
import CoreLocation

/// Altimeter setting unit shown in decoded weather.
nonisolated enum AltimeterUnit: String, Sendable {
    case inHg   // inches of mercury (US: "A3002" → 30.02 inHg)
    case hPa    // hectopascals (ICAO: "Q1017" → 1017 hPa)
}

/// Data products that exist only for some regions. Anything not listed here (base street map,
/// ownship, route, METAR/TAF) is available everywhere.
nonisolated enum RegionDataLayer: String, CaseIterable, Sendable {
    case sectional        // FAA VFR sectional raster
    case airports         // NASR airports: map dots, search, NRST
    case airspace         // NASR airspace
    case navaids          // NASR navaids
    case tfrs             // FAA TFRs
    case advisories       // NOAA AIRMET/SIGMET
    case notams           // FAA NOTAM API
    case airportCharts    // FAA d-TPP charts and diagram PDFs
    case airportDiagrams  // georeferenced FAA diagram overlay
    case pireps           // NOAA PIREPs
    case windsAloft       // NOAA winds aloft
    // Israel CVFR chart (IL-3), drawn from the bundled CAAI data
    case cvfrRoutes       // route segments with altitudes per direction
    case cvfrPoints       // reporting points and aerodrome reference points
    case cvfrAirspace     // CTR/ATZ/CTA/TMA and P/R/D
    case cvfrRunways      // runway lines
    case cvfrClosures     // NOTAM route closures (only while the feed is fresh)
    // Israel aerodromes (IL-4), curated from the AIP: search, NRST and the airport sheet (no map dots: IL-3 draws them)
    case aerodromes
    // Israel aerodrome diagrams (IL-13): CAAI diagrams from the downloaded il-diagrams pack, drawn by the diagram overlay
    case israelDiagrams

    /// The Israel CVFR chart layers: no US source, so the US keeps none of them.
    static let cvfrChart: Set<RegionDataLayer> = [.cvfrRoutes, .cvfrPoints, .cvfrAirspace, .cvfrRunways, .cvfrClosures]

    /// Everything only Israel has: the CVFR chart and the curated aerodromes.
    static let israelOnly: Set<RegionDataLayer> = cvfrChart.union([.aerodromes, .israelDiagrams])
}

/// A METAR/TAF station the region lists explicitly (used where the airport database has no
/// entry for it, e.g. Israel before IL-4).
nonisolated struct WeatherStation: Hashable, Sendable {
    let id: String                      // ICAO
    let name: String
    let latitude: Double                // degrees
    let longitude: Double               // degrees
    let hasMETAR: Bool
    let hasTAF: Bool

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

nonisolated enum Region: String, Codable, CaseIterable, Sendable, Identifiable {
    case us
    case israel

    /// Rough bounding box of the region's airspace (degrees). nil = no bound (US: the app's
    /// original behaviour follows the aircraft anywhere).
    private var bounds: (south: Double, north: Double, west: Double, east: Double)? {
        switch self {
        case .us: return nil
        case .israel: return (south: 29.0, north: 33.6, west: 33.8, east: 36.2)
        }
    }

    /// Whether a position is inside the region. Used to keep a GPS fix from another continent
    /// from pulling the map away from the region's home view.
    func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
        guard let b = bounds else { return true }
        return coordinate.latitude >= b.south && coordinate.latitude <= b.north
            && coordinate.longitude >= b.west && coordinate.longitude <= b.east
    }

    var id: String { rawValue }

    /// The region a fresh install starts in (IL-DEFAULT: Israel). A stored choice always wins;
    /// this only applies when no settings record was ever written.
    static let defaultRegion: Region = .israel

    var displayName: String {
        switch self {
        case .us: return "United States"
        case .israel: return "Israel"
        }
    }

    /// Where the map opens before the first GPS fix.
    var defaultCenter: CLLocationCoordinate2D {
        switch self {
        case .us: return CLLocationCoordinate2D(latitude: 39.0, longitude: -98.0)   // CONUS
        case .israel: return CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9) // whole country
        }
    }

    var defaultZoom: Double {
        switch self {
        case .us: return 5.0
        case .israel: return 6.7
        }
    }

    var altimeterUnit: AltimeterUnit {
        switch self {
        case .us: return .inHg
        case .israel: return .hPa
        }
    }

    /// Stations aviationweather.gov serves for the region. Empty for the US: stations there
    /// come from the airport database (every airport is a candidate).
    var weatherStations: [WeatherStation] {
        switch self {
        case .us:
            return []
        case .israel:
            // Verified against aviationweather.gov (docs/research/israel-cvfr.md): METAR for
            // LLBG, LLHA, LLER, LLIB; TAF for those plus LLHZ. Coordinates from the API.
            return [
                WeatherStation(id: "LLBG", name: "Tel Aviv / Ben Gurion", latitude: 32.011, longitude: 34.887, hasMETAR: true, hasTAF: true),
                WeatherStation(id: "LLHA", name: "Haifa", latitude: 32.809, longitude: 35.043, hasMETAR: true, hasTAF: true),
                WeatherStation(id: "LLER", name: "Eilat / Ramon", latitude: 29.722, longitude: 35.012, hasMETAR: true, hasTAF: true),
                WeatherStation(id: "LLIB", name: "Rosh Pina", latitude: 32.981, longitude: 35.572, hasMETAR: true, hasTAF: true),
                WeatherStation(id: "LLHZ", name: "Herzliya", latitude: 32.181, longitude: 34.835, hasMETAR: false, hasTAF: true)
            ]
        }
    }

    /// ICAO ids with a METAR, in request order.
    var metarStationIDs: [String] { weatherStations.filter(\.hasMETAR).map(\.id) }

    /// ICAO ids with a TAF, in request order.
    var tafStationIDs: [String] { weatherStations.filter(\.hasTAF).map(\.id) }

    func weatherStation(id: String) -> WeatherStation? {
        weatherStations.first { $0.id == id.uppercased() }
    }

    /// Data products with a source in this region.
    var availableLayers: Set<RegionDataLayer> {
        switch self {
        case .us:
            return Set(RegionDataLayer.allCases).subtracting(RegionDataLayer.israelOnly)
        case .israel:
            // The CVFR chart (IL-3) and the curated aerodromes (IL-4). The US sources are not
            // available: they can't produce data here and must never be shown as empty-but-current.
            return RegionDataLayer.israelOnly
        }
    }

    func isAvailable(_ layer: RegionDataLayer) -> Bool {
        availableLayers.contains(layer)
    }

    /// Map layers that cannot be drawn here (shown disabled in the layer panel).
    func supports(_ layer: MapLayer) -> Bool {
        switch layer {
        case .sectional: return isAvailable(.sectional)
        case .airports: return isAvailable(.airports)
        case .airspace: return isAvailable(.airspace)
        case .tfrs: return isAvailable(.tfrs)
        case .advisories: return isAvailable(.advisories)
        case .navaids: return isAvailable(.navaids)
        case .cvfrRoutes: return isAvailable(.cvfrRoutes)
        case .cvfrPoints: return isAvailable(.cvfrPoints)
        case .cvfrAirspace: return isAvailable(.cvfrAirspace)
        case .cvfrRunways: return isAvailable(.cvfrRunways)
        case .cvfrClosures: return isAvailable(.cvfrClosures)
        case .lsaRoutes: return isAvailable(.cvfrRoutes)  // the LSA network ships in the same Israel database
        case .weatherDots, .route, .ownship: return true
        }
    }

    /// Plain-words reason shown next to a disabled layer.
    var unavailableReason: String {
        "Not available in \(displayName) yet"
    }

    /// Whether the airport database covers this region (search, NRST, airport sheet).
    var hasAirportData: Bool { isAvailable(.airports) || isAvailable(.aerodromes) }

    /// Base map styles that make sense here. The FAA sectional is a separate layer.
    var availableMapStyles: [MapStyle] {
        switch self {
        case .us: return [.street, .satellite, .terrain]
        case .israel: return [.street]
        }
    }

    /// Attribution shown in Settings > About when the data source has no metadata of its own.
    var fallbackDataAttribution: String {
        switch self {
        case .us: return "Aeronautical data: FAA NASR. Weather: NOAA Aviation Weather Center."
        case .israel: return "Aeronautical data: Civil Aviation Authority of Israel (CAAI)"
        }
    }

    // MARK: - Altimeter formatting

    /// Format a NOAA `altim` value (always hPa on aviationweather.gov) in the region's unit.
    /// US: "30.02 inHg"; Israel: "1017 hPa".
    func formattedAltimeter(hPa: Double) -> String {
        switch altimeterUnit {
        case .hPa:
            return String(format: "%.0f hPa", hPa)
        case .inHg:
            return String(format: "%.2f inHg", hPa / Self.hPaPerInHg)
        }
    }

    /// 1 inHg = 33.8639 hPa.
    static let hPaPerInHg: Double = 33.8639
}
