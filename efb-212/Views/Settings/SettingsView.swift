//
//  SettingsView.swift
//  efb-212
//
//  Real Settings tab replacing placeholder.
//  Shows app version, build number, feedback link, chart info, NOTAM API key, and legal section.
//  Per CONTEXT.md: in-app "Send Feedback" link in Settings for TestFlight users.
//

import SwiftUI

struct SettingsView: View {

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
                }

                // Section 2: Feedback
                Section("Feedback") {
                    Link("Send Feedback", destination: feedbackURL)
                    Text("You can also take a screenshot in TestFlight to send feedback directly to the developer.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Section 3: Charts
                Section("Charts") {
                    LabeledContent("Sectional cycle", value: "valid to \(OfflineMapsView.dateString(SectionalCycle.current().expires))")
                    NavigationLink("Offline Maps") { OfflineMapsView() }
                        .accessibilityIdentifier("offline-maps-link")
                    Text("Offline on this iPad: the airport database, map regions you download under Offline Maps, and FAA charts and airport diagram PDFs you have opened. Needs the internet: weather, TFRs, NOTAMs, PIREPs, and any map area you have not downloaded. Sectionals are revised every 56 days.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Section 4: NOTAM API
                notamSection

                // Section 5: Legal
                Section("Legal") {
                    LabeledContent("License", value: "MPL-2.0")
                    Link("Source Code", destination: URL(string: "https://github.com/quartermint/openefb")!)
                }
            }
            .navigationTitle("Settings")
            .onAppear(perform: loadNotamCredentials)
        }
    }

    // MARK: - NOTAM API

    @ViewBuilder
    private var notamSection: some View {
        Section {
            LabeledContent("Status") {
                Text(notamConfigured ? "Configured" : "Not configured")
                    .foregroundStyle(notamConfigured ? Color.green : Color.secondary)
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
                    .foregroundStyle(.secondary)
            }

            if let registrationURL = NotamCredentials.registrationURL {
                Link("Get a free FAA NOTAM API key", destination: registrationURL)
            }
        } header: {
            Text("NOTAM API")
        } footer: {
            Text("NOTAMs come from the FAA NOTAM API, which needs a free client ID and secret from the FAA developer portal. They are stored in the iPad Keychain.")
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
            notamMessage = "Saved. NOTAMs appear in airport details."
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
}

#Preview {
    SettingsView()
}
