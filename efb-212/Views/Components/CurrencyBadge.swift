//
//  CurrencyBadge.swift
//  efb-212
//
//  Reusable traffic-light currency indicator badge.
//  Green (current), Yellow (warning), Red (expired).
//  Used in pilot profile view for medical, flight review, and night currency.
//

import SwiftUI

struct CurrencyBadge: View {
    let status: CurrencyStatus
    let label: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 6))
        layout {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 12, height: 12)
                    .accessibilityHidden(true)
                Text(label)
                    .font(.subheadline)
            }
            if !typeSize.isAccessibilitySize { Spacer() }
            // Status in words (primary text for contrast); the dot colour only reinforces it.
            Text(statusText)
                .font(.caption)
                .foregroundStyle(Palette.primaryText)
                .fontWeight(.semibold)
        }
        .accessibilityElement(children: .combine)
    }

    private var statusColor: Color {
        switch status {
        case .current: return Palette.ok
        case .warning: return Palette.caution
        case .expired: return Palette.warning
        }
    }

    private var statusText: String {
        switch status {
        case .current: return "Current"
        case .warning: return "Expiring Soon"
        case .expired: return "Expired"
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        CurrencyBadge(status: .current, label: "Medical Certificate")
        CurrencyBadge(status: .warning, label: "Flight Review")
        CurrencyBadge(status: .expired, label: "Night Currency (61.57)")
    }
    .padding()
}
