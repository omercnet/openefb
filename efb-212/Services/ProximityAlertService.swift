//
//  ProximityAlertService.swift
//  efb-212
//
//  Airspace and TFR proximity detection with distance-based alerts.
//  Checks pilot position against nearby airspaces and TFRs,
//  firing alerts at configurable distance thresholds per airspace class.
//
//  An airspace alert is INSIDE only when the aircraft is laterally within the boundary AND
//  the GPS altitude (feet MSL) is between the floor and ceiling. Laterally inside but below
//  a shelf, above the ceiling, or with no usable altitude (GPS Degraded) is NEAR.
//
//  Alert thresholds (lateral, outside the boundary):
//  - Class B: 5 NM
//  - Class C: 3 NM
//  - Class D: 2 NM
//  - TFR: 3 NM
//

import Foundation
import CoreLocation
import os

// MARK: - ProximityAlert

struct ProximityAlert: Identifiable, Sendable, Equatable {
    let id: String
    let type: AlertType
    let name: String
    let distance: Double      // nautical miles to the lateral boundary, 0 when laterally inside
    let altitude: String      // floor/ceiling info (e.g., "SFC-10000'")
    /// Where the aircraft sits relative to the floor/ceiling. `.unknown` for TFRs (AGL limits
    /// are not compared) and when GPS altitude is unavailable.
    let vertical: VerticalRelation

    enum AlertType: Sendable {
        case airspace
        case tfr
    }

    /// Aircraft altitude relative to an airspace's vertical limits.
    enum VerticalRelation: Sendable, Equatable {
        case within
        case below
        case above
        case unknown
    }

    /// True when laterally inside and, for airspace, vertically within known limits. Never true
    /// for airspace without altitude: "near", not "inside", is what the pilot sees when GPS
    /// altitude is missing. TFR altitudes are not compared, so lateral inside suffices.
    var isInside: Bool { distance <= 0 && (type == .tfr || vertical == .within) }

    /// Display word for the alert: "INSIDE" or "NEAR".
    var relationLabel: String { isInside ? "INSIDE" : "NEAR" }
}

// MARK: - ProximityAlertService

@Observable
@MainActor
final class ProximityAlertService {

    // MARK: - Dependencies

    let databaseService: any DatabaseServiceProtocol

    // MARK: - State

    var activeAlerts: [ProximityAlert] = []
    var isInAirspace: Bool = false
    var nearestAirspaceDistance: Double?  // nautical miles
    /// The last airspace check could not run (database error). "No alert" and "check failed" must never
    /// look the same, so the map shows an amber "airspace check unavailable" while this is true.
    var checkUnavailable: Bool = false

    // MARK: - Configuration

    /// Alert thresholds per airspace class in nautical miles.
    static let alertThresholds: [AirspaceClass: Double] = [
        .bravo: 5.0,
        .charlie: 3.0,
        .delta: 2.0
    ]
    static let tfrAlertThresholdNM: Double = 3.0

    // MARK: - Throttling

    private var lastCheckTime: Date?
    private let checkIntervalSeconds: TimeInterval = 10  // Throttle to once per 10 seconds

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "ProximityAlert")

    // MARK: - Init

    init(databaseService: any DatabaseServiceProtocol) {
        self.databaseService = databaseService
    }

    // MARK: - Proximity Check

    /// Check airspace proximity for the given position.
    /// Throttled to once per 10 seconds to avoid excessive DB queries.
    /// - `altitude`: GPS altitude in feet MSL, or nil when unknown (GPS Degraded, no vertical
    ///   fix). Unknown altitude never produces an INSIDE alert.
    func checkProximity(position: CLLocation, altitude: Double?, now: Date = Date()) {
        // Throttle checks
        if let lastCheck = lastCheckTime,
           now.timeIntervalSince(lastCheck) < checkIntervalSeconds {
            return
        }
        lastCheckTime = now

        do {
            let nearby = try databaseService.airspaces(near: position.coordinate, radiusNM: 5.0)
            let result = Self.airspaceAlerts(for: position.coordinate, altitude: altitude, airspaces: nearby)
            activeAlerts = result.alerts
            isInAirspace = result.alerts.contains { $0.isInside }
            nearestAirspaceDistance = result.nearestDistance
            checkUnavailable = false
        } catch {
            logger.warning("Airspace proximity check failed: \(error.localizedDescription)")
            // Old alerts describe an earlier position, so they are cleared; the failure is shown, never silent.
            activeAlerts = []
            isInAirspace = false
            nearestAirspaceDistance = nil
            checkUnavailable = true
        }
    }

    /// Vertical relation of `altitude` (feet MSL) to an airspace's limits. SFC is 0. The
    /// airspace model has no AGL flag (the NASR import stores B/C/D limits as MSL), so no
    /// field-elevation adjustment is applied.
    static func verticalRelation(altitude: Double?, floor: Int, ceiling: Int) -> ProximityAlert.VerticalRelation {
        guard let altitude else { return .unknown }
        if altitude < Double(floor) { return .below }
        if altitude > Double(ceiling) { return .above }
        return .within
    }

    /// Pure alert evaluation. Laterally inside airspaces always alert (INSIDE when the altitude
    /// is within limits, NEAR when below/above/unknown). Laterally outside alerts within the
    /// class threshold. `nearestDistance` is the closest lateral distance (0 when laterally
    /// inside any listed airspace).
    static func airspaceAlerts(
        for coordinate: CLLocationCoordinate2D,
        altitude: Double?,
        airspaces: [Airspace]
    ) -> (alerts: [ProximityAlert], nearestDistance: Double?) {
        var alerts: [ProximityAlert] = []
        var closest: Double?

        for airspace in airspaces {
            let distance = lateralDistanceNM(from: coordinate, airspace: airspace)
            let vertical = verticalRelation(altitude: altitude, floor: airspace.floor, ceiling: airspace.ceiling)
            let limits = formatAltitude(floor: airspace.floor, ceiling: airspace.ceiling)

            if distance <= 0.0 {
                alerts.append(ProximityAlert(
                    id: "airspace-\(airspace.id)", type: .airspace, name: airspace.name,
                    distance: 0, altitude: limits, vertical: vertical))
                closest = 0
                continue
            }

            if let threshold = alertThresholds[airspace.classification], distance <= threshold {
                alerts.append(ProximityAlert(
                    id: "airspace-\(airspace.id)", type: .airspace, name: airspace.name,
                    distance: distance, altitude: limits, vertical: vertical))
            }
            if closest == nil || distance < closest! { closest = distance }
        }
        return (alerts, closest)
    }

    /// Check TFR proximity separately (called when TFR data is available).
    func checkTFRProximity(position: CLLocation, tfrs: [TFR], now: Date = Date()) {
        let tfrAlerts = Self.tfrAlerts(for: position.coordinate, tfrs: tfrs, now: now)

        // Merge TFR alerts with existing airspace alerts
        let airspaceAlerts = activeAlerts.filter { $0.type == .airspace }
        activeAlerts = airspaceAlerts + tfrAlerts
    }

    /// Alerts for TFRs in effect at `now` whose boundary is within `tfrAlertThresholdNM`
    /// (distance 0 when inside the polygon), nearest first. Altitudes are not compared:
    /// many TFR limits are AGL, so lateral proximity alone triggers the alert.
    static func tfrAlerts(for coordinate: CLLocationCoordinate2D, tfrs: [TFR], now: Date) -> [ProximityAlert] {
        tfrs.compactMap { tfr -> ProximityAlert? in
            guard tfr.isActive(at: now),
                  let distanceNM = PolygonGeometry.distanceNM(from: coordinate, ring: tfr.boundaries),
                  distanceNM <= tfrAlertThresholdNM else { return nil }
            return ProximityAlert(
                id: "tfr-\(tfr.id)",
                type: .tfr,
                name: "TFR \(tfr.notamID) \u{2014} \(tfr.title)",
                distance: distanceNM,  // nautical miles to boundary, 0 inside
                altitude: tfr.altitudeDescription,
                vertical: .unknown
            )
        }
        .sorted { $0.distance < $1.distance }
    }

    // MARK: - Helpers

    /// Lateral distance from position to the airspace boundary in nautical miles.
    /// Returns 0 if inside, positive distance if outside.
    private static func lateralDistanceNM(from coordinate: CLLocationCoordinate2D, airspace: Airspace) -> Double {
        switch airspace.geometry {
        case .circle(let center, let radiusNM):
            guard center.count >= 2 else { return .greatestFiniteMagnitude }
            let centerCoord = CLLocationCoordinate2D(latitude: center[0], longitude: center[1])
            let distanceNM = haversineDistanceNM(from: coordinate, to: centerCoord)
            return max(0, distanceNM - radiusNM)

        case .polygon(let coordinates):
            // 0 inside the ring, else distance to the nearest edge (edges matter: a Class B ring has
            // long sides with no vertex near the aircraft).
            return PolygonGeometry.distanceNM(from: coordinate, ring: coordinates) ?? .greatestFiniteMagnitude
        }
    }

    /// Format altitude range string for display (e.g., "SFC-10000'" or "1200'-10000'").
    private static func formatAltitude(floor: Int, ceiling: Int) -> String {
        let floorStr = floor == 0 ? "SFC" : "\(floor)'"
        let ceilingStr = ceiling >= 99999 ? "UNL" : "\(ceiling)'"
        return "\(floorStr)-\(ceilingStr)"
    }

    /// Haversine great-circle distance in nautical miles.
    private static func haversineDistanceNM(
        from: CLLocationCoordinate2D,
        to: CLLocationCoordinate2D
    ) -> Double {
        let earthRadiusNM = 3440.065  // nautical miles
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
