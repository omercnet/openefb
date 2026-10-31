//
//  CurrencyWarningBanner.swift
//  efb-212
//
//  Non-blocking currency warning banner for the map tab.
//  Displays yellow (warning) or red (expired) banner when any pilot currency
//  (medical, flight review, night) is approaching or past expiry.
//  If the profile fetch fails the banner shows "Currency unknown" (amber): a failed
//  read must never be reported as current.
//  Pilot can dismiss the banner for the current session.
//

import SwiftUI
import SwiftData

struct CurrencyWarningBanner: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppState.self) private var appState

    /// nil until computed, or when the profile fetch failed (currency unknown).
    @State private var overallStatus: CurrencyStatus?
    @State private var fetchFailed: Bool = false
    @State private var warningMessages: [String] = []
    @State private var isDismissed: Bool = false

    private var shouldShow: Bool {
        guard !isDismissed, !appState.currencyWarningDismissed else { return false }
        if fetchFailed { return true }
        guard let status = overallStatus else { return false }
        return status != .current
    }

    var body: some View {
        if shouldShow {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(overallStatus == .expired ? .red : .yellow)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(fetchFailed ? "Currency unknown" : "Currency Warning")
                        .font(.caption.bold())
                    ForEach(Array(warningMessages.enumerated()), id: \.offset) { _, message in
                        Text(message)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                Button {
                    withAnimation {
                        isDismissed = true
                        appState.currencyWarningDismissed = true
                    }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: - Currency Computation

    /// Fetch active pilot profile and compute currency warnings.
    /// Same pattern as ContentView.updateCurrencyBadge for consistency.
    func computeCurrency() {
        let descriptor = FetchDescriptor<SchemaV1.PilotProfile>(
            predicate: #Predicate<SchemaV1.PilotProfile> { $0.isActive == true }
        )

        let activeProfiles: [SchemaV1.PilotProfile]
        do {
            activeProfiles = try modelContext.fetch(descriptor)
        } catch {
            // A failed read is not "current": show the pilot that currency could not be checked.
            fetchFailed = true
            overallStatus = nil
            warningMessages = ["Could not read the pilot profile. Check currency in the Aircraft tab."]
            return
        }
        fetchFailed = false

        guard let profile = activeProfiles.first else {
            // No active profile: nothing to check (absence of data, not a failed read).
            overallStatus = nil
            warningMessages = []
            return
        }

        let medical = CurrencyService.medicalStatus(expiryDate: profile.medicalExpiry)
        let flightReview = CurrencyService.flightReviewStatus(reviewDate: profile.flightReviewDate)
        let nightLandings = profile.nightLandingEntries.map { (date: $0.date, count: $0.count) }
        let night = CurrencyService.nightCurrencyStatus(nightLandings: nightLandings)

        overallStatus = CurrencyService.overallStatus(medical: medical, flightReview: flightReview, night: night)

        var messages: [String] = []
        switch medical {
        case .warning: messages.append("Medical certificate expiring soon")
        case .expired: messages.append("Medical certificate expired")
        case .current: break
        }
        switch flightReview {
        case .warning: messages.append("Flight review expiring soon")
        case .expired: messages.append("Flight review expired")
        case .current: break
        }
        switch night {
        case .expired: messages.append("Night currency expired (61.57)")
        default: break  // Night has no .warning state per FAR 61.57
        }
        warningMessages = messages
    }
}

// MARK: - View Extension for onAppear hook

extension CurrencyWarningBanner {
    /// Wrapper that triggers currency computation on appear.
    func withAutoCompute() -> some View {
        self.onAppear {
            computeCurrency()
        }
    }
}
