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
    /// Airspace entries predicted ahead of the aircraft (Direction 2 stage 2), run on every fix.
    @ObservationIgnored private let predictionService = PredictionService()

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
    private let regionChangeDebounce: Duration
    private var lastQueryWasLowZoom: Bool?
    private var hasCenteredOnFirstFix: Bool = false
    private var lastOwnshipTimestamp: Date?

    // MARK: - Init

    /// `regionChangeDebounce` is injectable so tests don't race real time (production: 500 ms).
    init(
        appState: AppState,
        mapService: MapService,
        databaseService: any DatabaseServiceProtocol,
        regionChangeDebounce: Duration = .milliseconds(500)
    ) {
        self.appState = appState
        self.mapService = mapService
        self.databaseService = databaseService
        self.regionChangeDebounce = regionChangeDebounce
    }

    // MARK: - Style Loaded

    /// Called when map style finishes loading. Configures layers and loads initial data.
    func onMapStyleLoaded(style: MLNStyle) {
        mapService.onStyleLoaded(style: style)
        mapService.israelChart.setActive(appState.region == .israel)
        mapService.israelLSA.setActive(appState.region == .israel)
        syncOfficialChart()

        // Load initial data for the CONUS view (default zoom is low: towered airports only)
        let region = appState.region
        let homeCenter = region.defaultCenter
        loadDataForRegion(
            center: homeCenter,
            radiusNM: MapQueryRegion.maxRadiusNM,
            towerRadiusNM: MapQueryRegion.isLowZoom(appState.mapZoom) ? MapQueryRegion.maxLowZoomRadiusNM : nil
        )

        // Sync current layer visibility, base map style, and sectional opacity
        for layer in MapLayer.allCases {
            let visible = appState.visibleLayers.contains(layer)
            mapService.setLayerVisibility(layer, visible: visible)
        }
        mapService.setMapStyle(appState.mapStyle, sectional: appState.visibleLayers.contains(.sectional))
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
        let debounce = regionChangeDebounce
        regionChangeDebounceTask = Task { [weak self] in
            do {
                try await Task.sleep(for: debounce)
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

            let cappedRadiusNM = MapQueryRegion.radiusNM(center: center, northEast: northEast, southWest: southWest)
            let isLowZoom = MapQueryRegion.isLowZoom(zoom)
            // Low zoom queries the whole visible region (uncapped); otherwise the capped radius.
            let queryRadiusNM = isLowZoom
                ? MapQueryRegion.lowZoomRadiusNM(center: center, northEast: northEast, southWest: southWest)
                : cappedRadiusNM
            // Crossing the low-zoom threshold changes what is queried, whatever the geometry says.
            guard isLowZoom != lastQueryWasLowZoom || MapQueryRegion.shouldRequery(
                lastCenter: lastQueryCenter,
                lastRadiusNM: lastQueryRadiusNM,
                center: center,
                radiusNM: queryRadiusNM
            ) else { return }

            loadDataForRegion(
                center: center, radiusNM: cappedRadiusNM,
                towerRadiusNM: isLowZoom ? queryRadiusNM : nil
            )
            lastQueryCenter = center
            lastQueryRadiusNM = queryRadiusNM
            lastQueryWasLowZoom = isLowZoom
        }
    }

    /// Completes when the pending debounced region change has been applied. Tests use this
    /// instead of sleeping past the debounce.
    func settleRegionChange() async {
        await regionChangeDebounceTask?.value
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
        // Minute-ruled track ahead, drawn wherever ownship is (it moves with every fix, in or out of
        // the region): track degrees true, ground speed knots; cleared below 30 kt by the service.
        mapService.updateTrackRuler(origin: location.coordinate, trackTrue: appState.track, groundSpeedKnots: appState.groundSpeed)
        // Predicted airspace entries along the same track (Layers > Predictions); off or stale clears them.
        predictionService.update(
            location: location, appState: appState, isStale: gpsStatus.isStale, enabled: FlightLogVisibility.predictionsOn()
        )
        mapService.updatePredictionMarkers(appState.predictedEvents)

        // A fix outside the selected region (e.g. a US simulator fix while viewing Israel) is
        // drawn but never pulls the camera away from the region's home view.
        guard appState.region.contains(location.coordinate) else { return }

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
            // A ruler from a frozen fix would read as current; the next live fix redraws it.
            if stale {
                mapService.updateTrackRuler(origin: nil, trackTrue: appState.track, groundSpeedKnots: appState.groundSpeed)
                // Predictions from a frozen fix would read as current too.
                clearPredictions()
            }
        }
    }

    /// Drops predicted events, their map diamonds and the debounce history (stale fix, or the
    /// Predictions toggle turned off); the next enabled fix starts fresh.
    func clearPredictions() {
        predictionService.clear(appState: appState)
        mapService.updatePredictionMarkers([])
    }

    // MARK: - First Location (legacy entry point)

    /// Kept for callers that only know the first fix arrived; follow handles the camera.
    func onFirstLocationReceived(location: CLLocation) {
        onOwnshipUpdated(location)
    }

    // MARK: - Airport Tapping

    func onAirportTapped(icao: String) {
        appState.selectedAirportID = icao
        appState.stripColumn = .airport
    }

    // MARK: - Layer Toggles

    /// Toggle a layer in AppState's visibleLayers set and update MapService visibility.
    func toggleLayer(_ layer: MapLayer) {
        guard appState.region.supports(layer) else { return }  // no source in this region
        if appState.visibleLayers.contains(layer) {
            appState.visibleLayers.remove(layer)
            mapService.setLayerVisibility(layer, visible: false)
        } else {
            appState.visibleLayers.insert(layer)
            mapService.setLayerVisibility(layer, visible: true)

            // If a data layer is toggled on, load just that layer for the current region
            let center = appState.mapCenter
            let queryRadiusNM = lastQueryRadiusNM ?? MapQueryRegion.maxRadiusNM
            let radiusNM = min(queryRadiusNM, MapQueryRegion.maxRadiusNM)
            switch layer {
            case .airports:
                isLoadingAirports = true
                loadAirports(
                    center: center, radiusNM: radiusNM,
                    towerRadiusNM: MapQueryRegion.isLowZoom(appState.mapZoom) ? queryRadiusNM : nil
                )
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

    // MARK: - Region Switch (IL-2)
    /// The one switch the Israel base-chart code (IL-9) calls when the official CAAI chart is shown or
    /// removed: resets the CVFR overlay to the matching defaults (`IsraelChartDefaults`).
    func setOfficialChartPresent(_ present: Bool) {
        guard appState.region == .israel else { return }
        mapService.israelChart.setOfficialChartPresent(present)
        appState.visibleLayers.subtract(MapLayer.cvfrChart)
        appState.visibleLayers.formUnion(IsraelChartDefaults.visibleLayers(officialChartPresent: present))
        for layer in MapLayer.cvfrChart {
            mapService.setLayerVisibility(layer, visible: appState.visibleLayers.contains(layer))
        }
    }

    /// Official chart pack state last pushed to the map; the CVFR layer defaults are reset only on a change,
    /// so the pilot's own layer choices survive a style reload.
    private var officialChartApplied = false

    /// Show the downloaded official CAAI chart as the Israel base chart, or remove it (nothing downloaded,
    /// pack deleted, or another region). Call when the style loads, the region changes, or the pack changes.
    func syncOfficialChart() {
        let url = appState.region == .israel ? IsraelChartStore.shared.packURL : nil
        mapService.israelOfficialChart.setPack(url)
        let present = url != nil
        guard present != officialChartApplied else { return }
        officialChartApplied = present
        setOfficialChartPresent(present)
    }


    /// The pilot switched region (AppState already reset the centre, zoom and layer set): hide
    /// layers the region has no source for, clear their data so it can't read as current,
    /// fly to the region's home view and reload the region's sources.
    func regionDidChange() {
        let region = appState.region
        // Predictions were made from the old region's airspace; the next fix predicts afresh.
        clearPredictions()
        mapService.israelChart.setActive(region == .israel)
        mapService.israelLSA.setActive(region == .israel)
        syncOfficialChart()
        for layer in MapLayer.allCases {
            mapService.setLayerVisibility(layer, visible: appState.visibleLayers.contains(layer))
        }
        mapService.setMapStyle(appState.mapStyle, sectional: appState.visibleLayers.contains(.sectional))

        if !region.isAvailable(.tfrs) {
            loadedTFRs = []
            tfrFetchedAt = nil
            tfrLoadFailed = false
            tfrOverlay = .current
            mapService.updateTFRs([])
        }
        if !region.isAvailable(.advisories) {
            loadedAdvisories = []
            advisoriesFetchedAt = nil
            advisoriesLoadFailed = false
            advisoryOverlay = .current
            mapService.updateAdvisories([])
        }
        if !region.isAvailable(.navaids) {
            visibleNavaids = []
            mapService.updateNavaids([])
        }
        if !region.isAvailable(.airspace) {
            visibleAirspaces = []
            mapService.updateAirspaces([])
        }
        mapService.airportDiagramOverlay.region = region
        if !region.isAvailable(.airportDiagrams) && !region.isAvailable(.israelDiagrams) {
            mapService.airportDiagramOverlay.isEnabled = false
        }
        onUserMovedMap()  // stop following a GPS fix elsewhere; Recenter re-engages it
        _oldestWeatherObservationTime = nil
        mapService.updateWeatherDots([], stationCoordinates: [:])

        mapService.setCamera(center: region.defaultCenter, zoom: region.defaultZoom, direction: 0, animated: true)
        lastQueryCenter = nil
        lastQueryRadiusNM = nil
        lastQueryWasLowZoom = nil
        loadDataForRegion(
            center: region.defaultCenter,
            radiusNM: MapQueryRegion.maxRadiusNM,
            towerRadiusNM: MapQueryRegion.isLowZoom(region.defaultZoom) ? MapQueryRegion.maxLowZoomRadiusNM : nil
        )
    }

    // MARK: - Data Loading

    /// `towerRadiusNM` non-nil = low zoom: airports are the towered public fields over that
    /// (uncapped) region radius; navaids/airspaces still use the capped `radiusNM`.
    private func loadDataForRegion(center: CLLocationCoordinate2D, radiusNM: Double, towerRadiusNM: Double?) {
        let region = appState.region
        isLoadingAirports = true
        if region.isAvailable(.airports) {
            loadAirports(center: center, radiusNM: radiusNM, towerRadiusNM: towerRadiusNM)
        } else {
            visibleAirports = []
            mapService.updateAirports([])
        }
        if appState.visibleLayers.contains(.navaids), region.isAvailable(.navaids) {
            loadNavaids(center: center, radiusNM: radiusNM)
        }
        if appState.visibleLayers.contains(.airspace), region.isAvailable(.airspace) {
            loadAirspaces(center: center, radiusNM: radiusNM)
        }

        isLoadingAirports = false

        // Load weather dots if layer visible (Plan 04)
        if appState.visibleLayers.contains(.weatherDots) {
            Task { await loadWeatherDots() }
        }

        // Load TFRs if layer visible (Plan 04)
        if appState.visibleLayers.contains(.tfrs), region.isAvailable(.tfrs) {
            Task { await loadTFRs() }
        }

        // Load AIRMET/SIGMETs if layer visible
        if appState.visibleLayers.contains(.advisories), region.isAvailable(.advisories) {
            Task { await loadAdvisories() }
        }
    }

    /// Airports for the region. Zoomed in: every airport in the (capped) radius, thinned so MapLibre
    /// never gets thousands of points. Zoomed out (`towerRadiusNM` set): towered public airports
    /// for the whole visible region, so the layer has no hard-edged disc.
    private func loadAirports(center: CLLocationCoordinate2D, radiusNM: Double, towerRadiusNM: Double?) {
        do {
            let shown: [Airport]
            if let towerRadiusNM {
                let towered = try databaseService.toweredAirports(near: center, radiusNM: towerRadiusNM)
                if let b = appState.mapVisibleBounds {
                    shown = MapQueryRegion.thinSpatially(towered, south: b.south, west: b.west, north: b.north, east: b.east)
                } else {
                    shown = towered
                }
            } else {
                let airports = try databaseService.airports(near: center, radiusNM: radiusNM)
                shown = MapQueryRegion.thin(airports, around: center)
            }
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

    /// When the weather dots were last fetched successfully; nil until the first fetch.
    private(set) var weatherFetchedAt: Date?

    /// Fetch weather for visible airports and update map weather dots. Returns whether the fetch succeeded.
    @discardableResult
    func loadWeatherDots() async -> Bool {
        guard let weatherService else { return false }

        // Build station ID list and coordinate lookup from visible airports, plus the region's
        // own stations (Israel has no airport data yet, so its stations come from the region).
        var stationIDs = visibleAirports.map { $0.icao }
        var stationCoordinates: [String: CLLocationCoordinate2D] = [:]
        for airport in visibleAirports {
            stationCoordinates[airport.icao] = airport.coordinate
        }
        for station in appState.region.weatherStations where station.hasMETAR && stationCoordinates[station.id] == nil {
            stationIDs.append(station.id)
            stationCoordinates[station.id] = station.coordinate
        }
        guard !stationIDs.isEmpty else { return false }

        do {
            let weather = try await weatherService.fetchWeatherForStations(stationIDs)
            mapService.updateWeatherDots(weather, stationCoordinates: stationCoordinates)

            // Track oldest observation for weather age badge
            _oldestWeatherObservationTime = weather.compactMap { $0.observationTime }.min()
            weatherFetchedAt = Date()
            return true
        } catch {
            // Weather fetch failure is non-critical -- dots just won't update
            return false
        }
    }

    // MARK: - TFR Loading

    /// Last loaded TFRs (all published, active or upcoming), used for proximity alerts.
    private(set) var loadedTFRs: [TFR] = []
    /// When the displayed TFR data was fetched from the FAA; nil until the first fetch.
    private(set) var tfrFetchedAt: Date?
    /// True when the last load failed with no cached data to fall back on.
    private(set) var tfrLoadFailed: Bool = false

    /// How the TFR layer is drawn right now: current, stale (OLD badge, dashed) or hidden (EXPIRED data).
    private(set) var tfrOverlay: OverlayStaleness = .current
    /// Same for the AIRMET/SIGMET layer.
    private(set) var advisoryOverlay: OverlayStaleness = .current
    /// Last loaded advisories (all validity windows); redrawn as time passes.
    private var loadedAdvisories: [AviationAdvisory] = []

    /// Load TFRs (service caches for 10 minutes) and redraw the TFR layer.
    func loadTFRs() async {
        guard let tfrService else { return }

        do {
            let snapshot = try await tfrService.currentTFRs()
            loadedTFRs = snapshot.tfrs
            tfrFetchedAt = snapshot.fetchedAt
            tfrLoadFailed = false
            drawTFRs()
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
            loadedAdvisories = snapshot.advisories
            advisoriesFetchedAt = snapshot.fetchedAt
            advisoriesLoadFailed = false
            drawAdvisories()
        } catch {
            advisoriesLoadFailed = true
        }
    }

    /// Draw the TFR layer per the age of its snapshot: stale is marked, expired is not drawn.
    private func drawTFRs(now: Date = Date()) {
        tfrOverlay = OverlayStaleness.evaluate(.tfr, fetchedAt: tfrFetchedAt, now: now)
        switch tfrOverlay {
        case .current: mapService.updateTFRs(loadedTFRs, now: now)
        case .stale: mapService.updateTFRs(loadedTFRs, now: now, stale: true)
        case .hidden: mapService.updateTFRs([], now: now)
        }
    }

    private func drawAdvisories(now: Date = Date()) {
        advisoryOverlay = OverlayStaleness.evaluate(.airmetSigmet, fetchedAt: advisoriesFetchedAt, now: now)
        let valid = loadedAdvisories.filter { $0.isValid(at: now) }
        switch advisoryOverlay {
        case .current: mapService.updateAdvisories(valid)
        case .stale: mapService.updateAdvisories(valid, stale: true)
        case .hidden: mapService.updateAdvisories([])
        }
    }

    /// Re-evaluate overlay age as time passes (called by the periodic tick), redrawing only on a change,
    /// so a snapshot that ages from current to OLD to EXPIRED never stays drawn as current.
    func refreshOverlayStaleness(now: Date = Date()) {
        if OverlayStaleness.evaluate(.tfr, fetchedAt: tfrFetchedAt, now: now) != tfrOverlay { drawTFRs(now: now) }
        if OverlayStaleness.evaluate(.airmetSigmet, fetchedAt: advisoriesFetchedAt, now: now) != advisoryOverlay {
            drawAdvisories(now: now)
        }
    }

    // MARK: - Basemap Tile Health (efb-zfm.18)

    /// True while basemap tiles keep failing to load; the map shows "Map tiles not loading".
    private(set) var tilesFailing = false
    @ObservationIgnored private var tileTracker = TileFailureTracker()

    func noteTileError() {
        tileTracker.recordError()
        if tileTracker.isFailing, !tilesFailing { tilesFailing = true }
    }

    func noteTileLoadedFromNetwork() {
        tileTracker.recordNetworkLoad()
        if tilesFailing { tilesFailing = false }
    }

    // MARK: - Periodic Refresh (efb-zfm.13)

    @ObservationIgnored private var refreshScheduler = DataRefreshScheduler()

    /// Refresh the weather, TFR and AIRMET/SIGMET layers that are on and due, per `DataRefreshScheduler`
    /// (interval per product, doubled in Low Power Mode, none offline, backoff after a failure).
    /// Called about once a minute by the map screen while it is visible.
    func refreshDueData(now: Date = Date(), lowPower: Bool = ProcessInfo.processInfo.isLowPowerModeEnabled) async {
        let region = appState.region
        var wanted: Set<RefreshProduct> = []
        if appState.visibleLayers.contains(.weatherDots) { wanted.insert(.weather) }
        if appState.visibleLayers.contains(.tfrs), region.isAvailable(.tfrs) { wanted.insert(.tfr) }
        if appState.visibleLayers.contains(.advisories), region.isAvailable(.advisories) { wanted.insert(.advisories) }

        let due = refreshScheduler.due(
            wanted: wanted,
            lastData: [.weather: weatherFetchedAt, .tfr: tfrFetchedAt, .advisories: advisoriesFetchedAt].compactMapValues { $0 },
            now: now, lowPower: lowPower, networkAvailable: appState.networkAvailable)

        for product in due {
            let success: Bool
            switch product {
            case .weather:
                success = await loadWeatherDots()
            case .tfr:
                let before = tfrFetchedAt
                await loadTFRs()
                success = tfrFetchedAt != before  // a failed refresh serves the cache, with the old time
            case .advisories:
                let before = advisoriesFetchedAt
                await loadAdvisories()
                success = advisoriesFetchedAt != before
            }
            refreshScheduler.recordAttempt(product, at: now, success: success)
        }
    }

    // MARK: - Proximity Alert Check (Plan 04)

    /// Check airspace/TFR proximity for current ownship position.
    /// Called from MapContainerView on GPS updates, throttled internally to 10s.
    func checkProximityAlerts() {
        guard let position = appState.ownshipPosition else { return }
        let before = Set(proximityAlertService?.activeAlerts.map(\.id) ?? [])
        // No vertical fix (verticalAccuracy < 0, GPS Degraded): altitude is unknown, never "inside".
        let altitude: Double? = position.verticalAccuracy >= 0 ? appState.altitude : nil  // feet MSL
        proximityAlertService?.checkProximity(position: position, altitude: altitude)
        if appState.visibleLayers.contains(.tfrs) {
            proximityAlertService?.checkTFRProximity(position: position, tfrs: loadedTFRs)
        }
        // One warning haptic per newly raised alert; an alert that stays active never repeats.
        let after = Set(proximityAlertService?.activeAlerts.map(\.id) ?? [])
        if !after.subtracting(before).isEmpty {
            Haptics.warning()
        }
    }
}
