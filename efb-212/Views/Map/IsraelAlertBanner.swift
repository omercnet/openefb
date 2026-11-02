//
//  IsraelAlertBanner.swift
//  efb-212
//
//  The one banner area for Israel in-flight alerts (IL-ALERTS, efb-aac.9). The highest priority alert is
//  shown in full on top (red = warning, amber = caution, nothing else); the rest are one line each, at most
//  two, then "+N more". Alerts never stack into a pile and nothing animates.
//

import SwiftUI

struct IsraelAlertBanner: View {
    /// Highest priority first (`IsraelAlert.sorted`).
    let alerts: [IsraelAlert]

    private static let maxSecondary = 2

    var body: some View {
        if let top = alerts.first {
            VStack(alignment: .leading, spacing: Space.xs) {
                row(top, prominent: true)
                ForEach(Array(alerts.dropFirst().prefix(Self.maxSecondary))) { alert in
                    row(alert, prominent: false)
                }
                let hidden = alerts.count - 1 - Self.maxSecondary
                if hidden > 0 {
                    Text("+\(hidden) more")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(foreground(for: top.severity))
                }
            }
            .padding(Space.m)
            .frame(maxWidth: 520, alignment: .leading)
            .background(background(for: top.severity), in: RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("israel-alert-banner")
        }
    }

    private func row(_ alert: IsraelAlert, prominent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Space.s) {
                Image(systemName: alert.severity == .warning ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                    .accessibilityHidden(true)
                Text(alert.title)
                    .font(prominent ? .headline.weight(.bold) : .subheadline.weight(.semibold))
                    .lineLimit(prominent ? 3 : 1)
            }
            if prominent, let detail = alert.detail {
                Text(detail)
                    .font(.subheadline)
                    .lineLimit(2)
            }
        }
        .foregroundStyle(foreground(for: alert.severity))
        // A caution under a red top alert keeps its own amber, so red never reads as "everything is a warning".
        .padding(.horizontal, prominent ? 0 : Space.s)
        .padding(.vertical, prominent ? 0 : Space.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            !prominent && alert.severity != alerts.first?.severity ? background(for: alert.severity) : .clear,
            in: RoundedRectangle(cornerRadius: Radius.s)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("israel-alert-\(alert.id)")
        .accessibilityLabel("\(alert.severity == .warning ? "Warning" : "Caution"): \(alert.title). \(alert.detail ?? "")")
    }

    /// Red warning (white text, 5.4:1 on the day red) or amber caution (black text, 9:1).
    private func background(for severity: IsraelAlert.Severity) -> Color {
        severity == .warning ? Palette.warning : Palette.cautionFill
    }

    private func foreground(for severity: IsraelAlert.Severity) -> Color {
        severity == .warning ? .white : .black
    }
}

/// Shown instead of the alerts while there is no fresh GPS fix (UX-IL): amber caution, because "no alerts" would
/// otherwise read as "nothing ahead".
struct IsraelAlertsSuspendedBanner: View {
    var body: some View {
        HStack(spacing: Space.s) {
            Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("ALERTS OFF: NO GPS POSITION").font(.headline.weight(.bold))
                Text("Airspace, border and route closure alerts resume with a fix.").font(.subheadline)
            }
        }
        .foregroundStyle(.black)
        .padding(Space.m)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Palette.cautionFill, in: RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Caution: alerts off, no GPS position. Airspace, border and route closure alerts resume with a fix.")
        .accessibilityIdentifier("israel-alerts-suspended")
    }
}
