//
//  IsraelDiagramBadge.swift
//  efb-212
//
//  Edition badge for the CAAI aerodrome diagrams on the Israel map (IL-13): shown while a diagram is
//  drawn, with the edition and date as printed on the charts.
//

import SwiftUI

struct IsraelDiagramBadge: View {
    let overlay: AirportDiagramOverlay?
    @State private var store = IsraelDiagramStore.shared

    var body: some View {
        if let overlay, !overlay.shownAirports.isEmpty, let pack = store.pack {
            Text("\(pack.badgeText): \(overlay.shownAirports.joined(separator: ", "))")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
                .padding(.horizontal, Space.m)
                .padding(.vertical, Space.s)
                .background(.regularMaterial)
                .clipShape(Capsule())
                .accessibilityIdentifier("israel-diagram-badge")
        }
    }
}
