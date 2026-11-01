//
//  ProximityAlertAltitudeTests.swift
//  efb-212Tests
//
//  Airspace proximity must compare GPS altitude (feet MSL) with each shelf's floor and
//  ceiling: a pilot under a Class B shelf is NEAR, not INSIDE.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Proximity Alert Altitude")
@MainActor
struct ProximityAlertAltitudeTests {

    /// Square ring as [lat, lon] pairs, closed.
    static func box(latMin: Double, latMax: Double, lonMin: Double, lonMax: Double) -> AirspaceGeometry {
        .polygon(coordinates: [
            [latMin, lonMin], [latMin, lonMax], [latMax, lonMax], [latMax, lonMin], [latMin, lonMin]
        ])
    }

    /// Stacked SFO Class B shelves (simplified): SFC-10000 core, 3000-10000 and 6000-10000 rings.
    static let core = Airspace(classification: .bravo, name: "SFO Class B", floor: 0, ceiling: 10000,
                               geometry: box(latMin: 37.60, latMax: 37.65, lonMin: -122.42, lonMax: -122.35))
    static let middle = Airspace(classification: .bravo, name: "SFO Class B", floor: 3000, ceiling: 10000,
                                 geometry: box(latMin: 37.50, latMax: 37.75, lonMin: -122.52, lonMax: -122.25))
    static let outer = Airspace(classification: .bravo, name: "SFO Class B", floor: 6000, ceiling: 10000,
                                geometry: box(latMin: 37.30, latMax: 37.95, lonMin: -122.80, lonMax: -122.00))
    static let shelves = [core, middle, outer]

    /// Inside the middle and outer rings only (laterally outside the core).
    static let ringPoint = CLLocationCoordinate2D(latitude: 37.70, longitude: -122.30)

    static func alerts(altitude: Double?, at coordinate: CLLocationCoordinate2D? = nil) -> [ProximityAlert] {
        ProximityAlertService.airspaceAlerts(for: coordinate ?? ringPoint, altitude: altitude, airspaces: shelves).alerts
    }

    static func insideIDs(_ alerts: [ProximityAlert]) -> Set<String> {
        Set(alerts.filter(\.isInside).map(\.id))
    }

    @Test func belowTheShelfIsNearNotInside() {
        let alerts = Self.alerts(altitude: 2000)  // under the 3000 ft floor
        #expect(!alerts.isEmpty)
        #expect(alerts.allSatisfy { !$0.isInside })
        #expect(alerts.allSatisfy { $0.relationLabel == "NEAR" })
        #expect(alerts.contains { $0.vertical == .below })
    }

    @Test func insideTheMiddleShelfOnlyAlertsInsideForThatShelf() {
        let alerts = Self.alerts(altitude: 4500)  // above 3000 floor, below the 6000 outer floor
        #expect(Self.insideIDs(alerts) == ["airspace-\(Self.middle.id)"])
        let outer = alerts.first { $0.id == "airspace-\(Self.outer.id)" }
        #expect(outer?.vertical == .below)
        #expect(outer?.isInside == false)
    }

    @Test func insideBothShelvesAtHigherAltitude() {
        let alerts = Self.alerts(altitude: 8000)
        #expect(Self.insideIDs(alerts) == ["airspace-\(Self.middle.id)", "airspace-\(Self.outer.id)"])
    }

    @Test func aboveTheCeilingIsNearNotInside() {
        let alerts = Self.alerts(altitude: 11000)
        #expect(!alerts.isEmpty)
        #expect(alerts.allSatisfy { $0.vertical == .above && !$0.isInside })
    }

    @Test func surfaceShelfContainsLowAltitude() {
        let center = CLLocationCoordinate2D(latitude: 37.625, longitude: -122.385)
        let alerts = Self.alerts(altitude: 500, at: center)
        #expect(Self.insideIDs(alerts) == ["airspace-\(Self.core.id)"])
    }

    @Test func limitsAreInclusive() {
        #expect(ProximityAlertService.verticalRelation(altitude: 3000, floor: 3000, ceiling: 10000) == .within)
        #expect(ProximityAlertService.verticalRelation(altitude: 10000, floor: 3000, ceiling: 10000) == .within)
        #expect(ProximityAlertService.verticalRelation(altitude: 2999, floor: 3000, ceiling: 10000) == .below)
        #expect(ProximityAlertService.verticalRelation(altitude: 10001, floor: 3000, ceiling: 10000) == .above)
    }

    @Test func unknownAltitudeNeverSaysInside() {
        let center = CLLocationCoordinate2D(latitude: 37.625, longitude: -122.385)
        for coordinate in [Self.ringPoint, center] {
            let alerts = Self.alerts(altitude: nil, at: coordinate)
            #expect(!alerts.isEmpty)
            #expect(alerts.allSatisfy { $0.vertical == .unknown && !$0.isInside && $0.relationLabel == "NEAR" })
        }
    }

    @Test func outsideLaterallyStillUsesClassThreshold() {
        // ~2 NM north of the outer ring (37.95): within the 5 NM Class B threshold
        let north = CLLocationCoordinate2D(latitude: 37.95 + 2.0 / 60.0, longitude: -122.40)
        let near = Self.alerts(altitude: 8000, at: north)
        #expect(near.count == 1)
        #expect(near.first?.isInside == false)
        #expect((near.first?.distance ?? 0) > 1.5)

        // ~20 NM away: no alert
        let far = CLLocationCoordinate2D(latitude: 37.95 + 20.0 / 60.0, longitude: -122.40)
        #expect(Self.alerts(altitude: 8000, at: far).isEmpty)
    }

    // MARK: - Service state

    @Test func serviceStateReflectsAltitude() {
        let db = MockDatabaseManager()
        db.airspacesData = Self.shelves
        let service = ProximityAlertService(databaseService: db)
        let position = CLLocation(latitude: Self.ringPoint.latitude, longitude: Self.ringPoint.longitude)
        let t0 = Date(timeIntervalSince1970: 1_000_000)

        service.checkProximity(position: position, altitude: 2000, now: t0)
        #expect(!service.isInAirspace)
        #expect(!service.activeAlerts.isEmpty)

        // Throttled inside 10 s
        service.checkProximity(position: position, altitude: 8000, now: t0.addingTimeInterval(5))
        #expect(!service.isInAirspace)

        service.checkProximity(position: position, altitude: 8000, now: t0.addingTimeInterval(11))
        #expect(service.isInAirspace)

        service.checkProximity(position: position, altitude: nil, now: t0.addingTimeInterval(22))
        #expect(!service.isInAirspace)
        #expect(service.nearestAirspaceDistance == 0)
    }
}
