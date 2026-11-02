//
//  IsraelSourceBadgeStack.swift
//  efb-212
//
//  One compact badge for the Israel map's data sources (replaces the separate chart and diagram badges, which
//  collided top-left). One line per source: the official base chart (IL-9) and, while a diagram is on screen, the
//  CAAI aerodrome diagrams (IL-13). Tap to expand each line to its full wording. Amber marks a caution only
//  (chart not downloaded, newer edition available); everything else is secondary text.
//

import SwiftUI

/// What one source line says. Pure so the wording and caution rules are testable without a view.
struct IsraelSourceLine: Equatable, Identifiable {
    let id: String
    let label: String        // "CHART", "DIAGRAMS"
    let summary: String      // collapsed: short, glanceable
    let detail: String       // expanded: full wording
    let isCaution: Bool

    /// Base chart line from the chart pack status.
    static func chart(_ status: IsraelChartStatus) -> IsraelSourceLine {
        switch status {
        case .notDownloaded:
            return .init(id: "chart", label: "CHART", summary: "Not downloaded", detail: status.badgeText + ". The street base map is shown.", isCaution: true)
        case .installed(_, let label):
            return .init(id: "chart", label: "CHART", summary: label, detail: status.badgeText, isCaution: false)
        case .updateAvailable(_, let label, _, _):
            return .init(id: "chart", label: "CHART", summary: "\(label) · update", detail: status.badgeText, isCaution: true)
        }
    }

    /// Diagram line from the installed diagram pack and the aerodromes drawn now; nil when none is on screen.
    static func diagrams(pack: IsraelDiagramPack?, shown: [String]) -> IsraelSourceLine? {
        guard let pack, !shown.isEmpty else { return nil }
        let ids = shown.joined(separator: ", ")
        return .init(id: "diagrams", label: "DIAGRAMS", summary: "±\(pack.index.accuracyFeet) ft · \(ids)", detail: "\(pack.badgeText): \(ids)", isCaution: false)
    }
}

struct IsraelSourceBadgeStack: View {
    let overlay: AirportDiagramOverlay?
    @State private var chartStore = IsraelChartStore.shared
    @State private var diagramStore = IsraelDiagramStore.shared
    @State private var isExpanded = false

    private var lines: [IsraelSourceLine] {
        var result = [IsraelSourceLine.chart(chartStore.status)]
        if let overlay, overlay.isShowing,
           let line = IsraelSourceLine.diagrams(pack: diagramStore.pack, shown: overlay.shownAirports) {
            result.append(line)
        }
        return result
    }

    var body: some View {
        Button {
            isExpanded.toggle()
        } label: {
            VStack(alignment: .leading, spacing: isExpanded ? Space.s : Space.xs) {
                ForEach(lines) { line in
                    row(line)
                }
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .frame(maxWidth: 360, alignment: .leading)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("israel-source-badge")
        .accessibilityHint(isExpanded ? "Collapses the data source list" : "Shows the full data source wording")
        .task { await chartStore.refresh() }  // update check; the installed edition shows regardless
    }

    @ViewBuilder
    private func row(_ line: IsraelSourceLine) -> some View {
        let colour = line.isCaution ? Palette.caution : Palette.secondaryText
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Space.s) {
                Text(line.label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(colour)
                    .frame(width: 70, alignment: .leading)
                Text(line.summary)
                    .font(TypeRole.caption)
                    .foregroundStyle(colour)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if line.id == lines.first?.id {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityHidden(true)
                }
            }
            if isExpanded {
                Text(line.detail)
                    .font(TypeRole.caption)
                    .foregroundStyle(colour)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 70 + Space.s)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("israel-source-\(line.id)")
    }
}
