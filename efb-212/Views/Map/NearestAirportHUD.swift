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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// Closest landable airport, nil until the first fix or when none is in range.
    let entry: NearestAirportEntry?

    var body: some View {
        Button(action: { appState.isPresentingNearestList = true }) {
            HStack(spacing: horizontalSizeClass == .compact ? 8 : 12) {
                // Fixed label: always reads "NRST"
                Text("NRST")
                    .font(.title3.weight(.heavy))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(Palette.onAccent)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 44)
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: 8))

                if appState.region.hasAirportData, let entry {
                    VStack(alignment: .leading, spacing: 2) {
                        if horizontalSizeClass == .compact {
                            // iPhone: ICAO + distance on the first line, bearing + runway on the second,
                            // so no number is truncated next to the NRST badge.
                            HStack(spacing: 8) {
                                Text(entry.airport.icao)
                                    .font(.title3.weight(.bold).monospaced())
                                Text(String(format: "%.1f NM", entry.distance))
                                    .font(.headline.monospaced())
                            }
                            .lineLimit(1)
                            HStack(spacing: 6) {
                                Text(String(format: "%03.0f\u{00B0}", entry.bearing))
                                    .font(.subheadline.weight(.semibold).monospaced())
                                Text(entry.runwaySummary ?? "no runway data")
                                    .font(.subheadline.weight(.medium).monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                if entry.isPrivateUse { PrivateUseTag() }
                                if entry.isMilitary { MilitaryUseTag() }
                                if entry.requiresPPR { PprTag() }
                                if entry.isClosedByNotam { NotamClosedTag() }
                            }
                        } else {
                            HStack(spacing: 10) {
                                Text(entry.airport.icao)
                                    .font(.title3.weight(.bold).monospaced())
                                Text(String(format: "%.1f NM", entry.distance))
                                    .font(.headline.monospaced())
                                Text(String(format: "%03.0f\u{00B0}", entry.bearing))
                                    .font(.headline.monospaced())
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                            HStack(spacing: 8) {
                                Text(entry.runwaySummary ?? "no runway data")
                                    .font(.subheadline.weight(.medium).monospaced())
                                    .foregroundStyle(.secondary)
                                if entry.isPrivateUse {
                                    PrivateUseTag()
                                }
                                if entry.isMilitary {
                                    MilitaryUseTag()
                                }
                                if entry.requiresPPR {
                                    PprTag()
                                }
                                if entry.isClosedByNotam {
                                    NotamClosedTag()
                                }
                            }
                        }
                    }
                } else {
                    Text(!appState.region.hasAirportData ? "no airport data yet"
                         : appState.gpsAvailable ? "no landable airport in range" : "waiting for GPS")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(minHeight: MapControlMetrics.size + 4)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(PressableButtonStyle())
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityIdentifier("NRST")
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens the nearest airports list")
    }

    private var accessibilityText: String {
        guard appState.region.hasAirportData else { return "Nearest airports. No airport data for this region yet." }
        guard let entry else { return "Nearest airports. No landable airport yet." }
        var text = "Nearest airport \(entry.airport.icao), \(String(format: "%.1f", entry.distance)) nautical miles, bearing \(String(format: "%03.0f", entry.bearing)) degrees"
        if let runway = entry.runwaySummary { text += ", runway \(runway)" }
        if entry.isPrivateUse { text += ", private use" }
        if entry.isMilitary { text += ", military, emergency use only" }
        if entry.requiresPPR { text += ", prior permission required" }
        if entry.isClosedByNotam { text += ", a NOTAM names this field closed" }
        return text
    }
}

// MARK: - PrivateUseTag

/// Amber caution tag for private-use fields (permission required to land).
struct PrivateUseTag: View {
    var body: some View {
        Text("PVT")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.orange, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel("Private use")
    }
}

/// Amber caution tag for military fields (emergency use only; still listed for emergencies).
struct MilitaryUseTag: View {
    var body: some View {
        Text("MIL")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.orange, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel("Military field, emergency use only")
    }
}

/// Amber caution tag for Israeli fields whose AIP entry requires prior permission (PPR).
struct PprTag: View {
    var body: some View {
        Text("PPR")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.orange, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel("Prior permission required")
    }
}

/// Red warning tag: a current NOTAM names this field closed. The pilot must read the NOTAM.
struct NotamClosedTag: View {
    var body: some View {
        Text("NOTAM CLSD")
            .font(.footnote.weight(.heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Palette.warning, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel("A NOTAM names this field closed")
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
