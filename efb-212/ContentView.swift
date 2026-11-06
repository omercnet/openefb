//
//  ContentView.swift
//  efb-212
//
//  Root view, Direction 2: no tab bar. The map screen (chart with the log strip at its leading
//  edge) or the log stack (Next / Now / Flown, also the logbook). The beta banner shows on the
//  map screen only; after dismissal it lives in Settings > About.
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            if appState.selectedScreen == .map {
                BetaBanner()
            }
            DatabaseUnavailableBanner()
            RemoteConfigBanner()

            switch appState.selectedScreen {
            case .map:
                MapContainerView()
            case .log:
                LogStackView()
            }
        }
        #if DEBUG
        .onAppear { ScreenCaptureHooks.apply(to: appState) }
        #endif
        .task { await checkRemoteConfig() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await checkRemoteConfig() } }
        }
        .onChange(of: appState.selectedTab) { _, tab in
            Telemetry.signal("Navigation.tab", parameters: ["tab": tab.rawValue])
        }
        // A check skipped while recording is retried when the recording ends.
        .onChange(of: appState.recordingStatus) { oldStatus, newStatus in
            if oldStatus != .idle, newStatus == .idle { Task { await checkRemoteConfig() } }
        }
    }

    /// At launch and whenever the app becomes active; the store limits it to once an hour and never fetches
    /// while a flight is being recorded.
    private func checkRemoteConfig() async {
        await RemoteConfigStore.shared.refreshIfDue(recordingActive: appState.recordingStatus != .idle)
    }
}

#Preview {
    ContentView()
        .environment(AppState())
        .modelContainer(for: [
            SchemaV1.AircraftProfile.self,
            SchemaV1.PilotProfile.self,
            SchemaV1.UserSettings.self,
            SchemaV1.FlightPlanRecord.self,
            SchemaV1.FlightRecord.self,
            SchemaV1.LogbookEntry.self
        ])
}
