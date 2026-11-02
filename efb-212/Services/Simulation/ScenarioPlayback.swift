//
//  ScenarioPlayback.swift
//  efb-212
//
//  DEBUG only (SIM-IL, T35). Replays a flight scenario (tools/flight-sim) through the same `LocationService` seam
//  the real GPS uses, so route following, alerts and recording run unchanged. Launch arguments:
//    -OpenEFBScenario <name or path>     the scenario (tools/flight-sim/scenarios/<name>.json)
//    -OpenEFBScenarioSpeed 4             time multiplier, default 1
//    -OpenEFBScenarioStart 600           skip to this many seconds into the flight, default 0
//    -OpenEFBNotamFixture <path>         serve this NOTAM feed to the Israel alerts (dates moved to the scenario)
//
//  Two clocks: fix timestamps are wall clock (the GPS-lost rule is 5 real seconds); route following and alerts
//  see the scenario clock, which runs `speed` times faster than the wall, so a 30 s altitude grace takes
//  30 / speed real seconds. A GPS loss shorter than 5 x speed scenario seconds does not show as lost.
//

import Foundation
import CoreLocation
import OSLog

#if DEBUG

nonisolated final class ScenarioPlayback: @unchecked Sendable {
    static let scenarioKey = "OpenEFBScenario"
    static let speedKey = "OpenEFBScenarioSpeed"
    static let startKey = "OpenEFBScenarioStart"
    static let notamFixtureKey = "OpenEFBNotamFixture"

    private static let logger = Logger(subsystem: "io.omer.efb", category: "ScenarioPlayback")

    /// Non-nil when the app was launched with `-OpenEFBScenario`.
    static let shared: ScenarioPlayback? = ScenarioPlayback.fromLaunchArguments()

    let scenario: FlightScenario
    let speed: Double          // scenario seconds per wall second
    let startOffset: Double    // seconds into the scenario
    let notamFixturePath: String?

    private let lock = NSLock()
    private var wallStart: Date?

    init(scenario: FlightScenario, speed: Double = 1, startOffset: Double = 0, notamFixturePath: String? = nil) {
        self.scenario = scenario
        self.speed = max(0.1, speed)
        self.startOffset = max(0, startOffset)
        self.notamFixturePath = notamFixturePath
    }

    static func fromLaunchArguments(_ defaults: UserDefaults = .standard) -> ScenarioPlayback? {
        guard let name = defaults.string(forKey: scenarioKey) else { return nil }
        do {
            let scenario = try FlightScenario.load(name)
            let speed = defaults.string(forKey: speedKey).flatMap(Double.init) ?? 1
            let start = defaults.string(forKey: startKey).flatMap(Double.init) ?? 0
            logger.notice("Scenario \(scenario.name, privacy: .public) x\(speed) from \(start) s")
            return ScenarioPlayback(scenario: scenario, speed: speed, startOffset: start,
                                    notamFixturePath: defaults.string(forKey: notamFixtureKey))
        } catch {
            logger.error("Scenario \(name, privacy: .public) not loaded: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    // MARK: - Clock

    /// The scenario's "now": its start instant plus the (accelerated) time played so far.
    func scenarioNow(at wall: Date = Date()) -> Date {
        lock.lock(); defer { lock.unlock() }
        let started = wallStart ?? wall
        let played = max(0, wall.timeIntervalSince(started)) * speed
        return scenario.startDate.addingTimeInterval(startOffset + played)
    }

    private func markStarted() {
        lock.lock(); defer { lock.unlock() }
        if wallStart == nil { wallStart = Date() }
    }

    // MARK: - App state

    /// Region, plan and route as the scenario's pilot would have them at the playback start.
    @MainActor
    func prepare(_ appState: AppState) {
        appState.region = scenario.isIsrael ? .israel : .us
        guard scenario.isIsrael, let first = scenario.fixes.first(where: { $0.t >= startOffset }) else { return }
        if var route = scenario.activeRoute(startingAtLeg: max(0, first.leg)) {
            route.following = ActiveRouteFollowing()
            appState.activeRoute = route
            appState.activeFlightPlan = true
            appState.activePlanDeparture = scenario.route.from
            appState.activePlanDestination = scenario.route.to
            appState.distanceToNext = route.current?.distanceNM ?? 0
        }
    }

    // MARK: - Updates

    /// The stream `LocationService` consumes: each fix at its scenario time (divided by `speed`), a "location
    /// unavailable" notice when a GPS loss starts, and the last fix repeated once a second after landing so
    /// the parked aircraft stays a valid position.
    func updates() -> AsyncThrowingStream<LocationUpdateSnapshot, Error> {
        let scenario = self.scenario
        let speed = self.speed
        let offset = self.startOffset
        return AsyncThrowingStream { continuation in
            let task = Task { [self] in
                markStarted()
                let begun = Date()
                var previous: Double?
                var last: FlightScenario.Fix?
                for fix in scenario.fixes where fix.t >= offset {
                    if Task.isCancelled { break }
                    if let previous, fix.t - previous > 1.5 {
                        continuation.yield(LocationUpdateSnapshot(location: nil, locationUnavailable: true))
                    }
                    previous = fix.t
                    let due = begun.addingTimeInterval((fix.t - offset) / speed)
                    let wait = due.timeIntervalSinceNow
                    if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                    continuation.yield(LocationUpdateSnapshot(
                        location: scenario.location(for: fix, timestamp: Date())))
                    last = fix
                }
                while !Task.isCancelled, let parked = last {
                    try? await Task.sleep(for: .seconds(1))
                    continuation.yield(LocationUpdateSnapshot(
                        location: scenario.location(for: parked, timestamp: Date()), stationary: true))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

#endif

// MARK: - Hooks

/// The few places production code asks "is a scenario playing?". The bodies exist only in DEBUG builds: in a
/// release build every function returns the production value.
enum ScenarioHooks {

    /// Set the region, plan and route before the services start.
    @MainActor
    static func prepare(_ appState: AppState) {
        #if DEBUG
        ScenarioPlayback.shared?.prepare(appState)
        #endif
    }

    @MainActor
    static func makeLocationService(appState: AppState) -> LocationService {
        #if DEBUG
        if let playback = ScenarioPlayback.shared {
            return LocationService(
                appState: appState,
                updates: { playback.updates() },
                clock: { playback.scenarioNow() }
            )
        }
        #endif
        return LocationService(appState: appState)
    }

    @MainActor
    static func makeIsraelAlertService() -> IsraelAlertService {
        #if DEBUG
        if let playback = ScenarioPlayback.shared, let path = playback.notamFixturePath {
            let start = playback.scenario.startDate
            return IsraelAlertService(notamFetcher: {
                try ScenarioNotamFixture.report(path: path, scenarioStart: start)
            })
        }
        #endif
        return IsraelAlertService()
    }

    /// The instant the Israel alerts evaluate at.
    @MainActor
    static var now: Date {
        #if DEBUG
        if let playback = ScenarioPlayback.shared { return playback.scenarioNow() }
        #endif
        return Date()
    }
}
