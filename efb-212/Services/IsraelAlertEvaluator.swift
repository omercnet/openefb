//
//  IsraelAlertEvaluator.swift
//  efb-212
//
//  Pure evaluators behind the Israel in-flight alerts (IL-ALERTS, efb-aac.9): closed legs ahead,
//  P/R/D areas and CTRs on the 2-minute projected track, the border buffers and the CVFR squawk
//  reminder. No state, no clock, no I/O: positions, altitude and `now` come in, alerts go out.
//
//  Colours follow COMMON.md: `.warning` = red, `.caution` = amber, nothing else.
//  Units: degrees WGS-84, nautical miles, feet MSL, knots, seconds.
//

import Foundation
import CoreLocation

// MARK: - Alert model

nonisolated struct IsraelAlert: Identifiable, Equatable, Sendable {
    enum Severity: Int, Comparable, Sendable {
        case caution = 1   // amber
        case warning = 2   // red
        static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    /// Display order inside one severity: lower first.
    enum Kind: Int, Sendable {
        case border = 0, prohibited, closure, restricted, ctr, northOf33, squawk
    }

    let id: String
    let severity: Severity
    let kind: Kind
    /// One short line: "Inside Gaza border buffer".
    let title: String
    /// Optional second line: the data or the action.
    let detail: String?

    /// Highest priority first: red before amber, then the kind order, then the id (a stable tiebreak).
    static func sorted(_ alerts: [IsraelAlert]) -> [IsraelAlert] {
        alerts.sorted {
            if $0.severity != $1.severity { return $0.severity > $1.severity }
            if $0.kind != $1.kind { return $0.kind.rawValue < $1.kind.rawValue }
            return $0.id < $1.id
        }
    }
}

// MARK: - Border buffers

/// The border lines the buffers are built from: Natural Earth 1:10m admin-0 boundary lines (public
/// domain), plus the Gaza buffer from the CAAI P-area LLP19 polygon. Accurate to about 1 km; the
/// alert text never claims more (docs/design/israel-border-buffers.md).
nonisolated struct IsraelBorderBuffers: Sendable {
    struct Border: Sendable {
        let name: String          // "Egypt"
        let bufferKm: Double      // kilometres either side of the line
        let lines: [[[Double]]]   // [line][vertex][lat, lon]

        var bufferNM: Double { bufferKm / 1.852 }
    }

    /// Gaza Strip buffer: CAAI P-area LLP19 itself, which is published as the no-flight area.
    static let gazaAreaCode = "LLP19"
    static let gazaBufferKm = 6.0

    let source: String
    let borders: [Border]

    static let resourceName = "israel-border-lines"

    init(source: String, borders: [Border]) {
        self.source = source
        self.borders = borders
    }

    init(data: Data) throws {
        struct File: Decodable {
            struct B: Decodable { let name: String; let bufferKm: Double; let lines: [[[Double]]] }
            let source: String
            let borders: [B]
        }
        let file = try JSONDecoder().decode(File.self, from: data)
        self.init(source: file.source, borders: file.borders.map { Border(name: $0.name, bufferKm: $0.bufferKm, lines: $0.lines) })
    }

    static func bundled(_ bundle: Bundle = .main) -> IsraelBorderBuffers? {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? IsraelBorderBuffers(data: data)
    }
}

// MARK: - Evaluator

nonisolated enum IsraelAlertEvaluator {

    /// Projection distance for "entering": 2 minutes ahead of the current track.
    static let projectionSeconds: TimeInterval = 120
    /// Below this ground speed the track is not trustworthy and nothing is projected -- knots.
    static let minimumProjectionSpeedKnots = 20.0
    /// Caution distance outside a border buffer -- nautical miles.
    static let borderCautionMarginNM = 1.0
    /// Latitude north of which two-way radio and a working transponder are required -- degrees north (A-17 §4a).
    static let northernLimitLatitude = 33.0

    // MARK: Projection

    /// The position `seconds` ahead on the current track at the current ground speed; nil when too slow to project.
    static func projectedPosition(
        from position: CLLocationCoordinate2D,
        trackTrue: Double,          // degrees true
        groundSpeedKnots: Double,   // knots
        seconds: TimeInterval = projectionSeconds
    ) -> CLLocationCoordinate2D? {
        guard groundSpeedKnots >= minimumProjectionSpeedKnots, trackTrue >= 0 else { return nil }
        let distanceNM = groundSpeedKnots * seconds / 3600  // nautical miles
        let radians = trackTrue * .pi / 180
        let latitude = position.latitude + cos(radians) * distanceNM / 60
        let cosLat = max(0.01, cos(position.latitude * .pi / 180))
        let longitude = position.longitude + sin(radians) * distanceNM / (60 * cosLat)
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    // MARK: Closed legs ahead

    /// Closures on the current leg and the legs after it. Full = red, partial and unread = amber. One alert per
    /// leg and NOTAM; `marks` is empty for a stale feed, so an old closure never reads as current.
    static func closureAlerts(route: ActiveRoute?, marks: [Int: IsraelChartClosureMark]) -> [IsraelAlert] {
        guard let route, !marks.isEmpty else { return [] }
        var alerts: [IsraelAlert] = []
        for index in route.currentLeg..<route.legs.count {
            let leg = route.legs[index]
            guard leg.segmentID != 0, let mark = marks[leg.segmentID] else { continue }
            let label = "\(leg.fromCode) \u{2192} \(leg.toCode)"
            let id = "closure-\(mark.notamID)-\(leg.segmentID)"
            switch mark.severity {
            case .full:
                alerts.append(IsraelAlert(id: id, severity: .warning, kind: .closure,
                                          title: "Route closed ahead: \(label)", detail: "\(mark.text) \u{00B7} NOTAM \(mark.notamID)"))
            case .partial:
                alerts.append(IsraelAlert(id: id, severity: .caution, kind: .closure,
                                          title: "Route partly closed ahead: \(label)", detail: "\(mark.text) \u{00B7} NOTAM \(mark.notamID)"))
            case .check:
                alerts.append(IsraelAlert(id: id, severity: .caution, kind: .closure,
                                          title: "Check NOTAM for \(label)", detail: "NOTAM \(mark.notamID) could not be read in full"))
            }
        }
        return alerts
    }

    // MARK: P / R / D areas and CTRs

    /// Alerts for the P/R/D areas and CTRs around the aircraft.
    /// - Inside a prohibited area (lateral and vertical): red. Projected into one: amber.
    /// - Restricted / danger / CTR: amber, inside or projected. A CTR alert is a reminder: clearance is unknown.
    /// - Unknown altitude never produces a red inside alert (same rule as the US ProximityAlertService).
    /// - `ctrContact` returns (name, "TWR 122.2") for a CTR code when the aerodrome table knows it.
    static func airspaceAlerts(
        position: CLLocationCoordinate2D,
        altitudeFeet: Double?,           // feet MSL; nil without a vertical fix
        trackTrue: Double,               // degrees true
        groundSpeedKnots: Double,        // knots
        airspaces: [IsraelAirspace],
        ctrContact: (String) -> (name: String, twr: String?)? = { _ in nil }
    ) -> [IsraelAlert] {
        let ahead = projectedPosition(from: position, trackTrue: trackTrue, groundSpeedKnots: groundSpeedKnots)
        var alerts: [IsraelAlert] = []
        for area in airspaces {
            // The Gaza buffer is raised by the border evaluator (one alert, not two).
            if area.code == IsraelBorderBuffers.gazaAreaCode { continue }
            guard area.kind == .prohibited || area.kind == .restricted || area.kind == .danger || area.kind == .ctr else { continue }

            let lateralNow = area.containsLaterally(position)
            let lateralAhead = ahead.map { area.containsLaterally($0) } ?? false
            guard lateralNow || lateralAhead else { continue }
            // Vertical: compared at the current altitude (the projection keeps level flight). Unknown = may apply.
            let verticalKnown = altitudeFeet != nil
            let withinVertical = altitudeFeet.map { area.containsAltitude(feetMSL: $0) } ?? true
            guard withinVertical else { continue }

            let inside = lateralNow && verticalKnown
            let isMilitary = area.authority == .military
            let limits = limitsText(area)
            let name = area.nameEnglish ?? area.code ?? "area"
            let code = area.code ?? "area"
            let milSuffix = isMilitary ? " \u{00B7} MIL" : ""

            switch area.kind {
            case .prohibited:
                let title = inside ? "Inside prohibited area \(code) \(name)" : (lateralNow ? "Near prohibited area \(code) \(name)" : "Entering prohibited area \(code) \(name)")
                alerts.append(IsraelAlert(id: "area-\(area.id)", severity: inside ? .warning : .caution, kind: .prohibited,
                                          title: title, detail: limits + milSuffix))
            case .restricted, .danger:
                let word = area.kind == .restricted ? "restricted" : "danger"
                let verb = lateralNow ? "Inside" : "Entering"
                alerts.append(IsraelAlert(id: "area-\(area.id)", severity: .caution, kind: .restricted,
                                          title: "\(verb) \(word) area \(code) \(name)", detail: limits + milSuffix))
            case .ctr:
                let contact = area.code.flatMap { ctrContact($0) }
                let ctrName = contact?.name ?? area.nameEnglish ?? area.code ?? "CTR"
                var title = "\(lateralNow ? "In" : "Entering") \(ctrName) CTR"
                if let twr = contact?.twr { title += ": contact \(twr)" } else { title += ": get clearance" }
                alerts.append(IsraelAlert(id: "area-\(area.id)", severity: .caution, kind: .ctr,
                                          title: title, detail: limits + milSuffix))
            default:
                continue
            }
        }
        return alerts
    }

    /// "SFC-3000 FT" / "SFC-UNL FT": the chart's own limits text.
    static func limitsText(_ area: IsraelAirspace) -> String {
        IsraelChartFeatureBuilder.limitsText(floor: area.floor, ceiling: area.ceiling) + " FT"
    }

    /// "Herzliya (Modi Alon) Airport" -> "Herzliya": the pilot says the town, not the register entry.
    static func shortAerodromeName(_ name: String) -> String {
        var short = name
        if let paren = short.firstIndex(of: "(") { short = String(short[..<paren]) }
        for suffix in [" Airport", " Airfield", " Airstrip", " Aerodrome"] where short.trimmingCharacters(in: .whitespaces).hasSuffix(suffix) {
            short = String(short.trimmingCharacters(in: .whitespaces).dropLast(suffix.count))
        }
        let trimmed = short.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? name : trimmed
    }

    /// "122.200" -> "TWR 122.2" for the first tower frequency; nil without one.
    static func towerContact(of aerodrome: IsraelAerodrome) -> String? {
        guard let tower = aerodrome.frequencies.first(where: { $0.service.uppercased().hasPrefix("TWR") }) else { return nil }
        var mhz = tower.mhz
        if mhz.contains(".") {
            while mhz.hasSuffix("0") { mhz.removeLast() }
            if mhz.hasSuffix(".") { mhz.removeLast() }
        }
        return "TWR \(mhz)"
    }

    // MARK: Border buffers

    /// Border buffer alerts: red inside a buffer, amber within 1 NM of one or when the 2-minute projection
    /// enters it, plus the 33°00'N reminder (amber: allowed with two-way radio and a working transponder).
    /// `gazaRings` are the outer rings of CAAI LLP19 as [lat, lon] vertices.
    static func borderAlerts(
        position: CLLocationCoordinate2D,
        trackTrue: Double,
        groundSpeedKnots: Double,
        buffers: IsraelBorderBuffers?,
        gazaRings: [[[Double]]]
    ) -> [IsraelAlert] {
        let ahead = projectedPosition(from: position, trackTrue: trackTrue, groundSpeedKnots: groundSpeedKnots)
        var alerts: [IsraelAlert] = []
        let accuracy = "Border from public-domain data, about 1 km accurate"

        func raise(name: String, bufferKm: Double, distanceNM: Double?, aheadNM: Double?, bufferNM: Double) {
            guard let distanceNM else { return }
            if distanceNM <= bufferNM {
                alerts.append(IsraelAlert(id: "border-\(name)", severity: .warning, kind: .border,
                                          title: "Inside \(name) border buffer (\(Int(bufferKm)) km)", detail: "No flight allowed \u{00B7} \(accuracy)"))
            } else if let aheadNM, aheadNM <= bufferNM {
                alerts.append(IsraelAlert(id: "border-\(name)", severity: .caution, kind: .border,
                                          title: "Track enters \(name) border buffer in 2 min", detail: accuracy))
            } else if distanceNM <= bufferNM + borderCautionMarginNM {
                alerts.append(IsraelAlert(id: "border-\(name)", severity: .caution, kind: .border,
                                          title: String(format: "%.1f NM from %@ border buffer", distanceNM - bufferNM, name), detail: accuracy))
            }
        }

        for border in buffers?.borders ?? [] {
            let distance = border.lines.compactMap { IsraelRouteFollowing.crossTrack(of: position, along: $0)?.distanceNM }.min()
            let aheadDistance = ahead.flatMap { point in border.lines.compactMap { IsraelRouteFollowing.crossTrack(of: point, along: $0)?.distanceNM }.min() }
            raise(name: border.name, bufferKm: border.bufferKm, distanceNM: distance, aheadNM: aheadDistance, bufferNM: border.bufferNM)
        }

        // Gaza: the CAAI P-area polygon is the published no-flight area (LLP19).
        if !gazaRings.isEmpty {
            func distanceNM(_ point: CLLocationCoordinate2D) -> Double? {
                gazaRings.compactMap { PolygonGeometry.distanceNM(from: point, ring: $0) }.min()
            }
            raise(name: "Gaza", bufferKm: IsraelBorderBuffers.gazaBufferKm, distanceNM: distanceNM(position),
                  aheadNM: ahead.flatMap { distanceNM($0) }, bufferNM: 0)
        }

        // 33°00'N: not a buffer, an equipment rule, so it never goes red.
        let northNow = position.latitude > northernLimitLatitude
        let northAhead = ahead.map { $0.latitude > northernLimitLatitude } ?? false
        if northNow || northAhead {
            alerts.append(IsraelAlert(id: "north-33", severity: .caution, kind: .northOf33,
                                      title: northNow ? "North of 33\u{00B0}00\u{2032}N" : "Track crosses 33\u{00B0}00\u{2032}N in 2 min",
                                      detail: "Two-way radio and a working transponder required"))
        }
        return alerts
    }
}

// MARK: - Squawk reminder

/// One reminder per departure: the CVFR squawk (domestic AIP B-03 §2f: transponder on for the whole flight, code
/// 5100 unless the AIP or ATC says otherwise). Armed once the aircraft has been on the ground; fires when the ground
/// speed passes 40 kt; re-armed by the next landing or stop.
nonisolated struct IsraelSquawkReminder: Equatable, Sendable {
    /// At or below this the aircraft counts as on the ground -- knots.
    static let groundSpeedKnots = 15.0
    /// Departure threshold -- knots.
    static let departureSpeedKnots = 40.0
    /// How long the reminder stays up -- seconds.
    static let displaySeconds: TimeInterval = 60
    /// The CVFR code, verified in the domestic AIP B-03 §2f text (docs/research/israel-cvfr-samples).
    static let code = "5100"

    private(set) var armed = false
    private(set) var shownAt: Date?

    /// Feed a ground speed; returns true exactly once per departure.
    mutating func update(groundSpeedKnots speed: Double, now: Date) -> Bool {
        if speed <= Self.groundSpeedKnots {
            armed = true
            shownAt = nil
            return false
        }
        if armed, speed > Self.departureSpeedKnots {
            armed = false
            shownAt = now
            return true
        }
        return false
    }

    /// The reminder alert while it is on display.
    func alert(now: Date) -> IsraelAlert? {
        guard let shownAt, now.timeIntervalSince(shownAt) <= Self.displaySeconds else { return nil }
        return IsraelAlert(id: "squawk", severity: .caution, kind: .squawk,
                           title: "Squawk \(Self.code) (CVFR)", detail: "Transponder on for the whole flight, unless the AIP or ATC says otherwise")
    }
}
