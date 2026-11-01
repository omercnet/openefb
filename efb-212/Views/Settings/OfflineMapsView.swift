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
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var service = OfflineMapService.shared

    /// Selected area id; `currentViewID` means the visible map box.
    @State private var selection: String = OfflineMapsView.currentViewID
    @State private var enabledLayers: Set<OfflineLayer> = Set(OfflineLayer.allCases)
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
            Text("FAA sectionals change every 56 days. A downloaded sectional from an earlier cycle is marked EXPIRED; download it again.")
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
                    Text(layer.detailDescription)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
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
                Label {
                    Text(errorMessage).foregroundStyle(Palette.primaryText)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.caution)
                }
                .font(.footnote)
            }
        }
    }

    // MARK: - Packs

    @ViewBuilder
    private var packsSection: some View {
        Section("Downloaded") {
            if service.packs.isEmpty {
                Text("Nothing downloaded yet. Without a region, the map needs the internet.")
                    .foregroundStyle(Palette.secondaryText)
            }
            ForEach(service.packs) { pack in
                packRow(pack)
            }
        }
    }

    private func isFailed(_ pack: OfflinePackSummary) -> Bool {
        if case .failed = pack.state { return true }
        return false
    }

    private func packRow(_ pack: OfflinePackSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("\(pack.context.name) · \(pack.context.layer.displayName)")
                        .font(.body)
                    Spacer()
                    if let effective = pack.context.cycleEffective, pack.context.layer.expiresWithChartCycle {
                        DataAgeBadge(.chartCycle,
                                     validUntil: effective.addingTimeInterval(TimeInterval(SectionalCycle.lengthDays) * 86_400))
                            .hiddenWhenFresh()
                    }
                }

                switch pack.state {
                case .complete:
                    Text("\(OfflineSizeFormatter.string(bytes: pack.completedBytes))"
                         + (pack.context.cycleEffective.map { " · cycle \(Self.dateString($0))" } ?? ""))
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                case .downloading, .paused:
                    ProgressView(value: pack.fraction)
                        .accessibilityValue("\(Int(pack.fraction * 100)) percent")
                    Text("\(Int(pack.fraction * 100))% · \(pack.state == .paused ? "paused" : "downloading")")
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                case .failed(let message):
                    Label {
                        Text("Failed: \(message)").foregroundStyle(Palette.primaryText)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.caution)
                    }
                    .font(.footnote)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(pack.context.name), \(pack.context.layer.displayName)")
            .accessibilityValue(accessibilityStatus(pack))

            let buttonLayout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 16))
            buttonLayout {
                if pack.state == .downloading {
                    Button { service.pause(pack) } label: { tapTarget("Pause") }
                } else if pack.state == .paused {
                    Button { service.resume(pack) } label: { tapTarget("Resume") }
                }
                if pack.isExpired() || isFailed(pack) {
                    Button {
                        do { try service.redownload(pack) } catch { errorMessage = error.localizedDescription }
                    } label: {
                        tapTarget(isFailed(pack) ? "Retry" : "Download again")
                    }
                }
                Spacer()
                Button(role: .destructive) {
                    service.delete(pack)
                } label: {
                    tapTarget(pack.state == .complete ? "Delete" : "Cancel")
                }
            }
            .buttonStyle(.borderless)
            .frame(minHeight: 44)
        }
        .padding(.vertical, 4)
    }

    /// Button label padded to the 44x44pt minimum hit target.
    private func tapTarget(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }

    /// Spoken status for a pack row: state, progress or size, cycle, expiry.
    private func accessibilityStatus(_ pack: OfflinePackSummary) -> String {
        let expired = pack.isExpired() ? ", expired, download again" : ""
        switch pack.state {
        case .complete:
            let size = OfflineSizeFormatter.string(bytes: pack.completedBytes)
            let cycle = pack.context.cycleEffective.map { ", cycle \(Self.dateString($0))" } ?? ""
            return "Downloaded, \(size)\(cycle)\(expired)"
        case .downloading, .paused:
            let verb = pack.state == .paused ? "Paused" : "Downloading"
            return "\(verb), \(Int(pack.fraction * 100)) percent\(expired)"
        case .failed(let message):
            return "Failed: \(message)"
        }
    }

    // MARK: - Copy

    private var copySection: some View {
        Section("What works offline") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Works offline: the airport and navaid database, regions downloaded here (sectional and street), and FAA charts and airport diagrams you have opened.")
                Text("Needs the internet: weather (METAR, TAF, winds aloft), TFRs, NOTAMs, PIREPs, AIRMET/SIGMET and map areas not downloaded.")
                Text("Satellite and Terrain base maps are online only.")
            }
            .font(.caption)
            .foregroundStyle(Palette.secondaryText)
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
