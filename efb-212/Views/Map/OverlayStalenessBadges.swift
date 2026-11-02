//
//  OverlayStalenessBadges.swift
//  efb-212
//
//  Map-level age marker for the TFR and AIRMET/SIGMET layers (efb-zfm.11). A stale snapshot is drawn
//  faded and dashed on the map, and this badge says so ("OLD 45 min"); once the snapshot is EXPIRED the
//  layer is not drawn and the badge says "not shown". Nothing appears while the data is current.
//

import SwiftUI

struct OverlayStalenessBadges: View {
    let viewModel: MapViewModel
    @Environment(AppState.self) private var appState
    @State private var now = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if viewModel.tilesFailing {
                Label("Map tiles not loading", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.primaryText)
                    .padding(.horizontal, Space.s)
                    .padding(.vertical, Space.xs)
                    .background(Palette.caution.opacity(0.35))
                    .clipShape(Capsule())
                    .accessibilityIdentifier("map-tiles-failing-badge")
            }
            if appState.visibleLayers.contains(.tfrs) {
                row("TFR", product: .tfr, fetchedAt: viewModel.tfrFetchedAt, overlay: viewModel.tfrOverlay,
                    identifier: "tfr-staleness-badge")
            }
            if appState.visibleLayers.contains(.advisories) {
                row("AIRMET/SIGMET", product: .airmetSigmet, fetchedAt: viewModel.advisoriesFetchedAt,
                    overlay: viewModel.advisoryOverlay, identifier: "advisory-staleness-badge")
            }
            let failedDiagrams = viewModel.mapService.airportDiagramOverlay.failedAirports
            if !failedDiagrams.isEmpty {
                Label("Airport diagram not loaded: \(failedDiagrams.prefix(3).joined(separator: ", "))",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.primaryText)
                    .padding(.horizontal, Space.s)
                    .padding(.vertical, Space.xs)
                    .background(Palette.caution.opacity(0.35))
                    .clipShape(Capsule())
                    .accessibilityIdentifier("diagram-load-failed-badge")
            }
        }
        .task {
            // Re-evaluate age as time passes: a layer that was current must not stay drawn once it is OLD or EXPIRED.
            while !Task.isCancelled {
                now = Date()
                viewModel.refreshOverlayStaleness(now: now)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .task {
            // In-flight refresh of the layers that are on (weather, TFR, AIRMET/SIGMET); see DataRefreshScheduler.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await viewModel.refreshDueData()
            }
        }
    }

    @ViewBuilder
    private func row(_ label: String, product: DataProduct, fetchedAt: Date?, overlay: OverlayStaleness,
                     identifier: String) -> some View {
        if fetchedAt != nil, overlay != .current {
            HStack(spacing: Space.xs) {
                Text(label)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.primaryText)
                DataAgeBadge(product, observed: fetchedAt, now: now)
                if overlay == .hidden {
                    Text("not shown")
                        .font(.footnote)
                        .foregroundStyle(Palette.primaryText)
                }
            }
            .padding(.horizontal, Space.s)
            .padding(.vertical, Space.xs)
            .background(.regularMaterial)
            .clipShape(Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(identifier)
        }
    }
}
