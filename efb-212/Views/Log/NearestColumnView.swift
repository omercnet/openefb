//
//  NearestColumnView.swift
//  efb-212
//
//  The nearest landable airports in the strip column, opened from the NRST footer cell.
//  Each row: ident, name, distance and bearing, longest runway, caution tags, and a large "Direct" action
//  that starts Direct-To and returns to the log: two taps from the footer (design findings F1, F2).
//  Tapping the row body opens the airport column.
//

import SwiftUI

struct NearestColumnView: View {
    @Environment(AppState.self) private var appState

    private let entries: [NearestAirportEntry]
    private let region: Region
    private let onDirectTo: (Airport) -> Void
    private let onAirportTap: (String) -> Void

    init(entries: [NearestAirportEntry], region: Region, onDirectTo: @escaping (Airport) -> Void,
         onAirportTap: @escaping (String) -> Void) {
        self.entries = entries
        self.region = region
        self.onDirectTo = onDirectTo
        self.onAirportTap = onAirportTap
    }

    var body: some View {
        VStack(spacing: 0) {
            ColumnHeader {
                Text("Nearest")
                    .font(TypeRole.title)
                    .foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
            }
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
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(entries) { entry in
                            NearestColumnRow(
                                entry: entry,
                                onDirectTo: { airport in
                                    onDirectTo(airport)
                                    appState.stripColumn = .log
                                },
                                onAirportTap: onAirportTap
                            )
                            ColumnRule()
                        }
                    }
                }
            }
        }
        .foregroundStyle(Palette.ink)
        .background(Palette.paper)
    }
}

// MARK: - NearestColumnRow

private struct NearestColumnRow: View {
    let entry: NearestAirportEntry
    let onDirectTo: (Airport) -> Void
    let onAirportTap: (String) -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    /// The column is narrow (400 pt on iPad): identity, distance and Direct side by side need room, so they
    /// stack from xLarge text, where the identity column would otherwise leave a closure tag no width.
    private var stacksVertically: Bool { typeSize >= .xLarge }

    var body: some View {
        let layout = stacksVertically
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.m))
            : AnyLayout(HStackLayout(spacing: Space.m))
        layout {
            // Airport identity and runway (tap for airport info)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(entry.airport.icao)
                    .font(TypeRole.rowIdent)
                    .foregroundStyle(Palette.airspace)
                    .lineLimit(1)
                    .fixedSize()
                Text(entry.airport.name)
                    .font(TypeRole.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(stacksVertically ? nil : 1)
                if let runway = entry.longestRunway {
                    Text("\(runway.id)  \(runway.length)' \(runway.surface.abbreviation)")   // feet
                        .font(TypeRole.data)
                } else {
                    Text("no runway data")
                        .font(TypeRole.data)
                        .foregroundStyle(Palette.inkSecondary)
                }
                // Caution tags keep their full width, so they get their own line: side by side when they fit,
                // one per line when they don't. They must never push the runway or the NOTAM closure tag out of
                // the row.
                if entry.isPrivateUse || entry.isMilitary || entry.requiresPPR || entry.isClosedByNotam {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Space.s) { cautionTags }
                        VStack(alignment: .leading, spacing: Space.xs) { cautionTags }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { onAirportTap(entry.airport.icao) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Shows airport information")

            // Distance (NM) and bearing (degrees)
            VStack(alignment: stacksVertically ? .leading : .trailing, spacing: 2) {
                Text(String(format: "%.1f NM", entry.distance))
                    .font(TypeRole.dataEmphasis)
                    .lineLimit(1)
                    .fixedSize()
                Text(String(format: "%03.0f\u{00B0}", entry.bearing))
                    .font(TypeRole.data)
                    .foregroundStyle(Palette.inkSecondary)
            }
            .accessibilityElement(children: .combine)

            // Direct-To: one tap, large target
            Button(action: { onDirectTo(entry.airport) }) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.right")
                        .accessibilityHidden(true)
                    Text("Direct")
                        .lineLimit(1)
                        .fixedSize()
                }
                .font(TypeRole.label.weight(.bold))
                .padding(.horizontal, Space.m)
                .frame(minHeight: StripMetrics.cell)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.accent)
            .foregroundStyle(Palette.onAccent)
            .accessibilityIdentifier("Direct \(entry.airport.icao)")
            .accessibilityLabel("Direct to \(entry.airport.icao)")
            .layoutPriority(1)
        }
        .padding(.horizontal, Space.l)
        .padding(.vertical, Space.s)
        .frame(minHeight: StripMetrics.cell + Space.s)
    }

    @ViewBuilder
    private var cautionTags: some View {
        if entry.isPrivateUse { PrivateUseTag() }
        if entry.isMilitary { MilitaryUseTag() }
        if entry.requiresPPR { PprTag() }
        if entry.isClosedByNotam { NotamClosedTag() }
    }
}

// MARK: - Caution tags

/// A short tag that is never truncated (layouts give it its own line). Day: a filled amber or red block.
/// Night: no filled amber blocks, so caution is an amber outline with amber text on the dark paper.
private struct StatusTag: View {
    let text: String
    let spoken: String
    let isWarning: Bool

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.xs)
        let night = colorScheme == .dark
        Text(text)
            .font(.footnote.weight(.heavy))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(isWarning ? Palette.onWarning : (night ? Palette.caution : .black))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background {
                if isWarning {
                    shape.fill(Palette.warning)
                } else if night {
                    shape.strokeBorder(Palette.caution, lineWidth: 1)
                } else {
                    shape.fill(Palette.cautionFill)
                }
            }
            .accessibilityLabel(spoken)
    }
}

/// Amber caution tag for private-use fields (permission required to land).
struct PrivateUseTag: View {
    var body: some View { StatusTag(text: "PVT", spoken: "Private use", isWarning: false) }
}

/// Amber caution tag for military fields (emergency use only; still listed for emergencies).
struct MilitaryUseTag: View {
    var body: some View { StatusTag(text: "MIL", spoken: "Military field, emergency use only", isWarning: false) }
}

/// Amber caution tag for Israeli fields whose AIP entry requires prior permission (PPR).
struct PprTag: View {
    var body: some View { StatusTag(text: "PPR", spoken: "Prior permission required", isWarning: false) }
}

/// Red warning tag: a current NOTAM names this field closed. The pilot must read the NOTAM.
struct NotamClosedTag: View {
    var body: some View { StatusTag(text: "NOTAM CLSD", spoken: "A NOTAM names this field closed", isWarning: true) }
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

    NearestColumnView(
        entries: entries,
        region: .us,
        onDirectTo: { _ in },
        onAirportTap: { _ in }
    )
    .frame(width: StripMetrics.width)
    .environment(AppState())
}
