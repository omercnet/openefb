//
//  DataAgeBadge.swift
//  efb-212
//
//  The one freshness badge (F12): METAR, PIREPs, winds aloft, TFR / AIRMET-SIGMET layers, NOTAMs
//  and the chart cycle all use it. Neutral while fresh, amber when OLD / EXPIRED, red only when
//  using the data would be unsafe. Text stays primary so it reads on any tint.
//  Thresholds: `DataProduct` in Core/DataFreshness.swift, documented in docs/DESIGN.md.
//

import SwiftUI

struct DataAgeBadge: View {
    let freshness: DataFreshness
    /// Chart-cycle style: show nothing until the data is past a caution threshold.
    var hideWhenFresh = false

    /// Age-based products (METAR, PIREP, NOTAM, TFR, AIRMET/SIGMET).
    init(_ product: DataProduct, observed: Date?, now: Date = Date()) {
        freshness = DataFreshness.evaluate(product, observed: observed, now: now)
    }

    /// Window-based products (winds aloft FOR USE window, chart cycle, TAF valid period).
    init(_ product: DataProduct, validFrom: Date? = nil, validUntil: Date?, now: Date = Date()) {
        freshness = DataFreshness.evaluate(product, validFrom: validFrom, validUntil: validUntil, now: now)
    }

    /// An already evaluated freshness (a TAF, whose valid period and fetch age are combined by the view model).
    init(freshness: DataFreshness) {
        self.freshness = freshness
    }

    private var tint: Color {
        switch freshness.level {
        case .unknown, .fresh: return Palette.secondaryText
        case .old, .expired: return Palette.caution
        case .unsafe: return Palette.warning
        }
    }

    private var isAlert: Bool { freshness.level >= .old }

    /// Show nothing until the data is OLD or worse (chart-cycle style).
    func hiddenWhenFresh() -> DataAgeBadge {
        var copy = self
        copy.hideWhenFresh = true
        return copy
    }

    var body: some View {
        if !(hideWhenFresh && freshness.level < .old) {
            badge
        }
    }

    private var badge: some View {
        HStack(spacing: Space.xs) {
            if isAlert {
                Image(systemName: "exclamationmark.triangle.fill")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            Text(freshness.text)
        }
        .font(.footnote.weight(.semibold).monospacedDigit())
        .padding(.horizontal, Space.s)
        .padding(.vertical, Space.xs)
        .background(tint.opacity(isAlert ? 0.35 : 0.2))
        .foregroundStyle(isAlert ? Palette.primaryText : Palette.secondaryText)
        .clipShape(Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(freshness.product.displayName) age")
        .accessibilityValue(freshness.text)
        .accessibilityIdentifier("data-age-badge")
    }
}

#Preview("Fresh") { DataAgeBadge(.metar, observed: Date()) }
#Preview("OLD") { DataAgeBadge(.metar, observed: Date().addingTimeInterval(-5400)) }
#Preview("EXPIRED") { DataAgeBadge(.metar, observed: Date().addingTimeInterval(-14_000)) }
#Preview("Chart unsafe") { DataAgeBadge(.chartCycle, validUntil: Date().addingTimeInterval(-86_400)) }
#Preview("No data") { DataAgeBadge(.metar, observed: nil) }
