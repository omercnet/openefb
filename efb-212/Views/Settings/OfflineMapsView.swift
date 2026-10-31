//
//  OfflineMapsView.swift
//  efb-212
//
//  Settings > Charts > Offline Maps (F6). Pick a sectional area or the current map view,
//  see the size estimate, download packs, watch progress, pause / delete, and see which
//  downloaded sectionals are expired for the current FAA cycle.
//

import SwiftUI

struct OfflineMapsView: View {
    @Environment(AppState.self) private var appState
    @State private var service = OfflineMapService.shared

    /// Selected area id; `currentViewID` means the visible map box.
    @State private var selection: String = OfflineMapsView.currentViewID
    @State private var enabledLayers: Set<OfflineLayer> = Set(OfflineLayer.allCases.filter(\.isDefaultEnabled))
    @State private var errorMessage: String?

    static let currentViewID = "__current_view__"

    var body: some View {
        Form {
            cycleSection
            downloadSection
            packsSection
            copySection
        }
        .navigationTitle("Offline Maps")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Cycle

    private var cycleSection: some View {
        let cycle = SectionalCycle.current()
        return Section {
            LabeledContent("Sectional cycle", value: "valid to \(Self.dateString(cycle.expires))")
                .accessibilityIdentifier("sectional-cycle-line")
            LabeledContent("Storage used", value: OfflineSizeFormatter.string(bytes: service.storageUsedBytes))
        } footer: {
            Text("FAA sectionals are revised every 56 days. A downloaded sectional from an earlier cycle is marked Expired and must be downloaded again.")
        }
    }

    // MARK: - Download

    private var downloadSection: some View {
        let bounds = selectedBounds
        let layers = OfflineLayer.allCases.filter { enabledLayers.contains($0) }
        let bytes = bounds.map { OfflineTileMath.estimatedBytes(bounds: $0, layers: layers) } ?? 0

        return Section("Download a region") {
            Picker("Region", selection: $selection) {
                Text("Current map view").tag(Self.currentViewID)
                ForEach(SectionalArea.contiguousUS) { area in
                    Text(area.name).tag(area.id)
                }
            }
            .accessibilityIdentifier("offline-region-picker")

            ForEach(OfflineLayer.allCases) { layer in
                VStack(alignment: .leading, spacing: 2) {
                    Toggle(layer.displayName, isOn: binding(for: layer))
                    Text("Zoom \(layer.zoomRange.lowerBound)-\(layer.zoomRange.upperBound)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let note = layer.termsNote {
                        Text(note)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            LabeledContent("Estimated size") {
                Text(bounds == nil ? "—" : "about " + OfflineSizeFormatter.string(bytes: bytes))
                    .accessibilityIdentifier("offline-size-estimate")
            }

            Button {
                startDownload(bounds: bounds, layers: layers)
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .disabled(bounds == nil || layers.isEmpty)
            .accessibilityIdentifier("offline-download-button")

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Packs

    @ViewBuilder
    private var packsSection: some View {
        Section("Downloaded") {
            if service.packs.isEmpty {
                Text("Nothing downloaded. The map needs the internet.")
                    .foregroundStyle(.secondary)
            }
            ForEach(service.packs) { pack in
                packRow(pack)
            }
        }
    }

    private func packRow(_ pack: OfflinePackSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(pack.context.name) · \(pack.context.layer.displayName)")
                    .font(.body)
                Spacer()
                if pack.isExpired() {
                    Text("EXPIRED")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.orange, in: Capsule())   // amber = caution
                        .foregroundStyle(.black)
                }
            }

            switch pack.state {
            case .complete:
                Text("\(OfflineSizeFormatter.string(bytes: pack.completedBytes))"
                     + (pack.context.cycleEffective.map { " · cycle \(Self.dateString($0))" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .downloading, .paused:
                ProgressView(value: pack.fraction)
                Text("\(Int(pack.fraction * 100))% · \(pack.state == .paused ? "paused" : "downloading")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .failed(let message):
                Text(message).font(.caption).foregroundStyle(.red)
            }

            HStack(spacing: 16) {
                if pack.state == .downloading {
                    Button("Pause") { service.pause(pack) }
                } else if pack.state == .paused {
                    Button("Resume") { service.resume(pack) }
                }
                if pack.isExpired() {
                    Button("Download again") {
                        do { try service.redownload(pack) } catch { errorMessage = error.localizedDescription }
                    }
                }
                Spacer()
                Button(pack.state == .complete ? "Delete" : "Cancel", role: .destructive) {
                    service.delete(pack)
                }
            }
            .buttonStyle(.borderless)
            .frame(minHeight: 44)
        }
        .padding(.vertical, 4)
    }

    // MARK: - Copy

    private var copySection: some View {
        Section("What works offline") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Offline on this iPad: the airport and navaid database, regions you download here (FAA sectional and street maps), and FAA charts and airport diagram PDFs you have opened.")
                Text("Needs the internet: weather (METAR, TAF, winds aloft), TFRs, NOTAMs, PIREPs, AIRMET/SIGMET, and any map area you have not downloaded.")
                Text("Satellite and Terrain tiles come from third-party servers with usage limits (Esri, OpenTopoMap). They are off by default; download only small areas.")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Helpers

    private var selectedBounds: OfflineRegionBounds? {
        if selection == Self.currentViewID { return appState.mapVisibleBounds }
        return SectionalArea.contiguousUS.first { $0.id == selection }?.bounds
    }

    private func binding(for layer: OfflineLayer) -> Binding<Bool> {
        Binding(
            get: { enabledLayers.contains(layer) },
            set: { isOn in
                if isOn { enabledLayers.insert(layer) } else { enabledLayers.remove(layer) }
            }
        )
    }

    private func startDownload(bounds: OfflineRegionBounds?, layers: [OfflineLayer]) {
        guard let bounds else { return }
        let name = selection == Self.currentViewID
            ? "Map view"
            : (SectionalArea.contiguousUS.first { $0.id == selection }?.name ?? "Region")
        do {
            try service.download(name: name, bounds: bounds, layers: layers)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM yyyy"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }
}
