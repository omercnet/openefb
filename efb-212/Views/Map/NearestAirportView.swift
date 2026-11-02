//
//  NearestAirportView.swift
//  efb-212
//
//  Sorted list of the nearest landable airports, opened from the NRST button.
//  Each row: ident, name, longest runway (length and surface), private-use flag,
//  distance and bearing, and a large "Direct" action that starts Direct-To and
//  closes the list (design findings F1, F2). Tapping the row text opens airport info.
//

import SwiftUI

struct NearestAirportView: View {
    @Environment(\.dismiss) private var dismiss

    let entries: [NearestAirportEntry]
    var region: Region = .us
    let onDirectTo: (Airport) -> Void
    let onAirportTap: (String) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if !region.hasAirportData {
                    // Never an empty list that reads as "no airports nearby".
                    ContentUnavailableView(
                        "No airport data for \(region.displayName) yet",
                        systemImage: "airplane.circle",
                        description: Text("Nearest airports need \(region.displayName) airport data, which is not installed yet. Weather stations are on the map.")
                    )
                } else if entries.isEmpty {
                    ContentUnavailableView(
                        "No landable airport in range",
                        systemImage: "airplane.circle",
                        description: Text("Heliports, seaplane bases and runways under \(LandableAirportFilter.defaultMinimumRunwayLengthFeet) ft are not listed.")
                    )
                } else {
                    List(entries) { entry in
                        NearestAirportRow(
                            entry: entry,
                            onDirectTo: { airport in
                                onDirectTo(airport)
                                dismiss()
                            },
                            onAirportTap: onAirportTap
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Nearest Airports")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("Close nearest airports")
                }
            }
        }
    }
}

// MARK: - NearestAirportRow

struct NearestAirportRow: View {
    let entry: NearestAirportEntry
    let onDirectTo: (Airport) -> Void
    let onAirportTap: (String) -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            // Airport identity and runway (tap for airport info)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(entry.airport.icao)
                        .font(.title2.weight(.bold).monospaced())
                    Text(entry.airport.name)
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                }
                HStack(spacing: 8) {
                    if let runway = entry.longestRunway {
                        Text("\(runway.id)  \(runway.length)' \(runway.surface.abbreviation)")   // feet
                            .font(.subheadline.weight(.medium).monospaced())
                    } else {
                        Text("no runway data")
                            .font(.subheadline.weight(.medium).monospaced())
                            .foregroundStyle(Palette.secondaryText)
                    }
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { onAirportTap(entry.airport.icao) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Shows airport information")

            // Distance and bearing
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f NM", entry.distance))
                    .font(.headline.monospaced())
                    .lineLimit(1)
                    .fixedSize()
                Text(String(format: "%03.0f\u{00B0}", entry.bearing))
                    .font(.callout.weight(.medium).monospaced())
                    .foregroundStyle(Palette.secondaryText)
            }
            .accessibilityElement(children: .combine)

            // Direct-To: one tap, large target
            Button(action: { onDirectTo(entry.airport) }) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.right")
                        .font(.body.weight(.bold))
                    Text("Direct")
                        .font(.body.weight(.bold))
                        .lineLimit(1)
                        .fixedSize()
                }
                .padding(.horizontal, 12)
                .frame(height: MapControlMetrics.size)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.accent)
            .foregroundStyle(Palette.onAccent)
            .accessibilityIdentifier("Direct \(entry.airport.icao)")
            .accessibilityLabel("Direct to \(entry.airport.icao)")
            .layoutPriority(1)
        }
        .frame(minHeight: MapControlMetrics.size + 8)
    }
}

#Preview {
    let entries = [
        NearestAirportEntry(
            airport: Airport(
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
            ),
            distance: 3.2,
            bearing: 245
        ),
        NearestAirportEntry(
            airport: Airport(
                icao: "1CA9",
                name: "Private Ranch",
                latitude: 37.416,
                longitude: -122.049,
                elevation: 32,
                type: .airport,
                ownership: .privateOwned,
                runways: [
                    Runway(
                        id: "18/36", length: 2200, width: 50,
                        surface: .turf, lighting: .none,
                        baseEndID: "18", reciprocalEndID: "36",
                        baseEndLatitude: 37.41, baseEndLongitude: -122.05,
                        reciprocalEndLatitude: 37.42, reciprocalEndLongitude: -122.05
                    )
                ]
            ),
            distance: 5.8,
            bearing: 135
        ),
    ]

    NearestAirportView(
        entries: entries,
        onDirectTo: { _ in },
        onAirportTap: { _ in }
    )
}
