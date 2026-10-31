//
//  AirportChartsSection.swift
//  efb-212
//
//  Airport sheet section listing FAA terminal procedure charts (d-TPP), grouped by category
//  with the airport diagram first. Shows cycle validity and an expired warning.
//

import SwiftUI

struct AirportChartsSection: View {
    let airport: Airport
    let service: any TerminalProcedureServiceProtocol

    private enum LoadState {
        case loading
        case loaded(charts: [TerminalChart], cycle: DTPPCycle)
        case failed(String)
    }

    @State private var state: LoadState = .loading
    @State private var selectedChart: TerminalChart?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("FAA CHARTS")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)

            switch state {
            case .loading:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading charts...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            case .failed(let message):
                VStack(alignment: .leading, spacing: 6) {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                        .font(.subheadline)
                }
            case .loaded(let charts, let cycle):
                if charts.isEmpty {
                    Text("No FAA charts for this airport.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    cycleStatus(cycle)
                    ForEach(Self.grouped(charts), id: \.category) { group in
                        groupView(group.category, charts: group.charts)
                    }
                }
            }
        }
        .task(id: airport.id) { await load() }
        .fullScreenCover(item: $selectedChart) { chart in
            ChartPDFView(chart: chart, service: service)
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private func cycleStatus(_ cycle: DTPPCycle) -> some View {
        if cycle.isExpired() {
            Label("Charts expired \(Self.shortDate(cycle.expirationDate)). Do not use for navigation.",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
        } else {
            Text("Cycle \(cycle.code) · Valid to \(Self.shortDate(cycle.expirationDate))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func groupView(_ category: TerminalChartCategory, charts: [TerminalChart]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(category.title)
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(charts) { chart in
                Button {
                    selectedChart = chart
                } label: {
                    HStack {
                        Text(chart.name)
                            .font(.subheadline)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Loading

    private func load() async {
        state = .loading
        do {
            let charts = try await service.charts(for: airport)
            let cycle = try await service.currentCycle()
            state = .loaded(charts: charts, cycle: cycle)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    // MARK: - Helpers

    /// Groups charts by category in display order (diagram first), keeping metafile order within a group.
    nonisolated static func grouped(_ charts: [TerminalChart]) -> [(category: TerminalChartCategory, charts: [TerminalChart])] {
        Dictionary(grouping: charts, by: \.category)
            .map { (category: $0.key, charts: $0.value) }
            .sorted { $0.category < $1.category }
    }

    private static func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MM/dd"
        return formatter.string(from: date)
    }
}
