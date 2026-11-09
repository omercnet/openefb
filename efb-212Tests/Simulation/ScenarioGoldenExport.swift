//
//  ScenarioGoldenExport.swift
//  efb-212Tests
//
//  Exports one event log per flight-sim scenario as golden JSON for the React Native scenario harness
//  (tools/ci/export-scenario-goldens.sh). Each scenario is flown through the same production pipeline and virtual
//  clock as ScenarioFlightTests (see ScenarioRun), then the pilot-visible state is turned into events: alerts that
//  appear, change and clear, leg sequencing, off-route and altitude cautions, GPS status, "alerts suspended".
//  Does nothing unless OPENEFB_GOLDEN_DIR is set (xcodebuild passes TEST_RUNNER_OPENEFB_GOLDEN_DIR through), so the
//  unit-test job is unaffected. Output is sorted-key JSON with rounded numbers, so two runs are byte-identical.
//

#if DEBUG

import Testing
import Foundation
@testable import efb_212

@MainActor
@Suite("Scenario golden export", .serialized)
struct ScenarioGoldenExport {

    /// Same scenarios, strides and NOTAM feed as ScenarioFlightTests.
    static let scenarios: [(name: String, stride: Double, notams: Bool)] = [
        ("il-cvfr-llhz-llib-nominal", 2, false), ("il-cvfr-llhz-llib-deviations", 2, false), ("il-ctr-entry", 2, false),
        ("il-border-approach", 2, false), ("il-closed-leg", 2, true), ("il-lsa-llbs-llrs", 3, false),
        ("il-gps-loss", 2, false), ("us-kpao-ksql", 2, false)
    ]

    @Test(arguments: scenarios.map(\.name))
    func exportGolden(_ name: String) async throws {
        guard let dir = ProcessInfo.processInfo.environment["OPENEFB_GOLDEN_DIR"], !dir.isEmpty else { return }
        let spec = try #require(Self.scenarios.first { $0.name == name })
        let run = try await ScenarioRun.fly(name, stride: spec.stride,
                                            notamFixture: spec.notams ? ScenarioRun.notamFixturePath : nil)
        let json = try Self.golden(for: run, stride: spec.stride)
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try json.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).json"))
    }

    // MARK: - Event log

    private static func r(_ x: Double, _ digits: Int = 3) -> Double {
        let f = pow(10.0, Double(digits))
        return (x * f).rounded() / f
    }

    private static func kindName(_ kind: IsraelAlert.Kind) -> String {
        switch kind {
        case .border: return "border"
        case .prohibited: return "prohibited"
        case .closure: return "closure"
        case .restricted: return "restricted"
        case .ctr: return "ctr"
        case .northOf33: return "northOf33"
        case .squawk: return "squawk"
        }
    }

    private static func severityName(_ severity: IsraelAlert.Severity) -> String {
        severity == .warning ? "warning" : "caution"
    }

    private static func gpsName(_ status: GPSStatus) -> String {
        switch status {
        case .ok: return "ok"
        case .degraded(.noAltitude): return "degraded:noAltitude"
        case .degraded(.poorHorizontalAccuracy): return "degraded:poorHorizontalAccuracy"
        case .lost: return "lost"
        }
    }

    private static func alertJSON(_ a: IsraelAlert) -> [String: Any] {
        var out: [String: Any] = ["id": a.id, "kind": kindName(a.kind), "severity": severityName(a.severity), "title": a.title]
        if let detail = a.detail { out["detail"] = detail }
        return out
    }

    static func golden(for run: ScenarioRun, stride: Double) throws -> Data {
        var events: [[String: Any]] = []
        func emit(_ t: Double, _ type: String, _ fields: [String: Any] = [:]) {
            var e = fields
            e["t"] = r(t, 1)
            e["type"] = type
            events.append(e)
        }

        var alerts: [String: IsraelAlert] = [:]
        var leg: Int?
        var offRoute = false, altitudeCaution = false, suspended = false
        var gps: String?
        for s in run.samples {
            let now = Dictionary(s.alerts.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            for id in now.keys.sorted() {
                let a = now[id]!
                if let before = alerts[id] {
                    if before != a { emit(s.t, "alert_changed", alertJSON(a)) }
                } else {
                    emit(s.t, "alert_on", alertJSON(a))
                }
            }
            for id in alerts.keys.sorted() where now[id] == nil { emit(s.t, "alert_off", ["id": id]) }
            alerts = now

            if let route = s.route, route.currentLeg != leg {
                leg = route.currentLeg
                emit(s.t, "leg", ["leg": route.currentLeg, "from": route.current?.fromCode ?? "", "to": route.current?.toCode ?? ""])
            }
            let off = s.route?.following.isOffRoute ?? false
            if off != offRoute {
                offRoute = off
                var f: [String: Any] = ["leg": s.route?.currentLeg ?? -1]
                if let xt = s.route?.following.crossTrackNM { f["crossTrackNM"] = r(xt, 2) }
                emit(s.t, off ? "off_route_on" : "off_route_off", f)
            }
            let caution = s.route?.following.isAltitudeCaution ?? false
            if caution != altitudeCaution {
                altitudeCaution = caution
                var f: [String: Any] = ["leg": s.route?.currentLeg ?? -1]
                if let dev = s.route?.following.altitudeDeviationFeet { f["deviationFeet"] = r(dev, 0) }
                emit(s.t, caution ? "altitude_caution_on" : "altitude_caution_off", f)
            }
            let g = gpsName(s.gpsStatus)
            if g != gps { gps = g; emit(s.t, "gps", ["status": g]) }
            if s.suspended != suspended {
                suspended = s.suspended
                emit(s.t, suspended ? "alerts_suspended" : "alerts_resumed")
            }
        }

        let routeLegs = run.samples.compactMap(\.route).first?.legs.map { ["from": $0.fromCode, "to": $0.toCode] } ?? []
        var summary: [String: Any] = [
            "samples": run.samples.count,
            "fixesDelivered": run.samples.filter(\.hadFix).count,
            "failedToDeliver": run.failedToDeliver,
            "legSequence": run.legSequence,
            "offRouteLegs": run.offRouteLegs.sorted(),
            "altitudeCautionLegs": run.altitudeCautionLegs.sorted(),
            "recordedTrackPoints": try run.recordingDB.trackPoints(forFlight: run.flightID).count
        ]
        if let debrief = try? run.cvfrDebrief() {
            summary["debrief"] = [
                "fromPlan": debrief.fromPlan,
                "legs": debrief.legs.count,
                "fractionWithin300": debrief.legs.map { $0.adherence.map { r($0.fractionWithin300) } ?? -1 },
                "points": debrief.points.count,
                "maxPointDistanceNM": r(debrief.points.map(\.distanceNM).max() ?? 0)
            ] as [String: Any]
        }
        let doc: [String: Any] = [
            "format": "kanaf-scenario-golden/1",
            "scenario": run.scenario.name,
            "durationSeconds": r(run.scenario.duration, 1),
            "strideSeconds": stride,
            "route": routeLegs,
            "events": events,
            "summary": summary
        ]
        var data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
        data.append(0x0A)
        return data
    }
}

#endif
