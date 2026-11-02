//
//  ChartPDFView.swift
//  efb-212
//
//  Full-screen viewer for FAA terminal procedure PDFs (PDFKit, pinch zoom).
//  Downloads the chart on appear (cached offline afterwards) and shows loading / error states.
//

import SwiftUI
import PDFKit

/// PDFKit wrapper: fit to the view, pinch to zoom up to 8x.
struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = FitToViewPDFView()
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .systemBackground
        view.document = document
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document {
            view.document = document
        }
    }
}

/// PDFView created at zero size never computes its fit scale (`autoScales` alone leaves the
/// page tiny). Re-fit whenever the view's size changes; zoom range is fit ... 8x fit.
final class FitToViewPDFView: PDFView {
    private var fittedSize: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != fittedSize, bounds.width > 0, bounds.height > 0 else { return }
        fittedSize = bounds.size
        let fit = scaleFactorForSizeToFit
        guard fit > 0 else { return }
        minScaleFactor = fit
        maxScaleFactor = fit * 8
        scaleFactor = fit
    }
}

struct ChartPDFView: View {
    let chart: TerminalChart
    let service: any TerminalProcedureServiceProtocol

    @Environment(\.dismiss) private var dismiss

    private enum LoadState {
        case loading
        case loaded(PDFDocument)
        case failed(String)
    }

    @State private var state: LoadState = .loading

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(chart.name)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .task(id: chart.id) { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                Text("Downloading chart...")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let document):
            VStack(spacing: 0) {
                if let banner = expiryBanner {
                    banner
                }
                PDFKitView(document: document)
                    .ignoresSafeArea(edges: .bottom)
            }
        case .failed(let message):
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(.orange)
                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                Button("Retry") { Task { await load() } }
                    .buttonStyle(.bordered)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// The chart's own cycle decides: expired charts are said to be expired, near expiry says so too.
    private var chartCycle: DTPPCycle? {
        TerminalProcedureService.cycle(code: chart.cycle, near: Date())
    }

    private var expiryBanner: AnyView? {
        guard let cycle = chartCycle else { return nil }
        let freshness = DataFreshness.evaluate(.chartCycle, validUntil: cycle.expirationDate)
        guard freshness.level >= .old else { return nil }
        let text = cycle.isExpired()
            ? "EXPIRED: cycle \(cycle.code) ended \(cycle.expirationDate.formatted(.dateTime.day().month(.abbreviated).year())). Do not use for navigation."
            : "Cycle \(cycle.code) \(freshness.text.lowercased())"
        return AnyView(
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(cycle.isExpired() ? Palette.warning : Palette.caution)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Space.m)
                .background(.regularMaterial)
                .accessibilityIdentifier("chart-expiry-banner")
        )
    }

    private func load() async {
        state = .loading
        do {
            let url = try await service.pdfURL(for: chart)
            if let document = PDFDocument(url: url) {
                state = .loaded(document)
            } else {
                state = .failed("The chart file could not be opened. Retry downloads it again.")
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
