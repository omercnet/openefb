//
//  Disclaimers.swift
//  efb-212
//
//  The five disclaimers required by PRD.md §12 "Required Disclaimers", verbatim.
//  Shown in Settings > Legal > Disclaimers; the primary-navigation text is also the last
//  onboarding page (short form in `Disclaimers.onboardingSummary`).
//

import Foundation

nonisolated enum Disclaimers {
    struct Item: Identifiable, Sendable {
        let title: String
        let text: String
        var id: String { title }
    }

    /// Short form for the onboarding page. The full text is `primaryNavigation`.
    static let onboardingSummary =
        "Kanaf is a supplemental reference. Fly with current charts, ATC and what you see outside. iPad GPS is not certified, and this app is not FAA-approved."

    static let primaryNavigation = Item(
        title: "Not for primary navigation",
        text: "Kanaf is provided as a supplemental reference tool. It is NOT intended to be used as a primary means of navigation. Pilots are responsible for maintaining situational awareness through all available means including current paper charts, ATC communication, and visual references."
    )

    static let dataCurrency = Item(
        title: "Data currency",
        text: "Aviation data (charts, airports, frequencies, airspace) is sourced from the FAA and is subject to change. Always verify information against official FAA publications. Expired data is clearly marked but should not be relied upon for navigation."
    )

    static let weather = Item(
        title: "Weather",
        text: "Weather information is provided for planning purposes only and may not reflect current conditions. Always obtain an official weather briefing from 1800wxbrief.com or FSS before flight."
    )

    static let gps = Item(
        title: "GPS",
        text: "iPad GPS accuracy varies by model and conditions. WiFi-only iPads do not have GPS hardware. Cellular iPad GPS is not TSO-certified. Do not rely on iPad GPS as a sole means of position awareness."
    )

    static let notFAAApproved = Item(
        title: "Not FAA-approved",
        text: "Kanaf has not been tested, approved, or certified by the FAA or any other aviation authority. Use at your own risk."
    )

    static let all: [Item] = [primaryNavigation, dataCurrency, weather, gps, notFAAApproved]
}
