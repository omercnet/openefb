//
//  OnboardingView.swift
//  efb-212
//
//  First-run screen: one page, one button. States what the app does, what works offline, and the
//  "not for primary navigation" disclaimer, then "I understand". (Was 4 swipe-only pages with no
//  visible way forward; the cut review, T14, reduced first run to a single acknowledgement.)
//  Completion persisted via @AppStorage so onboarding only shows once.
//

import SwiftUI

struct OnboardingView: View {
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false

    @ScaledMetric(relativeTo: .largeTitle) private var heroSize: CGFloat = 64

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 0)

                    Image(systemName: "location.fill")
                        .font(.system(size: heroSize))
                        .foregroundStyle(Palette.accentText)
                        .accessibilityHidden(true)

                    Text("Kanaf")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)

                    VStack(alignment: .leading, spacing: 20) {
                        row(
                            systemImage: "map.fill",
                            title: "See where you are",
                            text: "Your position on the FAA sectional, with airspace, airports, TFRs and METARs around you."
                        )
                        row(
                            systemImage: "icloud.slash",
                            title: "Know what works offline",
                            text: "Airports and the map regions you download work in the air. Weather, TFRs and NOTAMs need the internet."
                        )
                        row(
                            systemImage: "exclamationmark.shield.fill",
                            title: Disclaimers.primaryNavigation.title,
                            text: Disclaimers.onboardingSummary,
                            tint: Palette.caution
                        )
                    }
                    .frame(maxWidth: 560, alignment: .leading)
                    .padding(.horizontal, 32)

                    Button {
                        hasSeenOnboarding = true
                    } label: {
                        Text("I understand")
                            .font(.headline)
                            .foregroundStyle(Palette.onAccent)
                            .frame(maxWidth: 280, minHeight: 44)
                            .padding(.vertical, 14)
                            .background(Palette.accent)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.l))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 40)

                    Spacer(minLength: 0)
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
        }
        .background(Color(.systemBackground))
    }

    private func row(
        systemImage: String,
        title: String,
        text: String,
        tint: Color = Palette.accentText
    ) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(tint)
                .frame(width: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(text)
                    .font(.body)
                    .foregroundStyle(Palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    OnboardingView()
}
