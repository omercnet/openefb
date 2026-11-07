//
//  CVFRDebriefContent.swift
//  efb-212
//
//  The CVFR section of Flight Details (IL-DEBRIEF): the flight unrolled on one distance axis, per-leg altitude
//  adherence against the published altitude, reporting-point passage and plain-language observations. All numbers come from
//  CVFRDebriefBuilder, so the section shows even when Apple Intelligence is unavailable.
//  Renders nothing for flights outside Israel.
//

import SwiftUI

/// The tables and observations, separate from loading so a preview or test can feed it directly.
struct CVFRDebriefContent: View {
    let debrief: CVFRDebrief

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("CVFR Route", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.headline)
            Text(debrief.fromPlan ? "Compared with the activated plan." : "Matched from the track to the route network.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if !debrief.observations.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(debrief.observations, id: \.self) { line in
                        Text(line).font(.subheadline)
                    }
                }
                .accessibilityIdentifier("cvfr-observations")
            }

            // The flight unrolled on one distance axis; the table below keeps the exact numbers.
            CVFRDebriefProfileView(debrief: debrief)
            legsTable
            if !debrief.points.isEmpty { pointsTable }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("cvfr-debrief")
    }

    // MARK: Legs

    private var legsTable: some View {
        VStack(alignment: .leading, spacing: 0) {
            row(["Leg", "Pub. alt", "±200 / ±300 ft", "Max dev."], header: true)
            ForEach(debrief.legs) { leg in
                legRow(leg)
                Divider()
            }
        }
        .accessibilityIdentifier("cvfr-legs")
    }

    private func legRow(_ leg: CVFRLegDebrief) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(leg.fromCode)–\(leg.toCode)").font(.body.bold())
                Text("\(Self.timeFormatter.string(from: leg.startTime))–\(Self.timeFormatter.string(from: leg.endTime))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(leg.publishedAltitude.map { "\($0) ft" } ?? "---")
                .frame(maxWidth: .infinity, alignment: .leading)
            if let a = leg.adherence {
                HStack(spacing: 4) {
                    if isLow(a) {
                        Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
                    }
                    Text("\(CVFRDebriefBuilder.percent(a.fractionWithin200)) / \(CVFRDebriefBuilder.percent(a.fractionWithin300))")
                }
                .foregroundStyle(color(for: a))
                .accessibilityElement(children: .combine)
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(String(format: "%+.0f ft", a.maxDeviationFeet))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("not measured").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("---").frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.subheadline)
        .padding(.vertical, 8)
    }

    /// Amber (caution) below 80% within ±300 ft. A debrief is feedback, not a hazard warning, so it is never red;
    /// the glyph keeps it from being colour only.
    private func color(for adherence: CVFRAltitudeAdherence) -> Color {
        adherence.fractionWithin300 < 0.8 ? Palette.caution : Palette.primaryText
    }

    private func isLow(_ adherence: CVFRAltitudeAdherence) -> Bool { adherence.fractionWithin300 < 0.8 }

    // MARK: Points

    private var pointsTable: some View {
        VStack(alignment: .leading, spacing: 0) {
            row(["Point", "Time", "Closest", "Reported"], header: true)
            ForEach(debrief.points) { point in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(point.code).font(.body.bold())
                        if let name = point.nameEnglish, name.caseInsensitiveCompare(point.code) != .orderedSame {
                            Text(name).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Self.timeFormatter.string(from: point.time))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(String(format: "%.1f NM", point.distanceNM))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Group {
                        if debrief.transcriptAvailable {
                            Text(point.reported ? "Yes" : "No")
                        } else {
                            Text("Not checked")
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Not checked: no transcript")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.subheadline)
                .padding(.vertical, 8)
                Divider()
            }
        }
        .accessibilityIdentifier("cvfr-points")
    }

    private func row(_ titles: [String], header: Bool) -> some View {
        HStack(spacing: 8) {
            ForEach(titles, id: \.self) { title in
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.caption.bold())
        .foregroundStyle(.secondary)
        .padding(.bottom, 4)
    }
}
