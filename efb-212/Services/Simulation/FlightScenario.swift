//
//  FlightScenario.swift
//  efb-212
//
//  DEBUG only (SIM-IL, T35). A flight scenario written by tools/flight-sim/gen.py: fixes with time, position,
//  altitude, speed and course, plus the route that was flown. The player (ScenarioPlayback) replays it through
//  LocationService in the simulator; efb-212Tests/Simulation feeds the same fixes through the real pipeline.
//
//  Units: degrees WGS-84, feet MSL, knots, degrees true, seconds since the scenario start, metres (accuracies).
//

#if DEBUG

import Foundation
import CoreLocation

nonisolated struct FlightScenario: Decodable, Sendable {

    struct Leg: Decodable, Sendable {
        let segmentId: Int?
        let from: String
        let to: String
        let name: String?
        let altitudeFt: Int?       // feet MSL, published for the direction flown
        let altitudeText: String?  // verbatim, e.g. "800/1600"
        let activity: String?      // LSA: all_week | weekend | special
        let forward: Bool
        let distanceNm: Double?    // nautical miles
        let polyline: [[Double]]   // [lat, lon] in flying order
    }

    struct Route: Decodable, Sendable {
        let from: String
        let to: String
        let points: [String]
        let legs: [Leg]
    }

    struct Event: Decodable, Sendable {
        let kind: String           // altitudeDeviation | offRoute | gpsLoss | accuracyDegraded
        let leg: Int?
        let feet: Double?          // feet
        let nm: Double?            // nautical miles
        let side: String?
        let from: Double?          // seconds since start
        let to: Double?            // seconds since start
        let hAcc: Double?          // metres
    }

    struct Fix: Decodable, Sendable {
        let t: Double              // seconds since start
        let lat: Double
        let lon: Double
        let alt: Double            // feet MSL
        let gs: Double             // knots
        let crs: Double            // degrees true
        let hAcc: Double           // metres
        let vAcc: Double           // metres
        let leg: Int               // route leg the generator was on; -1 before the route, legs.count after it
    }

    let name: String
    let version: Int
    let description: String
    let region: String             // "IL" | "US"
    let network: String?           // "cvfr" | "lsa" | nil for direct paths
    let startTime: String          // ISO 8601
    let cruiseSpeedKt: Double
    let route: Route
    let events: [Event]
    let fixes: [Fix]

    // MARK: - Loading

    /// The folder the scenarios live in, found from this source file (the simulator shares the Mac's file system).
    static let scenarioDirectory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tools/flight-sim/scenarios", isDirectory: true)

    /// A scenario name ("il-gps-loss") or a path to a scenario JSON.
    static func resolve(_ nameOrPath: String) -> URL {
        if nameOrPath.contains("/") { return URL(fileURLWithPath: nameOrPath) }
        let file = nameOrPath.hasSuffix(".json") ? nameOrPath : nameOrPath + ".json"
        return scenarioDirectory.appendingPathComponent(file)
    }

    static func load(_ nameOrPath: String) throws -> FlightScenario {
        let data = try Data(contentsOf: resolve(nameOrPath))
        return try JSONDecoder().decode(FlightScenario.self, from: data)
    }

    // MARK: - Derived

    var isIsrael: Bool { region == "IL" }

    /// The scenario's start instant. Fixed in the file, so closures and LSA weekend rules are reproducible.
    var startDate: Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: startTime) ?? Date(timeIntervalSince1970: 1_800_000_000)
    }

    /// Seconds of the last fix.
    var duration: TimeInterval { fixes.last?.t ?? 0 }

    /// A fix as CoreLocation reports it. `timestamp` is the instant the fix is delivered.
    func location(for fix: Fix, timestamp: Date) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lon),
            altitude: fix.alt * 0.3048,                  // feet to metres
            horizontalAccuracy: fix.hAcc,
            verticalAccuracy: fix.vAcc,
            course: fix.crs,
            speed: fix.gs * 0.514444,                    // knots to m/s
            timestamp: timestamp
        )
    }

    /// The route an Israel plan activates: what `IsraelFlightPlanViewModel.activate()` builds.
    func activeRoute(startingAtLeg leg: Int = 0) -> ActiveRoute? {
        guard !route.legs.isEmpty else { return nil }
        let legs = route.legs.map { leg -> ActiveRouteLeg in
            let first = leg.polyline.first ?? [0, 0]
            let last = leg.polyline.last ?? first
            let text = leg.altitudeText ?? leg.altitudeFt.map(String.init) ?? ""
            return ActiveRouteLeg(
                segmentID: leg.segmentId ?? 0,
                fromCode: leg.from, toCode: leg.to,
                fromLatitude: first[0], fromLongitude: first[1],
                toLatitude: last[0], toLongitude: last[1],
                altitudeText: text,
                distanceNM: leg.distanceNm ?? 0,
                path: leg.polyline
            )
        }
        var active = ActiveRoute(legs: legs)
        active.currentLeg = max(0, min(leg, legs.count - 1))
        return active
    }

    /// GPS loss windows from the events: seconds since the start.
    var gpsLossWindows: [ClosedRange<Double>] {
        events.compactMap { event in
            guard event.kind == "gpsLoss", let from = event.from, let to = event.to else { return nil }
            return from...to
        }
    }
}

// MARK: - NOTAM fixture

/// A fixture feed (tools/flight-sim/fixtures) restamped relative to the scenario start: the file holds fixed dates,
/// but a feed older than the NOTAM limit is never drawn as current, so the player moves the dates to the scenario.
nonisolated enum ScenarioNotamFixture {

    static func report(path: String, scenarioStart: Date) throws -> IsraelNotamReport {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard var root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EFBError.databaseCorrupted
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func stamp(_ offset: TimeInterval) -> String { formatter.string(from: scenarioStart.addingTimeInterval(offset)) }
        root["generatedAt"] = stamp(-600)  // generated ten minutes before take-off
        if let closures = root["closures"] as? [[String: Any]] {
            root["closures"] = closures.map { closure -> [String: Any] in
                var c = closure
                c["validFrom"] = stamp(-3600)
                c["validTo"] = stamp(6 * 3600)
                return c
            }
        }
        let restamped = try JSONSerialization.data(withJSONObject: root)
        let feed = try IsraelNotamService.decoder.decode(IsraelNotamFeed.self, from: restamped)
        return IsraelNotamReport(feed: feed, fetchedAt: scenarioStart, refreshFailed: false)
    }
}

#endif
