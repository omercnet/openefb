//
//  MapContainerView.swift
//  efb-212
//
//  Complete map tab composing all navigation components:
//  map, right-edge controls, layer panel, chart expiration badge,
//  search bar with results, instrument strip, nearest airport HUD,
//  airport info sheet, nearest airport list,
//  offline indicator, and all service wiring.
//
//  Per UI-SPEC: map fills screen, controls on right edge, ZStack composition.
//  Per Plan 06: final assembly wiring all Plans 01-05 components.
//

import SwiftUI
import SwiftData
import CoreLocation

// MARK: - SearchResultsList (private helper)

/// Dropdown list of airport search results.
/// Per UI-SPEC: .regularMaterial background, 300pt max width.
private struct SearchResultsList: View {
    let results: [Airport]
    let onTap: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(results) { airport in
                Button {
                    onTap(airport.icao)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(airport.icao)
                            .font(.subheadline.bold())
                        Text(airport.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(PressableButtonStyle())
                if airport.id != results.last?.id {
                    Divider()
                }
            }
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .frame(maxWidth: 300)
    }
}

// MARK: - MapContainerView

struct MapContainerView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.modelContext) private var modelContext
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    // MARK: - Services (created once in onAppear)

    @State private var mapService = MapService()
    @State private var mapViewModel: MapViewModel?
    @State private var locationService: LocationService?
    @State private var nearestAirportVM: NearestAirportViewModel?
    @State private var searchViewModel: SearchViewModel?

    // Plan 04 Services
    @State private var weatherService = WeatherService()
    @State private var tfrService = TFRService()
    @State private var airSigmetService = AirSigmetService()
    @State private var chartService = TerminalProcedureService()
    @State private var notamService = NotamService()
    @State private var pirepService = PirepService()
    @State private var windsAloftService = WindsAloftService()
    @State private var proximityAlertService: ProximityAlertService?
    @State private var israelAlertService: IsraelAlertService?
    @State private var reachabilityService = ReachabilityService()

    /// Israel only: no fresh GPS fix, so position-based alerts (airspace, border, closures ahead) are not running.
    private var israelAlertsSuspended: Bool {
        appState.region == .israel && (mapViewModel?.gpsStatus ?? .lost(ageSeconds: nil)).isStale
    }

    // Recording Services (Plan 03)
    @State private var recordingViewModel: RecordingViewModel?
    @State private var recordingCoordinator: RecordingCoordinator?
    @State private var recordingUnavailable = false

    // MARK: - Local UI State

    @State private var showingSearch: Bool = false
    @AppStorage(IsraelChartHint.dismissedKey) private var israelChartHintDismissed = false

    private var showIsraelChartHint: Bool {
        IsraelChartHint.shouldShow(region: appState.region,
                                   chartInstalled: IsraelChartStore.shared.status.isPresent,
                                   dismissed: israelChartHintDismissed)
    }

    private func dismissIsraelChartHint() { israelChartHintDismissed = true }

    var body: some View {
        @Bindable var appState = appState

        ZStack {
            // MARK: Layer 1 -- Full-screen map

            if let viewModel = mapViewModel {
                MapView(mapService: mapService, mapViewModel: viewModel)
                    .ignoresSafeArea(edges: .top)

                // Night dimming for vector base layers (raster layers are dimmed in MapService)
                Color.black
                    .opacity(colorScheme == .dark ? NightPalette.mapDimOpacity * 0.6 : 0)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            // MARK: Layer 2 -- Floating UI overlays

            VStack(spacing: 0) {
                // Currency warning banner (non-blocking, dismissable)
                CurrencyWarningBanner()
                    .withAutoCompute()
                    .padding(.horizontal, 16)
                    .padding(.top, 52)

                // Top bar: search (left) + controls (right)
                HStack(alignment: .top) {
                    // Top-left: Search bar + chart expiration badge
                    VStack(alignment: .leading, spacing: 8) {
                        // Search toggle button
                        if !showingSearch, appState.region.hasAirportData {
                            Button {
                                showingSearch = true
                            } label: {
                                Image(systemName: "magnifyingglass")
                                    .font(.title3)
                                    .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                            }
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
                            .accessibilityLabel("Search airports")
                        }

                        // Flight planning entry point (F10): opens the Flights tab on Plans
                        if !showingSearch {
                            Button {
                                appState.openFlightsOnPlans = true
                                appState.selectedTab = .flights
                            } label: {
                                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                                    .font(.title3)
                                    .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                            }
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
                            .accessibilityLabel("Plan a flight")
                        }

                        // Search bar (shown when activated)
                        if showingSearch, let searchVM = searchViewModel {
                            @Bindable var searchVM = searchVM
                            SearchBar(
                                text: $searchVM.query,
                                placeholder: "Search airports (ICAO, name, city)",
                                onSubmit: { searchVM.search() }
                            )
                            .frame(maxWidth: 300)
                            .onChange(of: searchVM.query) { _, _ in
                                searchVM.search()
                            }

                            // Search results dropdown
                            if !searchVM.results.isEmpty {
                                SearchResultsList(
                                    results: searchVM.results,
                                    onTap: { icao in
                                        mapViewModel?.onAirportTapped(icao: icao)
                                        showingSearch = false
                                        searchVM.clear()
                                    }
                                )
                            } else if searchVM.isSearching {
                                ProgressView("Searching\u{2026}")
                                    .font(TypeRole.caption)
                                    .padding(Space.m)
                                    .background(.regularMaterial)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            } else if searchVM.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                                Text("No airports match \u{201C}\(searchVM.query)\u{201D}")
                                    .font(TypeRole.caption)
                                    .foregroundStyle(Palette.secondaryText)
                                    .padding(Space.m)
                                    .background(.regularMaterial)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .accessibilityIdentifier("search-no-results")
                            }
                        }

                        // Chart expiration badge (INFRA-03)
                        if let viewModel = mapViewModel {
                            DataAgeBadge(.chartCycle, validUntil: viewModel.chartExpirationDate)
                                .hiddenWhenFresh()
                        }

                        // Stale / hidden TFR and AIRMET-SIGMET data (efb-zfm.11)
                        if let viewModel = mapViewModel {
                            OverlayStalenessBadges(viewModel: viewModel)
                        }

                        // First Israel launch: where to get the official chart (once per install)
                        if appState.region == .israel, showIsraelChartHint {
                            IsraelChartHintBanner { dismissIsraelChartHint() }
                        }
                    }
                    .padding(.leading, 16)

                    Spacer()

                    // Top-right: Map controls stack
                    VStack(spacing: 8) {
                        if let viewModel = mapViewModel {
                            MapControlsView(mapViewModel: viewModel)
                        }
                    }
                    .padding(.trailing, 16)
                }
                .padding(.top, 60)  // below status bar

                Spacer()

                // MARK: Bottom stack

                VStack(spacing: 8) {
                    // Recenter (only while follow is suspended) and the fixed NRST button,
                    // bottom-right above the instrument strip (F2, F3)
                    HStack(alignment: .bottom, spacing: 12) {
                        Spacer()
                        if let viewModel = mapViewModel, !viewModel.isFollowing {
                            RecenterButton { viewModel.recenter() }
                        }
                        if let nearestVM = nearestAirportVM {
                            NearestAirportHUD(entry: nearestVM.nearestEntry)
                        }
                    }
                    .padding(.horizontal, 16)

                    // Why there is no position, with Open Settings when the pilot can fix it.
                    if let failure = appState.gpsFailure,
                       (mapViewModel?.gpsStatus ?? .lost(ageSeconds: nil)).isStale {
                        GPSFailureNotice(reason: failure)
                            .padding(.horizontal, 16)
                    }

                    // The airspace proximity check cannot run: say so instead of showing nothing (efb-8lm)
                    if proximityAlertService?.checkUnavailable == true {
                        AirspaceCheckUnavailableBanner()
                            .padding(.horizontal, 16)
                    }

                    // Israel alerts: one banner area, highest priority on top (red warning, amber caution).
                    // Without a fresh fix they cannot be evaluated: say so instead of showing the last ones as current.
                    if israelAlertsSuspended {
                        IsraelAlertsSuspendedBanner()
                            .padding(.horizontal, 16)
                    } else if let alerts = israelAlertService?.alerts, !alerts.isEmpty {
                        IsraelAlertBanner(alerts: alerts)
                            .padding(.horizontal, 16)
                    }

                    // Active Direct-To / route with a Clear button (wrong field picked).
                    if appState.region == .israel, appState.activeFlightPlan, let route = appState.activeRoute {
                        IsraelRouteFollowingBar(
                            route: route,
                            distanceToNext: appState.distanceToNext,
                            remainingNM: appState.routeSummaryDistanceNM,
                            remainingETE: appState.routeSummaryETE,
                            onPrevious: { appState.sequenceActiveRoute(forward: false) },
                            onNext: { appState.sequenceActiveRoute(forward: true) },
                            onClear: {
                                appState.clearActiveNavigation()
                                mapService.clearRoute()
                            }
                        )
                        .padding(.horizontal, 16)
                    } else if let navTitle = ActiveNavigationBar.title(for: appState) {
                        ActiveNavigationBar(title: navTitle) {
                            let hadRoute = appState.activePlanDestination != nil
                            appState.clearActiveNavigation()
                            if hadRoute { mapService.clearRoute() }
                        }
                        .padding(.horizontal, 16)
                    }

                    // Instrument strip (bottom bar) with the GPS status chip
                    InstrumentStripView(gpsStatus: mapViewModel?.gpsStatus ?? .lost(ageSeconds: nil))
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                }
            }
            // Map chrome keeps its 60pt geometry: cap text so controls never cover the map (sheets scale fully)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)

            // MARK: Layer 3 -- Recording overlay

            if let recVM = recordingViewModel {
                RecordingOverlayView(viewModel: recVM)
            } else if recordingUnavailable {
                VStack {
                    Label("Recording unavailable", systemImage: "mic.slash.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.caution)
                        .padding(Space.m)
                        .background(.regularMaterial)
                        .clipShape(Capsule())
                        .padding(.leading, Space.l)
                        .accessibilityIdentifier("recording-unavailable")
                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // MARK: Layer controls popover

            if appState.isPresentingLayerControls, let viewModel = mapViewModel {
                VStack {
                    LayerControlsView(mapViewModel: viewModel)
                        // iPad: sit left of the map controls column (16 edge + 60 button + 12 gap)
                        // so the layers button stays tappable to close the panel. iPhone: the panel
                        // covers the column (it has its own close button) and stops above the strip.
                        .padding(.trailing, horizontalSizeClass == .compact ? 16 : 88)
                        .padding(.top, horizontalSizeClass == .compact ? 130 : 140)
                        .padding(.bottom, horizontalSizeClass == .compact ? 120 : 0)
                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .transition(.opacity)
            }

            // MARK: Offline indicator

            if !reachabilityService.isConnected {
                VStack {
                    Spacer()
                    HStack {
                        Image(systemName: "wifi.slash")
                            .accessibilityHidden(true)
                        Text("Offline \u{2014} using cached data")
                            .font(.caption)
                    }
                    .foregroundStyle(.black)  // black on amber: 9:1 (white on amber is 2.2:1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.orange)
                    .clipShape(Capsule())
                    .padding(.bottom, 60)  // above instrument strip
                }
            }

            // MARK: Flight plan summary card overlay

            // The Israel route bar carries these totals itself; the card would sit on top of its buttons.
            if appState.activeFlightPlan, !(appState.region == .israel && appState.activeRoute != nil),
               let distance = appState.distanceToNext,
               let departure = appState.activePlanDeparture,
               let destination = appState.activePlanDestination {
                VStack {
                    Spacer()
                    HStack {
                        FlightPlanSummaryCard(
                            // A multi-leg route shows the whole remaining route; DTG on the strip stays "to next point".
                            distanceNM: appState.routeSummaryDistanceNM ?? distance,
                            ete: formatETE(appState.activeRoute == nil ? appState.estimatedTimeEnroute : appState.routeSummaryETE),
                            fuelGallons: appState.activePlanFuelGallons,
                            departure: departure,
                            destination: destination
                        )
                        .padding()
                        Spacer()
                    }
                }
            }
        }

        // MARK: - Airport Info Sheet

        .sheet(isPresented: $appState.isPresentingAirportInfo) {
            AirportInfoSheet(
                databaseService: mapViewModel?.databaseService ?? PlaceholderDatabaseService(),
                weatherService: weatherService,
                chartService: chartService,
                notamService: notamService,
                pirepService: pirepService,
                windsAloftService: windsAloftService
            )
        }

        // MARK: - Israel CVFR Chart Sheet (IL-3)

        .sheet(item: Binding(
            get: { mapService.israelChart.selection },
            set: { mapService.israelChart.selection = $0 }
        )) { selection in
            IsraelChartSheet(selection: selection)
        }

        // MARK: - Israel NOTAM Briefing Sheet (IL-BRIEF)

        .sheet(isPresented: $appState.isPresentingIsraelBriefing) {
            IsraelBriefingView()
        }

        // MARK: - Nearest Airport List Sheet

        .sheet(isPresented: $appState.isPresentingNearestList) {
            if let nearestVM = nearestAirportVM, let viewModel = mapViewModel {
                NearestAirportView(
                    entries: nearestVM.nearestAirports,
                    region: appState.region,
                    onDirectTo: { nearestVM.setDirectTo(airport: $0) },
                    onAirportTap: { viewModel.onAirportTapped(icao: $0) }
                )
            }
        }

        // MARK: - Lifecycle

        .onAppear {
            initializeServices()
        }
        .onChange(of: israelAlertsSuspended) { _, suspended in
            if suspended { israelAlertService?.suspend() }
        }

        // MARK: - GPS Position Updates

        .onChange(of: appState.ownshipPosition) { _, newPosition in
            guard let position = newPosition else { return }

            // Update nearest airport (throttled inside VM to 0.5 NM)
            if appState.region.hasAirportData {
                nearestAirportVM?.updateNearest(from: position)
            }

            // Update ownship on map
            mapService.updateOwnship(location: position, heading: appState.track)

            // Check proximity alerts (throttled internally to 10s)
            mapViewModel?.checkProximityAlerts()

            // Israel alerts: closed legs ahead, P/R/D and CTR, border buffers, squawk (Israel only)
            israelAlertService?.update(
                region: appState.region, route: appState.activeRoute, position: position,
                altitudeFeet: position.verticalAccuracy >= 0 ? appState.altitude : nil,  // feet MSL
                trackTrue: appState.track, groundSpeedKnots: appState.groundSpeed, now: ScenarioHooks.now
            )

            // First GPS fix: animate from the home view to the user position (only inside the region)
            if !appState.firstLocationReceived {
                appState.firstLocationReceived = true
                if appState.region.contains(position.coordinate) {
                    mapService.animateToLocation(position.coordinate, zoom: 10.0)
                }
            }
        }

        // MARK: - Reachability Sync

        .onChange(of: reachabilityService.isConnected) { _, newValue in
            appState.networkAvailable = newValue
        }

        // MARK: - Region Switch (IL-2)

        .onChange(of: appState.region) { _, _ in
            mapViewModel?.regionDidChange()
            // A new region has its own airports: list them now, not at the next GPS fix.
            if appState.region.hasAirportData, let position = appState.ownshipPosition {
                nearestAirportVM?.updateNearest(from: position)
            }
        }
        .onChange(of: IsraelChartStore.shared.packURL) { _, _ in
            mapViewModel?.syncOfficialChart()
        }
    }

    // MARK: - Service Initialization

    /// Create all services and view models once on first appear.
    /// The aviation database is owned by AppState; on failure its queries throw and
    /// AppState.databaseError drives the "Airport database unavailable" banner.
    private func initializeServices() {
        guard mapViewModel == nil else { return }  // already initialized

        // Saved operating region (before any view model or map reads it)
        appState.region = RegionStore.load(from: modelContext)
        ScenarioHooks.prepare(appState)  // DEBUG scenario playback only; a no-op otherwise

        // Database service (single shared instance, created once by AppState)
        let databaseService = appState.getOrCreateDatabaseService()

        // MapViewModel
        let vm = MapViewModel(
            appState: appState,
            mapService: mapService,
            databaseService: databaseService
        )

        // Wire Plan 04 services
        let proxService = ProximityAlertService(databaseService: databaseService)
        vm.weatherService = weatherService
        vm.tfrService = tfrService
        vm.airSigmetService = airSigmetService
        vm.proximityAlertService = proxService
        mapService.airportDiagramOverlay.region = appState.region
        mapService.airportDiagramOverlay.configure(chartService: chartService, databaseService: databaseService)

        mapViewModel = vm
        proximityAlertService = proxService

        // Israel in-flight alerts (IL-ALERTS): one haptic per newly raised alert
        let israelAlerts = ScenarioHooks.makeIsraelAlertService()
        israelAlerts.onRaised = { _ in Haptics.warning() }
        israelAlertService = israelAlerts

        // Share the map service via AppState for other tabs (Flight Plans, etc.)
        appState.sharedMapService = mapService

        // LocationService -- starts GPS tracking
        let locService = ScenarioHooks.makeLocationService(appState: appState)
        locationService = locService
        Task { await locService.startTracking() }

        // NearestAirportViewModel (Israel: curated aerodromes, flagged against the NOTAM feed when one is configured)
        let israelNotams = IsraelNotamService()
        nearestAirportVM = NearestAirportViewModel(
            appState: appState,
            databaseService: databaseService,
            notamFetcher: { try await israelNotams.fetchFeed(forceRefresh: false) }
        )

        // SearchViewModel
        let appStateForSearch = appState
        searchViewModel = SearchViewModel(databaseService: databaseService, regionProvider: { appStateForSearch.region })

        // Start reachability monitoring
        reachabilityService.start()
        appState.networkAvailable = reachabilityService.isConnected

        // Recording services (Plan 03)
        initializeRecordingServices()
    }

    /// Initialize recording pipeline: RecordingDatabase -> AudioRecorder -> TranscriptionService -> RecordingCoordinator -> RecordingViewModel.
    private func initializeRecordingServices() {
        do {
            guard let recordingDB = appState.getOrCreateRecordingDatabase() else {
                throw appState.recordingDatabaseError ?? EFBError.databaseCorrupted
            }
            let audioRecorder = AudioRecorder()
            let transcriptionService = TranscriptionService(recordingDB: recordingDB)
            // Israel: bias recognition towards the CVFR reporting-point names (Hebrew and English).
            if appState.region == .israel,
               let points = try? IsraelAviationDatabase.bundled().reportingPoints(in: .wholeCountry) {
                let terms = TranscriptTextMatcher.vocabulary(for: points)
                Task { await transcriptionService.setRegionVocabulary(terms) }
            }

            let coordinator = RecordingCoordinator(
                recordingDB: recordingDB,
                audioRecorder: audioRecorder,
                transcriptionService: transcriptionService
            )

            // Wire AudioRecorder's onBufferAvailable to TranscriptionService's feedBuffer
            Task {
                await audioRecorder.setOnBufferAvailable { @Sendable buffer, time in
                    let input = AudioBufferInput(buffer: buffer, time: time)
                    Task {
                        await transcriptionService.feedBuffer(input)
                    }
                }
            }

            // Wire TranscriptionService's onTranscriptUpdate to coordinator state
            let coordState = coordinator.state
            Task {
                await transcriptionService.setOnTranscriptUpdate { @Sendable item in
                    Task { @MainActor in
                        coordState.recentTranscripts.append(item)
                        // Keep only last 5 segments
                        if coordState.recentTranscripts.count > 5 {
                            coordState.recentTranscripts.removeFirst(
                                coordState.recentTranscripts.count - 5
                            )
                        }
                    }
                }
            }

            recordingCoordinator = coordinator
            let recVM = RecordingViewModel(coordinator: coordinator, appState: appState)
            recVM.modelContext = modelContext
            let persistence = FlightPersistenceService(
                recordingDB: recordingDB,
                databaseService: appState.sharedDatabaseService
            )
            recVM.persistence = persistence
            recordingViewModel = recVM

            // Rebuild History rows for any recording a crash or kill left without a FlightRecord.
            FlightRecoveryService(recordingDB: recordingDB, persistence: persistence).recoverOrphans(
                modelContext: modelContext,
                activeFlightID: appState.activeFlightRecordID,
                aircraftProfileID: appState.activeAircraftProfileID,
                pilotProfileID: appState.activePilotProfileID
            )

            // Start auto-start monitoring
            Task { await coordinator.startAutoStartMonitoring(appState: appState) }
        } catch {
            // Recording database failed: the rest of the app works, but say so (no silent missing button).
            recordingUnavailable = true
        }
    }
    // MARK: - Helpers

    /// Format ETE seconds as "h:mm" for summary card display.
    private func formatETE(_ seconds: TimeInterval?) -> String {
        guard let seconds = seconds else { return "0:00" }
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        return String(format: "%d:%02d", hours, minutes)
    }
}

#Preview {
    MapContainerView()
        .environment(AppState())
}
