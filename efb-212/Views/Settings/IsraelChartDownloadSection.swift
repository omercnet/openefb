//
//  IsraelChartDownloadSection.swift
//  efb-212
//
//  Settings > Offline Maps > Israel CVFR chart (IL-9). Download with progress, pause / resume, update
//  and delete for the official CAAI chart pack. Only a published, validated edition is ever offered.
//

import SwiftUI

struct IsraelChartDownloadSection: View {
    @State private var store = IsraelChartStore.shared

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Israel CVFR chart")
                    .font(.body)
                Text(detailLine)
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("israel-chart-detail")
                if let progress = store.downloadProgress {
                    ProgressView(value: progress)
                        .accessibilityValue("\(Int(progress * 100)) percent")
                    Text("\(Int(progress * 100))% \u{00B7} downloading")
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                } else if let paused = store.pausedProgress {
                    Text("Paused at \(Int(paused * 100))%. Download continues from where it stopped.")
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                }
                if case .updateAvailable(_, _, _, let latestLabel) = store.status {
                    Label("Newer edition available: \(latestLabel)", systemImage: "arrow.down.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(Palette.caution)
                        .accessibilityIdentifier("israel-chart-update")
                }
                if let message = store.errorMessage {
                    Label {
                        Text(message).foregroundStyle(Palette.primaryText)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.caution)
                    }
                    .font(.footnote)
                    .accessibilityIdentifier("israel-chart-error")
                }
                HStack(spacing: 16) {
                    if store.isDownloading {
                        Button { store.pauseDownload() } label: { tapTarget("Pause") }
                    } else if store.latest != nil, downloadLabel != nil {
                        Button { store.startDownload() } label: { tapTarget(downloadLabel ?? "Download") }
                            .accessibilityIdentifier("israel-chart-download")
                    }
                    Spacer()
                    if store.installed != nil, !store.isDownloading {
                        Button(role: .destructive) { store.remove() } label: { tapTarget("Delete") }
                            .accessibilityIdentifier("israel-chart-delete")
                    }
                }
                .buttonStyle(.borderless)
                .frame(minHeight: 44)
            }
            .padding(.vertical, 4)
            .accessibilityIdentifier("israel-chart-row")
        } header: {
            Text("Israel official chart")
        } footer: {
            Text("The official CAAI CVFR low-level routes chart, converted and checked by OpenEFB before release. "
                 + "Chart \u{00A9} CAAI; base map \u{00A9} Mapa Ltd. Supplemental reference only.")
        }
        .task { await store.refresh() }
    }

    /// Nil when there is nothing to fetch (already on the latest edition).
    private var downloadLabel: String? {
        switch store.status {
        case .notDownloaded: return store.pausedProgress == nil ? "Download" : "Resume"
        case .updateAvailable: return "Update"
        case .installed: return nil
        }
    }

    private var detailLine: String {
        let size = store.offeredBytes.map { OfflineSizeFormatter.string(bytes: $0) }
        switch store.status {
        case .notDownloaded:
            if let latest = store.latest {
                return "Edition \(latest.label), \(size ?? "")"
            }
            if store.isChecking { return "Checking for the latest edition\u{2026}" }
            return store.checkFailed
                ? "Can't reach the chart server. Connect to the internet to download."
                : "No official chart is published yet."
        case .installed(_, let label), .updateAvailable(_, let label, _, _):
            let installedSize = store.installed.map { OfflineSizeFormatter.string(bytes: $0.totalBytes) } ?? ""
            return "Installed: edition \(label), \(installedSize). Checksum verified."
        }
    }

    private func tapTarget(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }
}
