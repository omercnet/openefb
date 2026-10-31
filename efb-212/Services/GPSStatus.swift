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
