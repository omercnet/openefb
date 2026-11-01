//
//  WindsAloftSection.swift
//  efb-212
//
//  Airport sheet section: FD winds and temperatures aloft from the nearest forecast station,
//  with a 6/12/24-hour forecast picker.
//

import SwiftUI

struct WindsAloftSection: View {

    let airport: Airport
    let service: any WindsAloftServiceProtocol

    private enum LoadState {
        case loading
        case loaded(WindsAloftReport)
        case failed(String)
    }

    @State private var forecast: WindsAloftForecast = .sixHour
    @State private var state: LoadState = .loading
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("WINDS ALOFT")

            Picker("Forecast", selection: $forecast) {
                ForEach(WindsAloftForecast.allCases) { period in
                    Text(period.label).tag(period)
                }
            }
            .pickerStyle(.segmented)

            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            case .failed(let message):
                VStack(alignment: .leading, spacing: Space.xs) {
                    Label("Winds aloft not loaded: \(message)", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Palette.caution)
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                }
            case .loaded(let report):
                reportView(report)
            }
        }
        .task(id: "\(airport.icao)-\(forecast.rawValue)") {
            await load()
        }
    }

    // MARK: - Report

    @ViewBuilder
    private func reportView(_ report: WindsAloftReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            let headerLayout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
                : AnyLayout(HStackLayout(spacing: Space.s))
            headerLayout {
                Text("\(report.station.id) · \(report.station.name) · \(Int(report.distanceNM.rounded())) NM")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityLabel("Station \(report.station.id), \(report.station.name), \(Int(report.distanceNM.rounded())) nautical miles")
                if !typeSize.isAccessibilitySize { Spacer() }
                // Forecast products are judged by their FOR USE window, not by time since issue.
                DataAgeBadge(.windsAloft, validFrom: report.forUseStart, validUntil: report.forUseEnd)
            }

            Text(periodText(report))
                .font(.caption)
                .foregroundStyle(Palette.secondaryText)

            if !report.isInForUsePeriod(at: Date()) {
                Label("Outside the forecast's for-use period", systemImage: "clock.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(Palette.caution)
            }

            Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 4) {
                GridRow {
                    Text("ALT (ft MSL)").gridColumnAlignment(.leading)
                        .accessibilityLabel("Altitude feet MSL, direction degrees true, speed knots, temperature Celsius")
                    Text("DIR (°T)").accessibilityHidden(true)
                    Text("SPD (kt)").accessibilityHidden(true)
                    Text("TEMP (°C)").accessibilityHidden(true)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.secondaryText)

                ForEach(report.levels, id: \.altitude) { level in
                    GridRow {
                        // VoiceOver reads the whole level from the first cell; the other cells are hidden.
                        Text(level.altitude.formatted())  // feet MSL
                            .gridColumnAlignment(.leading)
                            .accessibilityLabel("\(level.altitude.formatted()) feet")
                            .accessibilityValue(spokenLevel(level))
                        if level.isLightAndVariable {
                            Text("Light & variable")
                                .gridCellColumns(2)
                                .accessibilityHidden(true)
                        } else {
                            Text(level.direction.map { String(format: "%03d", $0) } ?? "—")  // degrees true
                                .accessibilityHidden(true)
                            Text(level.speed.map { "\($0)" } ?? "—")                           // knots
                                .accessibilityHidden(true)
                        }
                        Text(level.temperature.map { "\($0)" } ?? "—")                       // degrees Celsius
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(level.isForecast ? Palette.primaryText : Palette.secondaryText)
                }
            }

            if report.levels.contains(where: { !$0.isForecast }) {
                Text("— Not forecast within 1,500 ft of station elevation (\(report.station.elevation.formatted()) ft MSL).")
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
        }
    }

    private func spokenLevel(_ level: WindsAloftLevel) -> String {
        var parts: [String] = []
        if level.isLightAndVariable {
            parts.append("wind light and variable")
        } else if let dir = level.direction, let spd = level.speed {
            parts.append("wind \(dir) degrees at \(spd) knots")
        }
        if let temp = level.temperature { parts.append("temperature \(temp) degrees Celsius") }
        if !level.isForecast { parts.append("not forecast") }
        return parts.isEmpty ? "no data" : parts.joined(separator: ", ")
    }


    private func periodText(_ report: WindsAloftReport) -> String {
        var parts: [String] = []
        if let valid = report.validTime { parts.append("Valid \(valid.metarTimeString)") }
        if let start = report.forUseStart, let end = report.forUseEnd {
            parts.append("For use \(start.zuluString)–\(end.zuluString)")
        }
        if let issued = report.issued { parts.append("Issued \(issued.zuluString)") }
        return parts.isEmpty ? "\(report.forecast.label) forecast" : parts.joined(separator: " · ")
    }

    // MARK: - Loading

    private func load() async {
        state = .loading
        do {
            let report = try await service.fetchWindsAloft(near: airport.coordinate, forecast: forecast)
            state = .loaded(report)
        } catch is CancellationError {
            return
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
