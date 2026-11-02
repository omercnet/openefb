//
//  IsraelFlightPlanViewModel.swift
//  efb-212
//
//  Israel flight planning (IL-PLAN): pick departure, destination and via points, route over the open
//  CVFR network (IsraelRoutePlanner), check NOTAM closures for the departure window, build the FPL
//  message, and activate the route for navigation. The US flow stays in FlightPlanViewModel.
//
//  Nothing is sent anywhere: the pilot shares or e-mails the message himself.
//

import Foundation
import Observation
import CoreLocation
import SwiftData
import UIKit
import MapLibre

@Observable
@MainActor
final class IsraelFlightPlanViewModel {

    // MARK: - Pickers

    var departureQuery: String = ""
    var destinationQuery: String = ""
    var viaQuery: String = ""
    private(set) var departureResults: [IsraelAerodrome] = []
    private(set) var destinationResults: [IsraelAerodrome] = []
    private(set) var departure: IsraelAerodrome?
    private(set) var destination: IsraelAerodrome?
    /// Via point codes in flying order.
    private(set) var viaCodes: [String] = []
    /// Why the last via entry was refused; nil when fine.
    private(set) var viaError: String?

    // MARK: - Settings

    /// Planned off-block time. Drives the NOTAM closure check and DOF/ETD in the message.
    var departureTime: Date = IsraelFlightPlanViewModel.defaultDeparture() { didSet { scheduleReroute() } }
    /// Pilot override: plan over dashed by-request segments. The result is not fileable.
    var allowByRequest: Bool = false { didSet { scheduleReroute() } }
    /// Pilot override: plan over blue military segments. The result is not fileable.
    var allowMilitary: Bool = false { didSet { scheduleReroute() } }
    /// Persons on board for P/ when the aircraft profile has none.
    var personsOnBoardOverride: Int?

    // MARK: - Result

    private(set) var plan: IsraelRoutePlan?
    private(set) var routeError: IsraelRouteError?
    private(set) var issues: [IsraelFlightPlanIssue] = []
    /// false: the NOTAM feed was missing or too old, so closures were NOT applied.
    private(set) var closuresChecked: Bool = false
    private(set) var isRouting: Bool = false
    private(set) var fplText: String = ""
    private(set) var hebrewSummary: String = ""
    private(set) var isActive: Bool = false

    var canFile: Bool { plan != nil && IsraelFlightPlanValidator.canFile(issues) }
    var cruiseSpeedKnots: Double { aircraftProfile?.cruiseSpeedKts.flatMap { $0 > 0 ? $0 : nil } ?? 100 }

    // MARK: - Dependencies

    private let databaseProvider: @Sendable () throws -> any IsraelAviationDatabaseProtocol
    private let notamFetcher: (@Sendable () async throws -> IsraelNotamReport)?
    private let appState: AppState
    private let now: @Sendable () -> Date
    private var mapService: MapService?
    private var modelContext: ModelContext?
    private var routeTask: Task<Void, Never>?

    private var network: (points: [IsraelReportingPoint], segments: [IsraelRouteSegment])?

    init(
        appState: AppState,
        databaseProvider: @escaping @Sendable () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() },
        notamFetcher: (@Sendable () async throws -> IsraelNotamReport)? = { try await IsraelNotamService().fetchFeed(forceRefresh: false) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.appState = appState
        self.databaseProvider = databaseProvider
        self.notamFetcher = notamFetcher
        self.now = now
        self.departureTime = Self.defaultDeparture(now: now())
    }

    func configure(mapService: MapService?, modelContext: ModelContext) {
        self.mapService = mapService
        self.modelContext = modelContext
    }

    /// The next full hour, at least 30 minutes ahead (A-11: file at least 60 min before ETD).
    static func defaultDeparture(now: Date = Date()) -> Date {
        let hour: TimeInterval = 3600
        let next = (now.timeIntervalSince1970 / hour).rounded(.up) * hour
        return Date(timeIntervalSince1970: next - now.timeIntervalSince1970 < 1800 ? next + hour : next)
    }

    // MARK: - Search

    func searchDeparture() { departureResults = search(departureQuery) }
    func searchDestination() { destinationResults = search(destinationQuery) }

    private func search(_ query: String) -> [IsraelAerodrome] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2, let database = try? databaseProvider() else { return [] }
        return ((try? database.searchAerodromes(query: trimmed, limit: 8)) ?? [])
            .filter { $0.use != .military && $0.use != .foreign }
    }

    func selectDeparture(_ aerodrome: IsraelAerodrome) {
        departure = aerodrome
        departureQuery = aerodrome.code
        departureResults = []
        reroute()
    }

    func selectDestination(_ aerodrome: IsraelAerodrome) {
        destination = aerodrome
        destinationQuery = aerodrome.code
        destinationResults = []
        reroute()
    }

    // MARK: - Via points

    /// Add a reporting point by code. Refused when it is not a point of the network.
    func addVia(code rawCode: String) {
        let code = rawCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard !code.isEmpty else { return }
        guard let database = try? databaseProvider(), (try? database.reportingPoint(code: code)) != nil else {
            viaError = "\(code) is not a reporting point of the CVFR network."
            return
        }
        viaError = nil
        viaCodes.append(code)
        viaQuery = ""
        reroute()
    }

    func removeVia(at index: Int) {
        guard viaCodes.indices.contains(index) else { return }
        viaCodes.remove(at: index)
        reroute()
    }

    // MARK: - Routing

    private func scheduleReroute() {
        guard departure != nil, destination != nil else { return }
        reroute()
    }

    /// Route again with the current picks. Cancels a route still waiting on the NOTAM feed.
    func reroute() {
        routeTask?.cancel()
        guard departure != nil, destination != nil else { return }
        routeTask = Task { [weak self] in await self?.computeRoute() }
    }

    /// Awaitable form of `reroute()` for tests and the return-flight button.
    func computeRoute() async {
        guard let departure, let destination else { return }
        isRouting = true
        defer { isRouting = false }

        let loaded: (points: [IsraelReportingPoint], segments: [IsraelRouteSegment])
        do {
            loaded = try loadNetwork()
        } catch {
            plan = nil
            routeError = nil
            issues = []
            lastNetworkFailure = error.localizedDescription
            return
        }
        lastNetworkFailure = nil

        // NOTAM closures for the departure window. A missing or stale feed applies none and says so.
        var report: IsraelNotamReport?
        if let notamFetcher { report = try? await notamFetcher() }
        if Task.isCancelled { return }
        let current = now()
        let network = IsraelChartNetwork(points: loaded.points, segments: loaded.segments)
        let options = IsraelRouteOptions(allowByRequest: allowByRequest, allowMilitary: allowMilitary)
        let applied = IsraelRoutePlanner.closures(
            from: report, network: network, departure: departureTime, window: options.closureWindow, now: current
        )
        closures = applied
        closuresChecked = report.map {
            IsraelChartFeatureBuilder.drawableFreshness.contains($0.freshness(now: current).level)
        } ?? false

        let planner = IsraelRoutePlanner(points: loaded.points, segments: loaded.segments, closures: applied)
        do {
            let routed = try planner.route(
                from: departure.code, via: viaCodes, to: destination.code,
                cruiseSpeedKnots: cruiseSpeedKnots, options: options
            )
            plan = routed
            routeError = nil
            issues = IsraelFlightPlanValidator.validate(
                plan: routed, closures: applied, closuresChecked: closuresChecked, input: messageInput()
            )
            fplText = IsraelFlightPlanMessage.fpl(plan: routed, input: messageInput())
            hebrewSummary = IsraelFlightPlanMessage.hebrewSummary(plan: routed, input: messageInput())
            draw(routed)
        } catch {
            plan = nil
            routeError = error
            issues = []
            fplText = ""
            hebrewSummary = ""
            mapService?.clearRoute()
        }
        isActive = false
    }

    /// Why the Israel database could not be opened; nil when it loaded.
    private(set) var lastNetworkFailure: String?

    /// Segment closures applied to the current plan; kept so the message can be re-validated after a profile edit.
    private var closures: [Int: IsraelSegmentClosure] = [:]

    private func loadNetwork() throws -> (points: [IsraelReportingPoint], segments: [IsraelRouteSegment]) {
        if let network { return network }
        let database = try databaseProvider()
        let loaded = (
            points: try database.reportingPoints(in: .wholeCountry),
            segments: try database.routeSegments(in: .wholeCountry)
        )
        network = loaded
        return loaded
    }

    // MARK: - Return flight

    /// Swap departure and destination, reverse the via points and route again: one-way segments
    /// usually make the way back a different path.
    func planReturn() async {
        guard let oldDeparture = departure, let oldDestination = destination else { return }
        departure = oldDestination
        destination = oldDeparture
        departureQuery = oldDestination.code
        destinationQuery = oldDeparture.code
        viaCodes.reverse()
        await computeRoute()
    }

    // MARK: - Activate

    /// Feed the plan to navigation: route line, active leg, next point, DTG/ETE. Refused when the plan cannot be filed:
    /// flying a route the app knows is closed or needs approval is the pilot's explicit choice via the overrides, not a default.
    func activate() {
        guard let plan, let first = plan.legs.first, canFile else { return }
        let legs = plan.legs.map {
            ActiveRouteLeg(
                fromCode: $0.from.code, toCode: $0.to.code,
                toLatitude: $0.to.latitude, toLongitude: $0.to.longitude,
                altitudeText: $0.altitudeText, distanceNM: $0.distanceNM
            )
        }
        appState.activeRoute = ActiveRoute(legs: legs)
        appState.activeFlightPlan = true
        appState.directToAirport = nil
        appState.activePlanDeparture = first.from.code
        appState.activePlanDestination = plan.points.last?.code
        appState.distanceToNext = first.distanceNM
        appState.estimatedTimeEnroute = first.eteSeconds
        appState.activePlanFuelGallons = aircraftProfile?.fuelBurnGPH.map { plan.totalETESeconds / 3600 * $0 }
        appState.updateActiveRouteProgress()
        isActive = true
    }

    func clear() {
        routeTask?.cancel()
        departure = nil
        destination = nil
        departureQuery = ""
        destinationQuery = ""
        viaQuery = ""
        viaCodes = []
        viaError = nil
        departureResults = []
        destinationResults = []
        plan = nil
        routeError = nil
        issues = []
        fplText = ""
        hebrewSummary = ""
        isActive = false
        if appState.activeRoute != nil { appState.clearActiveNavigation() }
        mapService?.clearRoute()
    }

    // MARK: - Message input

    /// The active aircraft; the only aircraft when none is marked active (new profiles start inactive).
    private var aircraftProfile: SchemaV1.AircraftProfile? {
        guard let modelContext, let all = try? modelContext.fetch(FetchDescriptor<SchemaV1.AircraftProfile>()) else { return nil }
        return all.first(where: \.isActive) ?? (all.count == 1 ? all.first : nil)
    }

    /// The active pilot; the only pilot when none is marked active.
    private var pilotProfile: SchemaV1.PilotProfile? {
        guard let modelContext, let all = try? modelContext.fetch(FetchDescriptor<SchemaV1.PilotProfile>()) else { return nil }
        return all.first(where: \.isActive) ?? (all.count == 1 ? all.first : nil)
    }

    /// Aircraft and pilot profile fields for the message; missing ones stay nil/empty and surface as warnings.
    func messageInput() -> IsraelFlightPlanInput {
        let aircraft = aircraftProfile
        let pilot = pilotProfile
        var endurance: TimeInterval?
        if let capacity = aircraft?.fuelCapacityGallons, let burn = aircraft?.fuelBurnGPH, capacity > 0, burn > 0 {
            endurance = capacity / burn * 3600  // seconds
        }
        return IsraelFlightPlanInput(
            registration: aircraft?.nNumber ?? "",
            typeDesignator: aircraft?.icaoTypeDesignator,
            typeDescription: aircraft?.aircraftType,
            cruiseSpeedKnots: cruiseSpeedKnots,
            enduranceSeconds: endurance,
            personsOnBoard: personsOnBoardOverride ?? aircraft?.personsOnBoard,
            departure: departureTime,
            picName: pilot?.name ?? "",
            licenseNumber: pilot?.certificateNumber,
            phone: pilot?.phone,
            email: pilot?.email
        )
    }

    /// Rebuild the message after the pilot edited a profile or the persons on board.
    func refreshMessage() {
        guard let plan else { return }
        let input = messageInput()
        fplText = IsraelFlightPlanMessage.fpl(plan: plan, input: input)
        hebrewSummary = IsraelFlightPlanMessage.hebrewSummary(plan: plan, input: input)
        issues = IsraelFlightPlanValidator.validate(plan: plan, closures: closures, closuresChecked: closuresChecked, input: input)
    }

    /// Mail link with the message as the body, addressed to the pilot's own e-mail; the pilot forwards it
    /// to the filing address himself. Never sent automatically.
    func mailURL(to address: String? = nil) -> URL? {
        guard !fplText.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = address ?? pilotProfile?.email ?? ""
        components.queryItems = [
            URLQueryItem(name: "subject", value: "FPL \(IsraelFlightPlanMessage.registrationField(messageInput().registration))"),
            URLQueryItem(name: "body", value: fplText)
        ]
        return components.url
    }

    /// Windy route-weather link (fpl.co.il offers the same): the route's points as lat,lon pairs.
    var windyURL: URL? {
        guard let first = plan?.points.first, let last = plan?.points.last else { return nil }
        return URL(string: String(
            format: "https://www.windy.com/distance/%.4f/%.4f/%.4f/%.4f",
            first.latitude, first.longitude, last.latitude, last.longitude
        ))
    }

    // MARK: - Map

    private func draw(_ plan: IsraelRoutePlan) {
        guard let mapService, let first = plan.points.first, let last = plan.points.last else { return }
        mapService.updateRoute(path: plan.polyline)
        mapService.addRoutePins(departure: first.coordinate, destination: last.coordinate)
        guard let mapView = mapService.mapView else { return }
        let lats = plan.points.map(\.latitude), lons = plan.points.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return }
        let bounds = MLNCoordinateBounds(
            sw: CLLocationCoordinate2D(latitude: minLat - 0.05, longitude: minLon - 0.05),
            ne: CLLocationCoordinate2D(latitude: maxLat + 0.05, longitude: maxLon + 0.05)
        )
        mapView.setVisibleCoordinateBounds(
            bounds, edgePadding: UIEdgeInsets(top: 80, left: 80, bottom: 80, right: 80), animated: false, completionHandler: nil
        )
    }
}
