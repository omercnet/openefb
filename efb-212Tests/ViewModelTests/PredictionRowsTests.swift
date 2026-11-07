//
//  PredictionRowsTests.swift
//  efb-212Tests
//
//  Stage 2 rows in NEXT: predicted airspace entries and route points share one time order, the
//  soonest is the top row, at most 3 later rows (2 in the rail) then "+N more"; the altitude tape's
//  floor and the spoken text come from the same events.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Flight log prediction rows")
struct PredictionRowsTests {

    private func event(
        _ volume: String, seconds: TimeInterval, kind: PredictedEvent.Kind = .floor,
        severity: PredictedEvent.Severity = .caution, limit: Int? = 3000, title: String = "B floor 3,000"
    ) -> PredictedEvent {
        PredictedEvent(
            volumeID: volume, kind: kind, severity: severity, secondsAhead: seconds,
            coordinate: CLLocationCoordinate2D(latitude: 37.5, longitude: -122.2), limitFeetMSL: limit,
            title: title, assumption: "at 312\u{00B0}, +300 fpm"
        )
    }

    private func ids(_ items: [NextItem]) -> [String] { items.map(\.id) }

    // MARK: Order

    @Test func eventFirstWhenSooner() {
        let items = FlightLogStrip.nextItems(events: [event("B", seconds: 110)], waypoints: [676, 900])
        #expect(ids(items) == ["event/B/floor", "waypoint/0", "waypoint/1"])
    }

    @Test func waypointFirstWhenSooner() {
        let items = FlightLogStrip.nextItems(events: [event("B", seconds: 372)], waypoints: [120, 676])
        #expect(ids(items) == ["waypoint/0", "event/B/floor", "waypoint/1"])
    }

    @Test func mergesInTimeOrderAndKeepsRouteOrder() {
        let events = [event("C", seconds: 500), event("B", seconds: 110)]  // unsorted on purpose
        let items = FlightLogStrip.nextItems(events: events, waypoints: [300, 450, 700])
        #expect(ids(items) == ["event/B/floor", "waypoint/0", "waypoint/1", "event/C/floor", "waypoint/2"])
        #expect(items.map(\.secondsAhead) == [110, 300, 450, 500, 700])
    }

    @Test func eventWinsATie() {
        let items = FlightLogStrip.nextItems(events: [event("B", seconds: 300)], waypoints: [300])
        #expect(ids(items) == ["event/B/floor", "waypoint/0"])
    }

    @Test func waypointWithoutTimeNeverGoesAheadOfAnEvent() {
        let items = FlightLogStrip.nextItems(events: [event("B", seconds: 590)], waypoints: [nil, nil])
        #expect(ids(items) == ["event/B/floor", "waypoint/0", "waypoint/1"])
    }

    @Test func noEventsLeavesTheRouteAsIs() {
        // Predictions off or a stale fix: AppState holds no events, so only the route remains.
        let items = FlightLogStrip.nextItems(events: [], waypoints: [120, 676])
        #expect(ids(items) == ["waypoint/0", "waypoint/1"])
    }

    @Test func eventsWithoutNavigation() {
        let items = FlightLogStrip.nextItems(events: [event("B", seconds: 110)], waypoints: [])
        #expect(ids(items) == ["event/B/floor"])
    }

    // MARK: Cap

    @Test func capsLaterRowsAndCountsTheRest() {
        let items = FlightLogStrip.nextItems(
            events: [event("B", seconds: 110), event("C", seconds: 372)], waypoints: [300, 450, 700, 900]
        )
        let iPad = FlightLogStrip.splitNext(items, laterCap: 3)
        #expect(iPad.top?.id == "event/B/floor")
        #expect(ids(iPad.later) == ["waypoint/0", "event/C/floor", "waypoint/1"])
        #expect(iPad.hiddenCount == 2)

        let rail = FlightLogStrip.splitNext(items, laterCap: 2)
        #expect(rail.later.count == 2)
        #expect(rail.hiddenCount == 3)
    }

    @Test func emptySplit() {
        let split = FlightLogStrip.splitNext([], laterCap: 3)
        #expect(split.top == nil && split.later.isEmpty && split.hiddenCount == 0)
    }

    // MARK: Tape floor

    @Test func tapeFloorIsTheSoonestFloorOrBoundaryAboveTheSurface() {
        let events = [
            event("P4", seconds: 60, kind: .lateral, severity: .warning, limit: 0, title: "P 4"),   // surface: no floor
            event("D", seconds: 90, kind: .ceiling, limit: 2500, title: "D ceiling 2,500"),        // a ceiling
            event("C", seconds: 400, limit: 1500, title: "B floor 1,500"),
            event("B", seconds: 110),
        ]
        let floor = FlightLogStrip.tapeFloor(events)
        #expect(floor?.feet == 3000)
        #expect(floor?.secondsAhead == 110)
        #expect(floor?.label == "B floor 3,000")
        #expect(FlightLogStrip.tapeFloor([]) == nil)
    }

    @Test func scaleKeepsTheFloorOnTheTape() {
        #expect(AltitudeTape.scaleTop(for: 2450, floor: 3000) == 4000)
        #expect(AltitudeTape.scaleTop(for: 2450, floor: 3600) == 5000)
        #expect(AltitudeTape.scaleTop(for: 2450, floor: 4000) == 5000)
        #expect(AltitudeTape.scaleTop(for: 5000, floor: 3000) == 10000)
        #expect(AltitudeTape.scaleTop(for: 2450) == 4000)
    }

    // MARK: Text

    @Test func spokenEventStatesSeverityTimeAndAssumption() {
        #expect(FlightLogStrip.spokenEvent(event("B", seconds: 110))
            == "Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold track 312 and climb 300 feet per minute")
        let restricted = PredictedEvent(
            volumeID: "R", kind: .lateral, severity: .warning, secondsAhead: 125,
            coordinate: CLLocationCoordinate2D(latitude: 32, longitude: 35), limitFeetMSL: nil,
            title: "P 4", assumption: "at 041\u{00B0}, -500 fpm"
        )
        #expect(FlightLogStrip.spokenEvent(restricted)
            == "Warning, P 4 in 2 minutes 5 seconds, if you hold track 041 and descend 500 feet per minute")
    }

    @Test func assumptionLines() {
        #expect(FlightLogStrip.holdText("at 312\u{00B0}, +300 fpm") == "If you hold 312\u{00B0} and +300 fpm")
        #expect(FlightLogStrip.holdText("at 312\u{00B0}, level") == "If you hold 312\u{00B0} and level")
        #expect(FlightLogStrip.spokenAssumption("at 312\u{00B0}, level") == "if you hold track 312 and stay level")
        #expect(FlightLogStrip.spokenTitle("CTR LLHA") == "CTR LLHA")
    }
}
