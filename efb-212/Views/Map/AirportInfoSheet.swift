//
//  AirportInfoSheet.swift
//  efb-212
//
//  Bottom sheet with airport details, runways, frequencies, weather, FAA charts,
//  NOTAMs, PIREPs, and winds aloft. Half-height default per user decision; drag up for full height.
//  Per UI-SPEC: .presentationBackground(.regularMaterial), 24pt horizontal padding.
//

import SwiftUI

struct AirportInfoSheet: View {

    @Environment(AppState.self) private var appState
    @Environment(\.dynamicTypeSize) private var typeSize

    let databaseService: any DatabaseServiceProtocol
    let weatherService: any WeatherServiceProtocol
    let chartService: any TerminalProcedureServiceProtocol
    let notamService: any NotamServiceProtocol
    let pirepService: any PirepServiceProtocol
    let windsAloftService: any WindsAloftServiceProtocol

    @State private var airport: Airport?
    @State private var weatherViewModel: WeatherViewModel?
    @State private var isRawMETARExpanded: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let airport {
                    // Order by J1 relevance: identity, weather + frequencies, runways, NOTAMs, charts, PIREPs, winds.
                    VStack(alignment: .leading, spacing: Space.xl) {
                        VStack(alignment: .leading, spacing: Space.m) {
                            headerSection(airport)
                            infoChipsRow(airport)
                        }
                        weatherAndFrequencies(airport)
                        runwaysSection(airport)
                        Divider()
                        NotamSection(airport: airport, service: notamService)
                        Divider()
                        AirportChartsSection(airport: airport, service: chartService)
                        Divider()
                        sideBySide(spacing: Space.xl) {
                            PirepSection(airport: airport, service: pirepService)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            WindsAloftSection(airport: airport, service: windsAloftService)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.bottom, Space.xl)
                    .padding(.horizontal, Space.xl)
                    .padding(.top, Space.s)
                } else {
                    ProgressView("Loading airport...")
                        .padding(.top, 40)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        appState.isPresentingAirportInfo = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Palette.secondaryText)
                            .font(.title2)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        // Opens at ~60% so identity, weather and frequencies are visible without dragging.
        .presentationDetents([.fraction(0.62), .large])
        .presentationBackground(.regularMaterial)
        .onAppear {
            loadAirport()
        }
    }

    // MARK: - Header Section

    @ViewBuilder
    private func headerSection(_ airport: Airport) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                Text(airport.icao)
                    .font(TypeRole.title)

                // Flight category, next to the identifier (dot + text, never colour alone)
                if let wx = weatherViewModel?.currentWeather {
                    FlightCategoryDot(category: wx.flightCategory, showsLabel: true)
                }
            }

            Text(airport.name)
                .font(TypeRole.body)
                .foregroundStyle(Palette.secondaryText)
        }
    }

    // MARK: - Info Chips Row

    @ViewBuilder
    private func infoChipsRow(_ airport: Airport) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s) {
                infoChip(icon: "arrow.up", text: "\(Int(airport.elevation))' MSL")  // feet MSL
                infoChip(icon: "airplane", text: airport.type.rawValue.capitalized)
                if let tpa = airport.patternAltitude {
                    infoChip(icon: "arrow.clockwise", text: "TPA \(tpa)'")  // feet MSL
                }
                if !airport.fuelTypes.isEmpty {
                    infoChip(icon: "fuelpump", text: airport.fuelTypes.joined(separator: ", "))
                }
            }
        }
    }

    @ViewBuilder
    private func infoChip(icon: String, text: String) -> some View {
        HStack(spacing: Space.xs) {
            Image(systemName: icon)
                .font(.caption)
                .accessibilityHidden(true)
            Text(text)
                .font(TypeRole.caption)
        }
        .foregroundStyle(Palette.primaryText)
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.s)
        .background(Palette.fill)
        .clipShape(Capsule())
    }

    /// Two columns side by side; stacked vertically at accessibility text sizes so nothing truncates.
    @ViewBuilder
    private func sideBySide<Content: View>(spacing: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: .top, spacing: spacing))
        layout(content)
    }

    /// Label/value row: label column beside the value, label above the value at accessibility sizes.
    private var rowLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Space.m))
    }

    // MARK: - Weather + Frequencies

    @ViewBuilder
    private func weatherAndFrequencies(_ airport: Airport) -> some View {
        sideBySide(spacing: Space.xl) {
            weatherSection()
                .frame(maxWidth: .infinity, alignment: .leading)
            frequenciesSection(airport)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Frequencies Section

    /// Standard aviation abbreviations; a fixed label column means labels never hyphenate.
    static func frequencyLabel(_ type: FrequencyType) -> String {
        switch type {
        case .ctaf: return "CTAF"
        case .tower: return "TWR"
        case .ground: return "GND"
        case .clearance: return "CD"
        case .approach: return "APP"
        case .departure: return "DEP"
        case .atis: return "ATIS"
        case .awos: return "AWOS"
        case .asos: return "ASOS"
        case .unicom: return "UNICOM"
        case .multicom: return "MULTICOM"
        case .center: return "CTR"
        case .fss: return "FSS"
        case .other: return "FREQ"
        }
    }

    /// Spoken names so VoiceOver doesn't read "TWR" / "CD" as letters.
    static func frequencySpokenName(_ type: FrequencyType) -> String {
        switch type {
        case .ctaf: return "C TAF"
        case .tower: return "Tower"
        case .ground: return "Ground"
        case .clearance: return "Clearance delivery"
        case .approach: return "Approach"
        case .departure: return "Departure"
        case .atis: return "ATIS"
        case .awos: return "AWOS"
        case .asos: return "ASOS"
        case .unicom: return "Unicom"
        case .multicom: return "Multicom"
        case .center: return "Center"
        case .fss: return "Flight service"
        case .other: return "Frequency"
        }
    }

    /// Arrival-to-departure order: weather first, then the local frequency, then the ATC sequence.
    private static func frequencyRank(_ type: FrequencyType) -> Int {
        switch type {
        case .atis, .awos, .asos: return 0
        case .ctaf, .unicom, .multicom: return 1
        case .approach: return 2
        case .tower: return 3
        case .ground: return 4
        case .clearance: return 5
        case .departure: return 6
        case .center: return 7
        case .fss: return 8
        case .other: return 9
        }
    }

    @ViewBuilder
    private func frequenciesSection(_ airport: Airport) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeader("FREQUENCIES")

            if airport.frequencies.isEmpty {
                if let ctaf = airport.ctafFrequency {
                    frequencyRow(type: "CTAF", spoken: Self.frequencySpokenName(.ctaf), value: ctaf)
                }
                if let unicom = airport.unicomFrequency {
                    frequencyRow(type: "UNICOM", spoken: Self.frequencySpokenName(.unicom), value: unicom)
                }
                if airport.ctafFrequency == nil && airport.unicomFrequency == nil {
                    Text("No frequencies available")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.secondaryText)
                }
            } else {
                let sorted = airport.frequencies.sorted {
                    Self.frequencyRank($0.type) < Self.frequencyRank($1.type)
                }
                ForEach(sorted) { freq in
                    frequencyRow(type: Self.frequencyLabel(freq.type),
                                 spoken: Self.frequencySpokenName(freq.type),
                                 value: freq.frequency)
                }
            }
        }
    }

    @ViewBuilder
    private func frequencyRow(type: String, spoken: String, value: Double) -> some View {
        let mhz = String(format: "%.3f", value)  // MHz
        rowLayout {
            Text(type)
                .font(TypeRole.label)
                .foregroundStyle(Palette.secondaryText)
                .frame(minWidth: 72, alignment: .leading)
            Text(mhz)
                .font(TypeRole.value)
                .foregroundStyle(Palette.primaryText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityValue("\(mhz) megahertz")
    }

    // MARK: - Runways Section

    @ViewBuilder
    private func runwaysSection(_ airport: Airport) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeader("RUNWAYS")

            if airport.runways.isEmpty {
                Text("No runway data available")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            } else {
                ForEach(airport.runways) { runway in
                    rowLayout {
                        Text(runway.id)
                            .font(TypeRole.value)
                            .frame(minWidth: 72, alignment: .leading)
                        Text("\(runway.length)' x \(runway.width)'")  // feet
                            .font(TypeRole.valueSmall)
                        Text(runway.surface.rawValue.capitalized)
                            .font(TypeRole.body)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Runway \(runway.id)")
                    .accessibilityValue("\(runway.length) by \(runway.width) feet, \(runway.surface.rawValue.capitalized)")
                }
            }
        }
    }

    // MARK: - Weather Section

    @ViewBuilder
    private func weatherSection() -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack {
                SectionHeader("WEATHER")

                Spacer()

                // Manual refresh button per locked decision
                Button(action: {
                    Task {
                        await weatherViewModel?.refreshWeather()
                    }
                }) {
                    if weatherViewModel?.isLoading == true {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 44, height: 44)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                }
                .foregroundStyle(Palette.secondaryText)
                .accessibilityLabel("Refresh weather")
            }

            if let wx = weatherViewModel?.currentWeather {
                weatherDataView(wx)
            } else if weatherViewModel?.isLoading == true {
                HStack(spacing: Space.s) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading weather...")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.secondaryText)
                }
            } else if let error = weatherViewModel?.error {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Label("Weather not loaded", systemImage: "exclamationmark.triangle.fill")
                        .font(TypeRole.body.weight(.semibold))
                        .foregroundStyle(Palette.caution)
                    Text(error.localizedDescription)
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.secondaryText)
                    Button("Retry") { Task { await weatherViewModel?.refreshWeather() } }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                }
            } else {
                Text("No METAR for this airport.")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
        }
    }

    @ViewBuilder
    private func weatherDataView(_ wx: WeatherCache) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            // Age badge first: "is what I see current?" before the numbers.
            HStack {
                DataAgeBadge(.metar, observed: wx.observationTime)
                Spacer()
            }

            if let vm = weatherViewModel {
                weatherFieldRow("Wind", spoken: "Wind", value: vm.decodedWind)
                weatherFieldRow("Vis", spoken: "Visibility", value: vm.decodedVisibility)
                weatherFieldRow("Ceiling", spoken: "Ceiling", value: vm.decodedCeiling)
                weatherFieldRow("Temp", spoken: "Temperature", value: vm.decodedTemp)
                weatherFieldRow("Dewpt", spoken: "Dew point", value: vm.decodedDew)
            }

            // Raw METAR (expandable per user decision)
            if let rawMETAR = wx.rawMETAR {
                Button {
                    withAnimation { isRawMETARExpanded.toggle() }
                } label: {
                    HStack {
                        Text("Raw METAR")
                            .font(TypeRole.label)
                            .foregroundStyle(Palette.secondaryText)
                        Spacer()
                        Image(systemName: isRawMETARExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableButtonStyle())

                if isRawMETARExpanded {
                    Text(rawMETAR)
                        .font(.footnote.monospaced())
                        .foregroundStyle(Palette.primaryText)
                        .padding(Space.s)
                        .background(Palette.fill)
                        .clipShape(RoundedRectangle(cornerRadius: Space.s))
                }
            }

            if let taf = weatherViewModel?.currentTAF {
                Text("TAF")
                    .font(TypeRole.label)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.top, Space.xs)
                Text(taf)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Palette.primaryText)
                    .padding(Space.s)
                    .background(Palette.fill)
                    .clipShape(RoundedRectangle(cornerRadius: Space.s))
            }
        }
    }

    @ViewBuilder
    private func weatherFieldRow(_ label: String, spoken: String, value: String) -> some View {
        rowLayout {
            Text(label)
                .font(TypeRole.label)
                .foregroundStyle(Palette.secondaryText)
                .frame(minWidth: 72, alignment: .leading)
            Text(value)
                .font(TypeRole.valueSmall)
                .foregroundStyle(Palette.primaryText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityValue(value)
    }

    // MARK: - Data Loading

    private func loadAirport() {
        guard let icao = appState.selectedAirportID else { return }

        // Load airport from database
        do {
            airport = try databaseService.airport(byICAO: icao)
        } catch {
            airport = nil
        }

        // Initialize weather view model and load weather
        let vm = WeatherViewModel(weatherService: weatherService)
        weatherViewModel = vm
        Task {
            await vm.loadWeather(for: icao)
        }
    }
}

#Preview {
    AirportInfoSheet(
        databaseService: PlaceholderDatabaseService(),
        weatherService: PlaceholderWeatherService(),
        chartService: TerminalProcedureService(),
        notamService: NotamService(),
        pirepService: PirepService(),
        windsAloftService: WindsAloftService()
    )
    .environment(AppState())
}
