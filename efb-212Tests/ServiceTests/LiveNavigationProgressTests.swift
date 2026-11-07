//
//  LiveNavigationProgressTests.swift
//  efb-212Tests
//
//  The flight log's NEXT block reads distance (NM), bearing (degrees true) and time-to (s)
//  straight from AppState, so they must refresh on every fix for Direct-To, a US direct plan
//  and an Israel route alike, and must clear with the navigation.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Live navigation progress")
@MainActor
struct LiveNavigationProgressTests {

    static let overPaloAlto = CLLocation(latitude: 37.4611, longitude: -122.1150)
    /// Roughly halfway from KPAO to KSQL.
    static let halfwayToSanCarlos = CLLocation(latitude: 37.4865, longitude: -122.1822)
    static let ksqlCoordinate = CLLocationCoordinate2D(latitude: 37.5119, longitude: -122.2494)

    @Test func directToNumbersFollowEachFix() throws {
        let appState = AppState()
        appState.ownshipPosition = Self.overPaloAlto
        appState.groundSpeed = 90   // knots
        let vm = NearestAirportViewModel(appState: appState, databaseService: NearestAirportViewModelTests.makeMockDB())
        vm.setDirectTo(airport: NearestAirportViewModelTests.ksql)

        let firstDistance = try #require(appState.distanceToNext)   // NM
        let firstETE = try #require(appState.estimatedTimeEnroute)  // seconds
        let firstBearing = try #require(appState.bearingToNext)     // degrees true
        #expect(firstBearing > 280 && firstBearing < 310)          // KSQL lies west-northwest of KPAO

        appState.ownshipPosition = Self.halfwayToSanCarlos
        appState.updateActiveRouteProgress()

        let secondDistance = try #require(appState.distanceToNext)
        let secondETE = try #require(appState.estimatedTimeEnroute)
        #expect(secondDistance < firstDistance * 0.6)
        #expect(secondETE < firstETE)
        #expect(abs(secondETE - secondDistance / 90 * 3600) < 1)
        let secondBearing = try #require(appState.bearingToNext)
        #expect(secondBearing > 280 && secondBearing < 310)
    }

    @Test func timeToIsUnknownBelow30Knots() {
        let appState = AppState()
        appState.ownshipPosition = Self.overPaloAlto
        appState.groundSpeed = 20   // knots: taxiing
        appState.directToAirport = NearestAirportViewModelTests.ksql
        appState.activeFlightPlan = true

        appState.updateActiveRouteProgress()

        #expect(appState.distanceToNext != nil)
        #expect(appState.bearingToNext != nil)
        #expect(appState.estimatedTimeEnroute == nil)
    }

    @Test func usPlanDestinationNumbersUpdatePerFix() throws {
        let appState = AppState()
        appState.activeFlightPlan = true
        appState.activePlanDestinationCoordinate = Self.ksqlCoordinate
        appState.groundSpeed = 100  // knots

        appState.ownshipPosition = Self.overPaloAlto
        appState.updateActiveRouteProgress()
        let first = try #require(appState.distanceToNext)
        #expect(abs(first - Self.overPaloAlto.distanceInNM(to: CLLocation(latitude: 37.5119, longitude: -122.2494))) < 0.01)

        appState.ownshipPosition = Self.halfwayToSanCarlos
        appState.updateActiveRouteProgress()
        let second = try #require(appState.distanceToNext)
        let secondETE = try #require(appState.estimatedTimeEnroute)
        #expect(second < first)
        #expect(abs(secondETE - second / 100 * 3600) < 1)
        #expect(appState.bearingToNext != nil)
    }

    @Test func clearingNavigationDropsBearingAndDestination() {
        let appState = AppState()
        appState.activeFlightPlan = true
        appState.activePlanDestinationCoordinate = Self.ksqlCoordinate
        appState.ownshipPosition = Self.overPaloAlto
        appState.groundSpeed = 100
        appState.updateActiveRouteProgress()
        #expect(appState.bearingToNext != nil)

        appState.clearActiveNavigation()

        #expect(appState.bearingToNext == nil)
        #expect(appState.activePlanDestinationCoordinate == nil)
        #expect(appState.distanceToNext == nil)
        #expect(appState.estimatedTimeEnroute == nil)

        // No navigation left: a later fix does not bring the numbers back.
        appState.updateActiveRouteProgress()
        #expect(appState.distanceToNext == nil)
        #expect(appState.bearingToNext == nil)
    }

    @Test func israelRouteStillMeasuresToTheActiveLegPoint() throws {
        let appState = AppState()
        appState.activeRoute = ActiveRoute(legs: [
            ActiveRouteLeg(
                segmentID: 1, fromCode: "AAAAA", toCode: "BBBBB",
                fromLatitude: 32.00, fromLongitude: 34.80, toLatitude: 32.30, toLongitude: 34.80,
                altitudeText: "2500", distanceNM: 18
            ),
            ActiveRouteLeg(
                segmentID: 2, fromCode: "BBBBB", toCode: "CCCCC",
                fromLatitude: 32.30, fromLongitude: 34.80, toLatitude: 32.30, toLongitude: 35.10,
                altitudeText: "3500", distanceNM: 15.2
            ),
        ])
        appState.activeFlightPlan = true
        appState.ownshipPosition = CLLocation(latitude: 32.10, longitude: 34.80)  // on the first leg, heading north
        appState.groundSpeed = 90   // knots

        appState.updateActiveRouteProgress()

        #expect(appState.activeRoute?.current?.toCode == "BBBBB")
        let distance = try #require(appState.distanceToNext)
        #expect(abs(distance - 12) < 0.2)                        // 0.2 degrees of latitude = 12 NM
        let bearing = try #require(appState.bearingToNext)
        #expect(bearing < 1 || bearing > 359)                     // due north
        let ete = try #require(appState.estimatedTimeEnroute)
        #expect(abs(ete - distance / 90 * 3600) < 1)
    }

    /// Without a fix, a new Direct-To must not inherit the previous plan's distance, bearing and time.
    @Test func directToWithoutAFixShowsNoOldNumbers() {
        let appState = AppState()
        appState.distanceToNext = 18.4        // nautical miles, left from a previous plan
        appState.bearingToNext = 341          // degrees true
        appState.estimatedTimeEnroute = 676   // seconds
        let vm = NearestAirportViewModel(appState: appState, databaseService: NearestAirportViewModelTests.makeMockDB())

        vm.setDirectTo(airport: NearestAirportViewModelTests.ksql)

        #expect(appState.distanceToNext == nil)
        #expect(appState.bearingToNext == nil)
        #expect(appState.estimatedTimeEnroute == nil)
    }

    /// A Direct-To taken during a route is the next waypoint everywhere it is shown.
    @Test func directToIsTheNextWaypointOverAnActiveRoute() {
        let appState = AppState()
        appState.activeRoute = ActiveRoute(legs: [
            ActiveRouteLeg(
                segmentID: 1, fromCode: "AAAAA", toCode: "BBBBB",
                fromLatitude: 32.00, fromLongitude: 34.80, toLatitude: 32.30, toLongitude: 34.80,
                altitudeText: "2500", distanceNM: 18
            ),
        ])
        appState.activeFlightPlan = true
        appState.directToAirport = NearestAirportViewModelTests.ksql

        #expect(FlightLogStrip.nextIdent(for: appState) == "KSQL")
    }
}
