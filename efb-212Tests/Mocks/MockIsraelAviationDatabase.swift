//
//  MockIsraelAviationDatabase.swift
//  efb-212Tests
//
//  In-memory IsraelAviationDatabaseProtocol for view-model, alert and map tests that need a small,
//  hand-built network instead of the bundled CAAI data.
//

import Foundation
import CoreLocation
@testable import efb_212

nonisolated struct MockIsraelAviationDatabase: IsraelAviationDatabaseProtocol {
    var metadataResult: Result<IsraelAviationMetadata, EFBError> = .failure(.regionDataUnavailable("Israel"))
    var points: [IsraelReportingPoint] = []
    var segments: [IsraelRouteSegment] = []
    var airspaceList: [IsraelAirspace] = []
    var runwayList: [IsraelRunway] = []
    var aerodromeList: [IsraelAerodrome] = []

    func metadata() throws -> IsraelAviationMetadata { try metadataResult.get() }

    func reportingPoint(code: String, network: IsraelRouteNetwork) throws -> IsraelReportingPoint? {
        points.first { $0.network == network && $0.code == code.uppercased() }
    }

    func reportingPoints(in bounds: IsraelGeoBounds, network: IsraelRouteNetwork) throws -> [IsraelReportingPoint] {
        points.filter { $0.network == network && Self.contains(bounds, latitude: $0.latitude, longitude: $0.longitude) }
    }

    func routeSegments(in bounds: IsraelGeoBounds, network: IsraelRouteNetwork) throws -> [IsraelRouteSegment] {
        segments.filter { segment in
            segment.network == network && segment.polyline.contains { Self.contains(bounds, latitude: $0.latitude, longitude: $0.longitude) }
        }
    }

    func routeSegment(from: String, to: String, network: IsraelRouteNetwork) throws -> IsraelRouteSegment? {
        segments.first { $0.network == network && $0.fromCode == from.uppercased() && $0.toCode == to.uppercased() }
    }

    func airspaces(containing coordinate: CLLocationCoordinate2D, altitudeFeetMSL: Double?) throws -> [IsraelAirspace] {
        airspaceList.filter { airspace in
            airspace.containsLaterally(coordinate) && (altitudeFeetMSL.map(airspace.containsAltitude(feetMSL:)) ?? true)
        }
    }

    func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [IsraelAirspace] {
        let bounds = IsraelGeoBounds(center: coordinate, radiusNM: radiusNM)
        return airspaceList.filter { airspace in
            airspace.polygons.joined().joined().contains { Self.contains(bounds, latitude: $0.latitude, longitude: $0.longitude) }
        }
    }

    func airspaces(ofKind kind: IsraelAirspaceKind) throws -> [IsraelAirspace] {
        airspaceList.filter { $0.kind == kind }
    }

    func runways(aerodrome: String) throws -> [IsraelRunway] {
        runwayList.filter { $0.aerodrome == aerodrome.uppercased() }
    }

    func runways(in bounds: IsraelGeoBounds) throws -> [IsraelRunway] {
        runwayList.filter {
            Self.contains(bounds, latitude: $0.endA.latitude, longitude: $0.endA.longitude)
                || Self.contains(bounds, latitude: $0.endB.latitude, longitude: $0.endB.longitude)
        }
    }

    func aerodrome(code: String) throws -> IsraelAerodrome? {
        aerodromeList.first { $0.code == code.uppercased() }
    }

    func aerodromes(in bounds: IsraelGeoBounds) throws -> [IsraelAerodrome] {
        aerodromeList.filter { Self.contains(bounds, latitude: $0.latitude, longitude: $0.longitude) }
    }

    func nearestAerodromes(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [IsraelAerodrome] {
        let here = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return Array(aerodromeList.sorted {
            here.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude))
                < here.distance(from: CLLocation(latitude: $1.latitude, longitude: $1.longitude))
        }.prefix(count))
    }

    func searchAerodromes(query: String, limit: Int) throws -> [IsraelAerodrome] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(aerodromeList.filter {
            $0.code.lowercased().hasPrefix(q) || $0.nameEnglish.lowercased().contains(q) || $0.nameHebrew.contains(q)
        }.prefix(limit))
    }

    private static func contains(_ bounds: IsraelGeoBounds, latitude: Double, longitude: Double) -> Bool {
        latitude >= bounds.minLatitude && latitude <= bounds.maxLatitude
            && longitude >= bounds.minLongitude && longitude <= bounds.maxLongitude
    }
}
