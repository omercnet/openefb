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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionHeader("PIREPS")
                Spacer()
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.body)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .foregroundStyle(Palette.accentText)
                .accessibilityLabel("Refresh PIREPs")
            }

            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            case .failed(let message):
                VStack(alignment: .leading, spacing: Space.xs) {
                    Label("PIREPs not loaded: \(message)", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Palette.caution)
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                }
            case .loaded(let pireps) where pireps.isEmpty:
                Text("No PIREPs within 50 NM in the last 2 hours.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
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
            let headerLayout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
                : AnyLayout(HStackLayout(spacing: 6))
            headerLayout {
                if pirep.isUrgent {
                    Label("URGENT", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Palette.warning)
                }
                Text(pirep.altitudeText)
                    .font(.subheadline.weight(.semibold))
                if let aircraft = pirep.aircraftType {
                    Text(aircraft)
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                }
                if !typeSize.isAccessibilitySize { Spacer() }
                DataAgeBadge(.pirep, observed: pirep.observationTime)
            }
            .accessibilityElement(children: .combine)

            Text(locationText(pirep))
                .font(.caption)
                .foregroundStyle(Palette.secondaryText)

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
                        .foregroundStyle(Palette.secondaryText)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")

            if isExpanded {
                Text(pirep.rawText)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
            }
        }
        .padding(8)
        .background(
            pirep.isUrgent ? Palette.warning.opacity(0.15) : Palette.fill,
            in: RoundedRectangle(cornerRadius: Radius.s)
        )
        .overlay {
            if pirep.isUrgent {
                RoundedRectangle(cornerRadius: Radius.s).stroke(Palette.warning, lineWidth: 1)
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
