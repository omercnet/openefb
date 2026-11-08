//
//  AirspacePredictor.swift
//  efb-212
//
//  Direction 2, stage 2 (docs/DESIGN.md): projects the current track, ground speed and smoothed
//  vertical speed ten minutes ahead in fixed steps and reports the first entry into each volume.
//  Straight line, constant rates: the assumption is printed with every event.
//

import Foundation
import CoreLocation

nonisolated enum AirspacePredictor {
    static let horizonSeconds: TimeInterval = 600      // 10 minutes
    static let stepSeconds: TimeInterval = 5
    static let minimumGroundSpeedKnots = 30.0

    /// Soonest first, at most one event per volume (its first entry). Empty when input.isStale,
    /// altitude is nil, or ground speed is below the minimum.
    static func events(input: PredictionInput, volumes: [PredictableVolume]) -> [PredictedEvent] {
        guard !input.isStale, let altitude = input.altitudeFeetMSL,
              input.groundSpeedKnots >= minimumGroundSpeedKnots, !volumes.isEmpty else { return [] }

        let assumption = assumptionText(trackTrue: input.trackTrue, verticalSpeedFPM: input.verticalSpeedFPM)
        let steps = Int(horizonSeconds / stepSeconds)
        // Sample k: seconds ahead, position (NM = knots * s / 3600), altitude (feet = fpm * s / 60).
        let samples = (0...steps).map { k -> (seconds: TimeInterval, position: CLLocationCoordinate2D, altitude: Double) in
            let seconds = Double(k) * stepSeconds
            let position = input.position.destination(
                distanceNM: input.groundSpeedKnots * seconds / 3600,
                bearingDegrees: input.trackTrue
            )
            return (seconds, position, altitude + input.verticalSpeedFPM * seconds / 60)
        }

        var events: [PredictedEvent] = []
        for volume in volumes {
            let floor = Double(volume.floorFeetMSL ?? 0)                        // feet MSL
            let ceiling = volume.ceilingFeetMSL.map(Double.init) ?? .infinity   // feet MSL
            var wasLateral = containsLaterally(volume.shape, samples[0].position)
            var previousAltitude = samples[0].altitude
            if wasLateral && floor <= previousAltitude && previousAltitude <= ceiling { continue }  // already inside

            for sample in samples.dropFirst() {
                let lateral = containsLaterally(volume.shape, sample.position)
                defer { wasLateral = lateral; previousAltitude = sample.altitude }
                guard lateral, floor <= sample.altitude, sample.altitude <= ceiling else { continue }

                let kind: PredictedEvent.Kind
                if wasLateral && previousAltitude < floor {
                    kind = .floor
                } else if wasLateral && previousAltitude > ceiling {
                    kind = .ceiling
                } else {
                    kind = .lateral
                }
                events.append(PredictedEvent(
                    volumeID: volume.id,
                    kind: kind,
                    severity: volume.severity,
                    secondsAhead: sample.seconds,
                    coordinate: sample.position,
                    limitFeetMSL: kind == .ceiling ? volume.ceilingFeetMSL : volume.floorFeetMSL,
                    title: title(volume, kind: kind),
                    assumption: assumption
                ))
                break
            }
        }
        return events.sorted { $0.secondsAhead < $1.secondsAhead }
    }

    /// "at 312\u{00B0}, +300 fpm" / "at 312\u{00B0}, level" (|VS| < 100 fpm)
    static func assumptionText(trackTrue: Double, verticalSpeedFPM: Double) -> String {
        let track = (trackTrue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)  // degrees true
        let trackText = String(format: "at %03.0f\u{00B0}", track)
        guard abs(verticalSpeedFPM) >= 100 else { return "\(trackText), level" }
        let rate = Int((verticalSpeedFPM / 10).rounded()) * 10  // feet per minute, nearest 10
        return "\(trackText), \(String(format: "%+ld", rate)) fpm"
    }

    private static func containsLaterally(_ shape: PredictableVolume.Shape, _ point: CLLocationCoordinate2D) -> Bool {
        switch shape {
        case .polygon(let rings):
            guard let outer = rings.first, PolygonGeometry.contains(point, ring: outer) else { return false }
            return !rings.dropFirst().contains { PolygonGeometry.contains(point, ring: $0) }
        case .circle(let center, let radiusNM):
            guard center.count >= 2 else { return false }
            return point.distanceInNM(to: CLLocationCoordinate2D(latitude: center[0], longitude: center[1])) <= radiusNM
        }
    }

    private static func title(_ volume: PredictableVolume, kind: PredictedEvent.Kind) -> String {
        switch kind {
        case .ceiling:
            if let ceiling = volume.ceilingFeetMSL { return "\(volume.shortName) ceiling \(feet(ceiling))" }
        case .floor, .lateral:
            if let floor = volume.floorFeetMSL, floor > 0 { return "\(volume.shortName) floor \(feet(floor))" }
        }
        return volume.shortName
    }

    /// Feet MSL with a thousands separator, independent of the device locale: "3,000".
    private static func feet(_ value: Int) -> String {
        value.formatted(.number.locale(Locale(identifier: "en_US")).grouping(.automatic))
    }
}

/// Debounces predictions across fixes so a jumpy number never shows: an event is published only once
/// it appeared in 2 of the last 3 evaluations; its time is the latest one.
nonisolated struct PredictionStabilizer: Sendable {
    private var history: [Set<String>] = []  // event ids of the last 3 evaluations, oldest first

    mutating func update(_ events: [PredictedEvent]) -> [PredictedEvent] {
        history.append(Set(events.map(\.id)))
        if history.count > 3 { history.removeFirst(history.count - 3) }
        return events.filter { event in history.filter { $0.contains(event.id) }.count >= 2 }
    }

    mutating func reset() {
        history.removeAll()
    }
}
