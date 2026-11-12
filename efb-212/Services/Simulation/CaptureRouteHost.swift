//
//  CaptureRouteHost.swift
//  efb-212
//
//  DEBUG only. Shows the page named by -OpenEFBRoute (ScreenCaptureHooks) over the app, in its own navigation
//  stack, so tools/ci/capture-screens.sh can screenshot pages that are normally pushed from the log stack.
//  Pages that show a stored record take the first one; seed it with -OpenEFBSeed small.
//

#if DEBUG

import SwiftUI
import SwiftData

struct CaptureRouteHost: View {
    private let model = CaptureRouteModel.shared
    @Query private var flights: [SchemaV1.FlightRecord]
    @Query private var aircraft: [SchemaV1.AircraftProfile]
    @Query private var entries: [SchemaV1.LogbookEntry]
    @Environment(AppState.self) private var appState
    @State private var logbook = LogbookViewModel()
    @State private var debriefEngine = DebriefEngine()
    @State private var cvfr: CVFRDebrief?

    private func loadCVFR() async {
        guard let flight = flights.first, let db = appState.getOrCreateRecordingDatabase() else { return }
        let id = flight.id
        let window = RemoteConfigStore.shared.value(for: .cvfrReportWindowSeconds)
        cvfr = await Task.detached { CVFRDebriefLoader.loadBundled(flightID: id, recordingDB: db, reportWindow: window) }.value
    }

    var body: some View {
        if let route = model.route {
            NavigationStack { page(route) }
                .background(Palette.paper.ignoresSafeArea())
        }
    }

    @ViewBuilder
    private func page(_ route: ScreenCaptureHooks.Route) -> some View {
        switch route {
        case .settings: SettingsView()
        case .disclaimers: CaptureDisclaimersView()
        case .aircraft: AircraftListView()
        case .aircraftedit:
            if let aircraft = aircraft.first {
                AircraftEditView(profile: aircraft, onSave: {}, onAddNew: { _ in aircraft })
            }
        case .pilot: PilotProfileView()
        case .logbookentry:
            if let entry = entries.first(where: { !$0.isConfirmed }) ?? entries.first {
                LogbookEntryEditView(entry: entry, viewModel: logbook, isReadOnly: false)
            }
        case .logbooklocked:
            if let entry = entries.first(where: \.isConfirmed) ?? entries.first {
                LogbookEntryEditView(entry: entry, viewModel: logbook, isReadOnly: true)
            }
        case .flightdetail:
            if let flight = flights.first { FlightDetailView(flightRecord: flight) }
        case .replay, .replayfast:
            if let flight = flights.first { ReplayView(flightRecord: flight) }
        case .cvfr:
            ScrollView { if let cvfr { CVFRDebriefContent(debrief: cvfr) } }
                .task(id: flights.first?.id) { await loadCVFR() }
        case .debrief:
            if let flight = flights.first, let db = appState.getOrCreateRecordingDatabase() {
                DebriefView(
                    debriefEngine: debriefEngine, flightID: flight.id, recordingDB: db,
                    metadata: FlightMetadata(
                        aircraftType: nil, pilotName: nil, departureICAO: flight.departureICAO,
                        arrivalICAO: flight.arrivalICAO, date: flight.startDate, durationSeconds: flight.durationSeconds))
                    .onAppear { debriefEngine.checkAvailability() }
            }
        case .israelPlan: IsraelFlightPlanView()
        }
    }
}

#endif
