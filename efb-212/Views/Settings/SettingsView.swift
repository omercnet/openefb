//
//  SettingsView.swift
//  efb-212
//
//  Real Settings tab replacing placeholder.
//  Shows app version, build number, feedback link, chart info, NOTAM API key, and legal section.
//  Per CONTEXT.md: in-app "Send Feedback" link in Settings for TestFlight users.
//

import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext
    @State private var regionSaveError: String?

    @Query(filter: #Predicate<SchemaV1.PilotProfile> { $0.isActive == true })
    private var activePilots: [SchemaV1.PilotProfile]

    /// NASR cycle of the airport database; nil until loaded or when unavailable.
    @State private var dataCycle: AviationDataCycle?

    // NOTAM API credentials (persisted in the Keychain, never UserDefaults)
    @State private var notamClientID: String = ""
    @State private var notamClientSecret: String = ""
    @State private var notamConfigured: Bool = false
    @State private var notamMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                // Section 1: About
                Section("About") {
                    LabeledContent("Version", value: appVersion)
                    LabeledContent("Build", value: buildNumber)
                    Text("Beta build. Report problems with Send Feedback below.")
                        .font(.caption)
                        .foregroundStyle(Palette.secondaryText)
                    LabeledContent("Data") {
                        Text(dataAttribution)
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .multilineTextAlignment(.trailing)
                    }
                    .accessibilityIdentifier("region-attribution")
                }

                // Section 2: Feedback
                Section("Feedback") {
                    Link("Send Feedback", destination: feedbackURL)
                    Text("In TestFlight, a screenshot also opens the feedback form.")
                        .font(.caption)
                        .foregroundStyle(Palette.secondaryText)
                }

                // Aircraft & pilot profiles (was the Aircraft tab; T22, efb-77r.22)
                Section("Profiles") {
                    NavigationLink {
                        AircraftListView()
                    } label: {
                        HStack {
                            Label("Aircraft & Pilot", systemImage: "airplane.circle")
                            Spacer()
                            if currencyCount > 0 {
                                // Medical / flight review / night currency not current: caution, not warning.
                                Text("\(currencyCount) to renew")
                                    .font(.footnote)
                                    .foregroundStyle(Palette.caution)
                            }
                        }
                    }
                    .accessibilityIdentifier("aircraft-pilot-link")
                }

                // Region: which country's data sources the app reads (IL-2)
                Section {
                    Picker("Region", selection: regionBinding) {
                        ForEach(Region.allCases) { region in
                            Text(region.displayName).tag(region)
                        }
                    }
                    .accessibilityIdentifier("region-picker")
                    if let regionSaveError {
                        Text(regionSaveError)
                            .font(.caption)
                            .foregroundStyle(Palette.caution)
                    }
                    if let dataError = appState.region.dataUnavailableError {
                        Text(dataError.localizedDescription)
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .accessibilityIdentifier("region-data-unavailable-text")
                    }
                } header: {
                    Text("Region")
                } footer: {
                    Text("Switching recenters the map and reloads that region's data sources. Layers with no source in a region are shown as unavailable.")
                }

                // Display: day / night / auto (F16)
                Section {
                    Picker("Display mode", selection: displayModeBinding) {
                        ForEach(DisplayMode.allCases, id: \.self) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .accessibilityIdentifier("display-mode-picker")
                } header: {
                    Text("Display")
                } footer: {
                    Text("Night uses a dim palette that protects night vision. Auto follows the sun at your position.")
                }

                // Section 3: Charts
                Section("Charts") {
                    if appState.region.isAvailable(.sectional) {
                        LabeledContent("Sectional cycle", value: "valid to \(OfflineMapsView.dateString(SectionalCycle.current().expires))")
                        aviationDataRow
                        NavigationLink("Offline Maps") { OfflineMapsView() }
                            .accessibilityIdentifier("offline-maps-link")
                        Text("Sectionals change every 56 days. What works offline is listed under Offline Maps.")
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                    } else {
                        NavigationLink("Offline Maps") { OfflineMapsView() }
                            .accessibilityIdentifier("offline-maps-link")
                        Text("FAA charts are not available in \(appState.region.displayName). "
                             + "Offline Maps downloads the official CVFR chart.")
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .accessibilityIdentifier("charts-unavailable-text")
                    }
                }

                // Section 4: NOTAM API
                if appState.region.isAvailable(.notams) {
                    notamSection
                }

                // Section 5: Legal
                Section("Legal") {
                    NavigationLink("Disclaimers") { DisclaimersView() }
                    LabeledContent("License", value: "MPL-2.0")
                    Link("Source Code", destination: URL(string: "https://github.com/quartermint/openefb")!)
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                loadNotamCredentials()
                loadDataCycle()
            }
        }
    }

    /// NASR cycle of the bundled airport database. Red + "EXPIRED" once the cycle has lapsed:
    /// out-of-date runway, frequency and airspace data must not read as current.
    @ViewBuilder
    private var aviationDataRow: some View {
        if let cycle = dataCycle {
            let expired = cycle.isExpired()
            LabeledContent("Airport data") {
                Text(expired
                     ? "NASR \(Self.cycleDate(cycle.effective)), EXPIRED \(Self.cycleDate(cycle.expires))"
                     : "NASR \(Self.cycleDate(cycle.effective)), valid to \(Self.cycleDate(cycle.expires))")
                    .foregroundStyle(expired ? Palette.warning : Palette.secondaryText)
            }
            .accessibilityIdentifier("aviation-data-cycle-line")
        } else {
            LabeledContent("Airport data", value: "Cycle unknown")
                .accessibilityIdentifier("aviation-data-cycle-line")
        }
    }

    private func loadDataCycle() {
        dataCycle = try? appState.getOrCreateDatabaseService().dataCycle()
    }

    private static func cycleDate(_ date: Date) -> String {
        OfflineMapsView.dateString(date)
    }

    private var displayModeBinding: Binding<DisplayMode> {
        Binding(get: { appState.displayMode }, set: { appState.displayMode = $0 })
    }

    // MARK: - NOTAM API

    @ViewBuilder
    private var notamSection: some View {
        Section {
            LabeledContent("Status") {
                Text(notamConfigured ? "Configured" : "Not configured")
                    .foregroundStyle(notamConfigured ? Palette.primaryText : Palette.secondaryText)
            }

            TextField("Client ID", text: $notamClientID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)

            SecureField("Client Secret", text: $notamClientSecret)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Button("Save Key", action: saveNotamCredentials)
                .disabled(trimmed(notamClientID).isEmpty || trimmed(notamClientSecret).isEmpty)

            if notamConfigured {
                Button("Remove Key", role: .destructive, action: removeNotamCredentials)
            }

            if let notamMessage {
                Text(notamMessage)
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)
            }

            if let registrationURL = NotamCredentials.registrationURL {
                Link("Get a free FAA NOTAM API key", destination: registrationURL)
            }
        } header: {
            Text("NOTAM API")
        } footer: {
            Text("The FAA NOTAM API needs a free client ID and secret from the FAA developer portal. OpenEFB keeps them in the iPad Keychain.")
        }
    }

    private func loadNotamCredentials() {
        if let credentials = NotamCredentials.load() {
            notamClientID = credentials.clientID
            notamClientSecret = credentials.clientSecret
            notamConfigured = true
        } else {
            notamConfigured = false
        }
    }

    private func saveNotamCredentials() {
        let credentials = NotamCredentials(
            clientID: trimmed(notamClientID),
            clientSecret: trimmed(notamClientSecret)
        )
        do {
            try credentials.save()
            notamClientID = credentials.clientID
            notamClientSecret = credentials.clientSecret
            notamConfigured = NotamCredentials.load() != nil
            notamMessage = "Saved. NOTAMs appear in the airport sheet."
        } catch {
            notamMessage = error.localizedDescription
        }
    }

    private func removeNotamCredentials() {
        do {
            try NotamCredentials.remove()
            notamClientID = ""
            notamClientSecret = ""
            notamConfigured = false
            notamMessage = "Key removed."
        } catch {
            notamMessage = error.localizedDescription
        }
    }

    private func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Currency

    /// Non-current currency statuses (medical, flight review, night) for the active pilot.
    /// Shown on the Aircraft & Pilot row; this replaces the old Aircraft tab badge.
    private var currencyCount: Int {
        guard let profile = activePilots.first else { return 0 }
        let nightLandings = profile.nightLandingEntries.map { (date: $0.date, count: $0.count) }
        var count = 0
        if CurrencyService.medicalStatus(expiryDate: profile.medicalExpiry) != .current { count += 1 }
        if CurrencyService.flightReviewStatus(reviewDate: profile.flightReviewDate) != .current { count += 1 }
        if CurrencyService.nightCurrencyStatus(nightLandings: nightLandings) != .current { count += 1 }
        return count
    }

    // MARK: - Computed Properties

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    private var feedbackURL: URL {
        URL(string: "mailto:feedback@quartermint.com?subject=OpenEFB%20Beta%20Feedback")!
    }

    // MARK: - Region (IL-2)

    private var regionBinding: Binding<Region> {
        Binding(
            get: { appState.region },
            set: { newRegion in
                guard newRegion != appState.region else { return }
                appState.region = newRegion
                do {
                    try RegionStore.save(newRegion, to: modelContext)
                    regionSaveError = nil
                } catch {
                    regionSaveError = "Region changed, but it could not be saved: \(error.localizedDescription)"
                }
            }
        )
    }

    /// The region's data attribution for Settings > About. Israel's comes from the bundled
    /// `israel-aviation.sqlite` metadata, including the source data date.
    private var dataAttribution: String {
        appState.region.dataAttribution
    }
}

// MARK: - Disclaimers

/// PRD.md §12 required disclaimers, full text.
private struct DisclaimersView: View {
    var body: some View {
        List(Disclaimers.all) { item in
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.headline)
                Text(item.text)
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
        .navigationTitle("Disclaimers")
    }
}

#Preview {
    SettingsView()
        .environment(AppState())
}
