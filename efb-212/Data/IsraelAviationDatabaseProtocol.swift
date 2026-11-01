//
//  IsraelAviationDatabaseProtocol.swift
//  efb-212
//
//  Read-only access to the bundled Israel aviation data (CAAI GIS layers).
//

import Foundation
import CoreLocation

nonisolated protocol IsraelAviationDatabaseProtocol: Sendable {
    func metadata() throws -> IsraelAviationMetadata

    /// First point with this code (see `IsraelReportingPoint.code` for the duplicate LLNV).
    /// Prefers the point that route segments use.
    func reportingPoint(code: String) throws -> IsraelReportingPoint?
    /// Points inside `bounds`, ordered by id.
    func reportingPoints(in bounds: IsraelGeoBounds) throws -> [IsraelReportingPoint]

    /// Segments whose bounding box meets `bounds`, ordered by id.
    func routeSegments(in bounds: IsraelGeoBounds) throws -> [IsraelRouteSegment]
    /// The segment published from `from` to `to`, in that direction only; nil when none.
    func routeSegment(from: String, to: String) throws -> IsraelRouteSegment?

    /// Airspaces that contain `coordinate` laterally and, when `altitudeFeetMSL` is given, vertically.
    func airspaces(containing coordinate: CLLocationCoordinate2D, altitudeFeetMSL: Double?) throws -> [IsraelAirspace]
    /// Airspaces whose bounding box meets the box around `coordinate` of `radiusNM` (nautical miles).
    func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [IsraelAirspace]
    func airspaces(ofKind kind: IsraelAirspaceKind) throws -> [IsraelAirspace]

    func runways(aerodrome: String) throws -> [IsraelRunway]
    func runways(in bounds: IsraelGeoBounds) throws -> [IsraelRunway]

    // MARK: Aerodromes (IL-4)

    /// The curated aerodrome with this code (ICAO or slug), with its runways and frequencies.
    func aerodrome(code: String) throws -> IsraelAerodrome?
    /// Aerodromes whose reference point lies inside `bounds`, ordered by code.
    func aerodromes(in bounds: IsraelGeoBounds) throws -> [IsraelAerodrome]
    /// The `count` aerodromes closest to `coordinate`, nearest first. Every kind and use is returned
    /// (heliports, military and foreign fields too): callers decide what is landable.
    func nearestAerodromes(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [IsraelAerodrome]
    /// Aerodromes matching `query` by code (prefix), English name or Hebrew name (substring), best match first.
    func searchAerodromes(query: String, limit: Int) throws -> [IsraelAerodrome]
}
