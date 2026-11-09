//
//  efb_212App.swift
//  efb-212
//
//  App entry point with @Observable AppState injection and SwiftData container.
//

import SwiftUI
import SwiftData

@main
struct efb_212App: App {
    @State private var appState = AppState()
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
    private let modelContainer = EFBModelContainer.makeForApp()

    init() {
        Telemetry.start(region: RegionStore.load(from: modelContainer.mainContext))
        #if DEBUG
        SeedDataHook.runIfRequested(container: modelContainer)
        #endif
    }

    /// Whether we are running inside a unit test host (XCTest bundle loaded).
    private var isRunningTests: Bool {
        NSClassFromString("XCTestCase") != nil
    }

    var body: some Scene {
        WindowGroup {
            if isRunningTests {
                // Minimal view for test runner -- avoids MapLibre initialization crash
                Text("Test Host")
                    .environment(appState)
                    .modelContainer(modelContainer)
            } else if !hasSeenOnboarding {
                OnboardingView()
                    .environment(appState)
                    .modelContainer(modelContainer)
            } else {
                ContentView()
                    .appliesDisplayMode()
                    .environment(appState)
                    .modelContainer(modelContainer)
            }
        }
    }
}
