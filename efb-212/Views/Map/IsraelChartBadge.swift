//
//  IsraelChartBadge.swift
//  efb-212
//
//  Edition badge for the Israel base chart (IL-9): which official edition is on screen, that a newer
//  validated one is available, or that the official chart is not downloaded and the street base shows.
//

import SwiftUI

struct IsraelChartBadge: View {
    @State private var store = IsraelChartStore.shared

    var body: some View {
        let status = store.status
        let isCaution: Bool = {
            if case .updateAvailable = status { return true }
            return false
        }()
        Text(status.badgeText)
            .font(TypeRole.caption)
            .foregroundStyle(isCaution ? Palette.caution : Palette.secondaryText)
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .background(.regularMaterial)
            .clipShape(Capsule())
            .accessibilityIdentifier("israel-chart-badge")
            .task { await store.refresh() }  // update check; the installed edition shows regardless
    }
}
