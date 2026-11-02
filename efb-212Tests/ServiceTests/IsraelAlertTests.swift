//
//  IsraelAlertTests.swift
//  efb-212Tests
//
//  Israel in-flight alerts (IL-ALERTS): closed legs ahead, P/R/D and CTR entry on the 2-minute projection,
//  border buffers and the 33 N rule, the squawk reminder, and the service's region gate, throttle and hold.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

struct IsraelAlertEvaluatorTests {

    private static let center = CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)

    /// A square of half-side `halfDegrees` degrees around `center`.
    private static func square(_ center: CLLocationCoordinate2D = center, halfDegrees: Double = 0.05) -> [[[CLLocationCoordinate2D]]] {
        let ring = [
            CLLocationCoordinate2D(latitude: center.latitude - halfDegrees, longitude: center.longitude - halfDegrees),
            CLLocationCoordinate2D(latitude: center.latitude - halfDegrees, longitude: center.longitude + halfDegrees),
            CLLocationCoordinate2D(latitude: center.latitude + halfDegrees, longitude: center.longitude + halfDegrees),
            CLLocationCoordinate2D(latitude: center.latitude + halfDegrees, longitude: center.longitude - halfDegrees),
        ]
        return [[ring]]
    }

    private static func area(
        _ id: Int, _ kind: IsraelAirspaceKind, code: String? = nil, name: String? = nil,
        authority: IsraelAirspaceAuthority? = .civil, ceiling: Int = 3000, at center: CLLocationCoordinate2D = center
    ) -> IsraelAirspace {
        IsraelAirspace(
            id: id, kind: kind, code: code ?? "LL\(id)", nameEnglish: name, nameHebrew: nil, label: nil, authority: authority,
            floor: IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil),
            ceiling: IsraelAirspaceLimit(feet: ceiling, reference: .msl, publishedText: nil),
            polygons: square(center)
        )
    }

    private static func alerts(
        at position: CLLocationCoordinate2D, altitude: Double? = 2000, track: Double = 0, groundSpeed: Double = 0,
        _ airspaces: [IsraelAirspace],
        ctr: @escaping (String) -> (name: String, twr: String?)? = { _ in nil }
    ) -> [IsraelAlert] {
        IsraelAlertEvaluator.airspaceAlerts(
            position: position, altitudeFeet: altitude, trackTrue: track, groundSpeedKnots: groundSpeed,
            airspaces: airspaces, ctrContact: ctr
        )
    }

    // MARK: Projection

    @Test func projectionIsGroundSpeedTimesTwoMinutesAlongTheTrack() throws {
        let north = try #require(IsraelAlertEvaluator.projectedPosition(from: Self.center, trackTrue: 0, groundSpeedKnots: 120))
        #expect(abs((north.latitude - Self.center.latitude) * 60 - 4) < 0.01)  // 120 kt x 2 min = 4 NM
        #expect(abs(north.longitude - Self.center.longitude) < 1e-9)

        let east = try #require(IsraelAlertEvaluator.projectedPosition(from: Self.center, trackTrue: 90, groundSpeedKnots: 120))
        let eastNM = (east.longitude - Self.center.longitude) * 60 * cos(Self.center.latitude * .pi / 180)
        #expect(abs(eastNM - 4) < 0.01)

        #expect(IsraelAlertEvaluator.projectedPosition(from: Self.center, trackTrue: 0, groundSpeedKnots: 10) == nil)
    }

    // MARK: P / R / D and CTR

    @Test func insideAProhibitedAreaWithinItsVerticalLimitsIsRed() {
        let result = Self.alerts(at: Self.center, [Self.area(1, .prohibited, code: "LLP04", name: "Haifa Oil Refinery")])
        #expect(result.count == 1)
        #expect(result.first?.severity == .warning)
        #expect(result.first?.title.contains("Inside prohibited area LLP04") == true)
    }

    @Test func aboveAProhibitedAreaCeilingRaisesNothing() {
        #expect(Self.alerts(at: Self.center, altitude: 3500, [Self.area(1, .prohibited, ceiling: 3000)]).isEmpty)
    }

    @Test func unknownAltitudeNeverRaisesARedInside() {
        let result = Self.alerts(at: Self.center, altitude: nil, [Self.area(1, .prohibited)])
        #expect(result.count == 1)
        #expect(result.first?.severity == .caution)
    }

    @Test func projectedEntryIntoAProhibitedAreaIsAmber() {
        // 5 NM south of the centre, area half-side 3 NM: 2 NM outside; 120 kt north puts the 2-min point 1 NM inside.
        let position = CLLocationCoordinate2D(latitude: Self.center.latitude - 5.0 / 60, longitude: Self.center.longitude)
        let result = Self.alerts(at: position, track: 0, groundSpeed: 120, [Self.area(1, .prohibited, code: "LLP09")])
        #expect(result.count == 1)
        #expect(result.first?.severity == .caution)
        #expect(result.first?.title.contains("Entering prohibited area LLP09") == true)
    }

    @Test func noProjectionWhenMovingAwayOrSlow() {
        let position = CLLocationCoordinate2D(latitude: Self.center.latitude - 5.0 / 60, longitude: Self.center.longitude)
        #expect(Self.alerts(at: position, track: 180, groundSpeed: 120, [Self.area(1, .prohibited)]).isEmpty)
        #expect(Self.alerts(at: position, track: 0, groundSpeed: 10, [Self.area(1, .prohibited)]).isEmpty)
    }

    @Test func restrictedAndDangerAreasAreAmberNeverRed() {
        let restricted = Self.alerts(at: Self.center, [Self.area(1, .restricted, code: "LLR1")])
        let danger = Self.alerts(at: Self.center, [Self.area(2, .danger, code: "LLD1")])
        #expect(restricted.first?.severity == .caution)
        #expect(danger.first?.severity == .caution)
        #expect(restricted.first?.kind == .restricted)
    }

    @Test func ctrEntryIsAnAmberReminderWithTheTowerFrequency() {
        let position = CLLocationCoordinate2D(latitude: Self.center.latitude - 5.0 / 60, longitude: Self.center.longitude)
        let ctr = Self.area(1, .ctr, code: "LLHZ")
        let result = Self.alerts(at: position, track: 0, groundSpeed: 120, [ctr], ctr: { _ in ("Herzliya", "TWR 122.2") })
        #expect(result.count == 1)
        #expect(result.first?.severity == .caution)
        #expect(result.first?.title == "Entering Herzliya CTR: contact TWR 122.2")
    }

    @Test func ctrWithNoKnownContactSaysGetClearance() {
        let result = Self.alerts(at: Self.center, [Self.area(1, .ctr, code: "LLXX")])
        #expect(result.first?.title.hasSuffix("get clearance") == true)
    }

    @Test func militaryAreasAreFlagged() {
        let result = Self.alerts(at: Self.center, [Self.area(1, .restricted, authority: .military)])
        #expect(result.first?.detail?.contains("MIL") == true)
        let civil = Self.alerts(at: Self.center, [Self.area(2, .restricted, authority: .civil)])
        #expect(civil.first?.detail?.contains("MIL") == false)
    }

    @Test func gazaAreaIsLeftToTheBorderEvaluatorAndOtherKindsAreIgnored() {
        let gaza = Self.area(1, .prohibited, code: IsraelBorderBuffers.gazaAreaCode)
        let tma = Self.area(2, .tma)
        #expect(Self.alerts(at: Self.center, [gaza, tma]).isEmpty)
    }

    @Test func ctrNamesDropTheRegisterDecoration() {
        #expect(IsraelAlertEvaluator.shortAerodromeName("Herzliya (Modi Alon) Airport") == "Herzliya")
        #expect(IsraelAlertEvaluator.shortAerodromeName("Haifa Airport") == "Haifa")
        #expect(IsraelAlertEvaluator.shortAerodromeName("Rosh Pina") == "Rosh Pina")
        #expect(IsraelAlertEvaluator.shortAerodromeName("Airport") == "Airport")
    }

    @Test func towerContactTrimsTrailingZeros() {
        func aerodrome(_ frequencies: [IsraelAerodromeFrequency]) -> IsraelAerodrome {
            IsraelAerodrome(
                id: 1, code: "LLHZ", nameHebrew: "", nameEnglish: "Herzliya", type: .airport, use: .civil,
                latitude: 32.18, longitude: 34.83, elevationFeet: nil, circuitAltitudeFeet: nil, circuitDirection: nil,
                hours: nil, ppr: .unknown, pprText: nil, remarks: nil,
                sources: IsraelAerodromeSources(identity: "test", runways: nil, frequencies: nil, circuit: nil, hours: nil, remarks: nil),
                uncertainGroups: [], notes: nil, reviewStatus: .reviewed, runways: [], frequencies: frequencies
            )
        }
        let tower = IsraelAerodromeFrequency(id: 1, mhz: "122.200", service: "TWR primary", callsignHebrew: nil)
        let ground = IsraelAerodromeFrequency(id: 2, mhz: "121.900", service: "GND", callsignHebrew: nil)
        #expect(IsraelAlertEvaluator.towerContact(of: aerodrome([ground, tower])) == "TWR 122.2")
        #expect(IsraelAlertEvaluator.towerContact(of: aerodrome([ground])) == nil)
    }

    // MARK: Closed legs

    private static func route(currentLeg: Int = 0) -> ActiveRoute {
        let legs = [
            ActiveRouteLeg(segmentID: 10, fromCode: "AAAAA", toCode: "BBBBB", toLatitude: 32.3, toLongitude: 34.8, altitudeText: "2500", distanceNM: 18),
            ActiveRouteLeg(segmentID: 11, fromCode: "BBBBB", toCode: "CCCCC", toLatitude: 32.3, toLongitude: 35.1, altitudeText: "3500", distanceNM: 15),
        ]
        var route = ActiveRoute(legs: legs)
        route.currentLeg = currentLeg
        return route
    }

    @Test func fullClosureOnALegAheadIsRedAndPartialIsAmber() {
        let full = IsraelChartClosureMark(notamID: "C1/26", text: "CLSD to 13:30Z", schedule: nil, severity: .full)
        let partial = IsraelChartClosureMark(notamID: "C2/26", text: "CLSD 2500 \u{00B7} AVBL 3000", schedule: nil, severity: .partial)

        let red = IsraelAlertEvaluator.closureAlerts(route: Self.route(), marks: [11: full])
        #expect(red.count == 1)
        #expect(red.first?.severity == .warning)
        #expect(red.first?.title == "Route closed ahead: BBBBB \u{2192} CCCCC")

        let amber = IsraelAlertEvaluator.closureAlerts(route: Self.route(), marks: [10: partial])
        #expect(amber.first?.severity == .caution)
        #expect(amber.first?.detail?.contains("AVBL 3000") == true)
    }

    @Test func aClosureBehindTheCurrentLegIsNotRaised() {
        let full = IsraelChartClosureMark(notamID: "C1/26", text: "CLSD", schedule: nil, severity: .full)
        #expect(IsraelAlertEvaluator.closureAlerts(route: Self.route(currentLeg: 1), marks: [10: full]).isEmpty)
        #expect(IsraelAlertEvaluator.closureAlerts(route: Self.route(currentLeg: 0), marks: [10: full]).count == 1)
    }

    @Test func noMarksOrNoRouteRaisesNothing() {
        let full = IsraelChartClosureMark(notamID: "C1/26", text: "CLSD", schedule: nil, severity: .full)
        #expect(IsraelAlertEvaluator.closureAlerts(route: Self.route(), marks: [:]).isEmpty)
        #expect(IsraelAlertEvaluator.closureAlerts(route: nil, marks: [10: full]).isEmpty)
    }

    @Test func anUnreadClosureSaysCheckNotamInAmber() {
        let check = IsraelChartClosureMark(notamID: "C3/26", text: "CHECK NOTAM", schedule: nil, severity: .check)
        let result = IsraelAlertEvaluator.closureAlerts(route: Self.route(), marks: [10: check])
        #expect(result.first?.severity == .caution)
        #expect(result.first?.title.hasPrefix("Check NOTAM") == true)
    }

    // MARK: Border buffers

    /// A north-south "Syria" line at 35.80E from 32.7N to 33.4N, 6 km (3.24 NM) buffer.
    private static let buffers = IsraelBorderBuffers(
        source: "test",
        borders: [.init(name: "Syria", bufferKm: 6, lines: [[[32.7, 35.80], [33.4, 35.80]]])]
    )

    private static func borderAlerts(
        lat: Double = 32.8, westNM: Double, track: Double = 0, groundSpeed: Double = 0, gaza: [[[Double]]] = []
    ) -> [IsraelAlert] {
        let lon = 35.80 - westNM / (60 * cos(lat * .pi / 180))
        return IsraelAlertEvaluator.borderAlerts(
            position: CLLocationCoordinate2D(latitude: lat, longitude: lon), trackTrue: track,
            groundSpeedKnots: groundSpeed, buffers: buffers, gazaRings: gaza
        )
    }

    @Test func insideABorderBufferIsRed() {
        let result = Self.borderAlerts(westNM: 2)
        #expect(result.count == 1)
        #expect(result.first?.severity == .warning)
        #expect(result.first?.title.contains("Syria") == true)
    }

    @Test func withinOneMileOutsideABufferIsAmberAndFurtherIsQuiet() {
        // Buffer edge at 3.24 NM: 4.0 NM is 0.76 NM outside (amber); 6.0 NM is 2.76 NM outside (nothing).
        #expect(Self.borderAlerts(westNM: 4.0).first?.severity == .caution)
        #expect(Self.borderAlerts(westNM: 6.0).isEmpty)
    }

    @Test func projectedEntryIntoABufferIsAmber() {
        // 6 NM from the line heading east at 150 kt: 5 NM in 2 min leaves 1 NM to the line, inside the buffer.
        let result = Self.borderAlerts(westNM: 6.0, track: 90, groundSpeed: 150)
        #expect(result.first?.severity == .caution)
        #expect(result.first?.title.contains("enters Syria") == true)
        // The same fix flying away raises nothing.
        #expect(Self.borderAlerts(westNM: 6.0, track: 270, groundSpeed: 150).isEmpty)
    }

    @Test func gazaUsesThePAreaPolygon() {
        let ring: [[Double]] = [[31.2, 34.2], [31.2, 34.6], [31.6, 34.6], [31.6, 34.2]]
        func result(lat: Double, lon: Double) -> [IsraelAlert] {
            IsraelAlertEvaluator.borderAlerts(
                position: CLLocationCoordinate2D(latitude: lat, longitude: lon), trackTrue: 0, groundSpeedKnots: 0,
                buffers: nil, gazaRings: [ring]
            )
        }
        #expect(result(lat: 31.4, lon: 34.4).first?.severity == .warning)
        #expect(result(lat: 31.4, lon: 34.4).first?.title.contains("Gaza") == true)
        // 0.5 NM east of the polygon: amber.
        #expect(result(lat: 31.4, lon: 34.6 + 0.5 / (60 * cos(31.4 * .pi / 180))).first?.severity == .caution)
        // 10 NM away: nothing.
        #expect(result(lat: 31.4, lon: 34.9).isEmpty)
    }

    @Test func northOf33IsAnAmberEquipmentReminderNeverRed() {
        let north = IsraelAlertEvaluator.borderAlerts(
            position: CLLocationCoordinate2D(latitude: 33.1, longitude: 35.4), trackTrue: 0, groundSpeedKnots: 0,
            buffers: nil, gazaRings: []
        )
        #expect(north.first?.id == "north-33")
        #expect(north.first?.severity == .caution)

        // 3 NM south of the line, 120 kt north: the 2-minute point is 1 NM north of it.
        let crossing = IsraelAlertEvaluator.borderAlerts(
            position: CLLocationCoordinate2D(latitude: 33.0 - 3.0 / 60, longitude: 35.4), trackTrue: 0, groundSpeedKnots: 120,
            buffers: nil, gazaRings: []
        )
        #expect(crossing.first?.title.contains("crosses") == true)

        let south = IsraelAlertEvaluator.borderAlerts(
            position: CLLocationCoordinate2D(latitude: 32.5, longitude: 35.4), trackTrue: 0, groundSpeedKnots: 0,
            buffers: nil, gazaRings: []
        )
        #expect(south.isEmpty)
    }

    @Test func theBundledBorderFileDecodesWithTheThreeBuffers() throws {
        let url = try #require(Bundle(for: BundleToken.self).url(forResource: "israel-border-lines", withExtension: "json")
                               ?? Bundle.main.url(forResource: "israel-border-lines", withExtension: "json"))
        let buffers = try IsraelBorderBuffers(data: Data(contentsOf: url))
        #expect(Dictionary(uniqueKeysWithValues: buffers.borders.map { ($0.name, $0.bufferKm) }) == ["Egypt": 3, "Syria": 6, "Lebanon": 3])
        #expect(buffers.borders.allSatisfy { !$0.lines.isEmpty })
        // A point on the Egypt line is inside its own buffer.
        let egypt = try #require(buffers.borders.first { $0.name == "Egypt" })
        let vertex = egypt.lines[0][0]
        let alerts = IsraelAlertEvaluator.borderAlerts(
            position: CLLocationCoordinate2D(latitude: vertex[0], longitude: vertex[1]), trackTrue: 0, groundSpeedKnots: 0,
            buffers: buffers, gazaRings: []
        )
        #expect(alerts.contains { $0.id == "border-Egypt" && $0.severity == .warning })
    }

    // MARK: Ordering

    @Test func redSortsBeforeAmberAndTheOrderIsStable() {
        let amber = IsraelAlert(id: "a", severity: .caution, kind: .ctr, title: "a", detail: nil)
        let red = IsraelAlert(id: "z", severity: .warning, kind: .closure, title: "z", detail: nil)
        let redBorder = IsraelAlert(id: "b", severity: .warning, kind: .border, title: "b", detail: nil)
        #expect(IsraelAlert.sorted([amber, red, redBorder]).map(\.id) == ["b", "z", "a"])
    }
}

private final class BundleToken {}

struct IsraelSquawkReminderTests {
    private static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func firesOnceWhenSpeedPasses40AfterBeingOnTheGround() {
        var reminder = IsraelSquawkReminder()
        let results = [
            reminder.update(groundSpeedKnots: 0, now: Self.t0),
            reminder.update(groundSpeedKnots: 30, now: Self.t0),
            reminder.update(groundSpeedKnots: 55, now: Self.t0.addingTimeInterval(20)),
            reminder.update(groundSpeedKnots: 90, now: Self.t0.addingTimeInterval(30)),
            reminder.update(groundSpeedKnots: 100, now: Self.t0.addingTimeInterval(300)),
        ]
        #expect(results == [false, false, true, false, false])
    }

    @Test func neverFiresForAFlightJoinedInTheAir() {
        var reminder = IsraelSquawkReminder()
        let a = reminder.update(groundSpeedKnots: 100, now: Self.t0)
        let b = reminder.update(groundSpeedKnots: 110, now: Self.t0.addingTimeInterval(10))
        #expect(!a && !b)
    }

    @Test func rearmsAfterTheNextStop() {
        var reminder = IsraelSquawkReminder()
        _ = reminder.update(groundSpeedKnots: 0, now: Self.t0)
        let first = reminder.update(groundSpeedKnots: 60, now: Self.t0.addingTimeInterval(10))
        #expect(first)
        _ = reminder.update(groundSpeedKnots: 5, now: Self.t0.addingTimeInterval(3600))
        let again = reminder.update(groundSpeedKnots: 60, now: Self.t0.addingTimeInterval(3700))
        #expect(again)
    }

    @Test func theReminderNamesCode5100AndExpiresAfterAMinute() throws {
        var reminder = IsraelSquawkReminder()
        _ = reminder.update(groundSpeedKnots: 0, now: Self.t0)
        _ = reminder.update(groundSpeedKnots: 60, now: Self.t0)
        let shown = try #require(reminder.alert(now: Self.t0.addingTimeInterval(30)))
        #expect(shown.title.contains("5100"))
        #expect(shown.severity == .caution)
        #expect(reminder.alert(now: Self.t0.addingTimeInterval(61)) == nil)
    }
}

@MainActor
struct IsraelAlertServiceTests {
    private static let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private static let center = CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)

    private static func service(areas: [IsraelAirspace]) -> IsraelAlertService {
        let database = MockIsraelAviationDatabase(airspaceList: areas)
        return IsraelAlertService(databaseProvider: { database }, notamFetcher: nil, borderBuffers: nil)
    }

    private static func prohibited() -> [IsraelAirspace] {
        [IsraelAlertEvaluatorTests_area()]
    }

    private static func fix(_ service: IsraelAlertService, region: Region = .israel, at coordinate: CLLocationCoordinate2D, speed: Double = 0, time: Date) {
        service.update(
            region: region, route: nil, position: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude),
            altitudeFeet: 2000, trackTrue: 0, groundSpeedKnots: speed, now: time
        )
    }

    private static let outside = CLLocationCoordinate2D(latitude: 32.0, longitude: 35.4)

    @Test func outsideIsraelNothingIsEvaluated() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, region: .us, at: Self.center, time: Self.t0)
        #expect(service.alerts.isEmpty)
    }

    @Test func raisesOnceAndCallsTheHapticOnlyForNewAlerts() {
        let service = Self.service(areas: Self.prohibited())
        var raisedCount = 0
        service.onRaised = { raisedCount += $0.count }
        Self.fix(service, at: Self.center, time: Self.t0)
        #expect(service.alerts.count == 1)
        #expect(raisedCount == 1)
        Self.fix(service, at: Self.center, time: Self.t0.addingTimeInterval(6))
        #expect(service.alerts.count == 1)
        #expect(raisedCount == 1)  // already showing: no second haptic
    }

    @Test func evaluationIsThrottledToOncePerFiveSeconds() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, at: Self.outside, time: Self.t0)
        #expect(service.alerts.isEmpty)
        Self.fix(service, at: Self.center, time: Self.t0.addingTimeInterval(2))  // inside, but inside the throttle window
        #expect(service.alerts.isEmpty)
        Self.fix(service, at: Self.center, time: Self.t0.addingTimeInterval(6))
        #expect(service.alerts.count == 1)
    }

    @Test func anAlertStaysUpForTenSecondsAfterItStopsApplying() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, at: Self.center, time: Self.t0)
        #expect(service.alerts.count == 1)
        Self.fix(service, at: Self.outside, time: Self.t0.addingTimeInterval(6))
        #expect(service.alerts.count == 1)  // held: 6 s since last seen
    }

    @Test func theHeldAlertClearsAfterTheHoldTime() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, at: Self.center, time: Self.t0)
        Self.fix(service, at: Self.outside, time: Self.t0.addingTimeInterval(11))
        #expect(service.alerts.isEmpty)
    }

    @Test func leavingIsraelClearsEverything() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, at: Self.center, time: Self.t0)
        #expect(!service.alerts.isEmpty)
        Self.fix(service, region: .us, at: Self.center, time: Self.t0.addingTimeInterval(1))
        #expect(service.alerts.isEmpty)
    }

    @Test func suspendingForALostFixDropsTheAlertsAndTheNextFixEvaluatesAtOnce() {
        let service = Self.service(areas: Self.prohibited())
        Self.fix(service, at: Self.center, time: Self.t0)
        #expect(!service.alerts.isEmpty)

        service.suspend()
        #expect(service.alerts.isEmpty)   // the last ones must not stay up as if current

        // One second later is inside the 5 s throttle, but a resumed fix is evaluated immediately.
        Self.fix(service, at: Self.center, time: Self.t0.addingTimeInterval(1))
        #expect(!service.alerts.isEmpty)
    }

    @Test func aClosureNewlyCoveringALegAheadRaisesOnceAndIsRedWhenFull() {
        func point(_ id: Int, _ code: String, lat: Double) -> IsraelReportingPoint {
            IsraelReportingPoint(id: id, code: code, nameEnglish: code, nameHebrew: nil, kind: .compulsory, latitude: lat, longitude: 34.9)
        }
        let a = point(1, "AAAAA", lat: 32.0), b = point(2, "BBBBB", lat: 32.3)
        var database = MockIsraelAviationDatabase()
        database.points = [a, b]
        database.segments = [IsraelRouteSegment(
            id: 5, fromCode: "AAAAA", toCode: "BBBBB", fromPointID: 1, toPointID: 2, nameEnglish: nil, nameHebrew: nil,
            lengthNM: 18, isCivil: true, isMilitary: false, isByRequest: false, bearingTrue: 0,
            altitudeForward: IsraelRouteAltitude(published: "2500", feet: 2500), altitudeReverse: nil,
            lowerAltitudeFeet: nil, mapSheet: nil, polyline: [a.coordinate, b.coordinate]
        )]
        let db = database
        let service = IsraelAlertService(databaseProvider: { db }, notamFetcher: nil, borderBuffers: nil)
        let route = ActiveRoute(legs: [
            ActiveRouteLeg(segmentID: 5, fromCode: "AAAAA", toCode: "BBBBB", toLatitude: 32.3, toLongitude: 34.9, altitudeText: "2500", distanceNM: 18)
        ])
        var raised: [IsraelAlert] = []
        service.onRaised = { raised += $0 }
        let here = CLLocation(latitude: 32.1, longitude: 34.9)

        // No closure yet.
        service.update(region: .israel, route: route, position: here, altitudeFeet: 2500, trackTrue: 0, groundSpeedKnots: 100, now: Self.t0)
        #expect(service.alerts.isEmpty)

        // The feed now closes AAAAA-BBBBB.
        let closure = IsraelRouteClosure(notamId: "C9/26", routeKind: "CVFR", routeName: nil, chain: ["AAAAA", "BBBBB"],
                                         validFrom: nil, validTo: nil, schedule: nil)
        service.setReport(
            IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: Self.t0, items: [], closures: [closure]), fetchedAt: Self.t0, refreshFailed: false),
            now: Self.t0.addingTimeInterval(6)
        )
        service.update(region: .israel, route: route, position: here, altitudeFeet: 2500, trackTrue: 0, groundSpeedKnots: 100, now: Self.t0.addingTimeInterval(6))
        #expect(service.alerts.first?.severity == .warning)
        #expect(service.alerts.first?.kind == .closure)
        #expect(raised.count == 1)

        // Still closed at the next evaluation: shown, not raised again.
        service.update(region: .israel, route: route, position: here, altitudeFeet: 2500, trackTrue: 0, groundSpeedKnots: 100, now: Self.t0.addingTimeInterval(12))
        #expect(service.alerts.count == 1)
        #expect(raised.count == 1)
    }

    @Test func theSquawkReminderAppearsOnDepartureAndOnlyOnce() {
        let service = Self.service(areas: [])
        var raised = 0
        service.onRaised = { raised += $0.filter { $0.id == "squawk" }.count }
        Self.fix(service, at: Self.outside, speed: 0, time: Self.t0)
        Self.fix(service, at: Self.outside, speed: 60, time: Self.t0.addingTimeInterval(6))
        #expect(service.alerts.contains { $0.id == "squawk" })
        Self.fix(service, at: Self.outside, speed: 90, time: Self.t0.addingTimeInterval(12))
        #expect(raised == 1)
    }
}

/// Shared P-area fixture for the service tests (the evaluator tests' helper is private to that suite).
private func IsraelAlertEvaluatorTests_area() -> IsraelAirspace {
    let center = CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)
    let h = 0.05
    let ring = [
        CLLocationCoordinate2D(latitude: center.latitude - h, longitude: center.longitude - h),
        CLLocationCoordinate2D(latitude: center.latitude - h, longitude: center.longitude + h),
        CLLocationCoordinate2D(latitude: center.latitude + h, longitude: center.longitude + h),
        CLLocationCoordinate2D(latitude: center.latitude + h, longitude: center.longitude - h),
    ]
    return IsraelAirspace(
        id: 1, kind: .prohibited, code: "LLP04", nameEnglish: "Haifa Oil Refinery", nameHebrew: nil, label: nil, authority: .civil,
        floor: IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil),
        ceiling: IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil),
        polygons: [[ring]]
    )
}
