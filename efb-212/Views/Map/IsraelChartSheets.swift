//
//  IsraelChartSheets.swift
//  efb-212
//
//  Tap sheets for the Israel CVFR chart (IL-3): a reporting point (code, name, connected segments
//  with altitudes per direction) and the airspaces under the finger (name, type, limits, raw text).
//  Published text is shown as published; inferred altitude references are flagged for the CFI review.
//

import SwiftUI

struct IsraelChartSheet: View {
    let selection: IsraelChartSelection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    switch selection {
                    case .point(let detail):
                        IsraelPointDetailView(detail: detail)
                    case .airspaces(let details):
                        ForEach(details) { detail in
                            IsraelAirspaceDetailView(detail: detail)
                            if detail.id != details.last?.id { Divider() }
                        }
                    case .aerodrome:
                        EmptyView()  // never presented: MapView opens the airport sheet instead
                    }
                }
                .padding(Space.l)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("israel-chart-sheet")
    }
}

private struct IsraelPointDetailView: View {
    let detail: IsraelPointDetail

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(detail.code)
                    .font(.largeTitle.weight(.bold))
                    .monospaced()
                if let name = detail.nameEnglish {
                    Text(name).font(.title3)
                }
                if let hebrew = detail.nameHebrew {
                    Text(hebrew)
                        .font(.title3)
                        .foregroundStyle(Palette.secondaryText)
                        .environment(\.layoutDirection, .rightToLeft)
                }
                Text(detail.kindText)
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            }

            if detail.rows.isEmpty {
                Text("No CVFR route segment ends here.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            } else {
                SectionHeader("ROUTE SEGMENTS (ALTITUDE FT MSL, PUBLISHED)")
                VStack(alignment: .leading, spacing: Space.s) {
                    ForEach(detail.rows) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text("\(row.from) \u{2192} \(row.to)")
                                    .font(.body.weight(.semibold))
                                    .monospaced()
                                Spacer()
                                Text(row.altitude)
                                    .font(.body.weight(.semibold))
                                    .monospacedDigit()
                            }
                            Text(row.routeType)
                                .font(TypeRole.caption)
                                .foregroundStyle(Palette.secondaryText)
                            if let closure = row.closure {
                                Label(closure, systemImage: "exclamationmark.octagon.fill")
                                    .font(TypeRole.caption.weight(.semibold))
                                    .foregroundStyle(Palette.warning)
                            }
                        }
                        .frame(minHeight: 44, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

private struct IsraelAirspaceDetailView: View {
    let detail: IsraelAirspaceDetail

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(detail.title)
                .font(.title2.weight(.bold))
            if let name = detail.nameEnglish, name != detail.title {
                Text(name).font(.body)
            }
            if let hebrew = detail.nameHebrew {
                Text(hebrew)
                    .font(.body)
                    .foregroundStyle(Palette.secondaryText)
                    .environment(\.layoutDirection, .rightToLeft)
            }
            Text(detail.typeText)
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)

            Grid(alignment: .leading, horizontalSpacing: Space.l, verticalSpacing: Space.xs) {
                GridRow {
                    Text("Ceiling").foregroundStyle(Palette.secondaryText)
                    Text(detail.ceiling).fontWeight(.semibold)
                }
                GridRow {
                    Text("Floor").foregroundStyle(Palette.secondaryText)
                    Text(detail.floor).fontWeight(.semibold)
                }
                if let authority = detail.authority {
                    GridRow {
                        Text("Authority").foregroundStyle(Palette.secondaryText)
                        Text(authority)
                    }
                }
                if let raw = detail.rawText {
                    GridRow {
                        Text("Chart text").foregroundStyle(Palette.secondaryText)
                        Text(raw).monospacedDigit()
                    }
                }
            }
            .font(.body)

            if let note = detail.referenceNote {
                Label(note, systemImage: "exclamationmark.triangle.fill")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.caution)
                    .padding(.top, Space.xs)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
