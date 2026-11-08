//
//  PredictionService.swift
//  efb-212
//
//  Direction 2, stage 2 (docs/DESIGN.md): runs AirspacePredictor on every GPS fix and writes
//  `AppState.predictedEvents`. Smooths vertical speed from the fixes (VerticalSpeedEstimator),
//  debounces the events (PredictionStabilizer) and reads the airspace volumes near ownship from
//  the region's database: US NASR airspace, or the Israel CAAI airspace. The database query is
//  throttled (10 s or 2 NM moved); the projection itself runs on every fix.
//

import Foundation
import CoreLocation

@MainActor
final class PredictionService {

    /// Re-query the database at most this often, seconds.
    static let queryIntervalSeconds: TimeInterval = 10
    /// ...or once ownship has moved this far from the last query, nautical miles.
    static let queryDistanceNM = 2.0

    private let israelDatabaseProvider: () throws -> any IsraelAviationDatabaseProtocol
    private var israelDatabase: (any IsraelAviationDatabaseProtocol)?

    private var verticalSpeed = VerticalSpeedEstimator()
    private var stabilizer = PredictionStabilizer()

    /// Volumes from the last query and where, when, how far (NM) and for which region it was made.
    private var cachedVolumes: [PredictableVolume] = []
    private var lastQuery: (coordinate: CLLocationCoordinate2D, time: Date, radiusNM: Double, region: Region)?

    init(israelDatabaseProvider: @escaping () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() }) {
        self.israelDatabaseProvider = israelDatabaseProvider
    }

    /// Predict from one fix. Predictions off or a stale fix clear the events: a prediction from a
    /// frozen position would read as current.
    func update(location: CLLocation, appState: AppState, isStale: Bool, enabled: Bool) {
        guard enabled, !isStale else {
            clear(appState: appState)
            return
        }
        let altitudeFeet = location.altitude * 3.28084  // meters to feet MSL
        let verticalSpeedFPM = verticalSpeed.update(
            altitudeFeet: altitudeFeet, timestamp: location.timestamp, verticalAccuracyMeters: location.verticalAccuracy
        )
        // No GPS course (course < 0): the track is unknown, so nothing can be projected along it.
        guard location.course >= 0 else {
            clear(appState: appState)
            return
        }
        let input = PredictionInput(
            position: location.coordinate,
            altitudeFeetMSL: location.verticalAccuracy >= 0 ? altitudeFeet : nil,
            trackTrue: appState.track,
            groundSpeedKnots: appState.groundSpeed,
            verticalSpeedFPM: verticalSpeedFPM,
            isStale: false
        )
        // Distance covered in the 10-minute horizon (NM = knots * 10 / 60) plus a 5 NM margin.
        let radiusNM = appState.groundSpeed * 10 / 60 + 5
        let nearby = volumes(near: location, radiusNM: radiusNM, appState: appState)
        let events = stabilizer.update(AirspacePredictor.events(input: input, volumes: nearby))
        if appState.predictedEvents != events { appState.predictedEvents = events }
    }

    /// Drop every event and the debounce history (predictions off, stale fix, unknown track).
    func clear(appState: AppState) {
        stabilizer.reset()
        if !appState.predictedEvents.isEmpty { appState.predictedEvents = [] }
    }

    // MARK: - Volumes

    private func volumes(near location: CLLocation, radiusNM: Double, appState: AppState) -> [PredictableVolume] {
        let region = appState.region
        if let last = lastQuery, last.region == region, radiusNM <= last.radiusNM,
           location.timestamp.timeIntervalSince(last.time) < Self.queryIntervalSeconds,
           location.coordinate.distanceInNM(to: last.coordinate) < Self.queryDistanceNM {
            return cachedVolumes
        }
        let coordinate = location.coordinate
        switch region {
        case .us:
            let airspaces = (try? appState.getOrCreateDatabaseService().airspaces(near: coordinate, radiusNM: radiusNM)) ?? []
            cachedVolumes = airspaces.compactMap(Self.volume(from:))
        case .israel:
            if israelDatabase == nil { israelDatabase = try? israelDatabaseProvider() }
            let airspaces = (try? israelDatabase?.airspaces(near: coordinate, radiusNM: radiusNM)) ?? []
            cachedVolumes = airspaces.flatMap(Self.volumes(from:))
        }
        lastQuery = (coordinate, location.timestamp, radiusNM, region)
        return cachedVolumes
    }

    /// A US NASR airspace as a predictable volume; nil for class E and G (no entry to predict).
    nonisolated static func volume(from airspace: Airspace) -> PredictableVolume? {
        let shortName: String
        switch airspace.classification {
        case .bravo: shortName = "B"
        case .charlie: shortName = "C"
        case .delta: shortName = "D"
        case .restricted: shortName = "R"
        case .prohibited: shortName = "P"
        case .moa: shortName = "MOA"
        case .alert: shortName = "A"
        case .warning: shortName = "W"
        case .tfr: shortName = "TFR"
        case .echo, .golf: return nil
        }
        let severity: PredictedEvent.Severity
        switch airspace.classification {
        case .prohibited, .restricted, .tfr: severity = .warning
        default: severity = .caution
        }
        let shape: PredictableVolume.Shape
        switch airspace.geometry {
        case .polygon(let coordinates): shape = .polygon(rings: [coordinates])
        case .circle(let center, let radiusNM): shape = .circle(center: center, radiusNM: radiusNM)
        }
        return PredictableVolume(
            id: "us-\(airspace.id.uuidString)",
            shortName: shortName,
            shape: shape,
            floorFeetMSL: airspace.floor,                                // feet MSL, 0 = surface
            ceilingFeetMSL: airspace.ceiling >= 99999 ? nil : airspace.ceiling,  // 99999 = unlimited
            severity: severity
        )
    }

    /// An Israel CAAI airspace as predictable volumes, one per polygon; none for the FIR.
    nonisolated static func volumes(from airspace: IsraelAirspace) -> [PredictableVolume] {
        guard airspace.kind != .fir else { return [] }
        let shortName = israelShortName(kind: airspace.kind, code: airspace.code)
        // Only an MSL value can be compared with a GPS altitude; AGL and FL floors read as surface,
        // non-MSL ceilings as unlimited (the volume is never reported smaller than the data allows).
        let floor: Int?
        switch airspace.floor.reference {
        case .surface: floor = 0
        case .msl: floor = airspace.floor.feet
        default: floor = nil
        }
        let ceiling = airspace.ceiling.reference == .msl ? airspace.ceiling.feet : nil
        let severity: PredictedEvent.Severity = airspace.kind == .prohibited || airspace.kind == .restricted ? .warning : .caution
        return airspace.polygons.enumerated().map { index, rings in
            PredictableVolume(
                id: airspace.polygons.count == 1 ? "il-\(airspace.id)" : "il-\(airspace.id)-\(index)",
                shortName: shortName,
                shape: .polygon(rings: rings.map { ring in ring.map { [$0.latitude, $0.longitude] } }),
                floorFeetMSL: floor,
                ceilingFeetMSL: ceiling,
                severity: severity
            )
        }
    }

    /// "CTR LLHA", "TMA LLBG", "P 4" (from LLP04), "R 12", "D 5"; the bare kind without a code.
    nonisolated static func israelShortName(kind: IsraelAirspaceKind, code: String?) -> String {
        guard let code, !code.isEmpty else { return kind.rawValue }
        switch kind {
        case .prohibited, .restricted, .danger:
            let digits = code.drop { !$0.isNumber }
            guard let number = Int(digits) else { return "\(kind.rawValue) \(code)" }
            return "\(kind.rawValue) \(number)"
        default:
            return "\(kind.rawValue) \(code)"
        }
    }
}
