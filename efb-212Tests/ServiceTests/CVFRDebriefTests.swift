//
//  CVFRDebriefTests.swift
//  efb-212Tests
//
//  IL-DEBRIEF: route matching (planned and unplanned), time-weighted altitude adherence with aerodrome
//  exclusion zones and two-number altitudes, reporting-point passage, Hebrew/English position-report
//  matching, and the unrolled profile (distance axis, excluded zones, verdict). Hand-made routes plus the
//  bundled LLHZ -> LLIB route.
//

import Testing
import Foundation
import CoreLocation
import GRDB
@testable import efb_212

@Suite("CVFR debrief")
struct CVFRDebriefTests {

    // MARK: Fixtures

    private static let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    private static let flightID = UUID()

    private static func coordinate(_ lat: Double, _ lon: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// One segment along lat 32.0 (west -> east between the given longitudes).
    private static func segment(
        _ id: Int, _ from: String, _ to: String, lon0: Double, lon1: Double, lat: Double = 32.0,
        forward: String? = "1500", reverse: String? = "2500"
    ) -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: from, toCode: to, fromPointID: id, toPointID: id + 100,
            nameEnglish: nil, nameHebrew: nil, lengthNM: nil, isCivil: true, isMilitary: false,
            isByRequest: false, bearingTrue: 90,
            altitudeForward: forward.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            altitudeReverse: reverse.map { IsraelRouteAltitude(published: $0, feet: Int($0)) },
            lowerAltitudeFeet: nil, mapSheet: nil,
            polyline: [coordinate(lat, lon0), coordinate(lat, lon1)]
        )
    }

    private static func point(
        lat: Double = 32.0, lon: Double, altitude: Double = 1500, second: Double,
        course: Double = 90, speed: Double = 90
    ) -> TrackPointRecord {
        TrackPointRecord(
            flightID: flightID, timestamp: t0.addingTimeInterval(second),
            latitude: lat, longitude: lon, altitudeFeet: altitude,
            groundSpeedKnots: speed, verticalSpeedFPM: 0, courseDegrees: course
        )
    }

    /// Eastbound track along lat 32.0, one point per second, from lon0 to lon1 in `count` steps.
    private static func eastbound(lon0: Double, lon1: Double, count: Int, start: Double = 0, altitude: (Int) -> Double = { _ in 1500 }) -> [TrackPointRecord] {
        (0..<count).map { i in
            let lon = lon0 + (lon1 - lon0) * Double(i) / Double(max(1, count - 1))
            return point(lon: lon, altitude: altitude(i), second: start + Double(i))
        }
    }

    private static func transcript(_ text: String, at second: Double) -> TranscriptSegmentRecord {
        TranscriptSegmentRecord(
            flightID: flightID, timestamp: t0.addingTimeInterval(second), text: text,
            confidence: 0.9, audioStartTime: 0, audioEndTime: 1, flightPhase: "cruise"
        )
    }

    private static func reportingPoint(code: String, en: String?, he: String?, lon: Double) -> IsraelReportingPoint {
        IsraelReportingPoint(id: 1, code: code, nameEnglish: en, nameHebrew: he, kind: .compulsory, latitude: 32.0, longitude: lon)
    }

    // MARK: Published altitudes

    @Test func parsesOneAndTwoNumberAltitudes() {
        #expect(CVFRDebriefBuilder.publishedAltitudes("3500") == [3500])
        #expect(CVFRDebriefBuilder.publishedAltitudes("2500/3500") == [2500, 3500])
        #expect(CVFRDebriefBuilder.publishedAltitudes("---").isEmpty)
    }

    @Test func twoNumberAltitudeComparesAgainstTheNearerValue() {
        let published = [2500.0, 3500.0]
        #expect(CVFRDebriefBuilder.deviationFeet(altitude: 2600, published: published) == 100)
        #expect(CVFRDebriefBuilder.deviationFeet(altitude: 3300, published: published) == -200)
        // 3000 is equidistant; either side is acceptable, the magnitude is 500.
        #expect(abs(CVFRDebriefBuilder.deviationFeet(altitude: 3000, published: published)) == 500)
    }

    // MARK: Adherence maths

    @Test func adherenceIsTimeWeightedWithMaxDeviation() throws {
        // 60 s on 1500 (0 ft), 40 s on 1750 (+250 ft), 20 s on 2000 (+500 ft); published 1500.
        let samples = Self.eastbound(lon0: 34.8, lon1: 35.0, count: 120) { i in i < 60 ? 1500 : (i < 100 ? 1750 : 2000) }
        let result = try #require(CVFRDebriefBuilder.adherence(samples: samples, published: [1500]))
        #expect(result.fractionWithin200 == 0.5)                   // 60 / 120 s
        #expect(abs(result.fractionWithin300 - 100.0 / 120.0) < 1e-9)
        #expect(result.maxDeviationFeet == 500)
        #expect(result.sampledSeconds == 120)
    }

    @Test func belowPublishedAltitudeGivesNegativeMaxDeviation() throws {
        let samples = Self.eastbound(lon0: 34.8, lon1: 35.0, count: 30) { _ in 1100 }
        let result = try #require(CVFRDebriefBuilder.adherence(samples: samples, published: [1500]))
        #expect(result.maxDeviationFeet == -400)
        #expect(result.fractionWithin300 == 0)
    }

    @Test func aGapInTheTrackIsNotCreditedBeyondTenSeconds() throws {
        // A good sample, then a 10-minute gap, then a bad one: the gap is not blamed on either side.
        let samples = [Self.point(lon: 34.8, altitude: 1500, second: 0), Self.point(lon: 34.9, altitude: 3000, second: 600)]
        let result = try #require(CVFRDebriefBuilder.adherence(samples: samples, published: [1500]))
        #expect(result.sampledSeconds == 11)   // 10 s credited to the first sample + 1 s to the last
    }

    @Test func aerodromeEndsAreExcludedFromTheAdherence() throws {
        // Leg ends at an aerodrome (LLIB); the last 3 NM are flown 3500 ft too high (a traffic pattern climb).
        let leg = CVFRRouteLeg(segment: Self.segment(1, "ALPHA", "LLIB", lon0: 34.8, lon1: 35.3), forward: true)
        let cutoffLon = 35.3 - 3.0 / (60 * cos(32.0 * .pi / 180))
        let track = Self.eastbound(lon0: 34.8, lon1: 35.3, count: 200) { i in
            let lon = 34.8 + 0.5 * Double(i) / 199
            return lon > cutoffLon + 0.002 ? 5000 : 1500   // high only well inside the 3 NM zone
        }
        let result = try #require(CVFRDebriefBuilder.adherence(points: track, leg: leg, publishedText: "1500"))
        #expect(result.fractionWithin200 == 1)
        #expect(result.maxDeviationFeet == 0)
        // Without the exclusion the same track is clearly off.
        let unfiltered = try #require(CVFRDebriefBuilder.adherence(samples: track, published: [1500]))
        #expect(unfiltered.fractionWithin200 < 1)
    }

    @Test func aerodromeStartAndEndAreBothExcludedButEnRoutePointsAreNot() throws {
        let leg = CVFRRouteLeg(segment: Self.segment(1, "LLHZ", "LLIB", lon0: 34.8, lon1: 35.3), forward: true)
        let nm = 3.0 / (60 * cos(32.0 * .pi / 180))
        let track = Self.eastbound(lon0: 34.8, lon1: 35.3, count: 200) { i in
            let lon = 34.8 + 0.5 * Double(i) / 199
            return (lon < 34.8 + nm || lon > 35.3 - nm) ? 900 : 2000   // 500 ft above published only en route
        }
        let result = try #require(CVFRDebriefBuilder.adherence(points: track, leg: leg, publishedText: "1500"))
        #expect(result.maxDeviationFeet == 500)
        #expect(result.fractionWithin300 == 0)
    }

    // MARK: Route matching

    @Test func plannedMatchFollowsTheLegsInOrder() {
        let legs = [
            CVFRRouteLeg(segment: Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.0), forward: true),
            CVFRRouteLeg(segment: Self.segment(2, "B", "C", lon0: 35.0, lon1: 35.2), forward: true),
        ]
        let track = Self.eastbound(lon0: 34.8, lon1: 35.2, count: 80)
        let matched = CVFRDebriefBuilder.matchPlanned(trackPoints: track, legs: legs)
        #expect(matched.map(\.leg.fromCode) == ["A", "B"])
        let counted = matched.reduce(0) { $0 + $1.points.count }
        #expect(counted == 80)
    }

    @Test func plannedMatchIgnoresTrackMoreThanOneNMOffTheRoute() {
        let legs = [CVFRRouteLeg(segment: Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.0), forward: true)]
        // 0.05 degrees of latitude = 3 NM north of the route.
        let off = (0..<20).map { Self.point(lat: 32.05, lon: 34.85 + Double($0) * 0.005, second: Double($0)) }
        #expect(CVFRDebriefBuilder.matchPlanned(trackPoints: off, legs: legs).isEmpty)
    }

    @Test func unplannedMatchPicksTheSegmentAndTheDirectionFlown() {
        let segments = [
            Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.2),
            Self.segment(2, "X", "Y", lon0: 34.8, lon1: 35.2, lat: 32.5),   // 30 NM north: never matched
        ]
        let west = (0..<60).map { i in
            Self.point(lon: 35.1 - Double(i) * 0.002, altitude: 2500, second: Double(i), course: 270)
        }
        let matched = CVFRDebriefBuilder.matchUnplanned(trackPoints: west, segments: segments)
        #expect(matched.count == 1)
        #expect(matched.first?.leg.segment.id == 1)
        #expect(matched.first?.leg.forward == false)
        #expect(matched.first?.leg.fromCode == "B")
        // Flown against the published direction, so the reverse altitude (2500) is the reference.
        #expect(matched.first?.leg.publishedAltitude == "2500")
    }

    @Test func unplannedMatchDropsBriefCrossingsAndFarTrack() {
        let segments = [Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.2)]
        let crossing = (0..<10).map { i in   // 10 s within 1 NM of the route, then gone
            Self.point(lat: 31.97 + Double(i) * 0.006, lon: 35.0, second: Double(i), course: 0)
        }
        #expect(CVFRDebriefBuilder.matchUnplanned(trackPoints: crossing, segments: segments).isEmpty)
        let far = (0..<60).map { Self.point(lat: 33.0, lon: 34.8 + Double($0) * 0.005, second: Double($0)) }
        #expect(CVFRDebriefBuilder.matchUnplanned(trackPoints: far, segments: segments).isEmpty)
    }

    @Test func unplannedRunsOnTheSameLegAreMergedAcrossAGap() {
        let segments = [Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.4)]
        // Two 40 s runs on the same segment separated by a stretch 3 NM north of it.
        let first = Self.eastbound(lon0: 34.85, lon1: 34.95, count: 40)
        let detour = (0..<10).map { Self.point(lat: 32.05, lon: 34.95 + Double($0) * 0.002, second: 40 + Double($0)) }
        let second = Self.eastbound(lon0: 35.0, lon1: 35.1, count: 40, start: 50)
        let matched = CVFRDebriefBuilder.matchUnplanned(trackPoints: first + detour + second, segments: segments)
        #expect(matched.count == 1)
        #expect(matched.first?.points.count == 80)
    }

    // MARK: Reporting points

    @Test func passageGivesTimeAndDistanceAtClosestApproach() throws {
        let point = Self.reportingPoint(code: "TAVOR", en: "Tavor", he: "תבור", lon: 35.0)
        // Track passes 0.01 deg of latitude (0.6 NM) south of the point at second 60.
        let track = (0...120).map { Self.point(lat: 31.99, lon: 34.94 + Double($0) * 0.001, second: Double($0)) }
        let result = try #require(CVFRDebriefBuilder.passage(of: point, trackPoints: track, transcript: []))
        #expect(result.time == Self.t0.addingTimeInterval(60))
        #expect(abs(result.distanceNM - 0.6) < 0.05)
        #expect(result.reported == false)
    }

    @Test func positionReportCountsOnlyWithinTwoMinutesOfPassage() throws {
        let point = Self.reportingPoint(code: "TAVOR", en: "Tavor", he: "תבור", lon: 35.0)
        let track = (0...120).map { Self.point(lon: 34.94 + Double($0) * 0.001, second: Double($0)) }   // closest at 60 s
        let near = try #require(CVFRDebriefBuilder.passage(
            of: point, trackPoints: track, transcript: [Self.transcript("Tavor, Cessna four x-ray, 1500 feet", at: 60 + 100)]))
        #expect(near.reported)
        let late = try #require(CVFRDebriefBuilder.passage(
            of: point, trackPoints: track, transcript: [Self.transcript("Tavor, Cessna four x-ray", at: 60 + 300)]))
        #expect(late.reported == false)
        let elsewhere = try #require(CVFRDebriefBuilder.passage(
            of: point, trackPoints: track, transcript: [Self.transcript("Afula is next", at: 60)]))
        #expect(elsewhere.reported == false)
    }

    @Test func reportWindowIsAParameterAndDefaultsToTwoMinutes() throws {
        let point = Self.reportingPoint(code: "TAVOR", en: "Tavor", he: "תבור", lon: 35.0)
        let track = (0...120).map { Self.point(lon: 34.94 + Double($0) * 0.001, second: Double($0)) }   // closest at 60 s
        let report = [Self.transcript("Tavor, Cessna four x-ray", at: 60 + 200)]   // 200 s after the passage
        let builtIn = try #require(CVFRDebriefBuilder.passage(of: point, trackPoints: track, transcript: report))
        #expect(builtIn.reported == false)
        let widened = try #require(CVFRDebriefBuilder.passage(of: point, trackPoints: track, transcript: report, reportWindow: 300))
        #expect(widened.reported)
        let narrowed = try #require(CVFRDebriefBuilder.passage(
            of: point, trackPoints: track, transcript: [Self.transcript("Tavor, Cessna four x-ray", at: 60 + 100)], reportWindow: 30))
        #expect(narrowed.reported == false)
    }

    /// A 400 s eastbound track over lat 32.0 whose closest approach to TAVOR (lon 35.0) is at about 200 s, and a
    /// position report heard 200 s after that: outside the built-in 120 s window, inside a 300 s one.
    private static func lateReportFixture() -> (
        track: [TrackPointRecord], transcript: [TranscriptSegmentRecord],
        segments: [IsraelRouteSegment], points: [String: IsraelReportingPoint]
    ) {
        (
            track: eastbound(lon0: 34.8, lon1: 35.2, count: 400),
            transcript: [transcript("Tavor, Cessna four x-ray", at: 400)],
            segments: [segment(1, "ALPHA", "TAVOR", lon0: 34.8, lon1: 35.2)],
            points: [
                "ALPHA": reportingPoint(code: "ALPHA", en: "Alpha", he: nil, lon: 34.8),
                "TAVOR": reportingPoint(code: "TAVOR", en: "Tavor", he: "תבור", lon: 35.0),
            ]
        )
    }

    @Test func theReportWindowReachesThePassageThroughTheBuilder() {
        let f = Self.lateReportFixture()
        let builtIn = CVFRDebriefBuilder.build(
            trackPoints: f.track, transcript: f.transcript, plannedLegs: nil, segments: f.segments, points: f.points)
        #expect(builtIn.points.first { $0.code == "TAVOR" }?.reported == false)
        let widened = CVFRDebriefBuilder.build(
            trackPoints: f.track, transcript: f.transcript, plannedLegs: nil, segments: f.segments, points: f.points,
            reportWindow: 300)
        #expect(widened.points.first { $0.code == "TAVOR" }?.reported == true)
    }

    @Test func theReportWindowReachesThePassageThroughTheLoader() throws {
        let f = Self.lateReportFixture()
        let path = NSTemporaryDirectory() + "cvfr-window-\(UUID()).sqlite"
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: path))
        for point in f.track { try db.insertTrackPoint(point) }
        for segment in f.transcript { try db.insertTranscript(segment) }
        var israel = MockIsraelAviationDatabase()
        israel.segments = f.segments
        israel.points = Array(f.points.values)

        let builtIn = try #require(try CVFRDebriefLoader.load(flightID: Self.flightID, recordingDB: db, israelDB: israel))
        #expect(builtIn.points.first { $0.code == "TAVOR" }?.reported == false)
        let widened = try #require(try CVFRDebriefLoader.load(
            flightID: Self.flightID, recordingDB: db, israelDB: israel, reportWindow: 300))
        #expect(widened.points.first { $0.code == "TAVOR" }?.reported == true)
        try db.deleteFlightData(flightID: Self.flightID)
    }

    // MARK: Hebrew and English text

    @Test func hebrewMatchingIgnoresNiqqudAndFinalLetterForms() {
        let point = Self.reportingPoint(code: "YRCHM", en: "Yeroham", he: "ירוחם", lon: 34.9)
        #expect(TranscriptTextMatcher.mentions(point: point, in: "מעל יְרוֹחָם בגובה אלף וחמש מאות"))
        // Final mem written in its medial form (a recogniser slip) still matches.
        #expect(TranscriptTextMatcher.mentions(point: point, in: "מעל ירוחמ עכשיו"))
        // Maqaf and punctuation are word separators.
        #expect(TranscriptTextMatcher.mentions(point: point, in: "דיווח־ירוחם, אלפא"))
        #expect(!TranscriptTextMatcher.mentions(point: point, in: "מעל ירוחמים"))
    }

    @Test func englishMatchingIsCaseInsensitiveByWholeWordAndAcceptsTheCode() {
        let point = Self.reportingPoint(code: "AFFEK", en: "Afek", he: "אפק", lon: 35.1)
        #expect(TranscriptTextMatcher.mentions(point: point, in: "passing AFEK at one thousand five hundred"))
        #expect(TranscriptTextMatcher.mentions(point: point, in: "affek, 4X-ABC"))
        #expect(!TranscriptTextMatcher.mentions(point: point, in: "the afeka tower"))
    }

    @Test func vocabularyListsHebrewAndEnglishNamesOnceAndSkipsAerodromes() {
        let points = [
            Self.reportingPoint(code: "AFFEK", en: "Afek", he: "אפק", lon: 35.1),
            Self.reportingPoint(code: "AFFE2", en: "Afek", he: "אפק", lon: 35.2),
            IsraelReportingPoint(id: 3, code: "LLHZ", nameEnglish: "Herzliya", nameHebrew: "הרצליה", kind: .arp, latitude: 32.18, longitude: 34.83),
        ]
        #expect(TranscriptTextMatcher.vocabulary(for: points) == ["Afek", "אפק"])
    }

    // MARK: Plan legs and the database

    @Test func storedLegsResolveToTheFlownDirection() throws {
        let segments = [Self.segment(1, "A", "B", lon0: 34.8, lon1: 35.0)]
        let resolved = try #require(CVFRDebriefLoader.resolve(legs: [("A", "B"), ("B", "A")], segments: segments))
        #expect(resolved.map(\.forward) == [true, false])
        #expect(CVFRDebriefLoader.resolve(legs: [], segments: segments) == nil)
        #expect(CVFRDebriefLoader.resolve(legs: [("A", "Z")], segments: segments) == nil)
    }

    @Test func routeLegsRoundTripThroughTheRecordingDatabase() throws {
        let path = NSTemporaryDirectory() + "cvfr-legs-\(UUID()).sqlite"
        let db = try RecordingDatabase(dbPool: try DatabasePool(path: path))
        let id = UUID()
        try db.saveRouteLegs([("LLHZ", "AAAAA"), ("AAAAA", "LLIB")], forFlight: id)
        let stored = try db.routeLegs(forFlight: id).map { "\($0.from)>\($0.to)" }
        #expect(stored == ["LLHZ>AAAAA", "AAAAA>LLIB"])
        try db.saveRouteLegs([("LLIB", "LLHZ")], forFlight: id)   // replaced, not appended
        #expect(try db.routeLegs(forFlight: id).count == 1)
        try db.deleteFlightData(flightID: id)
        #expect(try db.routeLegs(forFlight: id).isEmpty)
    }

    // MARK: Observations and prompt facts

    @Test func debriefObservationsAndPromptFactsComeFromTheNumbers() throws {
        let segments = [Self.segment(1, "ALPHA", "BRAVO", lon0: 34.8, lon1: 35.2)]
        let points = [
            "ALPHA": Self.reportingPoint(code: "ALPHA", en: "Alpha", he: nil, lon: 34.8),
            "BRAVO": Self.reportingPoint(code: "BRAVO", en: "Bravo", he: "ברבו", lon: 35.2),
        ]
        // 300 ft too high all the way: 0% within 200, 100% within 300.
        let track = Self.eastbound(lon0: 34.8, lon1: 35.2, count: 100) { _ in 1800 }
        let debrief = CVFRDebriefBuilder.build(
            trackPoints: track, transcript: [Self.transcript("ברבו, אלפא", at: 99)],
            plannedLegs: nil, segments: segments, points: points)
        #expect(!debrief.fromPlan)
        #expect(debrief.legs.count == 1)
        #expect(debrief.legs[0].adherence?.fractionWithin200 == 0)
        #expect(debrief.legs[0].adherence?.fractionWithin300 == 1)
        #expect(debrief.points.map(\.code) == ["ALPHA", "BRAVO"])
        let bravo = debrief.points.first { $0.code == "BRAVO" }
        #expect(bravo?.reported == true)
        #expect(debrief.observations.count >= 2 && debrief.observations.count <= 3)
        let facts = try #require(CVFRDebriefBuilder.promptFacts(debrief))
        #expect(facts.contains("Leg ALPHA-BRAVO published 1500: 0% within 200ft, 100% within 300ft, max deviation 300ft"))
        #expect(facts.contains("Point BRAVO"))
        #expect(facts.contains("position report heard"))
    }

    @Test func aFlightWithNoTranscriptSaysTheRadioWasNotCheckedInsteadOfNoneHeard() throws {
        let segments = [Self.segment(1, "ALPHA", "BRAVO", lon0: 34.8, lon1: 35.2)]
        let points = [
            "ALPHA": Self.reportingPoint(code: "ALPHA", en: "Alpha", he: nil, lon: 34.8),
            "BRAVO": Self.reportingPoint(code: "BRAVO", en: "Bravo", he: "ברבו", lon: 35.2),
        ]
        let track = Self.eastbound(lon0: 34.8, lon1: 35.2, count: 100) { _ in 1500 }
        let debrief = CVFRDebriefBuilder.build(
            trackPoints: track, transcript: [], plannedLegs: nil, segments: segments, points: points)

        #expect(!debrief.transcriptAvailable)
        #expect(debrief.observations.contains { $0.contains("could not be checked") })
        #expect(!debrief.observations.contains { $0.contains("heard at") || $0.contains("none heard") })
        let facts = try #require(CVFRDebriefBuilder.promptFacts(debrief))
        #expect(facts.contains("not checked (no transcript)"))
        #expect(!facts.contains("not heard"))
    }

    @MainActor
    @Test func promptCarriesTheCVFRFactsAndUSFlightsAreUnchanged() {
        let meta = FlightMetadata(aircraftType: nil, pilotName: nil, departureICAO: "LLHZ", arrivalICAO: "LLIB", date: Self.t0, durationSeconds: 600)
        let plain = FlightSummaryBuilder.buildPrompt(trackPoints: [], transcriptSegments: [], phaseMarkers: [], metadata: meta)
        let withNil = FlightSummaryBuilder.buildPrompt(trackPoints: [], transcriptSegments: [], phaseMarkers: [], metadata: meta, cvfrFacts: nil)
        #expect(plain == withNil)
        #expect(!plain.contains("CVFR"))
        let with = FlightSummaryBuilder.buildPrompt(trackPoints: [], transcriptSegments: [], phaseMarkers: [], metadata: meta, cvfrFacts: "[CVFR ROUTE] Leg A-B")
        #expect(with.contains("[CVFR ROUTE] Leg A-B"))
    }

    // MARK: Unrolled profile and verdict

    private static let alpha = reportingPoint(code: "ALPHA", en: "Alpha", he: "אלפא", lon: 34.8)
    private static let bravo = reportingPoint(code: "BRAVO", en: "Bravo", he: "ברבו", lon: 35.0)
    private static let charlie = reportingPoint(code: "CHARL", en: "Charlie", he: "צ'רלי", lon: 35.2)

    /// ALPHA -> BRAVO -> CHARL eastbound on lat 32.0 (published 1500 both legs), flown at 1 Hz for 400 s; BRAVO is
    /// passed at about 200 s. `altitude` is per sample index, feet MSL.
    private static func threePointDebrief(
        transcript: [TranscriptSegmentRecord], altitude: @escaping (Int) -> Double = { _ in 1500 }
    ) -> CVFRDebrief {
        let legs = [
            CVFRRouteLeg(segment: segment(1, "ALPHA", "BRAVO", lon0: 34.8, lon1: 35.0), forward: true),
            CVFRRouteLeg(segment: segment(2, "BRAVO", "CHARL", lon0: 35.0, lon1: 35.2), forward: true),
        ]
        return CVFRDebriefBuilder.build(
            trackPoints: eastbound(lon0: 34.8, lon1: 35.2, count: 400, altitude: altitude),
            transcript: transcript, plannedLegs: legs, segments: legs.map(\.segment),
            points: ["ALPHA": alpha, "BRAVO": bravo, "CHARL": charlie]
        )
    }

    @Test func profileDistancesAreMonotonicAndCumulativeAcrossLegs() throws {
        let debrief = Self.threePointDebrief(transcript: [])
        let legLength = IsraelRoutePlanner.length(of: [Self.coordinate(32.0, 34.8), Self.coordinate(32.0, 35.0)])   // NM
        #expect(debrief.legs.count == 2)
        #expect(debrief.legs[0].startDistanceNM == 0)
        #expect(abs(debrief.legs[0].endDistanceNM - legLength) < 1e-9)
        #expect(debrief.legs[1].startDistanceNM == debrief.legs[0].endDistanceNM)
        #expect(abs(debrief.legs[1].endDistanceNM - 2 * legLength) < 1e-9)

        #expect(debrief.profile.count == 400)
        let distances = debrief.profile.map(\.distanceNM)
        #expect(zip(distances, distances.dropFirst()).allSatisfy { $0 <= $1 })
        let first = try #require(distances.first), last = try #require(distances.last)
        #expect(first < 0.01)
        #expect(abs(last - 2 * legLength) < 0.01)
        // Leg 2's samples sit beyond leg 1's length: the axis is cumulative, not per leg.
        let second = debrief.profile.filter { $0.legIndex == 1 }
        #expect(!second.isEmpty)
        #expect(second.allSatisfy { $0.distanceNM >= legLength - 1e-9 && $0.distanceNM <= 2 * legLength + 1e-9 })
        #expect(debrief.profile.allSatisfy { !$0.excluded })   // no aerodrome on this route
    }

    @Test func profileSamplesInsideAnAerodromeZoneAreExcluded() {
        let legs = [
            CVFRRouteLeg(segment: Self.segment(1, "LLHZ", "ALPHA", lon0: 34.8, lon1: 35.0), forward: true),
            CVFRRouteLeg(segment: Self.segment(2, "ALPHA", "BRAVO", lon0: 35.0, lon1: 35.2), forward: true),
        ]
        let debrief = CVFRDebriefBuilder.build(
            trackPoints: Self.eastbound(lon0: 34.8, lon1: 35.2, count: 400), transcript: [],
            plannedLegs: legs, segments: legs.map(\.segment), points: [:])
        let excluded = debrief.profile.filter(\.excluded)
        #expect(!excluded.isEmpty)
        // Only the first 3 NM of the leg leaving LLHZ; the en-route leg is scored throughout.
        #expect(excluded.allSatisfy { $0.legIndex == 0 && $0.distanceNM < CVFRDebriefBuilder.aerodromeExclusionNM + 0.05 })
        let scoredOnFirstLeg = debrief.profile.filter { $0.legIndex == 0 && !$0.excluded }
        #expect(!scoredOnFirstLeg.isEmpty)
        #expect(scoredOnFirstLeg.allSatisfy { $0.distanceNM > CVFRDebriefBuilder.aerodromeExclusionNM - 0.05 })
        #expect(debrief.profile.filter { $0.legIndex == 1 }.allSatisfy { !$0.excluded })
    }

    @Test func aPointSitsAtItsLegBoundaryAlongTheRoute() throws {
        let debrief = Self.threePointDebrief(transcript: [])
        try #require(debrief.points.map(\.code) == ["ALPHA", "BRAVO", "CHARL"])
        #expect(debrief.points[0].distanceAlongRouteNM == 0)
        #expect(debrief.points[1].distanceAlongRouteNM == debrief.legs[0].endDistanceNM)
        #expect(debrief.points[2].distanceAlongRouteNM == debrief.legs[1].endDistanceNM)
        // The passage itself is still the closest approach, not the axis position.
        #expect(debrief.points[1].distanceNM < 0.1)
    }

    @Test func verdictPicksTheLowLegAndTheReportNotHeard() {
        // Leg 2 flown 330 ft low for 120 samples (250...369 s): 40% within ±300 ft. CHARL never named on the radio.
        let debrief = Self.threePointDebrief(
            transcript: [Self.transcript("Alpha, four x-ray", at: 0), Self.transcript("Bravo, four x-ray", at: 200)],
            altitude: { (250..<370).contains($0) ? 1170 : 1500 })
        #expect(debrief.points.first { $0.code == "BRAVO" }?.reportTime == Self.t0.addingTimeInterval(200))
        let findings = CVFRDebriefVerdict.findings(debrief)
        #expect(findings == ["BRAVO to CHARL: 330 ft low, 2 min", "CHARL report not heard"])
        #expect(CVFRDebriefVerdict.headline(count: findings.count) == "Two things to look at.")
        let excursions = CVFRDebriefBuilder.excursions(in: debrief)
        #expect(excursions.count == 1)
        #expect(excursions.first?.legIndex == 1)
        #expect(excursions.first?.seconds == 119)
    }

    @Test func verdictIsEmptyWhenEveryLegHeldAndEveryReportWasHeard() {
        let debrief = Self.threePointDebrief(transcript: [
            Self.transcript("Alpha", at: 0), Self.transcript("Bravo", at: 200), Self.transcript("Charlie", at: 399),
        ])
        #expect(CVFRDebriefVerdict.findings(debrief).isEmpty)
        #expect(CVFRDebriefVerdict.headline(count: 0) == "Nothing to look at.")
        // Without a transcript nothing is "not heard": the radio was not checked.
        #expect(CVFRDebriefVerdict.findings(Self.threePointDebrief(transcript: [])).isEmpty)
    }

    // MARK: Bundled network

    @Test func plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes() throws {
        let database = try IsraelAviationDatabase.bundled()
        let points = try database.reportingPoints(in: .wholeCountry)
        let segments = try database.routeSegments(in: .wholeCountry)
        let plan = try IsraelRoutePlanner(points: points, segments: segments, closures: [:])
            .route(from: "LLHZ", to: "LLIB", cruiseSpeedKnots: 90)

        // Fly the planned polyline at 1 Hz, 150 ft above the (first) published number on every leg.
        var track: [TrackPointRecord] = []
        var second = 0.0
        for leg in plan.legs {
            let published = CVFRDebriefBuilder.publishedAltitudes(leg.altitudeText).first ?? 1500
            for (a, b) in zip(leg.polyline, leg.polyline.dropFirst()) {
                let steps = max(1, Int(IsraelRoutePlanner.haversineNM(a, b) * 10))
                for step in 0..<steps {
                    let f = Double(step) / Double(steps)
                    track.append(Self.point(lat: a.latitude + (b.latitude - a.latitude) * f,
                                            lon: a.longitude + (b.longitude - a.longitude) * f,
                                            altitude: published + 150, second: second,
                                            course: leg.bearingTrue))
                    second += 1
                }
            }
        }
        var byCode: [String: IsraelReportingPoint] = [:]
        for p in points where byCode[p.code] == nil { byCode[p.code] = p }

        let planned = plan.legs.map { CVFRRouteLeg(segment: $0.segment, forward: $0.forward) }
        let debrief = CVFRDebriefBuilder.build(trackPoints: track, transcript: [], plannedLegs: planned, segments: segments, points: byCode)
        #expect(debrief.fromPlan)
        #expect(debrief.legs.count == plan.legs.count)
        for leg in debrief.legs {
            guard let adherence = leg.adherence else { continue }
            let name = "\(leg.fromCode)-\(leg.toCode) \(leg.publishedAltitude ?? "-") \(leg.startTime.timeIntervalSince(Self.t0))s"
            #expect(adherence.fractionWithin200 == 1, Comment(rawValue: name))
            #expect(adherence.maxDeviationFeet <= 150 + 1e-9, Comment(rawValue: name))
        }
        #expect(debrief.points.first?.code == "LLHZ")
        #expect(debrief.points.last?.code == "LLIB")
        let allClose = debrief.points.allSatisfy { $0.distanceNM < 0.5 }
        #expect(allClose)

        // The same track without the plan matches the same network.
        let unplanned = CVFRDebriefBuilder.build(trackPoints: track, transcript: [], plannedLegs: nil, segments: segments, points: byCode)
        #expect(!unplanned.legs.isEmpty)
        #expect(!unplanned.fromPlan)
    }
}
