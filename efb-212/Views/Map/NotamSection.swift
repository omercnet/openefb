//
//  NotamSection.swift
//  efb-212
//
//  Airport-sheet section listing currently effective FAA NOTAMs.
//  Aerodrome / runway closures sort first and are highlighted; tap a NOTAM to expand its text.
//  Shows data age (fetch time) via WeatherBadge.
//

import SwiftUI

struct NotamSection: View {

    let airport: Airport
    let service: any NotamServiceProtocol

    private enum LoadState {
        case loading
        case notConfigured
        case credentialsRejected
        case failed(String)
        case loaded(NotamReport)
    }

    @State private var state: LoadState = .loading
    @State private var expandedIDs: Set<String> = []

    init(airport: Airport, service: any NotamServiceProtocol) {
        self.airport = airport
        self.service = service
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("NOTAMS")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Spacer()
                if case .loaded(let report) = state {
                    WeatherBadge(observationTime: report.fetchedAt)
                }
            }

            content
        }
        .task(id: airport.icao) {
            await load()
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ProgressView()
                .controlSize(.small)

        case .notConfigured:
            Label("Add a free FAA NOTAM API key in Settings to see NOTAMs", systemImage: "key")
                .font(.subheadline)
                .foregroundStyle(.secondary)

        case .credentialsRejected:
            Label(NotamError.credentialsRejected.errorDescription ?? "NOTAM API key rejected",
                  systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(.orange)

        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Text("NOTAMs unavailable: \(message)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Retry") {
                    Task { await load() }
                }
                .font(.subheadline)
            }

        case .loaded(let report):
            if report.notams.isEmpty {
                Text("No active NOTAMs for \(report.location)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(report.notams) { notam in
                        notamRow(notam)
                    }
                }
            }
        }
    }

    // MARK: - Row

    @ViewBuilder
    private func notamRow(_ notam: Notam) -> some View {
        let isExpanded = expandedIDs.contains(notam.id)
        let closure = notam.closure

        Button {
            if isExpanded {
                expandedIDs.remove(notam.id)
            } else {
                expandedIDs.insert(notam.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if let closure {
                        Text(closure.label)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.red.opacity(0.2))
                            .foregroundStyle(.red)
                            .clipShape(Capsule())
                    }
                    Text(notam.number)
                        .font(.caption.monospaced())
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                // Effective window, UTC
                Text(notam.effectiveWindowDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(notam.text)
                    .font(.subheadline)
                    .lineLimit(isExpanded ? nil : 2)
                    .multilineTextAlignment(.leading)

                if isExpanded, let fullText = notam.fullText, fullText != notam.text {
                    Text(fullText)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(closure != nil ? Color.red.opacity(0.12) : Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityHint(isExpanded ? "Collapse NOTAM" : "Expand NOTAM")
    }

    // MARK: - Loading

    private func load() async {
        state = .loading
        do {
            let report = try await service.fetchNotams(for: airport)
            state = .loaded(report)
        } catch NotamError.notConfigured {
            state = .notConfigured
        } catch NotamError.credentialsRejected {
            state = .credentialsRejected
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(error.localizedDescription)
        }
    }
}
