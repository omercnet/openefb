//
//  AirspaceCheckUnavailableBanner.swift
//  efb-212
//
//  Amber caution while the airspace proximity check cannot run (database error), so a missing
//  alert is never mistaken for a clear sky (efb-8lm). Same style as GPSFailureNotice.
//

import SwiftUI

struct AirspaceCheckUnavailableBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label("Airspace check unavailable", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.caution)
            Text("Airspace and TFR alerts are not running. Check airspace on the chart.")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Space.m)
        .frame(maxWidth: 560, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("airspace-check-unavailable")
    }
}
