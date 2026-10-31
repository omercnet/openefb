//
//  MapViewModel.swift
//  efb-212
//
//  Map coordination -- airport loading sized from the visible bounds, follow-ownship
//  camera with track-up, GPS status clock, layer state, chart expiration state
//  (INFRA-03). Debounces region changes by 500ms and skips queries when the visible
//  region barely changed (see MapQueryRegion).
//

import Foundation
import Observation
import CoreLocation
import MapLibre

@Observable
@MainActor
final class MapViewModel {

    // MARK: - Dependencies

    let appState: AppState
    let mapService: MapService
    let databaseService: any DatabaseServiceProtocol

    // MARK: - Plan 04 Dependencies (Weather, TFR, Proximity)

    /// Optional weather service -- set by MapContainerView after creation.
    var weatherService: (any WeatherServiceProtocol)?
    /// Optional TFR service -- set by MapContainerView after creation.
    var tfrService: (any TFRServiceProtocol)?
    /// Optional AIRMET/SIGMET service -- set by MapContainerView after creation.
    var airSigmetService: (any AirSigmetServiceProtocol)?
    /// Optional proximity alert service -- set by MapContainerView after creation.
    var proximityAlertService: ProximityAlertService?

    // MARK: - State

    var visibleAirports: [Airport] = []
    var visibleNavaids: [Navaid] = []
    var visibleAirspaces: [Airspace] = []
    var isLoadingAirports: Bool = false
    var lastError: EFBError?

    // MARK: - Follow / Orientation (F3, F4, F7)

    /// Follow-ownship state. Following by default; a user pan suspends it.
    private(set) var followState = FollowModeState()

    /// True while the camera re-centres on every GPS fix.
    var isFollowing: Bool { followState.isFollowing }

    /// Current map rotation in degrees clockwise from north (0 = north-up). Drives the
    /// north indicator while rotated.
    private(set) var mapDirection: Double = 0   // degrees

    /// Zoom used when the first fix arrives and the map jumps from CONUS to the aircraft.
    static let firstFixZoom: Double = 10

    // MARK: - GPS Status (F5)

    /// Wall clock advanced once a second so the status chip ages the last fix.
    private(set) var now: Date = Date()
    private var clockTask: Task<Void, Never>?
    private var lastAppliedStale: Bool?

    /// Position quality derived from the stored fix and the clock.
    var gpsStatus: GPSStatus {
        GPSStatus.evaluate(
            fix: appState.ownshipPosition.map { GPSFix(location: $0, isStationary: appState.gpsStationary) },
            gpsAvailable: appState.gpsAvailable,
            now: now
        )
    }

    // MARK: - Chart Expiration (INFRA-03)

    /// Expiry of the FAA sectional cycle in force. The online sectional is always the current
    /// edition; downloaded regions are checked against this cycle separately (OfflineStatus).
    var chartExpirationDate: Date? { SectionalCycle.current(at: now).expires }

    /// Whole days until the current sectional cycle ends (drives the expiry warning badge).
    var chartDaysRemaining: Int? { SectionalCycle.daysRemaining(at: now) }

    // MARK: - Weather Data Age

    /// Oldest observation time from the last weather fetch, for staleness indicator.
    /// Nil when no weather data is loaded or weather layer is off.
    var oldestWeatherObservationTime: Date? {
        get { _oldestWeatherObservationTime }
    }
    private(set) var _oldestWeatherObservationTime: Date?

    // MARK: - Private

    private var lastQueryCenter: CLLocationCoordinate2D?
    private var lastQueryRadiusNM: Double?
    private var regionChangeDebounceTask: Task<Void, Never>?
    private var hasCenteredOnFirstFix: Bool = false
    private var lastOwnshipTimestamp: Date?

    // MARK: - Init

    init(appState: AppState, mapService: MapService, databaseService: any DatabaseServiceProtocol) {
        self.appState = appState
        self.mapService = mapService
        self.databaseService = databaseService
    }

    // MARK: - Style Loaded

    /// Called when map style finishes loading. Configures layers and loads initial data.
    func onMapStyleLoaded(style: MLNStyle) {
        mapService.onStyleLoaded(style: style)

        // Load initial data for the CONUS view (max radius; thinned to the cap)
        let conusCenter = CLLocationCoordinate2D(latitude: 39.0, longitude: -98.0)
        loadDataForRegion(center: conusCenter, radiusNM: MapQueryRegion.maxRadiusNM)

        // Sync current layer visibility, base map style, and sectional opacity
        for layer in MapLayer.allCases {
            let visible = appState.visibleLayers.contains(layer)
            mapService.setLayerVisibility(layer, visible: visible)
        }
        mapService.setMapStyle(appState.mapStyle)
        mapService.setSectionalOpacity(appState.sectionalOpacity)
        mapService.setOwnshipStale(gpsStatus.isStale)
    }

    // MARK: - Region Changed

    /// Debounce 500ms. Query radius comes from the visible bounds; the database is hit again
    /// only when the centre moved > 5 NM or the radius changed > 20% (zoom in place).
    func onRegionChanged(
        center: CLLocationCoordinate2D,
        zoom: Double,
        northEast: CLLocationCoordinate2D,
        southWest: CLLocationCoordinate2D,
        direction: Double
    ) {
        mapDirection = direction
        regionChangeDebounceTask?.cancel()
        regionChangeDebounceTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(500))
            } catch {
                return  // Cancelled
            }

            guard let self else { return }

            appState.mapCenter = center
            appState.mapZoom = zoom
            appState.mapVisibleBounds = OfflineRegionBounds(
                south: southWest.latitude, west: southWest.longitude,
                north: northEast.latitude, east: northEast.longitude
            )

            let radiusNM = MapQueryRegion.radiusNM(center: center, northEast: northEast, southWest: southWest)
            guard MapQueryRegion.shouldRequery(
                lastCenter: lastQueryCenter,
                lastRadiusNM: lastQueryRadiusNM,
                center: center,
                radiusNM: radiusNM
            ) else { return }

            loadDataForRegion(center: center, radiusNM: radiusNM)
            lastQueryCenter = center
            lastQueryRadiusNM = radiusNM
        }
    }

    /// Live camera rotation while a gesture or animation is in progress (north indicator).
    func onMapDirectionChanged(_ direction: Double) {
        if abs(direction - mapDirection) > 0.1 {
            mapDirection = direction
        }
    }

    // MARK: - Follow Ownship

    /// The user dragged or rotated the map: stop following until Recenter.
    func onUserMovedMap() {
        guard followState.isFollowing else { return }
        followState.userMovedMap()
    }

    /// Recenter button: re-engage follow and put the aircraft back in the centre at the
    /// current zoom, oriented for the current map mode.
    func recenter() {
        followState.recenter()
        guard let position = appState.ownshipPosition else { return }
        mapService.setCamera(
            center: position.coordinate,
            zoom: nil,
            direction: cameraDirection,
            animated: true
        )
    }

    /// Called for every new GPS fix. Draws the chevron, handles the first-fix jump from the
    /// CONUS view, and keeps the camera on the aircraft while following. Duplicate calls for
    /// the same fix are ignored.
    func onOwnshipUpdated(_ location: CLLocation) {
        guard location.timestamp != lastOwnshipTimestamp else { return }
        lastOwnshipTimestamp = location.timestamp

        mapService.updateOwnship(location: location, heading: appState.track)

        if !hasCenteredOnFirstFix {
            hasCenteredOnFirstFix = true
            // No animation: follow takes over on the next fix and would cut it short anyway.
            mapService.setCamera(
                center: location.coordinate,
                zoom: Self.firstFixZoom,
                direction: cameraDirection,
                animated: false
            )
            return
        }

        guard followState.isFollowing else { return }
        mapService.setCamera(
            center: location.coordinate,
            zoom: nil,
            direction: cameraDirection,
            animated: false
        )
    }

    /// Camera heading for the current map mode: GPS track for track-up, north otherwise.
    private var cameraDirection: Double {
        appState.mapMode == .trackUp ? appState.track : 0   // degrees
    }

    // MARK: - Map Mode (F4, F7)

    /// Switch orientation. Track-up rotates the camera to the GPS track ourselves and keeps
    /// our chevron; MapLibre's user-tracking mode is never used (it draws the system puck).
    func setMapMode(_ mode: MapMode) {
        appState.mapMode = mode
        mapService.setCamera(
            center: followState.isFollowing ? appState.ownshipPosition?.coordinate : nil,
            zoom: nil,
            direction: cameraDirection,
            animated: true
        )
    }

    // MARK: - GPS Clock (F5)

    /// Start the 1 Hz clock that ages the last fix and greys the chevron when stale.
    func startGPSClock() {
        guard clockTask == nil else { return }
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                tickGPSClock(now: Date())
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func stopGPSClock() {
        clockTask?.cancel()
        clockTask = nil
    }

    /// Advance the clock and push staleness to the map. Exposed for tests.
    func tickGPSClock(now: Date) {
        self.now = now
        let stale = gpsStatus.isStale
        if stale != lastAppliedStale {
            lastAppliedStale = stale
            mapService.setOwnshipStale(stale)
        }
    }

    // MARK: - First Location (legacy entry point)

    /// Kept for callers that only know the first fix arrived; follow handles the camera.
    func onFirstLocationReceived(location: CLLocation) {
        onOwnshipUpdated(location)
    }

    // MARK: - Airport Tapping

    func onAirportTapped(icao: String) {
        appState.selectedAirportID = icao
        appState.isPresentingAirportInfo = true
    }

    // MARK: - Layer Toggles

    /// Toggle a layer in AppState's visibleLayers set and update MapService visibility.
    func toggleLayer(_ layer: MapLayer) {
        if appState.visibleLayers.contains(layer) {
            appState.visibleLayers.remove(layer)
            mapService.setLayerVisibility(layer, visible: false)
        } else {
            appState.visibleLayers.insert(layer)
            mapService.setLayerVisibility(layer, visible: true)

            // If a data layer is toggled on, load just that layer for the current region
            let center = appState.mapCenter
            let radiusNM = lastQueryRadiusNM ?? MapQueryRegion.maxRadiusNM
            switch layer {
            case .airports:
                isLoadingAirports = true
                loadAirports(center: center, radiusNM: radiusNM)
                isLoadingAirports = false
            case .navaids:
                loadNavaids(center: center, radiusNM: radiusNM)
            case .airspace:
                loadAirspaces(center: center, radiusNM: radiusNM)
            case .weatherDots:
                Task { await loadWeatherDots() }
            case .tfrs:
                Task { await loadTFRs() }
            case .advisories:
                Task { await loadAdvisories() }
            default:
                break
            }
        }
    }

    // MARK: - Data Loading

    private func loadDataForRegion(center: CLLocationCoordinate2D, radiusNM: Double) {
        isLoadingAirports = true
        loadAirports(center: center, radiusNM: radiusNM)
        if appState.visibleLayers.contains(.navaids) {
            loadNavaids(center: center, radiusNM: radiusNM)
        }
        if appState.visibleLayers.contains(.airspace) {
            loadAirspaces(center: center, radiusNM: radiusNM)
        }

        isLoadingAirports = false

        // Load weather dots if layer visible (Plan 04)
        if appState.visibleLayers.contains(.weatherDots) {
            Task { await loadWeatherDots() }
        }

        // Load TFRs if layer visible (Plan 04)
        if appState.visibleLayers.contains(.tfrs) {
            Task { await loadTFRs() }
        }

        // Load AIRMET/SIGMETs if layer visible
        if appState.visibleLayers.contains(.advisories) {
            Task { await loadAdvisories() }
        }
    }

    /// Airports for the region; thinned at low zoom so MapLibre never gets thousands of points.
    private func loadAirports(center: CLLocationCoordinate2D, radiusNM: Double) {
        do {
            let airports = try databaseService.airports(near: center, radiusNM: radiusNM)
            let shown = MapQueryRegion.thin(airports, around: center)
            visibleAirports = shown
            mapService.updateAirports(shown)
        } catch {
            lastError = EFBError.databaseCorrupted
        }
    }

    private func loadNavaids(center: CLLocationCoordinate2D, radiusNM: Double) {
        do {
            let navaids = try databaseService.navaids(near: center, radiusNM: radiusNM)
            visibleNavaids = navaids
            mapService.updateNavaids(navaids)
        } catch {
            // Non-critical -- continue without navaids
        }
    }

    private func loadAirspaces(center: CLLocationCoordinate2D, radiusNM: Double) {
        do {
            let airspaces = try databaseService.airspaces(near: center, radiusNM: min(radiusNM, 300))
            visibleAirspaces = airspaces
            mapService.updateAirspaces(airspaces)
        } catch {
            // Non-critical -- continue without airspaces
        }
    }

    // MARK: - Weather Dot Loading (Plan 04)

    /// Fetch weather for visible airports and update map weather dots.
    func loadWeatherDots() async {
        guard let weatherService else { return }
        guard !visibleAirports.isEmpty else { return }

        // Build station ID list and coordinate lookup from visible airports
        let stationIDs = visibleAirports.map { $0.icao }
        var stationCoordinates: [String: CLLocationCoordinate2D] = [:]
        for airport in visibleAirports {
            stationCoordinates[airport.icao] = airport.coordinate
        }

        do {
            let weather = try await weatherService.fetchWeatherForStations(stationIDs)
            mapService.updateWeatherDots(weather, stationCoordinates: stationCoordinates)

            // Track oldest observation for weather age badge
            _oldestWeatherObservationTime = weather.compactMap { $0.observationTime }.min()
        } catch {
            // Weather fetch failure is non-critical -- dots just won't update
        }
    }

    // MARK: - TFR Loading

    /// Last loaded TFRs (all published, active or upcoming), used for proximity alerts.
    private(set) var loadedTFRs: [TFR] = []
    /// When the displayed TFR data was fetched from the FAA; nil until the first fetch.
    private(set) var tfrFetchedAt: Date?
    /// True when the last load failed with no cached data to fall back on.
    private(set) var tfrLoadFailed: Bool = false

    /// Load TFRs (service caches for 10 minutes) and redraw the TFR layer.
    func loadTFRs() async {
        guard let tfrService else { return }

        do {
            let snapshot = try await tfrService.currentTFRs()
            loadedTFRs = snapshot.tfrs
            tfrFetchedAt = snapshot.fetchedAt
            tfrLoadFailed = false
            mapService.updateTFRs(snapshot.tfrs)
        } catch {
            // Service already falls back to its cache; reaching here means nothing was ever fetched
            tfrLoadFailed = true
        }
    }

    // MARK: - AIRMET / SIGMET Loading

    /// When the displayed advisory data was fetched; nil until the first fetch.
    private(set) var advisoriesFetchedAt: Date?
    /// True when the last load failed with no cached data to fall back on.
    private(set) var advisoriesLoadFailed: Bool = false

    /// Load advisories (service caches for 10 minutes) and draw only those valid now.
    func loadAdvisories() async {
        guard let airSigmetService else { return }

        do {
            let snapshot = try await airSigmetService.currentAdvisories()
            advisoriesFetchedAt = snapshot.fetchedAt
            advisoriesLoadFailed = false
            mapService.updateAdvisories(snapshot.valid(at: Date()))
        } catch {
            advisoriesLoadFailed = true
        }
    }

    // MARK: - Proximity Alert Check (Plan 04)

    /// Check airspace/TFR proximity for current ownship position.
    /// Called from MapContainerView on GPS updates, throttled internally to 10s.
    func checkProximityAlerts() {
        guard let position = appState.ownshipPosition else { return }
        proximityAlertService?.checkProximity(position: position, altitude: appState.altitude)
        if appState.visibleLayers.contains(.tfrs) {
            proximityAlertService?.checkTFRProximity(position: position, tfrs: loadedTFRs)
        }
    }
}
