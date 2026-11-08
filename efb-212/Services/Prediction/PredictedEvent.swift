//
//  PredictedEvent.swift
//  efb-212
//
//  Direction 2, stage 2 (docs/DESIGN.md): what the airplane is about to meet if nothing changes.
//  The engine (AirspacePredictor) projects the current track, ground speed and smoothed vertical
//  speed ten minutes ahead and reports when the airplane would enter an airspace volume. The
//  strip, the altitude tape and the map's track ruler read the same events from
//  `AppState.predictedEvents`, so a row, the tape floor and a diamond are one fact.
//

import Foundation
import CoreLocation

/// The flight state a prediction is made from. Built once per fix by `PredictionService`.
nonisolated struct PredictionInput: Equatable, Sendable {
    var position: CLLocationCoordinate2D
    var altitudeFeetMSL: Double?         // feet MSL; nil without a vertical fix (no prediction is made)
    var trackTrue: Double                // degrees true
    var groundSpeedKnots: Double         // knots
    var verticalSpeedFPM: Double         // feet per minute, smoothed (VerticalSpeedEstimator), + climbing
    var isStale: Bool                    // GPS fix lost: nothing is predicted

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.position.latitude == rhs.position.latitude && lhs.position.longitude == rhs.position.longitude
            && lhs.altitudeFeetMSL == rhs.altitudeFeetMSL && lhs.trackTrue == rhs.trackTrue
            && lhs.groundSpeedKnots == rhs.groundSpeedKnots && lhs.verticalSpeedFPM == rhs.verticalSpeedFPM
            && lhs.isStale == rhs.isStale
    }
}

/// One airspace volume the engine can predict an entry into, from the US NASR or Israel CAAI data.
nonisolated struct PredictableVolume: Identifiable, Equatable, Sendable {
    nonisolated enum Shape: Equatable, Sendable {
        /// Outer ring first, then holes; vertices as [latitude, longitude].
        case polygon(rings: [[[Double]]])
        case circle(center: [Double], radiusNM: Double)  // [latitude, longitude], nautical miles
    }

    let id: String
    /// Short name for a row, e.g. "B", "C", "D", "CTR LLHA", "P 4", "TFR".
    let shortName: String
    let shape: Shape
    /// Feet MSL; 0 = surface. nil when the limit cannot be read as MSL (AGL, FL): treated as surface.
    let floorFeetMSL: Int?
    /// Feet MSL; nil = unlimited or not MSL: treated as unlimited.
    let ceilingFeetMSL: Int?
    /// Entering it is a warning (prohibited, restricted, TFR) or a caution (controlled airspace).
    let severity: PredictedEvent.Severity
}

/// A predicted entry into an airspace volume, `secondsAhead` from the fix it was computed at.
nonisolated struct PredictedEvent: Identifiable, Equatable, Sendable {
    nonisolated enum Kind: String, Equatable, Sendable {
        case lateral   // crossing the volume's side boundary at an altitude inside its limits
        case floor     // climbing through its floor while under it laterally
        case ceiling   // descending through its ceiling while over it laterally
    }

    nonisolated enum Severity: Int, Comparable, Sendable {
        case caution = 1   // amber
        case warning = 2   // red
        static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    /// Stable across fixes for the same volume and kind, so rows do not flicker: "<volume id>/<kind>".
    var id: String { "\(volumeID)/\(kind.rawValue)" }
    let volumeID: String
    let kind: Kind
    let severity: Severity
    /// Seconds from the fix until the entry, 0...AirspacePredictor.horizonSeconds.
    let secondsAhead: TimeInterval
    /// Where along the projected track the entry happens (for the diamond on the ruler).
    let coordinate: CLLocationCoordinate2D
    /// The limit being met, feet MSL: the floor for .floor and .lateral, the ceiling for .ceiling.
    let limitFeetMSL: Int?
    /// Row text, e.g. "B floor 3,000", "CTR LLHA", "P 4".
    let title: String
    /// What the prediction assumes, printed under it: "at 312\u{00B0}, +300 fpm".
    let assumption: String

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.volumeID == rhs.volumeID && lhs.kind == rhs.kind && lhs.severity == rhs.severity
            && lhs.secondsAhead == rhs.secondsAhead && lhs.limitFeetMSL == rhs.limitFeetMSL
            && lhs.title == rhs.title && lhs.assumption == rhs.assumption
            && lhs.coordinate.latitude == rhs.coordinate.latitude
            && lhs.coordinate.longitude == rhs.coordinate.longitude
    }
}
