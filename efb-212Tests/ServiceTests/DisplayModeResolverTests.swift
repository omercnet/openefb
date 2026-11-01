//
//  DisplayModeResolverTests.swift
//  efb-212Tests
//
//  Auto day/night decision: explicit modes win, auto follows the sun at ownship, and falls back
//  to the system appearance without a fix.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Display Mode Resolver Tests")
struct DisplayModeResolverTests {

    static let kpao = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

    /// UTC instant from components.
    static func utc(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int = 0) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi)) ?? .distantPast
    }

    @Test func explicitModesIgnoreSunAndSystem() {
        let noon = Self.utc(2026, 6, 21, 20)  // 13:00 PDT at KPAO
        #expect(DisplayModeResolver.isNight(mode: .night, systemIsDark: false, coordinate: Self.kpao, date: noon))
        #expect(!DisplayModeResolver.isNight(mode: .day, systemIsDark: true, coordinate: Self.kpao, date: noon))
    }

    @Test func autoWithoutFixFollowsSystem() {
        let now = Self.utc(2026, 6, 21, 20)
        #expect(DisplayModeResolver.isNight(mode: .auto, systemIsDark: true, coordinate: nil, date: now))
        #expect(!DisplayModeResolver.isNight(mode: .auto, systemIsDark: false, coordinate: nil, date: now))
    }

    @Test func autoIsDayAtLocalNoon() {
        // System dark must not matter once a position is known
        let noon = Self.utc(2026, 6, 21, 20)
        #expect(!DisplayModeResolver.isNight(mode: .auto, systemIsDark: true, coordinate: Self.kpao, date: noon))
    }

    @Test func autoIsNightAtLocalMidnight() {
        let midnight = Self.utc(2026, 6, 21, 9)  // 02:00 PDT
        #expect(DisplayModeResolver.isNight(mode: .auto, systemIsDark: false, coordinate: Self.kpao, date: midnight))
    }

    @Test func solarElevationMatchesKnownValues() {
        // Summer solstice solar noon at KPAO: elevation ~ 90 - 37.46 + 23.44 = 75.98 deg (solar noon ~20:10 UTC)
        let noon = SolarPosition.elevationDegrees(at: Self.kpao, date: Self.utc(2026, 6, 21, 20, 10))
        #expect(abs(noon - 76.0) < 1.0)
        // Winter solstice solar noon: 90 - 37.46 - 23.44 = 29.1 deg (solar noon ~20:10 UTC)
        let winter = SolarPosition.elevationDegrees(at: Self.kpao, date: Self.utc(2026, 12, 21, 20, 10))
        #expect(abs(winter - 29.1) < 1.0)
    }

    @Test func civilTwilightBoundaryIsSix() {
        // Late evening at KPAO in June: sun is above -6 shortly after sunset, below it later.
        // Sunset ~03:25 UTC (20:25 PDT); civil twilight ends ~04:00 UTC.
        #expect(!DisplayModeResolver.isNight(mode: .auto, systemIsDark: false, coordinate: Self.kpao, date: Self.utc(2026, 6, 22, 3, 40)))
        #expect(DisplayModeResolver.isNight(mode: .auto, systemIsDark: false, coordinate: Self.kpao, date: Self.utc(2026, 6, 22, 4, 30)))
    }

    @Test func polarWinterIsNightAtNoonAndPolarSummerIsDayAtMidnight() {
        let arcticWinterNoon = CLLocationCoordinate2D(latitude: 80, longitude: 0)
        #expect(DisplayModeResolver.isNight(mode: .auto, systemIsDark: false, coordinate: arcticWinterNoon, date: Self.utc(2026, 12, 21, 12)))
        #expect(!DisplayModeResolver.isNight(mode: .auto, systemIsDark: true, coordinate: arcticWinterNoon, date: Self.utc(2026, 6, 21, 0)))
    }

    @Test func invalidCoordinateFallsBackToSystem() {
        let bad = CLLocationCoordinate2D(latitude: 999, longitude: 999)
        #expect(DisplayModeResolver.isNight(mode: .auto, systemIsDark: true, coordinate: bad, date: Self.utc(2026, 6, 21, 20)))
    }
}
