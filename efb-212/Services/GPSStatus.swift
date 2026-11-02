//
//  GPSStatus.swift
//  efb-212
//
//  Position-quality state for the GPS status chip and stale-ownship greying
//  (design finding F5). Pure, nonisolated logic evaluated against a clock so the
//  age of the last fix can be tested without CoreLocation.
//

import Foundation
import CoreLocation

/// The parts of a CoreLocation fix that matter for position quality.
nonisolated struct GPSFix: Equatable, Sendable {
    let timestamp: Date
    let horizontalAccuracyMeters: Double   // meters; negative = invalid
    let verticalAccuracyMeters: Double     // meters; negative = no altitude
    /// CoreLocation reported the device stationary and paused updates. The fix stays
    /// valid until motion resumes, so age does not count against it.
    let isStationary: Bool

    nonisolated init(
        timestamp: Date,
        horizontalAccuracyMeters: Double,
        verticalAccuracyMeters: Double,
        isStationary: Bool = false
    ) {
        self.timestamp = timestamp
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.verticalAccuracyMeters = verticalAccuracyMeters
        self.isStationary = isStationary
    }

    nonisolated init(location: CLLocation, isStationary: Bool = false) {
        self.init(
            timestamp: location.timestamp,
            horizontalAccuracyMeters: location.horizontalAccuracy,
            verticalAccuracyMeters: location.verticalAccuracy,
            isStationary: isStationary
        )
    }
}

nonisolated enum GPSDegradedReason: Equatable, Sendable {
    case noAltitude
    case poorHorizontalAccuracy(meters: Double)
}

nonisolated enum GPSStatus: Equatable, Sendable {
    /// Fresh fix with altitude and acceptable horizontal accuracy.
    case ok
    /// Fresh fix, but missing altitude or horizontal accuracy worse than the limit.
    case degraded(GPSDegradedReason)
    /// No fix, or the last fix is older than `staleAfterSeconds`. `ageSeconds` is nil when
    /// no fix was ever received.
    case lost(ageSeconds: Int?)

    /// A fix older than this is treated as lost and the ownship/instruments grey out.
    static let staleAfterSeconds: TimeInterval = 5      // seconds
    /// Horizontal accuracy worse than this is degraded (Wi-Fi-only iPads sit around 65 m).
    static let maxHorizontalAccuracyMeters: Double = 50  // meters

    /// Evaluate position quality at `now`.
    /// - `gpsAvailable == false` means the location stream itself failed (denied, errored).
    static func evaluate(fix: GPSFix?, gpsAvailable: Bool, now: Date) -> GPSStatus {
        guard gpsAvailable, let fix else { return .lost(ageSeconds: nil) }

        let age = now.timeIntervalSince(fix.timestamp)
        if age > staleAfterSeconds && !fix.isStationary {
            return .lost(ageSeconds: Int(age.rounded(.down)))
        }
        if fix.verticalAccuracyMeters < 0 {
            return .degraded(.noAltitude)
        }
        if fix.horizontalAccuracyMeters < 0 || fix.horizontalAccuracyMeters > maxHorizontalAccuracyMeters {
            return .degraded(.poorHorizontalAccuracy(meters: fix.horizontalAccuracyMeters))
        }
        return .ok
    }

    /// True when the ownship chevron and instrument values must be greyed out.
    var isStale: Bool {
        if case .lost = self { return true }
        return false
    }

    /// Chip text. Standard abbreviations; the age is shown so the pilot knows how old the
    /// last position is.
    var label: String {
        switch self {
        case .ok: return "GPS OK"
        case .degraded: return "GPS DEGR"
        case .lost(let age):
            guard let age else { return "GPS LOST" }
            return "GPS LOST \(age)s"
        }
    }

    /// Spoken description for accessibility.
    var accessibilityDescription: String {
        switch self {
        case .ok: return "GPS OK"
        case .degraded(.noAltitude): return "GPS degraded, no altitude"
        case .degraded(.poorHorizontalAccuracy(let m)): return "GPS degraded, accuracy \(Int(m)) meters"
        case .lost(let age):
            guard let age else { return "GPS lost, no fix" }
            return "GPS lost, last fix \(age) seconds ago"
        }
    }
}

// MARK: - GPSFailureReason

/// Why CoreLocation is not delivering a usable position. "GPS LOST" alone tells the pilot
/// nothing; this names the cause and, when the pilot can fix it, points at Settings.
nonisolated enum GPSFailureReason: Equatable, Sendable {
    /// Location access denied for this app, or Location Services off device-wide.
    case authorizationDenied
    /// Location access blocked by restrictions (parental controls, MDM). Settings cannot fix it.
    case authorizationRestricted
    /// Access granted but no position source: Wi-Fi-only iPad with no network, airplane mode.
    case locationUnavailable
    /// Stream is running but no fix arrived within `noFixGraceSeconds` of starting.
    case noFixYet
    /// The location stream itself ended with an error.
    case streamFailed

    /// How long after tracking starts, with no fix, before `noFixYet` is shown. Cold GPS
    /// starts take a few seconds; a Wi-Fi-only iPad never gets there.
    static let noFixGraceSeconds: TimeInterval = 15   // seconds

    /// Map the flags of a location update that carried no position. nil when none of the
    /// flags explain the missing position (e.g. a stationary notice).
    static func from(
        authorizationDenied: Bool,
        authorizationRestricted: Bool,
        locationUnavailable: Bool
    ) -> GPSFailureReason? {
        if authorizationDenied { return .authorizationDenied }
        if authorizationRestricted { return .authorizationRestricted }
        if locationUnavailable { return .locationUnavailable }
        return nil
    }

    var title: String {
        switch self {
        case .authorizationDenied: return "Location access is off"
        case .authorizationRestricted: return "Location access is restricted"
        case .locationUnavailable: return "No position source"
        case .noFixYet: return "Waiting for a GPS fix"
        case .streamFailed: return "GPS stopped"
        }
    }

    var message: String {
        switch self {
        case .authorizationDenied:
            return "The moving map, NRST and recording need your position. Allow Location for Kanaf in Settings \u{203A} Privacy & Security \u{203A} Location Services."
        case .authorizationRestricted:
            return "Location is blocked by a restriction on this iPad (Screen Time or device management)."
        case .locationUnavailable:
            return "No GPS receiver is answering. Wi-Fi-only iPads have no GPS: connect an external GPS, or check Airplane Mode."
        case .noFixYet:
            return "No position yet. Outdoors a fix takes under a minute; a Wi-Fi-only iPad has no GPS and needs an external receiver."
        case .streamFailed:
            return "Position updates ended unexpectedly. Relaunch Kanaf; if it repeats, check Location in Settings."
        }
    }

    /// Only a denial can be fixed in Settings. Restricted and hardware causes cannot.
    var offersSettings: Bool {
        self == .authorizationDenied
    }
}
