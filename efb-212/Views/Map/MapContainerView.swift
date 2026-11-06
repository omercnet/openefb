//
//  MapContainerView.swift
//  efb-212
//
//  The map screen (Direction 2, stage 1): the flight log strip at the leading edge beside
//  the chart, its footer of 60pt cells under it, and all service wiring.
//  Regular width: a fixed 400pt strip column. Compact width: a 104pt rail beside the chart,
//  the NOW cell at full width under it, then the footer. The strip is layout, not an overlay;
//  it sits on the leading edge, so a right-to-left locale mirrors it (the chart never mirrors).
//  Nothing floats over the chart except the north indicator while rotated.
//

import SwiftUI
import SwiftData
import CoreLocation

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

    @AppStorage(IsraelChartHint.dismissedKey) private var israelChartHintDismissed = false

    private var showIsraelChartHint: Bool {
        IsraelChartHint.shouldShow(region: appState.region,
                                   chartInstalled: IsraelChartStore.shared.status.isPresent,
                                   dismissed: israelChartHintDismissed)
    }

    private func dismissIsraelChartHint() { israelChartHintDismissed = true }

    var body: some View {
        @Bindable var appState = appState

        Group {
            if let viewModel = mapViewModel, let nearestVM = nearestAirportVM {
                if horizontalSizeClass == .compact {
                    compactLayout(viewModel, nearestVM)
                } else {
                    regularLayout(viewModel, nearestVM)
                }
            } else {
                Palette.paper.ignoresSafeArea()
            }
        }
        // The strip keeps its fixed width: cap text at a size its rows still fit (they scroll beyond).
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)

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
}

// MARK: - Layouts

extension MapContainerView {
    /// iPad: the 400pt strip column (with its footer) at the leading edge, the chart beside it.
    private func regularLayout(_ viewModel: MapViewModel, _ nearestVM: NearestAirportViewModel) -> some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                stripColumn(viewModel, nearestVM)
                    .frame(maxHeight: .infinity)
                FlightLogFooter(mapViewModel: viewModel, nearestEntry: nearestVM.nearestEntry)
            }
            .frame(width: StripMetrics.width)
            .background(Palette.paper.ignoresSafeArea())

            Rectangle()
                .fill(Palette.rule)
                .frame(width: 1)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            chart(viewModel)
        }
    }

    /// iPhone and iPad Split View: header and warnings on top, the NEXT rail beside the chart, the NOW
    /// cell at full width, then the footer. Other columns cover rail and chart (the map stays alive).
    private func compactLayout(_ viewModel: MapViewModel, _ nearestVM: NearestAirportViewModel) -> some View {
        VStack(spacing: 0) {
            ZStack {
                VStack(spacing: 0) {
                    FlightLogHeader(recordingViewModel: recordingViewModel, compact: true)
                    ColumnRule()
                    notices(viewModel)
                    HStack(spacing: 0) {
                        FlightLogRail(gpsStatus: viewModel.gpsStatus, nearestEntry: nearestVM.nearestEntry)
                        Rectangle()
                            .fill(Palette.rule)
                            .frame(width: 1)
                            .accessibilityHidden(true)
                        chart(viewModel)
                    }
                    ColumnRule()
                    FlightLogNowCell(gpsStatus: viewModel.gpsStatus, onClear: clearNavigation, compact: true)
                }
                .background(Palette.paper.ignoresSafeArea())

                if appState.stripColumn != .log {
                    stripColumn(viewModel, nearestVM)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.paper.ignoresSafeArea())
                }
            }
            FlightLogFooter(mapViewModel: viewModel, nearestEntry: nearestVM.nearestEntry, compact: true)
                .background(Palette.paperSecondary.ignoresSafeArea(edges: .bottom))
        }
    }

    /// The strip column: the log, or the airport, nearest, layers or search column in its place.
    @ViewBuilder
    private func stripColumn(_ viewModel: MapViewModel, _ nearestVM: NearestAirportViewModel) -> some View {
        switch appState.stripColumn {
        case .log:
            FlightLogStrip(
                gpsStatus: viewModel.gpsStatus,
                nearestEntry: nearestVM.nearestEntry,
                recordingViewModel: recordingViewModel,
                notices: notices(viewModel),
                onClear: clearNavigation
            )
        case .airport:
            AirportColumnView(
                databaseService: viewModel.databaseService,
                weatherService: weatherService,
                chartService: chartService,
                notamService: notamService,
                pirepService: pirepService,
                windsAloftService: windsAloftService,
                onDirectTo: { airport in
                    nearestVM.setDirectTo(airport: airport)
                    appState.stripColumn = .log
                }
            )
        case .nearest:
            NearestColumnView(
                entries: nearestVM.nearestAirports,
                region: appState.region,
                onDirectTo: { nearestVM.setDirectTo(airport: $0) },
                onAirportTap: { viewModel.onAirportTapped(icao: $0) }
            )
        case .layers:
            LayersColumnView(mapViewModel: viewModel)
        case .search:
            if let searchViewModel {
                SearchColumnView(searchViewModel: searchViewModel, onSelect: { viewModel.onAirportTapped(icao: $0) })
            }
        }
    }

    /// Warning and caution rows for the strip, in priority order.
    private func notices(_ viewModel: MapViewModel) -> FlightLogNotices {
        FlightLogNotices(
            mapViewModel: viewModel,
            airspaceCheckUnavailable: proximityAlertService?.checkUnavailable == true,
            israelAlertsSuspended: israelAlertsSuspended,
            israelAlerts: israelAlertService?.alerts ?? [],
            isOffline: !reachabilityService.isConnected,
            showIsraelChartHint: showIsraelChartHint,
            onDismissIsraelChartHint: dismissIsraelChartHint,
            recordingViewModel: recordingViewModel,
            recordingUnavailable: recordingUnavailable
        )
    }

    /// The chart: map, night dim, and the north indicator while rotated.
    private func chart(_ viewModel: MapViewModel) -> some View {
        ZStack(alignment: .topTrailing) {
            MapView(mapService: mapService, mapViewModel: viewModel)
                .ignoresSafeArea()

            // Night dimming for vector base layers (raster layers are dimmed in MapService)
            Color.black
                .opacity(colorScheme == .dark ? NightPalette.mapDimOpacity * 0.6 : 0)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            // Only while the map is rotated (track-up or rotate gesture); an indicator, not a control.
            if abs(viewModel.mapDirection) > 0.5 {
                NorthIndicator(mapDirection: viewModel.mapDirection)
                    .padding(Space.m)
            }
        }
    }

    /// Clear Direct-To or the active route (wrong field picked) and its line on the chart.
    private func clearNavigation() {
        let hadRoute = appState.activePlanDestination != nil || appState.activeRoute != nil
        appState.clearActiveNavigation()
        if hadRoute { mapService.clearRoute() }
    }
}

// MARK: - NorthIndicator

/// Arrow pointing to true north while the map is rotated. Rotates against the map
/// direction so it always points where north is on screen. Not a button.
private struct NorthIndicator: View {
    let mapDirection: Double   // degrees clockwise from north

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "arrowtriangle.up.fill")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Palette.northMarker)
            Text("N")
                .font(.callout.weight(.heavy))
                .foregroundStyle(Palette.onAccent)
        }
        .rotationEffect(.degrees(-mapDirection))
        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
        .glassEffect(.regular.tint(Palette.accent), in: .circle)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("North indicator")
        .accessibilityValue("Map rotated \(Int(mapDirection.rounded())) degrees")
    }
}

#Preview {
    MapContainerView()
        .environment(AppState())
}
