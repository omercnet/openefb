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
    @Query private var entries: [SchemaV1.LogbookEntry]
    @State private var logbook = LogbookViewModel()

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
        case .planner: FlightPlanView()
        case .offlineMaps: OfflineMapsView()
        case .logbook:
            if let entry = entries.first {
                LogbookEntryEditView(entry: entry, viewModel: logbook, isReadOnly: entry.isConfirmed)
            }
        case .flight:
            if let flight = flights.first { FlightDetailView(flightRecord: flight) }
        case .replay:
            if let flight = flights.first { ReplayView(flightRecord: flight) }
        }
    }
}

#endif
