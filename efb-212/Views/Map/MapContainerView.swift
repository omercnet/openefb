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
                .buttonStyle(.plain)
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
    @State private var reachabilityService = ReachabilityService()

    // Recording Services (Plan 03)
    @State private var recordingViewModel: RecordingViewModel?
    @State private var recordingCoordinator: RecordingCoordinator?

    // MARK: - Local UI State

    @State private var showingSearch: Bool = false

    var body: some View {
        @Bindable var appState = appState

        ZStack {
            // MARK: Layer 1 -- Full-screen map

            if let viewModel = mapViewModel {
                MapView(mapService: mapService, mapViewModel: viewModel)
                    .ignoresSafeArea(edges: .top)
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
                        if !showingSearch {
                            Button {
                                showingSearch = true
                            } label: {
                                Image(systemName: "magnifyingglass")
                                    .font(.title3)
                                    .frame(width: 44, height: 44)
                            }
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .accessibilityLabel("Search airports")
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
                            }
                        }

                        // Chart expiration badge (INFRA-03)
                        if let viewModel = mapViewModel {
                            ChartExpirationBadge(daysRemaining: viewModel.chartDaysRemaining)
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

                    // Instrument strip (bottom bar) with the GPS status chip
                    InstrumentStripView(gpsStatus: mapViewModel?.gpsStatus ?? .lost(ageSeconds: nil))
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                }
            }

            // MARK: Layer 3 -- Recording overlay

            if let recVM = recordingViewModel {
                RecordingOverlayView(viewModel: recVM)
            }

            // MARK: Layer controls popover

            if appState.isPresentingLayerControls, let viewModel = mapViewModel {
                VStack {
                    LayerControlsView(mapViewModel: viewModel)
                        // Sit left of the map controls column (16 edge + 60 button + 12 gap)
                        // so the layers button stays tappable to close the panel.
                        .padding(.trailing, 88)
                        .padding(.top, 140)
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
                        Text("Offline \u{2014} using cached data")
                            .font(.caption)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.orange.opacity(0.9))
                    .clipShape(Capsule())
                    .padding(.bottom, 60)  // above instrument strip
                }
            }

            // MARK: Flight plan summary card overlay

            if appState.activeFlightPlan,
               let distance = appState.distanceToNext,
               let departure = appState.activePlanDeparture,
               let destination = appState.activePlanDestination {
                VStack {
                    Spacer()
                    HStack {
                        FlightPlanSummaryCard(
                            distanceNM: distance,
                            ete: formatETE(appState.estimatedTimeEnroute),
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

        // MARK: - Nearest Airport List Sheet

        .sheet(isPresented: $appState.isPresentingNearestList) {
            if let nearestVM = nearestAirportVM, let viewModel = mapViewModel {
                NearestAirportView(
                    entries: nearestVM.nearestAirports,
                    onDirectTo: { nearestVM.setDirectTo(airport: $0) },
                    onAirportTap: { viewModel.onAirportTapped(icao: $0) }
                )
            }
        }

        // MARK: - Lifecycle

        .onAppear {
            initializeServices()
        }

        // MARK: - GPS Position Updates

        .onChange(of: appState.ownshipPosition) { _, newPosition in
            guard let position = newPosition else { return }

            // Update nearest airport (throttled inside VM to 0.5 NM)
            nearestAirportVM?.updateNearest(from: position)

            // Update ownship on map
            mapService.updateOwnship(location: position, heading: appState.track)

            // Check proximity alerts (throttled internally to 10s)
            mapViewModel?.checkProximityAlerts()

            // First GPS fix: animate from CONUS to user position
            if !appState.firstLocationReceived {
                appState.firstLocationReceived = true
                mapService.animateToLocation(position.coordinate, zoom: 10.0)
            }
        }

        // MARK: - Reachability Sync

        .onChange(of: reachabilityService.isConnected) { _, newValue in
            appState.networkAvailable = newValue
        }
    }

    // MARK: - Service Initialization

    /// Create all services and view models once on first appear.
    /// The aviation database is owned by AppState; on failure its queries throw and
    /// AppState.databaseError drives the "Airport database unavailable" banner.
    private func initializeServices() {
        guard mapViewModel == nil else { return }  // already initialized

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
        mapService.airportDiagramOverlay.configure(chartService: chartService, databaseService: databaseService)

        mapViewModel = vm
        proximityAlertService = proxService

        // Share the map service via AppState for other tabs (Flight Plans, etc.)
        appState.sharedMapService = mapService

        // LocationService -- starts GPS tracking
        let locService = LocationService(appState: appState)
        locationService = locService
        Task { await locService.startTracking() }

        // NearestAirportViewModel
        nearestAirportVM = NearestAirportViewModel(
            appState: appState,
            databaseService: databaseService
        )

        // SearchViewModel
        searchViewModel = SearchViewModel(databaseService: databaseService)

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

            let coordinator = RecordingCoordinator(
                recordingDB: recordingDB,
                audioRecorder: audioRecorder,
                transcriptionService: transcriptionService
            )

            // Wire AudioRecorder's onBufferAvailable to TranscriptionService's feedBuffer
            Task {
                await audioRecorder.setOnBufferAvailable { @Sendable buffer, time in
                    Task {
                        await transcriptionService.feedBuffer(buffer, time: time)
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
            recordingViewModel = RecordingViewModel(coordinator: coordinator, appState: appState)

            // Start auto-start monitoring
            Task { await coordinator.startAutoStartMonitoring(appState: appState) }
        } catch {
            // Recording database failed -- recording won't be available but app still works
            // This is not a fatal error
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
