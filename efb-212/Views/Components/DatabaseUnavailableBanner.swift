//
//  DatabaseUnavailableBanner.swift
//  efb-212
//
//  Non-dismissable red banner shown on every tab when the aviation database failed to open
//  (AppState.databaseError != nil). Without the database there are no airports, airspaces or
//  navaids; the pilot must know that rather than see an empty sky.
//  Red = warning per the EFB lens. No animation, no dismiss button.
//

import SwiftUI

struct DatabaseUnavailableBanner: View {
    @Environment(AppState.self) private var appState

    /// Fixed pilot-facing copy. The EFBError itself stays in AppState.databaseError for
    /// diagnostics; its generic text is not shown because it would not help the pilot here.
    static let title = "Airport database could not be opened"
    static let detail = "No airports, airspace or navaids will show. Reinstall OpenEFB."

    var body: some View {
        if appState.databaseError != nil {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.octagon.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.title)
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                    Text(Self.detail)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.9))
                }

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            // Deep red so white text clears 4.5:1 (system red under white is ~3.6:1), day and night.
            .background(Color(red: 0.70, green: 0.07, blue: 0.07))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("databaseUnavailableBanner")
        }
    }
}

#Preview("Database unavailable") {
    let state = AppState()
    state.getOrCreateDatabaseService { throw EFBError.databaseCorrupted }
    return DatabaseUnavailableBanner().environment(state)
}
