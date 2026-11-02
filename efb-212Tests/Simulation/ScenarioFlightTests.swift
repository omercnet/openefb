//
//  ScenarioFlightTests.swift
//  efb-212Tests
//
//  SIM-IL (T35). Each committed scenario in tools/flight-sim/scenarios is flown through the production pipeline
//  (see ScenarioRun) on a virtual clock, and the pilot-visible outcomes are asserted: route sequencing, cautions,
//  alerts and their severity, "no position", the recorded track and the CVFR debrief.
//

#if DEBUG

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@MainActor
@Suite("Scenario flights", .serialized)
struct ScenarioFlightTests {

    // MARK: Scenario files

    @Test(arguments: ["il-cvfr-llhz-llib-nominal", "il-cvfr-llhz-llib-deviations", "il-ctr-entry", "il-border-approach",
                      "il-closed-leg", "il-lsa-llbs-llrs", "il-gps-loss", "us-kpao-ksql"])
    func everyScenarioIsATimeOrderedFlightFromTheFirstToTheLastPoint(_ name: String) throws {
        let scenario = try FlightScenario.load(name)
        #expect(scenario.fixes.count > 100)
        #expect(zip(scenario.fixes, scenario.fixes.dropFirst()).allSatisfy { $0.t < $1.t })
        let first = try #require(scenario.fixes.first), last = try #require(scenario.fixes.last)
        #expect(first.gs < 15 && last.gs < 15)  // starts and ends on the ground
        let legs = scenario.route.legs
        #expect(!legs.isEmpty)
        if let departure = legs.first?.polyline.first, let arrival = legs.last?.polyline.last {
            let startNM = IsraelRouteFollowing.distanceNM(.init(latitude: first.lat, longitude: first.lon),
                                                          .init(latitude: departure[0], longitude: departure[1]))
            let endNM = IsraelRouteFollowing.distanceNM(.init(latitude: last.lat, longitude: last.lon),
                                                        .init(latitude: arrival[0], longitude: arrival[1]))
            #expect(startNM < 0.5 && endNM < 0.5)
        }
    }

    // MARK: Nominal

    @Test func aNominalCVFRFlightSequencesEveryLegWithoutCautionsAndDebriefsNearPerfect() async throws {
        let run = try await ScenarioRun.fly("il-cvfr-llhz-llib-nominal")

        #expect(run.failedToDeliver == 0)
        #expect(run.legSequence == Array(0..<run.scenario.route.legs.count))
        #expect(run.offRouteLegs.isEmpty)
        #expect(run.altitudeCautionLegs.isEmpty)
        #expect(run.samples.allSatisfy { $0.alerts.allSatisfy { $0.severity != .warning } })  // red = warning only
        #expect(run.samples(with: .closure).isEmpty)
        #expect(run.samples(with: .border).isEmpty)
        #expect(run.alerts(of: .squawk).count == 1)  // the 5100 reminder, once per departure

        let recorded = try run.recordingDB.trackPoints(forFlight: run.flightID)
        #expect(recorded.count == run.samples.filter(\.hadFix).count)

        let debrief = try run.cvfrDebrief()
        #expect(debrief.fromPlan)
        #expect(debrief.legs.count == run.scenario.route.legs.count)
        let within300 = debrief.legs.compactMap { $0.adherence?.fractionWithin300 }
        #expect(within300.count == debrief.legs.count)
        #expect(within300.allSatisfy { $0 >= 0.9 })
        #expect(within300.reduce(0, +) / Double(within300.count) >= 0.97)
        #expect(debrief.points.count == run.scenario.route.points.count)
        #expect(debrief.points.allSatisfy { $0.distanceNM < 0.5 })
    }

    // MARK: Deviations

    @Test func aHighLegThenAnOffRouteExcursionRaiseTheRightCautionsOnTheRightLegsAndFlagTheDebrief() async throws {
        let run = try await ScenarioRun.fly("il-cvfr-llhz-llib-deviations")
        let altitude = try #require(run.scenario.events.first { $0.kind == "altitudeDeviation" })
        let excursion = try #require(run.scenario.events.first { $0.kind == "offRoute" })
        let altitudeLeg = try #require(altitude.leg), offRouteLeg = try #require(excursion.leg)

        // Altitude: caution on the deviating leg only, while the deviation lasts, and it says "high".
        #expect(run.altitudeCautionLegs == [altitudeLeg])
        let cautioned = run.samples.filter { $0.route?.following.isAltitudeCaution == true }
        let firstCaution = try #require(cautioned.first)
        #expect(firstCaution.t > (altitude.from ?? 0) && firstCaution.t < (altitude.to ?? 0) + 60)
        let deviation = try #require(firstCaution.route?.following.altitudeDeviationFeet)
        #expect(deviation > IsraelRouteFollowing.altitudeToleranceFeet && deviation < 500)  // feet above

        // Off route: on the excursion leg, to the right, at about the flown distance.
        #expect(run.offRouteLegs == [offRouteLeg])
        let off = run.samples.compactMap { $0.route?.following }.filter(\.isOffRoute)
        #expect(off.allSatisfy { $0.side == .right })
        let farthest = off.compactMap(\.crossTrackNM).max() ?? 0  // nautical miles
        #expect(farthest > 1.0 && farthest < (excursion.nm ?? 0) + 0.2)

        // The debrief flags the high leg and only that leg.
        let debrief = try run.cvfrDebrief()
        let high = try #require(debrief.legs.first { $0.fromCode == run.scenario.route.legs[altitudeLeg].from })
        #expect((high.adherence?.fractionWithin300 ?? 1) < 0.7)
        #expect((high.adherence?.maxDeviationFeet ?? 0) > 350)
        let others = debrief.legs.filter { $0.fromCode != high.fromCode }.compactMap { $0.adherence?.fractionWithin300 }
        #expect(others.allSatisfy { $0 >= 0.9 })
        #expect(debrief.observations.contains { $0.contains(high.fromCode) && $0.contains(high.toCode) })
    }

    // MARK: Airspace and border

    @Test func enteringARestrictedAreaThenACTRRaisesAmberAlertsInThatOrder() async throws {
        let run = try await ScenarioRun.fly("il-ctr-entry")

        let restricted = try #require(run.alerts(of: .restricted).first { $0.title.hasPrefix("Entering restricted area LLR100") })
        #expect(restricted.severity == .caution)  // red is reserved for warnings
        #expect(run.alerts(of: .restricted).contains { $0.title.hasPrefix("Inside restricted area LLR100") })

        let ctr = try #require(run.alerts(of: .ctr).first { $0.title.contains("Haifa") })
        #expect(ctr.severity == .caution)
        #expect(ctr.title == "Entering Haifa CTR: contact TWR 133")

        let restrictedAt = try #require(run.samples.first { $0.alerts.contains { $0.id == restricted.id } }?.t)
        let ctrAt = try #require(run.samples.first { $0.alerts.contains { $0.id == ctr.id } }?.t)
        #expect(restrictedAt < ctrAt)
    }

    @Test func approachingTheLebanonBorderThenEnteringItRaisesAmberThenRed() async throws {
        let run = try await ScenarioRun.fly("il-border-approach")

        let border = run.alerts(of: .border).filter { $0.title.contains("Lebanon") }
        let projected = try #require(border.first { $0.title.hasPrefix("Track enters Lebanon border buffer") })
        let inside = try #require(border.first { $0.title.hasPrefix("Inside Lebanon border buffer") },
                                  Comment(rawValue: border.map { "\($0.severity) \($0.title)" }.joined(separator: " | ")))
        #expect(projected.severity == .caution)
        #expect(inside.severity == .warning)  // red
        #expect(inside.detail?.contains("No flight allowed") == true)
        let projectedAt = try #require(run.samples.first { $0.alerts.contains { $0.id == projected.id } }?.t)
        let insideAt = try #require(run.samples.first { $0.alerts.contains { $0.severity == .warning && $0.title.hasPrefix("Inside Lebanon") } }?.t)
        #expect(projectedAt < insideAt)
        // Red sorts first in the banner.
        let worst = try #require(run.samples.first { $0.t == insideAt }?.alerts.first)
        #expect(worst.severity == .warning)
        #expect(!run.alerts(of: .northOf33).isEmpty)
    }

    // MARK: Closures

    @Test func aFixtureNotamClosesOneLegFullyInRedAndAnotherPartlyInAmberUntilTheyArePassed() async throws {
        let run = try await ScenarioRun.fly("il-closed-leg", notamFixture: ScenarioRun.notamFixturePath)
        let legs = run.scenario.route.legs

        let full = try #require(run.alerts(of: .closure).first { $0.id.hasPrefix("closure-C9001/26") })
        #expect(full.severity == .warning)
        #expect(full.title == "Route closed ahead: \(legs[2].from) \u{2192} \(legs[2].to)")
        #expect(full.detail?.contains("C9001/26") == true)
        let partial = try #require(run.alerts(of: .closure).first { $0.id.hasPrefix("closure-C9002/26") })
        #expect(partial.severity == .caution)
        #expect(partial.title == "Route partly closed ahead: \(legs[7].from) \u{2192} \(legs[7].to)")

        // Shown from take-off (the closed legs are ahead), gone once the aircraft is past them.
        func shown(_ id: String, in sample: ScenarioRun.Sample) -> Bool { sample.alerts.contains { $0.id == id } }
        let atStart = try #require(run.sample(at: 10))
        #expect(shown(full.id, in: atStart) && shown(partial.id, in: atStart))
        for sample in run.samples where (sample.route?.currentLeg ?? 0) > 2 && sample.t > 450 {
            #expect(!shown(full.id, in: sample), "closed leg 2 still announced on leg \(sample.route?.currentLeg ?? -1)")
        }
        for sample in run.samples where (sample.route?.currentLeg ?? 0) > 7 && sample.t > 1560 {
            #expect(!shown(partial.id, in: sample))
        }
        #expect(run.legSequence == Array(0..<legs.count))  // the closure warns; it doesn't stop the sequencing
    }

    // MARK: GPS loss

    @Test func aGPSLossSuspendsTheAlertsAndTheRouteThenTheyResume() async throws {
        let run = try await ScenarioRun.fly("il-gps-loss", stride: 2)
        let window = try #require(run.scenario.gpsLossWindows.first)

        let before = try #require(run.samples.last { $0.t < window.lowerBound && $0.hadFix })
        #expect(!before.suspended)
        #expect(!before.alerts.isEmpty)  // an alert is up when the position disappears

        let during = run.samples.filter { $0.t < window.upperBound && $0.t > window.lowerBound + 2 }
        #expect(!during.isEmpty)
        #expect(during.allSatisfy { $0.suspended && $0.gpsStatus.isStale })  // "ALERTS OFF: NO GPS POSITION"
        #expect(during.allSatisfy { $0.alerts.isEmpty })                      // none stays current
        #expect(during.allSatisfy { !$0.hadFix })
        #expect(Set(during.compactMap { $0.route?.currentLeg }).count == 1)    // the route stood still

        let after = run.samples.filter { $0.t > window.upperBound + 2 }
        #expect(after.first?.suspended == false)
        #expect(after.allSatisfy { !$0.suspended })
        let resumed = try #require(after.first { !$0.alerts.isEmpty })
        #expect(resumed.t < window.upperBound + 60)  // alerts come back with the position
        #expect(run.legSequence == Array(0..<run.scenario.route.legs.count))
    }

    // MARK: LSA

    @Test func aWeekdaySportFlightFollowsTheLSANetworkWithoutWeekendOnlyRoutes() async throws {
        let scenario = try FlightScenario.load("il-lsa-llbs-llrs")
        #expect(scenario.network == "lsa")
        #expect(scenario.route.legs.allSatisfy { $0.activity != "weekend" })
        #expect(IsraelLSATimeRules.weekendState(at: scenario.startDate) == .notInUse)  // a Wednesday

        // The planner agrees on that day: it routes the pair over the LSA network with no weekend-only segment.
        let database = try IsraelAviationDatabase.bundled()
        let planner = IsraelRoutePlanner(
            points: try database.reportingPoints(in: .wholeCountry, network: .lsa),
            segments: try database.routeSegments(in: .wholeCountry, network: .lsa))
        let plan = try planner.route(from: scenario.route.from, to: scenario.route.to, cruiseSpeedKnots: scenario.cruiseSpeedKt,
                                     options: IsraelRouteOptions(departure: scenario.startDate))
        #expect(plan.network == .lsa)
        #expect(plan.legs.allSatisfy { $0.segment.activity != .weekend })

        let run = try await ScenarioRun.fly("il-lsa-llbs-llrs", stride: 3)
        #expect(run.legSequence == Array(0..<scenario.route.legs.count))
        #expect(run.offRouteLegs.isEmpty && run.altitudeCautionLegs.isEmpty)
    }

    // MARK: US parity

    @Test func theUSRouteRunsThroughTheSameSeamWithAltitudeAndNoIsraelAlerts() async throws {
        let run = try await ScenarioRun.fly("us-kpao-ksql", stride: 2)

        #expect(run.appState.region == .us)
        #expect(run.appState.activeRoute == nil)
        #expect(run.samples.allSatisfy { $0.alerts.isEmpty && !$0.suspended })
        let cruise = run.samples.compactMap { $0.hadFix ? $0.t : nil }
        #expect(!cruise.isEmpty)
        #expect(abs(run.appState.groundSpeed - 0) < 1)  // parked after landing
        #expect(run.scenario.fixes.map(\.gs).max() ?? 0 > 90)  // knots
        let peak = run.scenario.fixes.map(\.alt).max() ?? 0  // feet MSL
        #expect(peak > 1000 && peak <= 1600)
        let end = try #require(run.appState.ownshipPosition)
        let ksql = CLLocationCoordinate2D(latitude: 37.5124, longitude: -122.2495)
        #expect(IsraelRouteFollowing.distanceNM(end.coordinate, ksql) < 0.3)
    }
}

#endif
