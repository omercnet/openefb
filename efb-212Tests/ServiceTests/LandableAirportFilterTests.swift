//
//  LandableAirportFilterTests.swift
//  efb-212Tests
//
//  Nearest-airport landability rules (design finding F1): heliports, seaplane bases,
//  short or soft runways are excluded; private fields are flagged.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Landable Airport Filter")
struct LandableAirportFilterTests {

    // MARK: - Fixtures

    static func runway(_ id: String, length: Int, surface: SurfaceType) -> Runway {
        Runway(
            id: id, length: length, width: 60,
            surface: surface, lighting: .none,
            baseEndID: String(id.prefix(2)), reciprocalEndID: String(id.suffix(2)),
            baseEndLatitude: 0, baseEndLongitude: 0,
            reciprocalEndLatitude: 0, reciprocalEndLongitude: 0
        )
    }

    static func airport(
        _ icao: String,
        type: AirportType = .airport,
        ownership: OwnershipType = .publicOwned,
        runways: [Runway]
    ) -> Airport {
        Airport(
            icao: icao, name: icao, latitude: 37.0, longitude: -122.0, elevation: 0,
            type: type, ownership: ownership, runways: runways
        )
    }

    static let kpao = airport("KPAO", runways: [runway("13/31", length: 2441, surface: .asphalt)])
    static let hospitalHeliport = airport("15CA", type: .heliport, runways: [runway("H1", length: 100, surface: .asphalt)])
    static let heliportNoRunway = airport("US-2776", type: .heliport, runways: [])
    static let seaplaneBase = airport("S00", type: .seaplane, runways: [runway("01W/19W", length: 5000, surface: .water)])
    static let shortStrip = airport("1CA1", runways: [runway("09/27", length: 1200, surface: .turf)])
    static let gravelOnly = airport("2CA2", runways: [runway("09/27", length: 3000, surface: .gravel)])
    static let turfStrip = airport("3CA3", runways: [runway("18/36", length: 2200, surface: .turf)])
    static let privateField = airport("4CA4", ownership: .privateOwned, runways: [runway("18/36", length: 2600, surface: .asphalt)])
    static let mixedSurfaces = airport("5CA5", runways: [
        runway("09/27", length: 4000, surface: .dirt),
        runway("18/36", length: 1800, surface: .concrete),
    ])
    static let exactMinimum = airport("6CA6", runways: [runway("18/36", length: 1500, surface: .asphalt)])

    // MARK: - Exclusions

    @Test func heliportIsNotLandableEvenWithHardPad() {
        #expect(LandableAirportFilter.isLandable(Self.hospitalHeliport) == false)
        #expect(LandableAirportFilter.isLandable(Self.heliportNoRunway) == false)
    }

    @Test func seaplaneBaseIsNotLandable() {
        #expect(LandableAirportFilter.isLandable(Self.seaplaneBase) == false)
    }

    @Test func shortRunwayIsNotLandable() {
        #expect(LandableAirportFilter.isLandable(Self.shortStrip) == false)
    }

    @Test func gravelOnlyIsNotLandable() {
        #expect(LandableAirportFilter.isLandable(Self.gravelOnly) == false)
    }

    @Test func airportWithoutRunwayDataIsNotLandable() {
        let noRunways = Self.airport("7CA7", runways: [])
        #expect(LandableAirportFilter.isLandable(noRunways) == false)
    }

    // MARK: - Inclusions

    @Test func pavedAirportIsLandable() {
        #expect(LandableAirportFilter.isLandable(Self.kpao))
    }

    @Test func turfStripAboveMinimumIsLandable() {
        #expect(LandableAirportFilter.isLandable(Self.turfStrip))
    }

    @Test func runwayExactlyAtMinimumIsLandable() {
        #expect(LandableAirportFilter.isLandable(Self.exactMinimum))
        #expect(LandableAirportFilter.defaultMinimumRunwayLengthFeet == 1500)
    }

    @Test func onlyLandableSurfaceRunwaysCountTowardMinimum() {
        // 4000 ft of dirt does not help; the 1800 ft concrete runway qualifies.
        #expect(LandableAirportFilter.isLandable(Self.mixedSurfaces))
        #expect(LandableAirportFilter.isLandable(Self.mixedSurfaces, minimumRunwayLengthFeet: 2000) == false)
    }

    @Test func minimumRunwayLengthIsConfigurable() {
        #expect(LandableAirportFilter.isLandable(Self.kpao, minimumRunwayLengthFeet: 2500) == false)
        #expect(LandableAirportFilter.isLandable(Self.kpao, minimumRunwayLengthFeet: 2400))
    }

    // MARK: - List filtering and ordering

    @Test func filterKeepsOrderAndDropsHeliportsSeaplanesAndShortStrips() {
        let input = [Self.hospitalHeliport, Self.kpao, Self.heliportNoRunway, Self.seaplaneBase,
                     Self.shortStrip, Self.turfStrip, Self.gravelOnly, Self.privateField]
        let result = LandableAirportFilter.landable(input).map(\.icao)
        #expect(result == ["KPAO", "3CA3", "4CA4"])
    }

    // MARK: - Private flag and runway summary

    @Test func privateUseIsFlaggedButStillLandable() {
        #expect(LandableAirportFilter.isPrivateUse(Self.privateField))
        #expect(LandableAirportFilter.isPrivateUse(Self.kpao) == false)
        #expect(LandableAirportFilter.isLandable(Self.privateField))
    }

    @Test func longestRunwayPrefersLandableSurface() {
        let longest = LandableAirportFilter.longestRunway(Self.mixedSurfaces)
        #expect(longest?.id == "18/36")   // 1800 ft concrete beats 4000 ft dirt
        #expect(longest?.surface == .concrete)
    }

    @Test func longestRunwayFallsBackToAnySurfaceAndNilWhenNone() {
        #expect(LandableAirportFilter.longestRunway(Self.gravelOnly)?.surface == .gravel)
        #expect(LandableAirportFilter.longestRunway(Self.heliportNoRunway) == nil)
    }

    @Test func surfaceAbbreviationsAreStandard() {
        #expect(SurfaceType.asphalt.abbreviation == "ASPH")
        #expect(SurfaceType.concrete.abbreviation == "CONC")
        #expect(SurfaceType.turf.abbreviation == "TURF")
        #expect(SurfaceType.gravel.abbreviation == "GRVL")
    }
}
