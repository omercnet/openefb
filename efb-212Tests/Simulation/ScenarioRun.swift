//
//  ScenarioRun.swift
//  efb-212Tests
//
//  SIM-IL (T35). Flies a scenario from tools/flight-sim through the production pipeline without a simulator UI:
//  LocationService (injected update stream and clock) -> AppState -> route following -> IsraelAlertService (as
//  MapContainerView drives it, including the "no position" suspension) -> TrackRecorder -> RecordingDatabase.
//  The scenario clock is virtual, so a 44-minute flight takes seconds.
//

#if DEBUG

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

/// The instant LocationService sees as "now": set by the runner before each fix is delivered.
final class ScenarioClockBox: @unchecked Sendable {
    private let lock = NSLock()
    private var instant: Date
    init(_ instant: Date) { self.instant = instant }
    var now: Date {
        get { lock.lock(); defer { lock.unlock() }; return instant }
        set { lock.lock(); defer { lock.unlock() }; instant = newValue }
    }
}

@MainActor
final class ScenarioRun {

    /// What the pilot sees at one step of the flight.
    struct Sample {
        let t: Double                  // seconds since the scenario start
        let alerts: [IsraelAlert]      // the alert banner
        let route: ActiveRoute?        // leg, off-route and altitude-caution state
        let gpsStatus: GPSStatus
        let suspended: Bool            // the "ALERTS OFF: NO GPS POSITION" banner
        let hadFix: Bool               // a fix was delivered at this step
    }

    typealias Updates = AsyncThrowingStream<LocationUpdateSnapshot, Error>

    let scenario: FlightScenario
    let appState = AppState()
    let alertService: IsraelAlertService
    let recordingDB: RecordingDatabase
    let flightID = UUID()
    private(set) var samples: [Sample] = []
    private(set) var failedToDeliver = 0

    private init(scenario: FlightScenario, alertService: IsraelAlertService, recordingDB: RecordingDatabase) {
        self.scenario = scenario
        self.alertService = alertService
        self.recordingDB = recordingDB
    }

    // MARK: - Running

    /// - Parameters:
    ///   - stride: Seconds of scenario time per step (one fix delivered per step).
    ///   - notamFixture: A NOTAM fixture feed (restamped to the scenario start), as `-OpenEFBNotamFixture` does.
    static func fly(
        _ name: String, stride: Double = 2, notamFixture: String? = nil, startOffset: Double = 0
    ) async throws -> ScenarioRun {
        let scenario = try FlightScenario.load(name)
        let alerts = IsraelAlertService(
            databaseProvider: { try IsraelAviationDatabase.bundled() },
            notamFetcher: nil,
            borderBuffers: IsraelBorderBuffers.bundled()
        )
        if let notamFixture {
            alerts.setReport(try ScenarioNotamFixture.report(path: notamFixture, scenarioStart: scenario.startDate),
                             now: scenario.startDate)
        }
        let dbPath = NSTemporaryDirectory() + "scenario-\(UUID().uuidString).sqlite"
        let recordingDB = try RecordingDatabase(dbPool: try DatabasePool(path: dbPath))
        let run = ScenarioRun(scenario: scenario, alertService: alerts, recordingDB: recordingDB)
        try await run.play(stride: stride, startOffset: startOffset)
        return run
    }

    private func play(stride: Double, startOffset: Double) async throws {
        ScenarioPlayback(scenario: scenario, startOffset: startOffset).prepare(appState)
        let clock = ScenarioClockBox(scenario.startDate)
        let (stream, feed) = Updates.makeStream()
        let service = LocationService(appState: appState, updates: { stream }, noFixGrace: .seconds(3600),
                                      clock: { clock.now })
        await service.startTracking()
        defer { service.stopTracking(); feed.finish() }
        let recorder = TrackRecorder(recordingDB: recordingDB, flightID: flightID)

        let fixes = scenario.fixes.filter { $0.t >= startOffset }
        var next = 0
        var previousDelivered = false
        var t = startOffset
        while t <= scenario.duration {
            let now = scenario.startDate.addingTimeInterval(t)
            clock.now = now
            while next < fixes.count, fixes[next].t < t - 1e-6 { next += 1 }
            var delivered = false
            if next < fixes.count, fixes[next].t < t + 1 {
                let location = scenario.location(for: fixes[next], timestamp: now)
                feed.yield(LocationUpdateSnapshot(location: location))
                if await wait({ self.appState.ownshipPosition === location }) {
                    await recorder.ingest(location)
                    delivered = true
                } else {
                    failedToDeliver += 1
                }
            } else if previousDelivered {
                // GPS loss starts: CoreLocation reports "location unavailable", the position stops updating.
                feed.yield(LocationUpdateSnapshot(location: nil, locationUnavailable: true))
                _ = await wait { !self.appState.gpsAvailable }
            }
            previousDelivered = delivered

            // MapContainerView: the 1 Hz GPS clock decides "no position"; a fix feeds the alert service.
            let status = GPSStatus.evaluate(
                fix: appState.ownshipPosition.map { GPSFix(location: $0, isStationary: appState.gpsStationary) },
                gpsAvailable: appState.gpsAvailable, now: now)
            let suspended = appState.region == .israel && status.isStale
            if suspended {
                alertService.suspend()
            } else if delivered, let position = appState.ownshipPosition {
                alertService.update(
                    region: appState.region, route: appState.activeRoute, position: position,
                    altitudeFeet: position.verticalAccuracy >= 0 ? appState.altitude : nil,
                    trackTrue: appState.track, groundSpeedKnots: appState.groundSpeed, now: now)
            }
            samples.append(Sample(t: t, alerts: alertService.alerts, route: appState.activeRoute,
                                  gpsStatus: status, suspended: suspended, hadFix: delivered))
            t += stride
        }
    }

    /// Poll (yielding the main actor) until `condition` holds; false when it never does.
    private func wait(_ condition: () -> Bool) async -> Bool {
        var spins = 0
        while !condition() {
            spins += 1
            if spins > 20_000 { return false }
            if spins % 100 == 0 { try? await Task.sleep(for: .milliseconds(1)) } else { await Task.yield() }
        }
        return true
    }

    // MARK: - Reading the flight

    func sample(at t: Double) -> Sample? { samples.min { abs($0.t - t) < abs($1.t - t) } }

    /// Samples whose alert banner holds an alert of `kind`.
    func samples(with kind: IsraelAlert.Kind) -> [Sample] {
        samples.filter { $0.alerts.contains { $0.kind == kind } }
    }

    func alerts(of kind: IsraelAlert.Kind) -> [IsraelAlert] {
        // Distinct by id and title: one id can change its text as the aircraft gets closer ("Entering" then "Inside").
        var seen = Set<String>(), out: [IsraelAlert] = []
        for alert in samples.flatMap(\.alerts) where alert.kind == kind && seen.insert(alert.id + "|" + alert.title).inserted { out.append(alert) }
        return out
    }

    /// The leg indices the route sequenced through, in order, without repeats.
    var legSequence: [Int] {
        var out: [Int] = []
        for leg in samples.compactMap({ $0.route?.currentLeg }) where out.last != leg { out.append(leg) }
        return out
    }

    /// Legs on which the altitude caution showed / the route was off.
    var altitudeCautionLegs: Set<Int> { Set(samples.compactMap { $0.route.flatMap { $0.following.isAltitudeCaution ? $0.currentLeg : nil } }) }
    var offRouteLegs: Set<Int> { Set(samples.compactMap { $0.route.flatMap { $0.following.isOffRoute ? $0.currentLeg : nil } }) }

    // MARK: - Debrief

    /// The CVFR debrief of the recorded track against the plan the scenario flew.
    func cvfrDebrief() throws -> CVFRDebrief {
        let database = try IsraelAviationDatabase.bundled()
        let points = try database.reportingPoints(in: .wholeCountry)
        let segments = try database.routeSegments(in: .wholeCountry)
        var byCode: [String: IsraelReportingPoint] = [:]
        for p in points where byCode[p.code] == nil { byCode[p.code] = p }
        let planned: [CVFRRouteLeg] = scenario.route.legs.compactMap { leg in
            segments.first { $0.id == leg.segmentId }.map { CVFRRouteLeg(segment: $0, forward: leg.forward) }
        }
        return CVFRDebriefBuilder.build(
            trackPoints: try recordingDB.trackPoints(forFlight: flightID), transcript: [],
            plannedLegs: planned.isEmpty ? nil : planned, segments: segments, points: byCode)
    }

    static var notamFixturePath: String {
        FlightScenario.scenarioDirectory.deletingLastPathComponent()
            .appendingPathComponent("fixtures/notams-closed-leg.json").path
    }
}

#endif
