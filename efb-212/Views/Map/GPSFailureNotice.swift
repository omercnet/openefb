//
//  GPSFailureNotice.swift
//  efb-212
//
//  Says why there is no position ("GPS LOST" alone gives no cause) and, when the pilot can
//  fix it, offers Open Settings. Amber = caution; shown above the instrument strip.
//

import SwiftUI

struct GPSFailureNotice: View {
    let reason: GPSFailureReason

    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .center, spacing: Space.m) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Label(reason.title, systemImage: "location.slash.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.caution)
                Text(reason.message)
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if reason.offersSettings {
                Spacer(minLength: Space.s)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(minHeight: MapControlMetrics.size)  // in-flight control: >= 60 pt
                .accessibilityIdentifier("gps-open-settings")
            }
        }
        .padding(Space.m)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .frame(maxWidth: 560, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("gps-failure-notice")
    }
}
