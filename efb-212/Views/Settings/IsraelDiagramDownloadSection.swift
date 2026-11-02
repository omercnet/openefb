//
//  IsraelDiagramDownloadSection.swift
//  efb-212
//
//  Settings > Region (Israel) > Aerodrome diagrams (IL-DEFAULT). Moved off the map badge: the installed
//  edition, the placement accuracy, which aerodromes are placed on the map, and Download / Update.
//  The diagrams are (c) CAAI; advisory only.
//

import SwiftUI

/// What the diagram row says. Pure so the wording is testable without a view.
struct IsraelDiagramSettingsSummary: Equatable {
    let detail: String
    let placed: String?

    init(pack: IsraelDiagramPack?, latest: IsraelChartManifest?, isChecking: Bool, checkFailed: Bool) {
        if let pack {
            detail = "Installed: \(pack.editionLabel). Placed on the map to about \u{00B1}\(pack.index.accuracyFeet) ft."
            let ids = pack.georeferencedICAOs
            placed = ids.isEmpty ? "No aerodrome is placed on the map in this edition." : "Placed on the map: \(ids.joined(separator: ", "))"
        } else {
            placed = nil
            if let latest {
                detail = "Not downloaded. Edition \(latest.label) is available."
            } else if isChecking {
                detail = "Checking for the latest edition\u{2026}"
            } else if checkFailed {
                detail = "Not downloaded. Can't reach the chart server."
            } else {
                detail = "Not downloaded. No edition is published yet."
            }
        }
    }
}

struct IsraelDiagramDownloadSection: View {
    @State private var store = IsraelDiagramStore.shared

    private var summary: IsraelDiagramSettingsSummary {
        IsraelDiagramSettingsSummary(pack: store.pack, latest: store.latest,
                                     isChecking: store.isChecking, checkFailed: store.latest == nil && store.errorMessage != nil)
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Aerodrome diagrams")
                    .font(.body)
                Text(summary.detail)
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("israel-diagrams-detail")
                if let placed = summary.placed {
                    Text(placed)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("israel-diagrams-placed")
                }
                if let progress = store.downloadProgress {
                    ProgressView(value: progress)
                        .accessibilityValue("\(Int(progress * 100)) percent")
                    Text("\(Int(progress * 100))% \u{00B7} downloading")
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                }
                if let message = store.errorMessage {
                    Label {
                        Text(message).foregroundStyle(Palette.primaryText)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.caution)
                    }
                    .font(.footnote)
                    .accessibilityIdentifier("israel-diagrams-error")
                }
                if !store.isDownloading, store.canDownload {
                    Button { store.startDownload() } label: {
                        Text(buttonTitle)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("israel-diagrams-download")
                }
            }
            .padding(.vertical, 4)
            .accessibilityIdentifier("israel-diagrams-row")
        } footer: {
            Text("Official CAAI aerodrome charts. Diagrams \u{00A9} CAAI. Supplemental reference only. "
                 + "Street map packs are under Offline Maps.")
        }
        .task { await store.refresh() }
    }

    private var buttonTitle: String {
        if store.errorMessage != nil { return "Retry" }
        return store.pack == nil ? "Download" : "Update"
    }
}
