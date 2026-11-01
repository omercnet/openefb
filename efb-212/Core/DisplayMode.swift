//
//  DisplayMode.swift
//  efb-212
//
//  Day / night / auto display mode for the cockpit (design finding F16). `auto` is offline-safe:
//  with a GPS position it follows the sun (night once the sun is more than 6 degrees below the
//  horizon, i.e. past civil twilight); without one it follows the system appearance.
//  Pure math, `nonisolated` so it is testable off the main actor.
//

import Foundation
import CoreLocation
import SwiftUI

/// User-selected display mode. Persisted in UserDefaults under `DisplayMode.defaultsKey`.
nonisolated enum DisplayMode: String, CaseIterable, Codable, Sendable {
    case day
    case night
    case auto

    static let defaultsKey = "displayMode"

    var title: String {
        switch self {
        case .day: return "Day"
        case .night: return "Night"
        case .auto: return "Auto"
        }
    }
}

/// Decides whether the night palette is active for a display mode.
nonisolated enum DisplayModeResolver {

    /// Sun elevation below which `auto` switches to night. -6 degrees is the end of civil twilight,
    /// the point where a lit chart starts to wash out the pilot's night vision.
    static let nightSunElevationDegrees: Double = -6

    /// - Parameters:
    ///   - mode: the user's selection.
    ///   - systemIsDark: current system appearance, used when no position is known.
    ///   - coordinate: current ownship position (nil before the first fix).
    ///   - date: evaluation time (UTC instant).
    static func isNight(
        mode: DisplayMode,
        systemIsDark: Bool,
        coordinate: CLLocationCoordinate2D?,
        date: Date
    ) -> Bool {
        switch mode {
        case .day: return false
        case .night: return true
        case .auto:
            guard let coordinate, CLLocationCoordinate2DIsValid(coordinate) else { return systemIsDark }
            return SolarPosition.elevationDegrees(at: coordinate, date: date) < nightSunElevationDegrees
        }
    }
}

/// Low-precision solar elevation (NOAA simplified algorithm, about 0.5 degree accuracy, no network).
nonisolated enum SolarPosition {

    /// Sun elevation above the horizon in degrees (negative = below the horizon), ignoring refraction.
    static func elevationDegrees(at coordinate: CLLocationCoordinate2D, date: Date) -> Double {
        let julianDay = date.timeIntervalSince1970 / 86_400 + 2_440_587.5
        let t = (julianDay - 2_451_545.0) / 36_525  // Julian centuries since J2000.0

        let meanLongitude = normalizeDegrees(280.46646 + t * (36_000.76983 + t * 0.0003032))
        let meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
        let m = radians(meanAnomaly)
        let equationOfCenter = sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
            + sin(2 * m) * (0.019993 - 0.000101 * t)
            + sin(3 * m) * 0.000289
        let trueLongitude = meanLongitude + equationOfCenter
        let omega = radians(125.04 - 1_934.136 * t)
        let apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sin(omega)

        let meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
        let obliquity = meanObliquity + 0.00256 * cos(omega)

        let declination = asin(sin(radians(obliquity)) * sin(radians(apparentLongitude)))

        // Equation of time in minutes
        let y = pow(tan(radians(obliquity) / 2), 2)
        let l0 = radians(meanLongitude)
        let eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
        let equationOfTime = 4 * degrees(
            y * sin(2 * l0)
            - 2 * eccentricity * sin(m)
            + 4 * eccentricity * y * sin(m) * cos(2 * l0)
            - 0.5 * y * y * sin(4 * l0)
            - 1.25 * eccentricity * eccentricity * sin(2 * m)
        )

        // Minutes past UTC midnight -> true solar time at this longitude
        let utcMinutes = (date.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400) + 86_400)
            .truncatingRemainder(dividingBy: 86_400) / 60
        let trueSolarMinutes = (utcMinutes + equationOfTime + 4 * coordinate.longitude + 1_440)
            .truncatingRemainder(dividingBy: 1_440)
        var hourAngle = trueSolarMinutes / 4 - 180
        if hourAngle < -180 { hourAngle += 360 }

        let latitude = radians(coordinate.latitude)
        let cosZenith = sin(latitude) * sin(declination)
            + cos(latitude) * cos(declination) * cos(radians(hourAngle))
        return 90 - degrees(acos(max(-1, min(1, cosZenith))))
    }

    private static func normalizeDegrees(_ value: Double) -> Double {
        let r = value.truncatingRemainder(dividingBy: 360)
        return r < 0 ? r + 360 : r
    }

    private static func radians(_ degrees: Double) -> Double { degrees * .pi / 180 }
    private static func degrees(_ radians: Double) -> Double { radians * 180 / .pi }
}

/// Cockpit night palette: low-luminance foregrounds instead of white. Used by the map chrome.
enum NightPalette {
    /// Primary text at night (about 75% luminance; no bright whites).
    static let text = Color(white: 0.78)
    /// Secondary labels at night.
    static let secondaryText = Color(white: 0.55)
    /// Map dim overlay opacity (black over base + sectional).
    static let mapDimOpacity: Double = 0.45
    /// Raster brightness ceiling for base/sectional tiles at night (0-1).
    static let rasterBrightnessMax: Double = 0.55
    /// Raster saturation shift at night (-1...1).
    static let rasterSaturation: Double = -0.35
    /// Airport dot at night: muted teal (about 45% of systemCyan luminance) with the dark ring kept.
    static let airportDot = UIColor(red: 0.22, green: 0.55, blue: 0.62, alpha: 1)
    /// Navaid dot at night: muted violet.
    static let navaidDot = UIColor(red: 0.45, green: 0.32, blue: 0.62, alpha: 1)
}
