//
//  NotamSection.swift
//  efb-212
//
//  Airport-sheet section listing currently effective FAA NOTAMs.
//  Aerodrome / runway closures sort first and are highlighted; tap a NOTAM to expand its text.
//  Shows data age (fetch time) via DataAgeBadge.
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
    @Environment(\.dynamicTypeSize) private var typeSize

    init(airport: Airport, service: any NotamServiceProtocol) {
        self.airport = airport
        self.service = service
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionHeader("NOTAMS")
                Spacer()
                if case .loaded(let report) = state {
                    DataAgeBadge(.notam, observed: report.fetchedAt)
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
            Label("NOTAMs need a free FAA API key. Add it in Settings › NOTAM API.", systemImage: "key")
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)

        case .credentialsRejected:
            Label(NotamError.credentialsRejected.errorDescription ?? "NOTAM API key rejected",
                  systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(Palette.caution)

        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Text("NOTAMs not loaded: \(message)")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
                Button("Retry") {
                    Task { await load() }
                }
                .font(.subheadline)
                .buttonStyle(.bordered)
                .controlSize(.large)
            }

        case .loaded(let report):
            if report.refreshFailed {
                Label("Refresh failed. Showing the copy from the last successful download; check NOTAMs again before flight.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
                    .accessibilityIdentifier("notam-refresh-failed")
                Button("Retry") { Task { await load() } }
                    .font(.subheadline)
                    .buttonStyle(.bordered)
                    .controlSize(.large)
            }
            if report.isIncomplete {
                Label("List incomplete: too many NOTAMs to download. Closures may be missing.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
                    .accessibilityIdentifier("notam-incomplete")
            }
            if report.notams.isEmpty {
                Text(report.refreshFailed ? "No active NOTAMs in the saved copy for \(report.location)"
                                          : "No active NOTAMs for \(report.location)")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
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
                            .font(.caption)
                            .fontWeight(.bold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Palette.warning)
                            .foregroundStyle(Palette.onWarning)
                            .clipShape(Capsule())
                    }
                    Text(notam.number)
                        .font(.caption.monospaced())
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityHidden(true)
                }

                // Effective window, UTC
                Text(notam.effectiveWindowDescription)
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)

                Text(notam.text)
                    .font(.subheadline)
                    .lineLimit(isExpanded ? nil : (typeSize.isAccessibilitySize ? 6 : 2))
                    .multilineTextAlignment(.leading)

                if isExpanded, let fullText = notam.fullText, fullText != notam.text {
                    Text(fullText)
                        .font(.caption.monospaced())
                        .foregroundStyle(Palette.secondaryText)
                        .textSelection(.enabled)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(closure != nil ? Palette.warning.opacity(0.12) : Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: Radius.s))
        }
        .buttonStyle(PressableButtonStyle())
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
