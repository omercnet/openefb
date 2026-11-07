//
//  ContentView.swift
//  efb-212
//
//  Root view -- 3-tab TabView shell: Map / Flights / Settings (T22).
//  Logbook is a section of Flights (History / Logbook / Plans); Aircraft & Pilot live under
//  Settings. The beta banner shows on the Map tab only; after dismissal it lives in
//  Settings > About.
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var appState = appState

        VStack(spacing: 0) {
            if appState.selectedTab == .map {
                BetaBanner()
            }
            DatabaseUnavailableBanner()
            RemoteConfigBanner()

            TabView(selection: $appState.selectedTab) {
                Tab(AppTab.map.title, systemImage: AppTab.map.systemImage, value: .map) {
                    MapContainerView()
                }

                Tab(AppTab.flights.title, systemImage: AppTab.flights.systemImage, value: .flights) {
                    FlightsTabView()
                }

                Tab(AppTab.settings.title, systemImage: AppTab.settings.systemImage, value: .settings) {
                    SettingsView()
                }
            }
        }
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

// MARK: - Flights Tab View

/// Flights tab with segmented control for History, Logbook and Plans (T22: Logbook folded in,
/// efb-77r.23). Opens on Plans while there is no flight history (F10: planning must be
/// reachable), else History.
struct FlightsTabView: View {

    enum FlightsSection: String, CaseIterable {
        case history = "History"
        case logbook = "Logbook"
        case plans = "Plans"
    }

    /// Draft (unconfirmed) logbook entries; shown as a neutral count next to "Logbook".
    /// A draft is a to-do, not a warning, so it is never red (efb-77r.32).
    @Query(filter: #Predicate<SchemaV1.LogbookEntry> { $0.isConfirmed == false })
    private var draftEntries: [SchemaV1.LogbookEntry]
    private var draftLogbookCount: Int { draftEntries.count }

    @Environment(AppState.self) private var appState
    @Query private var flightRecords: [SchemaV1.FlightRecord]
    @State private var selectedSection: FlightsSection = .history
    @State private var didChooseInitialSection = false

    var body: some View {
        // One NavigationStack for all three sections. The picker lives in the navigation bar:
        // on iPadOS the floating tab bar overlays plain content at the top of the tab, and the
        // navigation bar is the only top surface that lays out around it.
        NavigationStack {
            Group {
                switch selectedSection {
                case .history:
                    FlightHistoryListView()
                case .logbook:
                    LogbookListView()
                case .plans:
                    FlightPlanView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Flights section", selection: $selectedSection) {
                        ForEach(FlightsSection.allCases, id: \.self) { section in
                            Text(segmentTitle(section)).tag(section)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 320)
                    .accessibilityIdentifier("flights-section-picker")
                }
            }
        }
        .onAppear { chooseInitialSection() }
        .onChange(of: appState.openFlightsOnPlans) { _, wantsPlans in
            if wantsPlans { chooseInitialSection() }
        }
    }

    /// "Logbook (2)" while drafts wait for confirmation; plain text otherwise. A segmented
    /// picker cannot carry a tinted badge, and a count in the label reads as neutral.
    private func segmentTitle(_ section: FlightsSection) -> String {
        guard section == .logbook, draftLogbookCount > 0 else { return section.rawValue }
        return "\(section.rawValue) (\(draftLogbookCount))"
    }

    private func chooseInitialSection() {
        if appState.openFlightsOnPlans {
            appState.openFlightsOnPlans = false
            selectedSection = .plans
            didChooseInitialSection = true
            return
        }
        guard !didChooseInitialSection else { return }
        didChooseInitialSection = true
        selectedSection = flightRecords.isEmpty ? .plans : .history
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
            SchemaV1.LogbookEntry.self
        ])
}
