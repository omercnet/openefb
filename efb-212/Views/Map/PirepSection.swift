//
//  PirepSection.swift
//  efb-212
//
//  Airport sheet section: pilot reports within 50 NM from the last 2 hours, newest first.
//  Urgent PIREPs (UUA) are highlighted red; raw report text expands per row.
//

import SwiftUI
import CoreLocation

struct PirepSection: View {

    let airport: Airport
    let service: any PirepServiceProtocol

    static let radiusNM: Double = 50          // nautical miles
    static let maxAge: TimeInterval = 7200    // seconds (2 hours)

    private enum LoadState {
        case loading
        case loaded([Pirep])
        case failed(String)
    }

    @State private var state: LoadState = .loading
    @State private var expandedIDs: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PIREPS")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption)
                }
                .accessibilityLabel("Refresh PIREPs")
            }

            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            case .loaded(let pireps) where pireps.isEmpty:
                Text("No PIREPs within 50 NM in the last 2 hours.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            case .loaded(let pireps):
                ForEach(pireps) { pirep in
                    row(pirep)
                }
            }
        }
        .task(id: airport.icao) {
            await load()
        }
    }

    // MARK: - Row

    @ViewBuilder
    private func row(_ pirep: Pirep) -> some View {
        let isExpanded = expandedIDs.contains(pirep.id)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if pirep.isUrgent {
                    Label("URGENT", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.red)
                }
                Text(pirep.altitudeText)
                    .font(.subheadline.weight(.semibold))
                if let aircraft = pirep.aircraftType {
                    Text(aircraft)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                WeatherBadge(observationTime: pirep.observationTime)
            }

            Text(locationText(pirep))
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach(summaryLines(pirep), id: \.self) { line in
                Text(line)
                    .font(.subheadline)
            }

            Button {
                withAnimation {
                    if isExpanded { expandedIDs.remove(pirep.id) } else { expandedIDs.insert(pirep.id) }
                }
            } label: {
                HStack {
                    Text("Raw report")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(pirep.rawText)
                    .font(.caption2.monospaced())
                    .textSelection(.enabled)
            }
        }
        .padding(8)
        .background(
            pirep.isUrgent ? Color.red.opacity(0.15) : Color.secondary.opacity(0.08),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .overlay {
            if pirep.isUrgent {
                RoundedRectangle(cornerRadius: 8).stroke(Color.red, lineWidth: 1)
            }
        }
    }

    private func summaryLines(_ pirep: Pirep) -> [String] {
        var lines: [String] = []
        if let tb = pirep.turbulenceSummary { lines.append("Turbulence: \(tb)") }
        if let ic = pirep.icingSummary { lines.append("Icing: \(ic)") }
        if let sky = pirep.skySummary { lines.append("Sky: \(sky)") }
        if let wx = pirep.weather { lines.append("Weather: \(wx)") }
        var air: [String] = []
        if let temp = pirep.temperature { air.append("Temp \(temp)°C") }
        if let wind = pirep.windSummary { air.append("Wind \(wind)") }
        if !air.isEmpty { lines.append(air.joined(separator: " · ")) }
        return lines
    }

    /// Distance (NM) and compass direction of the report from the airport.
    private func locationText(_ pirep: Pirep) -> String {
        let distance = PirepParser.distanceNM(from: airport.coordinate, to: pirep.coordinate)  // nautical miles
        let from = CLLocation(latitude: airport.latitude, longitude: airport.longitude)
        let to = CLLocation(latitude: pirep.latitude, longitude: pirep.longitude)
        let bearing = from.bearing(to: to)  // degrees true
        let points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let compass = points[Int((bearing + 22.5) / 45) % 8]
        if distance < 1 { return "Over \(airport.icao) · \(pirep.reportType)" }
        return "\(Int(distance.rounded())) NM \(compass) of \(airport.icao) · \(pirep.reportType)"
    }

    // MARK: - Loading

    private func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let pireps = try await service.fetchPireps(
                near: airport.coordinate,
                radiusNM: Self.radiusNM,
                maxAge: Self.maxAge
            )
            state = .loaded(pireps)
        } catch is CancellationError {
            return
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
