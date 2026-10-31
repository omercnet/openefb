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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WINDS ALOFT")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)

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
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
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
            HStack {
                Text("\(report.station.id) · \(report.station.name) · \(Int(report.distanceNM.rounded())) NM")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                // Forecast products are judged by their FOR USE window, not by time since
                // issue (WeatherBadge would read STALE 2 h after issue while still current).
                forUseBadge(report)
            }

            Text(periodText(report))
                .font(.caption)
                .foregroundStyle(.secondary)

            if !report.isInForUsePeriod(at: Date()) {
                Label("Outside the forecast's for-use period", systemImage: "clock.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 4) {
                GridRow {
                    Text("ALT (ft MSL)").gridColumnAlignment(.leading)
                    Text("DIR (°T)")
                    Text("SPD (kt)")
                    Text("TEMP (°C)")
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)

                ForEach(report.levels, id: \.altitude) { level in
                    GridRow {
                        Text(level.altitude.formatted())  // feet MSL
                            .gridColumnAlignment(.leading)
                        if level.isLightAndVariable {
                            Text("Light & variable")
                                .gridCellColumns(2)
                        } else {
                            Text(level.direction.map { String(format: "%03d", $0) } ?? "—")  // degrees true
                            Text(level.speed.map { "\($0)" } ?? "—")                           // knots
                        }
                        Text(level.temperature.map { "\($0)" } ?? "—")                       // degrees Celsius
                    }
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(level.isForecast ? Color.primary : Color.secondary)
                }
            }

            if report.levels.contains(where: { !$0.isForecast }) {
                Text("— Not forecast within 1,500 ft of station elevation (\(report.station.elevation.formatted()) ft MSL).")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func forUseBadge(_ report: WindsAloftReport) -> some View {
        let current = report.isInForUsePeriod(at: Date())
        Text(current ? "Current" : "Not current")
            .font(.caption)
            .foregroundStyle(current ? Color.secondary : Color.orange)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill((current ? Color.secondary : Color.orange).opacity(0.15)))
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
