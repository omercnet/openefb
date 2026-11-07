//
//  RegionTests.swift
//  efb-212Tests
//
//  IL-2: the region switch. Persistence, per-region configuration (stations, altimeter unit,
//  layer availability), weather requests using the region's stations, hPa display and the
//  honest "no data" states. No network: weather goes through StubURLProtocol.
//

import Testing
import Foundation
import SwiftData
import CoreLocation
@testable import efb_212

/// Records the URLs a stubbed session was asked for.
private final class RegionRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []
    func add(_ url: URL?) { if let url { lock.withLock { urls.append(url) } } }
    var all: [URL] { lock.withLock { urls } }
}

@Suite("Region Tests")
@MainActor
struct RegionTests {

    /// Shape captured from https://aviationweather.gov/api/data/metar?ids=LLBG&format=json
    /// (`altim` is hectopascals).
    nonisolated static let llbgJSON = """
    [{"icaoId":"LLBG","obsTime":1793524800,"reportTime":"2026-11-01T09:20:00.000Z","temp":26,"dewp":15,
      "wdir":290,"wspd":5,"visib":"6+","altim":1017,"fltCat":"VFR",
      "rawOb":"METAR LLBG 010920Z 29005KT 250V330 9999 FEW025 26/15 Q1017 NOSIG",
      "clouds":[{"cover":"FEW","base":2500}]}]
    """.data(using: .utf8)!

    private func makeContext() throws -> ModelContext {
        let container = try ModelContainer(
            for: SchemaV1.UserSettings.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        return ModelContext(container)
    }

    // MARK: - Persistence

    @Test func freshStoreDefaultsToIsrael() throws {
        let context = try makeContext()
        #expect(RegionStore.load(from: context) == .israel)
        #expect(SchemaV1.UserSettings().region == .israel)
    }

    @Test func aStoredUSChoiceIsKept() throws {
        let context = try makeContext()
        try RegionStore.save(.us, to: context)
        #expect(RegionStore.load(from: context) == .us)
    }

    @Test func firstLaunchHintShowsOnlyInIsraelWithoutChartUntilDismissed() {
        #expect(IsraelChartHint.shouldShow(region: .israel, chartInstalled: false, dismissed: false))
        #expect(!IsraelChartHint.shouldShow(region: .israel, chartInstalled: false, dismissed: true))
        #expect(!IsraelChartHint.shouldShow(region: .israel, chartInstalled: true, dismissed: false))
        #expect(!IsraelChartHint.shouldShow(region: .us, chartInstalled: false, dismissed: false))
    }

    @Test func regionRoundTripsThroughUserSettings() throws {
        let context = try makeContext()
        try RegionStore.save(.israel, to: context)
        #expect(RegionStore.load(from: context) == .israel)

        // Saving again updates the one record instead of adding another.
        try RegionStore.save(.us, to: context)
        #expect(RegionStore.load(from: context) == .us)
        let count = try context.fetchCount(FetchDescriptor<SchemaV1.UserSettings>())
        #expect(count == 1)
    }

    @Test func unknownStoredValueReadsAsTheDefaultRegion() throws {
        let context = try makeContext()
        let settings = SchemaV1.UserSettings()
        settings.regionRaw = "atlantis"
        context.insert(settings)
        try context.save()
        #expect(RegionStore.load(from: context) == Region.defaultRegion)
    }

    // MARK: - Configuration

    @Test func israelWeatherStationsMatchWhatAviationWeatherServes() {
        #expect(Region.israel.metarStationIDs == ["LLBG", "LLHA", "LLER", "LLIB"])
        #expect(Set(Region.israel.tafStationIDs) == ["LLBG", "LLHA", "LLER", "LLIB", "LLHZ"])
        #expect(Region.israel.weatherStation(id: "llhz")?.hasMETAR == false)
        #expect(Region.us.weatherStations.isEmpty)
    }

    @Test func altimeterUnitFollowsRegion() {
        #expect(Region.us.altimeterUnit == .inHg)
        #expect(Region.israel.altimeterUnit == .hPa)
        #expect(Region.israel.formattedAltimeter(hPa: 1017) == "1017 hPa")
        #expect(Region.us.formattedAltimeter(hPa: 1016.9) == "30.03 inHg")
    }

    @Test func usKeepsEveryLayerAndIsraelHasNoUSOnlyLayer() {
        for layer in RegionDataLayer.allCases where !RegionDataLayer.israelOnly.contains(layer) {
            #expect(Region.us.isAvailable(layer))
            #expect(!Region.israel.isAvailable(layer), "\(layer) has no Israel source")
        }
        // Weather, ownship and route are not region data.
        #expect(Region.israel.supports(.weatherDots))
        #expect(Region.israel.supports(.ownship))
        #expect(!Region.israel.supports(.sectional))
        #expect(!Region.israel.supports(.tfrs))
        #expect(!Region.israel.supports(.advisories))
        #expect(Region.israel.unavailableReason == "Not available in Israel yet")
        #expect(Region.israel.availableMapStyles == [.street])
    }

    @Test func israelHomeViewCoversTheCountryAndUSKeepsConus() {
        #expect(Region.us.defaultCenter.latitude == 39.0)
        #expect(Region.us.defaultCenter.longitude == -98.0)
        #expect(Region.us.defaultZoom == 5.0)
        #expect(abs(Region.israel.defaultCenter.latitude - 32.0) < 0.5)
        #expect(abs(Region.israel.defaultCenter.longitude - 34.9) < 0.5)
        #expect(Region.israel.contains(CLLocationCoordinate2D(latitude: 32.011, longitude: 34.887)))  // LLBG
        #expect(!Region.israel.contains(CLLocationCoordinate2D(latitude: 37.46, longitude: -122.11)))  // KPAO
        #expect(Region.us.contains(CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)))
    }

    // MARK: - AppState

    @Test func switchingToIsraelRecentersAndDropsUSOnlyLayers() {
        let appState = AppState()
        appState.visibleLayers = [.sectional, .airports, .ownship, .tfrs, .advisories, .navaids]

        appState.region = .israel

        #expect(appState.mapCenter.latitude == Region.israel.defaultCenter.latitude)
        #expect(appState.mapZoom == Region.israel.defaultZoom)
        #expect(appState.visibleLayers == Set([.ownship, .weatherDots] + MapLayer.cvfrChart))
        #expect(appState.mapStyle == .street)
    }

    @Test func switchingBackToUSRestoresHomeViewAndDefaultOverlays() {
        let appState = AppState()
        appState.region = .israel
        appState.region = .us
        #expect(appState.mapCenter.latitude == 39.0)
        #expect(appState.mapZoom == 5.0)
        #expect(appState.visibleLayers.isSuperset(of: [.sectional, .tfrs]))
    }

    // MARK: - Weather

    @Test func israelWeatherRequestUsesTheRegionStations() async throws {
        let log = RegionRequestLog()
        let service = WeatherService(session: StubURLProtocol.session { request in
            log.add(request.url)
            return (200, Self.llbgJSON)
        })

        let results = try await service.fetchWeatherForStations(Region.israel.metarStationIDs)

        let url = try #require(log.all.first)
        let ids = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "ids" }?.value
        #expect(ids == "LLBG,LLHA,LLER,LLIB")
        #expect(results.first?.stationID == "LLBG")
    }

    @Test func metarAltimeterIsKeptInHectopascals() throws {
        let wx = try #require(try WeatherService().parseMetarResponse(Self.llbgJSON).first)
        #expect(wx.altimeterHPa == 1017)
    }

    @Test func altimeterBelowOneHundredIsTreatedAsInchesOfMercury() throws {
        let json = #"[{"icaoId":"KPAO","altim":30.02}]"#
        let wx = try #require(try WeatherService().parseMetarResponse(Data(json.utf8)).first)
        let hPa = try #require(wx.altimeterHPa)
        #expect(abs(hPa - 1016.6) < 0.2)
    }

    @Test func weatherViewModelShowsHectopascalsInIsraelAndInHgInTheUS() async throws {
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, Self.llbgJSON) })
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel
        await vm.loadWeather(for: "LLBG")
        #expect(vm.decodedAltimeter == "1017 hPa")

        vm.region = .us
        #expect(vm.decodedAltimeter == "30.03 inHg")
    }

    @Test func missingAltimeterReadsAsDashes() {
        let vm = WeatherViewModel(weatherService: PlaceholderWeatherService())
        #expect(vm.decodedAltimeter == "---")
    }

    // MARK: - Layers and NRST

    @Test func israelCannotTurnOnUSOnlyLayers() {
        let appState = AppState()
        appState.region = .israel
        let vm = MapViewModel(
            appState: appState,
            mapService: MapService(),
            databaseService: PlaceholderDatabaseService()
        )
        vm.toggleLayer(.tfrs)
        vm.toggleLayer(.sectional)
        vm.toggleLayer(.advisories)
        #expect(!appState.visibleLayers.contains(.tfrs))
        #expect(!appState.visibleLayers.contains(.sectional))
        #expect(!appState.visibleLayers.contains(.advisories))
    }

    /// Switching region drops predictions made from the old region's airspace, even without a new fix.
    @Test func regionChangeClearsPredictions() {
        let appState = AppState()
        let vm = MapViewModel(
            appState: appState,
            mapService: MapService(),
            databaseService: PlaceholderDatabaseService()
        )
        appState.predictedEvents = [PredictedEvent(
            volumeID: "SFO-B", kind: .floor, severity: .caution, secondsAhead: 110,
            coordinate: CLLocationCoordinate2D(latitude: 37.5, longitude: -122.2), limitFeetMSL: 3000,
            title: "B floor 3,000", assumption: "at 312\u{00B0}, +300 fpm"
        )]
        appState.region = .israel
        vm.regionDidChange()
        #expect(appState.predictedEvents.isEmpty)
    }

    @Test func nrstAndSearchHaveAirportDataInBothRegions() {
        // Israel's data is the curated aerodrome table (IL-4), not the US airport layer.
        #expect(Region.israel.hasAirportData)
        #expect(Region.israel.isAvailable(.aerodromes))
        #expect(!Region.israel.isAvailable(.airports))   // no US map dots there
        #expect(Region.us.hasAirportData)
        #expect(!Region.us.isAvailable(.aerodromes))
    }
}
