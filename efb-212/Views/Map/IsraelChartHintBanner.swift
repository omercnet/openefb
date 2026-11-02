//
//  IsraelChartHintBanner.swift
//  efb-212
//
//  One dismissible hint per install (IL-DEFAULT): the official CAAI chart is a download under
//  Settings > Region. Shown on the Israel map until the pilot dismisses it or the chart is installed.
//  Neutral styling: it is guidance, not a caution.
//

import SwiftUI

enum IsraelChartHint {
    /// UserDefaults key: the pilot dismissed the hint.
    static let dismissedKey = "israelChartHintDismissed"
    static let text = "Download the official CAAI chart in Settings \u{203A} Region"

    /// Shown only in Israel, while the official chart is not on the device, until dismissed.
    static func shouldShow(region: Region, chartInstalled: Bool, dismissed: Bool) -> Bool {
        region == .israel && !chartInstalled && !dismissed
    }
}

struct IsraelChartHintBanner: View {
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: Space.s) {
            Image(systemName: "arrow.down.circle")
                .foregroundStyle(Palette.secondaryText)
            Text(IsraelChartHint.text)
                .font(TypeRole.caption)
                .foregroundStyle(Palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Dismiss hint")
            .accessibilityIdentifier("israel-chart-hint-dismiss")
        }
        .padding(.leading, Space.m)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: Radius.s))
        .frame(maxWidth: 360, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("israel-chart-hint")
    }
}
