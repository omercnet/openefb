//
//  ContentView.swift
//  efb-212
//
//  Root view, Direction 2: no tab bar. The map screen (chart with the log strip at its leading
//  edge) or the log stack (Next / Now / Flown, also the logbook). The map screen stays mounted
//  under the log stack so its services (recording, route, location) survive the switch. The beta
//  status lives in Settings > About only.
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            DatabaseUnavailableBanner()
            RemoteConfigBanner()

            ZStack {
                // Always mounted: tearing it down would orphan an active recording and drop the route.
                MapContainerView()
                    .accessibilityHidden(appState.selectedScreen == .log)
                    .allowsHitTesting(appState.selectedScreen == .map)

                if appState.selectedScreen == .log {
                    LogStackView()
                        .background(Palette.paper.ignoresSafeArea())
                }
            }
        }
        #if DEBUG
        .onAppear { ScreenCaptureHooks.apply(to: appState) }
        .overlay { CaptureRouteHost() }
        #endif
        .task { await checkRemoteConfig() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await checkRemoteConfig() } }
        }
        .onChange(of: appState.selectedScreen) { _, screen in
            Telemetry.signal("Navigation.screen", parameters: ["screen": screen.rawValue])
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
