//
//  IsraelDiagramSection.swift
//  efb-212
//
//  Airport sheet section for the official CAAI aerodrome diagram (IL-13): "on the map" when the diagram
//  passed the runway gate, "sheet only" (PDF viewer) when it did not, a download row when the diagram pack
//  is not on the device. The diagrams are (c) CAAI; advisory only.
//

import SwiftUI
import PDFKit

struct IsraelDiagramSection: View {
    let icao: String
    @State private var store = IsraelDiagramStore.shared
    @State private var remoteConfig = RemoteConfigStore.shared
    @State private var showingSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("CAAI DIAGRAM")
            content
        }
        .task { await store.refresh() }
        .fullScreenCover(isPresented: $showingSheet) {
            if let url = store.pack?.sheetURL(for: icao) {
                IsraelDiagramSheetView(title: "\(icao) aerodrome chart", url: url)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.availability(for: icao) {
        case .georeferenced(let record):
            if let message = remoteConfig.disabledMessage(for: .israelDiagramOverlay) {
                // Switched off by the remote config: say so, with the file's own words, instead of promising an overlay.
                Text("Not drawn on the map right now. \(message) \(record.chart), \(editionText).")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("israel-diagram-remote-off")
            } else {
                Text("On the map at zoom 14 and closer, placed to about ±\(store.pack?.index.accuracyFeet ?? 100) ft. \(record.chart), \(editionText).")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            sheetButton("View chart sheet")
        case .sheetOnly(let record):
            Text("Sheet only, not placed on the map: it could not be checked against the runway positions. \(record.chart), \(editionText).")
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("israel-diagram-sheet-only")
            sheetButton("View chart sheet")
        case .none:
            if store.pack == nil {
                notDownloaded
            } else {
                Text("No official aerodrome chart for this field in \(editionText).")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
        }
    }

    private var editionText: String { store.pack?.editionLabel ?? "no edition installed" }

    @ViewBuilder
    private var notDownloaded: some View {
        if let progress = store.downloadProgress {
            ProgressView(value: progress)
            Text("Downloading aerodrome diagrams...").font(.subheadline).foregroundStyle(Palette.secondaryText)
        } else if store.canDownload {
            Text("Official aerodrome diagrams are not on this device.")
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
            Button(store.errorMessage == nil ? "Download diagrams" : "Retry download") { store.startDownload() }
                .buttonStyle(.bordered)
                .controlSize(.large)
        } else {
            Text("Official aerodrome diagrams are not available yet.")
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
        }
        if let message = store.errorMessage {
            Text(message).font(TypeRole.caption).foregroundStyle(Palette.warning)
        }
    }

    private func sheetButton(_ title: String) -> some View {
        Button(title) { showingSheet = true }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityIdentifier("israel-diagram-view-sheet")
    }
}

/// Full-screen viewer for a diagram sheet PDF from the pack.
struct IsraelDiagramSheetView: View {
    let title: String
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let document = PDFDocument(url: url) {
                    PDFKitView(document: document).ignoresSafeArea(edges: .bottom)
                } else {
                    Text("The chart file could not be opened.").padding()
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
