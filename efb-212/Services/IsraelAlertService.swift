//
//  IsraelAlertService.swift
//  efb-212
//
//  Israel in-flight alerts (IL-ALERTS, efb-aac.9): closed legs on the active route, P/R/D areas and
//  CTRs on the projected track, border buffers, the CVFR squawk reminder. The rules live in
//  `IsraelAlertEvaluator`; this class adds what needs state: the NOTAM feed, throttling, a hold time
//  so an alert does not flicker at a boundary, and "newly raised" detection for the haptic.
//
//  Israel only: outside the Israel region it shows nothing, and the US ProximityAlertService is untouched.
//

import Foundation
import CoreLocation
import Observation
import os
@MainActor
protocol IsraelAlertServiceProtocol: AnyObject {
    var alerts: [IsraelAlert] { get }
    func update(
        region: Region, route: ActiveRoute?, position: CLLocation,
        altitudeFeet: Double?, trackTrue: Double, groundSpeedKnots: Double, now: Date
    )
}

@Observable
@MainActor
final class IsraelAlertService: IsraelAlertServiceProtocol {

    // MARK: - Output

    /// Alerts to show, highest priority first (red before amber).
    private(set) var alerts: [IsraelAlert] = []
    /// Called once for every alert that was not showing a moment ago (the map plays one haptic).
    @ObservationIgnored var onRaised: (([IsraelAlert]) -> Void)?

    // MARK: - Configuration

    /// Evaluate at most this often -- seconds.
    static let evaluationInterval: TimeInterval = 5
    /// An alert that stops applying stays up this long (no flicker on a boundary) -- seconds.
    static let holdSeconds: TimeInterval = 10
    /// Airspace lookup radius around the aircraft; covers the 2-minute projection at 180 kt (6 NM) -- nautical miles.
    static let lookupRadiusNM = 12.0
    /// Re-read the NOTAM feed this often (the relay caches 5 min) -- seconds.
    static let closureRefreshInterval: TimeInterval = 300

    // MARK: - Dependencies

    @ObservationIgnored private let databaseProvider: @Sendable () throws -> any IsraelAviationDatabaseProtocol
    @ObservationIgnored private let notamFetcher: (@Sendable () async throws -> IsraelNotamReport)?
    @ObservationIgnored private let borderBuffers: IsraelBorderBuffers?
    @ObservationIgnored private let logger = Logger(subsystem: "quartermint.efb-212", category: "IsraelAlerts")

    // MARK: - State

    @ObservationIgnored private var database: (any IsraelAviationDatabaseProtocol)?
    @ObservationIgnored private var network: IsraelChartNetwork?
    @ObservationIgnored private var gazaRings: [[[Double]]]?
    @ObservationIgnored private var closureMarks: [Int: IsraelChartClosureMark] = [:]
    @ObservationIgnored private var report: IsraelNotamReport?
    @ObservationIgnored private var lastEvaluation: Date?
    @ObservationIgnored private var lastClosureFetch: Date?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var held: [String: (alert: IsraelAlert, lastSeen: Date)] = [:]
    @ObservationIgnored private var squawk = IsraelSquawkReminder()

    init(
        databaseProvider: @escaping @Sendable () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() },
        notamFetcher: (@Sendable () async throws -> IsraelNotamReport)? = { try await IsraelAlertService.defaultFetch() },
        borderBuffers: IsraelBorderBuffers? = IsraelBorderBuffers.bundled()
    ) {
        self.databaseProvider = databaseProvider
        self.notamFetcher = notamFetcher
        self.borderBuffers = borderBuffers
    }

    // MARK: - Update

    /// Evaluate for a fix. Throttled to `evaluationInterval`; cheap enough to call on every location update.
    func update(
        region: Region, route: ActiveRoute?, position: CLLocation,
        altitudeFeet: Double?, trackTrue: Double, groundSpeedKnots: Double, now: Date = Date()
    ) {
        guard region == .israel else {
            reset()
            return
        }
        // The squawk reminder watches every fix: a departure takes seconds.
        _ = squawk.update(groundSpeedKnots: groundSpeedKnots, now: now)

        if let last = lastEvaluation, now.timeIntervalSince(last) < Self.evaluationInterval { return }
        lastEvaluation = now

        loadDatabaseIfNeeded()
        refreshClosuresIfNeeded(now: now)

        let coordinate = position.coordinate
        var current: [IsraelAlert] = []
        current += IsraelAlertEvaluator.closureAlerts(route: route, marks: closureMarks)

        if let database {
            do {
                let nearby = try database.airspaces(near: coordinate, radiusNM: Self.lookupRadiusNM)
                current += IsraelAlertEvaluator.airspaceAlerts(
                    position: coordinate, altitudeFeet: altitudeFeet, trackTrue: trackTrue,
                    groundSpeedKnots: groundSpeedKnots, airspaces: nearby,
                    ctrContact: { code in Self.ctrContact(code: code, database: database) }
                )
            } catch {
                logger.warning("Israel airspace lookup failed: \(error.localizedDescription)")
            }
        }
        current += IsraelAlertEvaluator.borderAlerts(
            position: coordinate, trackTrue: trackTrue, groundSpeedKnots: groundSpeedKnots,
            buffers: borderBuffers, gazaRings: gazaRings ?? []
        )
        if let reminder = squawk.alert(now: now) { current.append(reminder) }

        publish(current, now: now)
    }

    /// Merge the fresh alerts with the held ones: an alert absent for less than `holdSeconds` stays up.
    private func publish(_ current: [IsraelAlert], now: Date) {
        let before = Set(alerts.map(\.id))
        for alert in current { held[alert.id] = (alert, now) }
        held = held.filter { now.timeIntervalSince($0.value.lastSeen) <= Self.holdSeconds }
        let shown = IsraelAlert.sorted(held.values.map(\.alert))
        if shown != alerts { alerts = shown }
        let raised = shown.filter { !before.contains($0.id) }
        if !raised.isEmpty { onRaised?(raised) }
    }

    /// No fresh fix: drop every shown and held alert (the last ones describe a place the aircraft may have left),
    /// and evaluate again at the next fix. The squawk reminder keeps its state: it watches speed, not position.
    func suspend() {
        guard !alerts.isEmpty || !held.isEmpty else { return }
        alerts = []
        held = [:]
        lastEvaluation = nil
    }

    private func reset() {
        guard !alerts.isEmpty || !held.isEmpty || lastEvaluation != nil else { return }
        alerts = []
        held = [:]
        lastEvaluation = nil
        squawk = IsraelSquawkReminder()
    }

    // MARK: - Default feed

    /// The relay feed; DEBUG builds read the notams.json named by the `IsraelChartDebugNotamsPath` launch
    /// argument instead (screenshots, UI tests), like the chart and the briefing. Never in release builds.
    nonisolated static func defaultFetch() async throws -> IsraelNotamReport {
        #if DEBUG
        if let path = UserDefaults.standard.string(forKey: "IsraelChartDebugNotamsPath") {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            let feed = try IsraelNotamService.decoder.decode(IsraelNotamFeed.self, from: data)
            return IsraelNotamReport(feed: feed, fetchedAt: Date(), refreshFailed: false)
        }
        #endif
        return try await IsraelNotamService().fetchFeed(forceRefresh: false)
    }

    // MARK: - Data

    private func loadDatabaseIfNeeded() {
        guard database == nil else { return }
        do {
            let db = try databaseProvider()
            database = db
            gazaRings = Self.loadGazaRings(from: db)
            let bounds = IsraelGeoBounds.wholeCountry
            network = IsraelChartNetwork(points: try db.reportingPoints(in: bounds), segments: try db.routeSegments(in: bounds))
        } catch {
            logger.warning("Israel aviation database unavailable: \(error.localizedDescription)")
        }
    }

    /// Outer rings of the CAAI LLP19 polygon as [lat, lon] vertices.
    private static func loadGazaRings(from database: any IsraelAviationDatabaseProtocol) -> [[[Double]]] {
        guard let areas = try? database.airspaces(ofKind: .prohibited) else { return [] }
        return areas
            .filter { $0.code == IsraelBorderBuffers.gazaAreaCode }
            .flatMap { $0.polygons }
            .compactMap { $0.first }
            .map { ring in ring.map { [$0.latitude, $0.longitude] } }
    }

    private static func ctrContact(code: String, database: any IsraelAviationDatabaseProtocol) -> (name: String, twr: String?)? {
        guard let aerodrome = (try? database.aerodrome(code: code)) ?? nil else { return nil }
        return (IsraelAlertEvaluator.shortAerodromeName(aerodrome.nameEnglish), IsraelAlertEvaluator.towerContact(of: aerodrome))
    }

    /// Fetch the NOTAM feed in the background; the marks are rebuilt at every evaluation so a feed that ages
    /// past the NOTAM limit stops raising closures.
    private func refreshClosuresIfNeeded(now: Date) {
        if let notamFetcher, fetchTask == nil,
           lastClosureFetch.map({ now.timeIntervalSince($0) >= Self.closureRefreshInterval }) ?? true {
            lastClosureFetch = now
            fetchTask = Task { [weak self] in
                let fetched = try? await notamFetcher()
                guard let self else { return }
                if let fetched { self.report = fetched }
                self.fetchTask = nil
            }
        }
        if let network {
            closureMarks = IsraelChartFeatureBuilder.closures(from: report, network: network, now: now).marks
        }
    }

    /// Test and preview hook: use `report` as the NOTAM feed now.
    func setReport(_ report: IsraelNotamReport?, now: Date = Date()) {
        self.report = report
        if let network {
            closureMarks = IsraelChartFeatureBuilder.closures(from: report, network: network, now: now).marks
        }
    }
}
