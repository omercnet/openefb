//
//  AirportColumnView.swift
//  efb-212
//
//  Airport details in the strip column (Direction 2, stage 1): identity, Direct-To, weather with its age,
//  frequencies, runways, then NOTAMs, charts, diagrams, PIREPs and winds aloft stacked in one narrow column.
//  Replaces the airport bottom sheet. Also holds the small pieces every strip column shares: the 60 pt
//  header row with the Log back button, the hairline rule and the uppercase section label.
//

import SwiftUI

// MARK: - Shared column pieces

/// 60 pt header row of a strip column: a "Log" back button, then the column's title content.
struct ColumnHeader<Title: View>: View {
    @Environment(AppState.self) private var appState
    private let title: Title

    init(@ViewBuilder title: () -> Title) {
        self.title = title()
    }

    var body: some View {
        HStack(spacing: Space.s) {
            Button {
                appState.stripColumn = .log
            } label: {
                Label("Log", systemImage: "chevron.backward")
                    .labelStyle(.titleAndIcon)
                    .font(TypeRole.label)
                    .foregroundStyle(Palette.ink)
                    .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())
            .accessibilityLabel("Back to flight log")
            .accessibilityIdentifier("column-back-to-log")

            title
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Space.s)
        .frame(minHeight: StripMetrics.cell)
        .background(Palette.paperSecondary)
        .overlay(alignment: .bottom) { ColumnRule() }
    }
}

/// 1 pt hairline between column rows and sections.
struct ColumnRule: View {
    var body: some View {
        Rectangle()
            .fill(Palette.rule)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

/// Uppercase tracked section label, e.g. "WEATHER".
struct ColumnSectionLabel: View {
    private let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(TypeRole.stripLabel)
            .textCase(.uppercase)
            .tracking(StripMetrics.labelTracking)
            .foregroundStyle(Palette.inkSecondary)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - AirportColumnView

struct AirportColumnView: View {

    @Environment(AppState.self) private var appState
    @Environment(\.dynamicTypeSize) private var typeSize

    private let databaseService: any DatabaseServiceProtocol
    private let weatherService: any WeatherServiceProtocol
    private let chartService: any TerminalProcedureServiceProtocol
    private let notamService: any NotamServiceProtocol
    private let pirepService: any PirepServiceProtocol
    private let windsAloftService: any WindsAloftServiceProtocol
    private let onDirectTo: (Airport) -> Void

    @State private var airport: Airport?
    /// Israel (IL-4): the curated aerodrome behind `airport`, with its sources and review status.
    @State private var aerodrome: IsraelAerodrome?
    @State private var weatherViewModel: WeatherViewModel?
    @State private var isRawMETARExpanded: Bool = false

    init(databaseService: any DatabaseServiceProtocol, weatherService: any WeatherServiceProtocol,
         chartService: any TerminalProcedureServiceProtocol, notamService: any NotamServiceProtocol,
         pirepService: any PirepServiceProtocol, windsAloftService: any WindsAloftServiceProtocol,
         onDirectTo: @escaping (Airport) -> Void) {
        self.databaseService = databaseService
        self.weatherService = weatherService
        self.chartService = chartService
        self.notamService = notamService
        self.pirepService = pirepService
        self.windsAloftService = windsAloftService
        self.onDirectTo = onDirectTo
    }

    private var station: WeatherStation? {
        appState.region.weatherStation(id: appState.selectedAirportID ?? "")
    }

    var body: some View {
        VStack(spacing: 0) {
            ColumnHeader { headerTitle }
            ScrollView {
                if let airport {
                    // Order by J1 relevance: identity, Direct, weather, frequencies, runways, NOTAMs, charts, PIREPs, winds.
                    VStack(alignment: .leading, spacing: Space.l) {
                        directButton(airport)
                        infoChipsRow(airport)
                        weatherSection()
                        ColumnRule()
                        frequenciesSection(airport)
                        ColumnRule()
                        if let aerodrome {
                            IsraelAerodromeSection(aerodrome: aerodrome)
                        } else {
                            runwaysSection(airport)
                        }
                        if appState.region.isAvailable(.notams) {
                            ColumnRule()
                            NotamSection(airport: airport, service: notamService)
                        }
                        if appState.region.isAvailable(.airportCharts) {
                            ColumnRule()
                            AirportChartsSection(airport: airport, service: chartService)
                        }
                        if appState.region.isAvailable(.israelDiagrams) {
                            ColumnRule()
                            IsraelDiagramSection(icao: airport.icao)
                        }
                        if appState.region.isAvailable(.pireps) {
                            ColumnRule()
                            PirepSection(airport: airport, service: pirepService)
                        }
                        if appState.region.isAvailable(.windsAloft) {
                            ColumnRule()
                            WindsAloftSection(airport: airport, service: windsAloftService)
                        }
                    }
                    .padding(Space.l)
                } else if station != nil {
                    // No airport data for this region yet: the station's weather still works.
                    VStack(alignment: .leading, spacing: Space.l) {
                        weatherSection()
                        Text("Airport data for \(appState.region.displayName) is not available yet. Only this station's weather is shown.")
                            .font(TypeRole.caption)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .padding(Space.l)
                } else {
                    ProgressView("Loading airport...")
                        .padding(.top, 40)
                }
            }
        }
        .foregroundStyle(Palette.ink)
        .background(Palette.paper)
        .task(id: appState.selectedAirportID) {
            await loadAirport()
        }
    }

    // MARK: - Header

    /// Ident in chart blue with the flight category beside it, then the name.
    private var headerTitle: some View {
        let ident = airport?.icao ?? station?.id ?? appState.selectedAirportID ?? ""
        let name = airport?.name ?? station?.name
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                Text(ident)
                    .font(TypeRole.title)
                    .foregroundStyle(Palette.airspace)
                    .lineLimit(1)
                    .fixedSize()
                // Flight category, next to the identifier (dot + text, never colour alone)
                if let wx = weatherViewModel?.currentWeather {
                    FlightCategoryDot(category: wx.flightCategory, showsLabel: true)
                }
            }
            if let name {
                Text(name)
                    .font(TypeRole.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
            }
        }
        .padding(.vertical, Space.xs)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Direct-To

    private func directButton(_ airport: Airport) -> some View {
        Button {
            onDirectTo(airport)
            appState.stripColumn = .log
        } label: {
            Label("Direct \(airport.icao)", systemImage: "arrow.up.right")
                .font(TypeRole.label.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: StripMetrics.cell)
        }
        .buttonStyle(.borderedProminent)
        .tint(Palette.accent)
        .foregroundStyle(Palette.onAccent)
        .accessibilityLabel("Direct to \(airport.icao)")
        .accessibilityIdentifier("airport-direct-to")
    }

    // MARK: - Info Chips Row

    @ViewBuilder
    private func infoChipsRow(_ airport: Airport) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s) {
                if let aerodrome, aerodrome.elevationFeet == nil {
                    infoChip(icon: "arrow.up", text: "ELEV not published")
                } else {
                    infoChip(icon: "arrow.up", text: "\(Int(airport.elevation))' MSL")  // feet MSL
                }
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

    private func infoChip(icon: String, text: String) -> some View {
        HStack(spacing: Space.xs) {
            Image(systemName: icon)
                .font(.caption)
                .accessibilityHidden(true)
            Text(text)
                .font(TypeRole.data)
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.s)
        .background(Palette.paperSecondary)
        .clipShape(Capsule())
    }

    /// Label/value row: label column beside the value, label above the value at accessibility sizes.
    private var rowLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Space.m))
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
            ColumnSectionLabel("Frequencies")

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
                        .foregroundStyle(Palette.inkSecondary)
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

    private func frequencyRow(type: String, spoken: String, value: Double) -> some View {
        let mhz = String(format: "%.3f", value)  // MHz
        return rowLayout {
            Text(type)
                .font(TypeRole.label)
                .foregroundStyle(Palette.inkSecondary)
                .frame(minWidth: 80, alignment: .leading)
            Text(mhz)
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityValue("\(mhz) megahertz")
    }

    // MARK: - Runways Section

    @ViewBuilder
    private func runwaysSection(_ airport: Airport) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            ColumnSectionLabel("Runways")

            if airport.runways.isEmpty {
                Text("No runway data available")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.inkSecondary)
            } else {
                ForEach(airport.runways) { runway in
                    rowLayout {
                        Text(runway.id)
                            .font(TypeRole.dataEmphasis)
                            .frame(minWidth: 80, alignment: .leading)
                        Text("\(runway.length)' x \(runway.width)'")  // feet
                            .font(TypeRole.data)
                        Text(runway.surface.rawValue.capitalized)
                            .font(TypeRole.body)
                            .foregroundStyle(Palette.inkSecondary)
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
            // Age on the first line: "is what I see current?" before the numbers.
            HStack(spacing: Space.s) {
                ColumnSectionLabel("Weather")
                if let wx = weatherViewModel?.currentWeather {
                    DataAgeBadge(.metar, observed: wx.observationTime)
                }
                Spacer()
                // Manual refresh button per locked decision
                Button {
                    Task { await weatherViewModel?.refreshWeather() }
                } label: {
                    if weatherViewModel?.isLoading == true {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: StripMetrics.cell, height: StripMetrics.cell)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .frame(width: StripMetrics.cell, height: StripMetrics.cell)
                            .contentShape(Rectangle())
                    }
                }
                .foregroundStyle(Palette.inkSecondary)
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
                        .foregroundStyle(Palette.inkSecondary)
                }
            } else if let error = weatherViewModel?.error {
                weatherError("Weather not loaded", error: error)
            } else if weatherViewModel?.metarPublished == false {
                Text(weatherViewModel?.tafPublished == false
                     ? "No METAR or TAF is published for this aerodrome."
                     : "No METAR is published for this aerodrome. The forecast (TAF) is below.")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.inkSecondary)
                    .accessibilityIdentifier("weather-no-metar")
            } else {
                Text("No METAR for this airport.")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.inkSecondary)
            }

            tafView()
        }
    }

    /// Amber failure notice with the error and a Retry button (never just an OLD badge).
    private func weatherError(_ title: String, error: EFBError) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(TypeRole.body.weight(.semibold))
                .foregroundStyle(Palette.caution)
            Text(error.localizedDescription)
                .font(TypeRole.caption)
                .foregroundStyle(Palette.inkSecondary)
            Button("Retry") { Task { await weatherViewModel?.refreshWeather() } }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(minHeight: StripMetrics.cell)
        }
    }

    @ViewBuilder
    private func weatherDataView(_ wx: WeatherCache) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            // A cached report is shown, but the refresh failed: say so, and offer Retry.
            if let error = weatherViewModel?.error {
                weatherError("Weather refresh failed. Showing the last report.", error: error)
                    .accessibilityIdentifier("weather-refresh-failed")
            }

            if let vm = weatherViewModel {
                weatherFieldRow("Wind", spoken: "Wind", value: vm.decodedWind)
                weatherFieldRow("Vis", spoken: "Visibility", value: vm.decodedVisibility)
                weatherFieldRow("Ceiling", spoken: "Ceiling", value: vm.decodedCeiling)
                weatherFieldRow("Temp", spoken: "Temperature", value: vm.decodedTemp)
                weatherFieldRow("Dewpt", spoken: "Dew point", value: vm.decodedDew)
                weatherFieldRow("Altim", spoken: "Altimeter", value: vm.decodedAltimeter)
            }

            // Raw METAR (expandable per user decision)
            if let rawMETAR = wx.rawMETAR {
                Button {
                    isRawMETARExpanded.toggle()
                } label: {
                    HStack {
                        Text("Raw METAR")
                            .font(TypeRole.label)
                            .foregroundStyle(Palette.inkSecondary)
                        Spacer()
                        Image(systemName: isRawMETARExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .frame(minHeight: StripMetrics.cell)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityValue(isRawMETARExpanded ? "Expanded" : "Collapsed")

                if isRawMETARExpanded {
                    rawReport(rawMETAR)
                }
            }
        }
    }

    private func rawReport(_ text: String) -> some View {
        Text(text)
            .font(TypeRole.data)
            .foregroundStyle(Palette.ink)
            .padding(Space.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.activeCell)
            .clipShape(RoundedRectangle(cornerRadius: Radius.s))
    }

    /// The TAF block, independent of the METAR: a TAF-only aerodrome (Israel's LLHZ) shows it alone, and a METAR
    /// failure never hides it.
    @ViewBuilder
    private func tafView() -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if let taf = weatherViewModel?.currentTAF {
                HStack(spacing: Space.s) {
                    ColumnSectionLabel("TAF")
                    // Valid-period end from the TAF text, else its fetch age: an old forecast reads OLD / EXPIRED.
                    if let freshness = weatherViewModel?.tafFreshness() {
                        DataAgeBadge(freshness: freshness)
                            .accessibilityIdentifier("taf-age-badge")
                    }
                    Spacer()
                }
                .padding(.top, Space.xs)
                rawReport(taf)
                if weatherViewModel?.tafFailed == true {
                    Label("TAF refresh failed. Showing the last forecast.", systemImage: "exclamationmark.triangle.fill")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.caution)
                }
            } else if weatherViewModel?.tafFailed == true {
                Label("TAF not loaded", systemImage: "exclamationmark.triangle.fill")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.caution)
                    .padding(.top, Space.xs)
            }
        }
    }

    private func weatherFieldRow(_ label: String, spoken: String, value: String) -> some View {
        rowLayout {
            Text(label)
                .font(TypeRole.label)
                .foregroundStyle(Palette.inkSecondary)
                .frame(minWidth: 80, alignment: .leading)
            Text(value)
                .font(TypeRole.data)
                .foregroundStyle(Palette.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityValue(value)
    }

    // MARK: - Data Loading

    /// Runs on appear and whenever `appState.selectedAirportID` changes; a newer selection cancels the older load.
    private func loadAirport() async {
        airport = nil
        aerodrome = nil
        weatherViewModel = nil
        isRawMETARExpanded = false
        guard let icao = appState.selectedAirportID else { return }

        // Load airport from database (regions without airport data have none to find).
        // Israel reads the curated aerodromes and keeps the aerodrome for its sources and review note.
        if appState.region == .israel {
            aerodrome = (try? IsraelAviationDatabase.bundled().aerodrome(code: icao)) ?? nil
            airport = aerodrome.map(IsraelAerodromeAdapter.airport)
        } else if appState.region.hasAirportData {
            airport = try? databaseService.airport(byICAO: icao)
        }

        let vm = WeatherViewModel(weatherService: weatherService)
        vm.region = appState.region
        weatherViewModel = vm
        await vm.loadWeather(for: icao)
    }
}

#Preview {
    let appState = AppState()
    appState.selectedAirportID = "KPAO"
    return AirportColumnView(
        databaseService: PlaceholderDatabaseService(),
        weatherService: PlaceholderWeatherService(),
        chartService: TerminalProcedureService(),
        notamService: NotamService(),
        pirepService: PirepService(),
        windsAloftService: WindsAloftService(),
        onDirectTo: { _ in }
    )
    .frame(width: StripMetrics.width)
    .environment(appState)
}
