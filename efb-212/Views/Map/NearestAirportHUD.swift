//
//  NearestAirportHUD.swift
//  efb-212
//
//  The NRST button: a fixed, prominent (≥ 60pt) emergency entry point above the
//  instrument strip (design finding F2). Shows the nearest landable airport with
//  distance, bearing and longest runway; one tap opens the nearest list. Always
//  visible so the pilot's hand learns where it is, even before the first fix.
//

import SwiftUI

struct NearestAirportHUD: View {
    @Environment(AppState.self) private var appState

    /// Closest landable airport, nil until the first fix or when none is in range.
    let entry: NearestAirportEntry?

    var body: some View {
        Button(action: { appState.isPresentingNearestList = true }) {
            HStack(spacing: 12) {
                // Fixed label: always reads "NRST"
                Text("NRST")
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .frame(height: 44)
                    .background(.blue, in: RoundedRectangle(cornerRadius: 8))

                if let entry {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 10) {
                            Text(entry.airport.icao)
                                .font(.system(size: 22, weight: .bold, design: .monospaced))
                            Text(String(format: "%.1f NM", entry.distance))
                                .font(.system(size: 20, weight: .semibold, design: .monospaced))
                            Text(String(format: "%03.0f\u{00B0}", entry.bearing))
                                .font(.system(size: 20, weight: .semibold, design: .monospaced))
                        }
                        HStack(spacing: 8) {
                            Text(entry.runwaySummary ?? "no runway data")
                                .font(.system(size: 15, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                            if entry.isPrivateUse {
                                PrivateUseTag()
                            }
                        }
                    }
                } else {
                    Text(appState.gpsAvailable ? "no landable airport in range" : "waiting for GPS")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(minHeight: MapControlMetrics.size + 4)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("NRST")
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens the nearest airports list")
    }

    private var accessibilityText: String {
        guard let entry else { return "Nearest airports. No landable airport yet." }
        var text = "Nearest airport \(entry.airport.icao), \(String(format: "%.1f", entry.distance)) nautical miles, bearing \(String(format: "%03.0f", entry.bearing)) degrees"
        if let runway = entry.runwaySummary { text += ", runway \(runway)" }
        if entry.isPrivateUse { text += ", private use" }
        return text
    }
}

// MARK: - PrivateUseTag

/// Amber caution tag for private-use fields (permission required to land).
struct PrivateUseTag: View {
    var body: some View {
        Text("PVT")
            .font(.system(size: 13, weight: .heavy, design: .rounded))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.orange, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel("Private use")
    }
}

#Preview {
    let sampleAirport = Airport(
        icao: "KPAO",
        name: "Palo Alto",
        latitude: 37.461,
        longitude: -122.115,
        elevation: 7,
        type: .airport,
        ownership: .publicOwned,
        runways: [
            Runway(
                id: "13/31", length: 2441, width: 70,
                surface: .asphalt, lighting: .fullTime,
                baseEndID: "13", reciprocalEndID: "31",
                baseEndLatitude: 37.458, baseEndLongitude: -122.118,
                reciprocalEndLatitude: 37.465, reciprocalEndLongitude: -122.112
            )
        ]
    )

    VStack(spacing: 16) {
        NearestAirportHUD(entry: NearestAirportEntry(airport: sampleAirport, distance: 3.2, bearing: 245))
        NearestAirportHUD(entry: nil)
    }
    .environment(AppState())
    .padding()
}
