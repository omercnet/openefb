//
//  MapQueryRegion.swift
//  efb-212
//
//  Sizes the airport/navaid database query from the visible map bounds instead of a
//  zoom-level formula (design finding F8), and thins the result at low zoom so the map
//  stays fast. Pure, nonisolated logic.
//

import Foundation
import CoreLocation

nonisolated enum MapQueryRegion {

    /// Largest radius we ever ask the database for. Beyond this the whole CONUS is in view.
    static let maxRadiusNM: Double = 500            // nautical miles
    /// Smallest radius, so a very zoomed-in view still finds the field under the aircraft.
    static let minRadiusNM: Double = 5              // nautical miles
    /// Margin added to the visible half-diagonal so airports at the screen edge are included.
    static let marginFactor: Double = 1.10
    /// Most airport features we hand to MapLibre at once.
    static let maxAirportCount: Int = 600
    /// Re-query thresholds: the centre moved this far, or the radius changed this much.
    static let requeryDistanceNM: Double = 5         // nautical miles
    static let requeryRadiusRatio: Double = 0.20     // 20 %

    /// Query radius covering everything on screen: distance from the centre to the farthest
    /// visible corner, plus margin, clamped to [minRadiusNM, maxRadiusNM].
    static func radiusNM(
        center: CLLocationCoordinate2D,
        northEast: CLLocationCoordinate2D,
        southWest: CLLocationCoordinate2D
    ) -> Double {
        let corners = [
            northEast,
            southWest,
            CLLocationCoordinate2D(latitude: northEast.latitude, longitude: southWest.longitude),
            CLLocationCoordinate2D(latitude: southWest.latitude, longitude: northEast.longitude),
        ]
        let farthest = corners.map { haversineNM(from: center, to: $0) }.max() ?? minRadiusNM
        return min(max(farthest * marginFactor, minRadiusNM), maxRadiusNM)
    }

    /// Whether the region changed enough to hit the database again.
    static func shouldRequery(
        lastCenter: CLLocationCoordinate2D?,
        lastRadiusNM: Double?,
        center: CLLocationCoordinate2D,
        radiusNM: Double
    ) -> Bool {
        guard let lastCenter, let lastRadiusNM else { return true }
        if haversineNM(from: lastCenter, to: center) >= requeryDistanceNM { return true }
        let ratio = abs(radiusNM - lastRadiusNM) / max(lastRadiusNM, 0.001)
        return ratio >= requeryRadiusRatio
    }

    /// Keep at most `maxCount` airports. Real airports with ICAO identifiers come first,
    /// then other fixed-wing fields, then heliports and seaplane bases; ties by distance
    /// from the centre. Returns the input untouched when it already fits.
    static func thin(
        _ airports: [Airport],
        around center: CLLocationCoordinate2D,
        maxCount: Int = maxAirportCount
    ) -> [Airport] {
        guard airports.count > maxCount else { return airports }
        let ranked = airports.map { airport -> (rank: Int, distance: Double, airport: Airport) in
            let location = CLLocationCoordinate2D(latitude: airport.latitude, longitude: airport.longitude)
            return (rank: priorityRank(airport), distance: haversineNM(from: center, to: location), airport: airport)
        }
        return ranked
            .sorted { lhs, rhs in
                if lhs.rank != rhs.rank { return lhs.rank < rhs.rank }
                return lhs.distance < rhs.distance
            }
            .prefix(maxCount)
            .map(\.airport)
    }

    /// 0 = ICAO-coded fixed-wing airport, 1 = other fixed-wing field, 2 = heliport/seaplane/ultralight.
    static func priorityRank(_ airport: Airport) -> Int {
        guard airport.type == .airport else { return 2 }
        let isICAO = airport.icao.count == 4 && airport.icao.allSatisfy { $0.isLetter && $0.isUppercase }
        return isICAO ? 0 : 1
    }

    /// Great-circle distance in nautical miles.
    static func haversineNM(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let earthRadiusNM = 3440.065
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusNM * asin(min(1, sqrt(h)))
    }
}
