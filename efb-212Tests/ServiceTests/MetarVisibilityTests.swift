//
//  MetarVisibilityTests.swift
//  efb-212Tests
//
//  Israel METARs show visibility in metres; the US keeps statute miles.
//

import Foundation
import Testing
@testable import efb_212

@MainActor
@Suite("METAR visibility")
struct MetarVisibilityTests {

    @Test func nineNineNineNineMeansTenKilometresOrMore() {
        let raw = "METAR LLBG 010920Z 29005KT 250V330 9999 FEW025 26/15 Q1017 NOSIG"
        #expect(MetarVisibility.metres(fromRaw: raw) == 9999)
        #expect(MetarVisibility.format(metres: 9999) == "≥10 km")
    }

    @Test func belowTenKilometresIsShownInMetres() {
        #expect(MetarVisibility.metres(fromRaw: "LLHA 011950Z VRB03KT 4000 HZ SCT020 24/20 Q1015") == 4000)
        #expect(MetarVisibility.format(metres: 4000) == "4000 m")
        #expect(MetarVisibility.metres(fromRaw: "LLER 011950Z 28010KT 0800 FG VV002 12/12 Q1015") == 800)
        #expect(MetarVisibility.format(metres: 800) == "800 m")
    }

    @Test func cavokReadsAsTenKilometresOrMore() {
        #expect(MetarVisibility.metres(fromRaw: "LLIB 011950Z 30008KT CAVOK 28/12 Q1014") == 9999)
    }

    @Test func usStatuteMileReportsHaveNoMetricVisibility() {
        #expect(MetarVisibility.metres(fromRaw: "KPAO 011953Z 31008KT 10SM FEW040 18/09 A3002") == nil)
        #expect(MetarVisibility.metres(fromRaw: "KSFO 011956Z 28012KT 1/2SM FG OVC002 12/11 A2998") == nil)
        #expect(MetarVisibility.metres(fromRaw: nil) == nil)
    }

    @Test func aTimeOrTemperatureGroupIsNeverReadAsVisibility() {
        // No visibility group at all: must not pick up "0920" from the time or anything after the wind.
        #expect(MetarVisibility.metres(fromRaw: "LLBG 010920Z 29005KT 26/15 Q1017") == nil)
    }

    @Test func israelShowsMetresAndTheUSKeepsStatuteMiles() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, RegionTests.llbgJSON) })
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel
        await vm.loadWeather(for: "LLBG")
        #expect(vm.decodedVisibility == "≥10 km")

        vm.region = .us
        #expect(vm.decodedVisibility == ">10 SM")
    }

    @Test func israelWeatherRowUsesKnotsCelsiusAndHectopascals() async {
        let service = WeatherService(session: StubURLProtocol.session { _ in (200, RegionTests.llbgJSON) })
        let vm = WeatherViewModel(weatherService: service)
        vm.region = .israel
        await vm.loadWeather(for: "LLBG")
        #expect(vm.decodedWind.contains("KT"))
        #expect(vm.decodedTemp == "26°C")
        #expect(vm.decodedAltimeter == "1017 hPa")
    }

    @Test func variableWindAndCavokReadFromTheLiveShapedReport() async {
        // AWC sends "wdir":"VRB" (a string) and no usable visibility for a CAVOK report.
        let json = Data("""
        [{"icaoId":"LLBG","obsTime":1793582400,"reportTime":"2026-11-02T01:20:00.000Z","temp":19,"dewp":15,
          "wdir":"VRB","wspd":2,"visib":"6+","altim":1016,
          "rawOb":"METAR LLBG 020120Z VRB02KT CAVOK 19/15 Q1016 NOSIG"}]
        """.utf8)
        let vm = WeatherViewModel(weatherService: WeatherService(session: StubURLProtocol.session { _ in (200, json) }))
        vm.region = .israel
        await vm.loadWeather(for: "LLBG")
        #expect(vm.decodedWind == "VRB/02 KT")
        #expect(vm.decodedVisibility == "≥10 km")
        #expect(vm.decodedAltimeter == "1016 hPa")
    }
}
