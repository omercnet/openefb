//
//  IsraelNearestAndSearchTests.swift
//  efb-212Tests
//
//  IL-4 app paths: NRST lists landable Israeli aerodromes with PPR and NOTAM-closed flags, search finds
//  them by ICAO, English and Hebrew name, the adapter keeps units straight, and the sheet text for an
//  unreviewed field says so.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel NRST and Search Tests")
@MainActor
struct IsraelNearestAndSearchTests {

    // MARK: - Fixtures

    static func runway(_ designator: String, length: Double, width: Double = 30, surface: String = "asphalt") -> IsraelAerodromeRunway {
        IsraelAerodromeRunway(id: 1, designator: designator, lengthMetres: length, widthMetres: width, surface: surface,
                              headingA: 100, headingB: 280, headingIsTrue: true)
    }

    static func aerodrome(
        _ code: String, he: String = "שדה", lat: Double, lon: Double,
        type: IsraelAerodromeType = .airport, use: IsraelAerodromeUse = .civil, ppr: IsraelPPR = .no,
        runways: [IsraelAerodromeRunway] = [runway("10/28", length: 1000)], review: IsraelAerodromeReviewStatus = .unreviewed
    ) -> IsraelAerodrome {
        IsraelAerodrome(
            id: abs(code.hashValue % 10_000), code: code, nameHebrew: he, nameEnglish: "\(code) field", type: type, use: use,
            latitude: lat, longitude: lon, elevationFeet: 100, circuitAltitudeFeet: 800, circuitDirection: nil, hours: nil,
            ppr: ppr, pprText: nil, remarks: nil,
            sources: IsraelAerodromeSources(identity: "AIP 1/26 p1", runways: "AIP 1/26 p2", frequencies: nil, circuit: nil, hours: nil, remarks: nil),
            uncertainGroups: [], notes: nil, reviewStatus: review, runways: runways, frequencies: []
        )
    }

    /// Ownship near Herzliya.
    static let here = CLLocation(latitude: 32.18, longitude: 34.83)

    static func database() -> MockIsraelAviationDatabase {
        var db = MockIsraelAviationDatabase()
        db.aerodromeList = [
            aerodrome("LLHZ", he: "הרצליה", lat: 32.1794, lon: 34.8344),
            aerodrome("LLRS", he: "ראשון לציון", lat: 31.9675, lon: 34.7536, ppr: .yes, runways: [runway("18/36", length: 660, width: 9)]),
            aerodrome("ICHILOV", lat: 32.08, lon: 34.79, type: .heliport, use: .hospital, runways: [runway("08/26", length: 28, surface: "concrete")]),
            aerodrome("LLES", lat: 32.44, lon: 35.00, use: .uas),
            aerodrome("ULTRA", lat: 32.18, lon: 34.83, use: .ultralight),   // closest field of all, ultralight only
            aerodrome("GVULT", lat: 31.2275, lon: 34.4603, use: .agricultural, ppr: .yes, runways: []),
            aerodrome("LLEK", lat: 31.84, lon: 34.82, use: .military, runways: [runway("?", length: 2450, surface: "unknown")]),
            aerodrome("LLBG", he: "בן גוריון", lat: 32.0094, lon: 34.8856, runways: [runway("08/26", length: 4062, width: 45)]),
        ]
        return db
    }

    static func viewModel(
        region: Region = .israel,
        notams: (@Sendable () async throws -> IsraelNotamReport)? = nil,
        us: MockDatabaseManager = MockDatabaseManager()
    ) -> (NearestAirportViewModel, AppState) {
        let state = AppState()
        state.region = region
        let db = database()
        let vm = NearestAirportViewModel(appState: state, databaseService: us, israelDatabaseProvider: { db }, notamFetcher: notams)
        return (vm, state)
    }

    static func notam(id: String, text: String, from: Date? = nil, to: Date? = nil, cancelledBy: String? = nil, closures: [IsraelRouteClosure] = []) -> IsraelNotam {
        IsraelNotam(rowId: id, id: id, type: "NOTAMN", references: nil, location: "LLLL", locationDescription: nil, created: nil, q: nil,
                    a: "LLLL", validFrom: from, validTo: to, permanent: to == nil, estimated: false, d: nil, e: text, f: nil, g: nil,
                    geometry: IsraelNotamGeometry(polygon: nil, circle: nil), closures: closures, parsed: true,
                    cancelledBy: cancelledBy, replacedBy: nil, raw: text)
    }

    static func report(_ items: [IsraelNotam], generatedAt: Date) -> IsraelNotamReport {
        IsraelNotamReport(feed: IsraelNotamFeed(generatedAt: generatedAt, items: items, closures: []), fetchedAt: generatedAt, refreshFailed: false)
    }

    /// Poll until `condition` holds (the NOTAM fetch finishes on another task).
    static func eventually(_ condition: () -> Bool) async -> Bool {
        for _ in 0..<200 {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return condition()
    }

    // MARK: - NRST in Israel

    @Test func nrstListsLandableAerodromesNearestFirstAndSkipsTheRest() {
        let (vm, _) = Self.viewModel()
        vm.updateNearest(from: Self.here)
        let codes = vm.nearestAirports.map(\.airport.icao)
        #expect(codes == ["LLHZ", "LLBG", "LLRS"])   // heliport, UAS strip, no-runway strip and unknown-surface military field are dropped
        #expect(vm.nearestAirport?.icao == "LLHZ")
        let distances = vm.nearestAirports.map(\.distance)   // nautical miles
        #expect(distances == distances.sorted())
        #expect(abs(distances[0] - 0.1) < 0.2)
    }

    /// Adjudication rule 4: an ultralight-only strip (LLRS, LLEV) is never offered to conventional GA aircraft,
    /// even when it is the closest field with a runway.
    @Test func nrstExcludesUltralightOnlyStrips() {
        let (vm, _) = Self.viewModel()
        vm.updateNearest(from: Self.here)
        #expect(!vm.nearestAirports.map(\.airport.icao).contains("ULTRA"))
        #expect(vm.nearestAirport?.icao == "LLHZ")
        #expect(IsraelAerodromeAdapter.notLandableUses.contains(.ultralight))
    }

    @Test func theBundledUltralightStripsAreMarkedUltralightAndSkippedByNrst() throws {
        let db = try IsraelAviationDatabase.bundled()
        let rishon = try #require(try db.aerodrome(code: "LLRS"))
        let einVered = try #require(try db.aerodrome(code: "LLEV"))
        #expect(rishon.use == .ultralight && einVered.use == .ultralight)
        let vm = NearestAirportViewModel(appState: { let s = AppState(); s.region = .israel; return s }(),
                                         databaseService: MockDatabaseManager(), israelDatabaseProvider: { db })
        vm.updateNearest(from: CLLocation(latitude: 31.9675, longitude: 34.7536))   // on the LLRS reference point
        #expect(!vm.nearestAirports.map(\.airport.icao).contains("LLRS"))
        #expect(!vm.nearestAirports.map(\.airport.icao).contains("LLEV"))
        #expect(!vm.nearestAirports.isEmpty)
    }

    @Test func nrstFlagsPPRFromTheAIPAndNothingElse() {
        let (vm, _) = Self.viewModel()
        vm.updateNearest(from: Self.here)
        let byCode = Dictionary(uniqueKeysWithValues: vm.nearestAirports.map { ($0.airport.icao, $0) })
        #expect(byCode["LLRS"]?.requiresPPR == true)
        #expect(byCode["LLHZ"]?.requiresPPR == false)
        #expect(byCode["LLRS"]?.israel?.isReviewed == false)
        #expect(byCode["LLHZ"]?.isClosedByNotam == false)   // no feed: no closure claim either way
        #expect(byCode["LLHZ"]?.isPrivateUse == false)      // PPR is its own tag, not the US private-use flag
    }

    /// Real feed text (C2210/26, 2026-11-01): an area near Herzliya is closed for UAS activity, the field is not.
    @Test func anAreaClosureThatMentionsTheFieldDoesNotCloseIt() {
        let now = Date()
        let text = "UAS ACT WILL TAKE PLACE AT KFAR-SABA WI LLHZ TRG AREA NR 3, FM GND UP TO 400FT AGL. AN AREA BTN FLW PSN CLSD FM GND UP TO 900FT AMSL 321038N0345552E 321015N0345531E"
        let report = Self.report([Self.notam(id: "C2210/26", text: text, from: now - 3600, to: now + 3600)], generatedAt: now - 60)
        #expect(IsraelAerodromeAdapter.closingNotams(naming: "LLHZ", in: report, at: now).isEmpty)
    }

    @Test func onlyAClosureWhoseSubjectIsTheFieldMatches() {
        let now = Date()
        func match(_ text: String) -> Bool {
            let report = Self.report([Self.notam(id: "N", text: text)], generatedAt: now - 60)
            return !IsraelAerodromeAdapter.closingNotams(naming: "LLHZ", in: report, at: now).isEmpty
        }
        #expect(match("LLHZ AD CLSD TO ALL FLT"))
        #expect(match("LLHZ AIRSTRIP CLSD"))
        #expect(match("AD LLHZ CLSD"))
        #expect(match("LLHZ CLOSED DUE WORKS"))
        #expect(!match("RWY 10/28 CLSD AT LLHZ"))              // runway, not the field
        #expect(!match("TWY B CLSD AT LLHZ"))                  // taxiway
        #expect(!match("LLHZ TRG AREA ACT, AN AREA CLSD"))     // area closure
        #expect(!match("PARACHUTING NR LLHZ, AIRSPACE CLSD"))
    }

    @Test func switchingRegionRequeriesWithoutMoving() {
        let us = MockDatabaseManager()
        us.airports = [NearestAirportViewModelTests.kpao]
        let (vm, state) = Self.viewModel(region: .us, us: us)
        vm.updateNearest(from: Self.here)
        #expect(vm.nearestAirports.map(\.airport.icao) == ["KPAO"])
        #expect(vm.nearestAirports.first?.israel == nil)
        state.region = .israel
        vm.updateNearest(from: Self.here)   // same spot
        #expect(vm.nearestAirports.map(\.airport.icao) == ["LLHZ", "LLBG", "LLRS"])
    }

    @Test func nrstFlagsAFieldAFreshNotamNamesClosed() async {
        let now = Date()
        let feed = Self.report([Self.notam(id: "C1/26", text: "LLHZ AD CLSD TO ALL FLT", from: now.addingTimeInterval(-3600))], generatedAt: now.addingTimeInterval(-300))
        let (vm, _) = Self.viewModel(notams: { feed })
        vm.updateNearest(from: Self.here)
        let flagged = await Self.eventually { vm.nearestAirports.first?.isClosedByNotam == true }
        #expect(flagged)
        #expect(vm.nearestAirports.first?.israel?.closureNotamIDs == ["C1/26"])
        #expect(vm.nearestAirports.first { $0.airport.icao == "LLBG" }?.isClosedByNotam == false)
    }

    @Test func aFailedNotamFetchLeavesTheListUnflaggedNotBroken() async {
        let (vm, _) = Self.viewModel(notams: { throw IsraelNotamError.notConfigured })
        vm.updateNearest(from: Self.here)
        try? await Task.sleep(nanoseconds: 100_000_000)
        #expect(vm.nearestAirports.count == 3)
        #expect(vm.nearestAirports.allSatisfy { !$0.isClosedByNotam })
    }

    // MARK: - NOTAM matching

    @Test func closureMatchingIgnoresSupersededExpiredFutureAndRouteNotams() {
        let now = Date()
        let hour: TimeInterval = 3600
        let items = [
            Self.notam(id: "OK", text: "LLBO AIRSTRIP CLSD TO ALL FLT", from: now - hour, to: now + hour),
            Self.notam(id: "CANCELLED", text: "LLBO AIRSTRIP CLSD", cancelledBy: "C9/26"),
            Self.notam(id: "ENDED", text: "LLBO AIRSTRIP CLSD", from: now - 3 * hour, to: now - hour),
            Self.notam(id: "FUTURE", text: "LLBO AIRSTRIP CLSD", from: now + hour, to: now + 2 * hour),
            Self.notam(id: "ROUTE", text: "CVFR RTE CLSD LLBO-GALIM", closures: [IsraelRouteClosure(notamId: "ROUTE", routeKind: "CVFR", routeName: nil, chain: ["LLBO", "GALIM"], validFrom: nil, validTo: nil, schedule: nil)]),
            Self.notam(id: "OTHER", text: "LLBOX AIRSTRIP CLSD"),
            Self.notam(id: "NOTCLOSED", text: "LLBO PARACHUTING ACT"),
        ]
        let report = Self.report(items, generatedAt: now - 60)
        #expect(IsraelAerodromeAdapter.closingNotams(naming: "LLBO", in: report, at: now).map(\.id) == ["OK"])
    }

    @Test func anOldFeedNeverFlagsAClosure() {
        let now = Date()
        let notams = [Self.notam(id: "C1/26", text: "LLHZ AD CLSD")]
        let stale = Self.report(notams, generatedAt: now - 8 * 3600)   // past the 6 h NOTAM expiry
        #expect(IsraelAerodromeAdapter.closingNotams(naming: "LLHZ", in: stale, at: now).isEmpty)
        let current = Self.report(notams, generatedAt: now - 600)
        #expect(IsraelAerodromeAdapter.closingNotams(naming: "LLHZ", in: current, at: now).count == 1)
    }

    // MARK: - Search

    @Test func searchInIsraelFindsByHebrewEnglishAndCode() async {
        let state = AppState()
        state.region = .israel
        let db = Self.database()
        let us = MockDatabaseManager()
        us.airports = [NearestAirportViewModelTests.kpao]
        let vm = SearchViewModel(databaseService: us, regionProvider: { state.region }, israelDatabaseProvider: { db })

        vm.query = "הרצליה"
        vm.search()
        #expect(await Self.eventually { vm.results.map(\.icao) == ["LLHZ"] })

        vm.query = "LLBG field"
        vm.search()
        #expect(await Self.eventually { vm.results.map(\.icao) == ["LLBG"] })

        vm.query = "llrs"
        vm.search()
        #expect(await Self.eventually { vm.results.map(\.icao) == ["LLRS"] })
    }

    @Test func searchOutsideIsraelStillUsesTheAviationDatabase() async {
        let state = AppState()
        let db = Self.database()
        let us = MockDatabaseManager()
        us.airports = [NearestAirportViewModelTests.kpao]
        let vm = SearchViewModel(databaseService: us, regionProvider: { state.region }, israelDatabaseProvider: { db })
        vm.query = "Palo"
        vm.search()
        #expect(await Self.eventually { vm.results.map(\.icao) == ["KPAO"] })
        vm.query = "הרצליה"
        vm.search()
        #expect(await Self.eventually { vm.results.isEmpty })
    }

    // MARK: - Adapter units

    @Test func runwayLengthsConvertFromMetresToFeet() {
        let airport = IsraelAerodromeAdapter.airport(Self.aerodrome("LLHZ", lat: 32.18, lon: 34.83, runways: [Self.runway("10/28", length: 903, width: 18)]))
        let runway = airport.runways[0]
        #expect(runway.length == 2963 && runway.width == 59)   // feet
        #expect(runway.baseEndID == "10" && runway.reciprocalEndID == "28")
        #expect(runway.surface == .asphalt)
        #expect(airport.elevation == 100)   // feet MSL
    }

    @Test func frequencyRolesFollowTheAIPWording() {
        #expect(IsraelAerodromeAdapter.frequencyType(service: "TWR primary") == .tower)
        #expect(IsraelAerodromeAdapter.frequencyType(service: "GND west of RWY 21") == .ground)
        #expect(IsraelAerodromeAdapter.frequencyType(service: "ATIS arrival") == .atis)
        #expect(IsraelAerodromeAdapter.frequencyType(service: "Airstrip operator channel (Teyman)") == .ctaf)
        #expect(IsraelAerodromeAdapter.frequencyType(service: "Emergency") == .other)
    }

    @Test func militaryFieldsMapToMilitaryOwnershipAndHeliportsToHeliports() {
        let mil = IsraelAerodromeAdapter.airport(Self.aerodrome("LLEK", lat: 31.8, lon: 34.8, use: .military))
        #expect(mil.ownership == .military)
        let pad = IsraelAerodromeAdapter.airport(Self.aerodrome("ICHILOV", lat: 32.0, lon: 34.8, type: .heliport, use: .hospital))
        #expect(pad.type == .heliport)
        #expect(!LandableAirportFilter.isLandable(pad))
    }

    // MARK: - Sheet text

    @Test func runwayTextShowsMetresFeetSurfaceAndHeadingReference() {
        let runway = IsraelAerodromeRunway(id: 1, designator: "10/28", lengthMetres: 903, widthMetres: 18, surface: "asphalt",
                                           headingA: 104.12, headingB: 284.12, headingIsTrue: true)
        #expect(IsraelAerodromeSection.dimensions(runway) == "903 x 18 m  (2963 ft)")
        #expect(IsraelAerodromeSection.surfaceAndHeading(runway) == "Asphalt, 104.12/284.12\u{00B0} true")
        let magnetic = IsraelAerodromeRunway(id: 2, designator: "14/32", lengthMetres: 1403, widthMetres: 21, surface: "asphalt",
                                             headingA: 136, headingB: 316, headingIsTrue: false)
        #expect(IsraelAerodromeSection.surfaceAndHeading(magnetic).hasSuffix("magnetic"))
        let unknown = IsraelAerodromeRunway(id: 3, designator: "?", lengthMetres: 2450, widthMetres: 50, surface: "unknown",
                                            headingA: nil, headingB: nil, headingIsTrue: nil)
        #expect(IsraelAerodromeSection.surfaceAndHeading(unknown) == "surface not published")
    }

    @Test func everyNonCivilUseExplainsItself() {
        #expect(IsraelAerodromeSection.useNote(.civil) == nil)
        for use in [IsraelAerodromeUse.military, .uas, .agricultural, .hospital, .foreign] {
            #expect(IsraelAerodromeSection.useNote(use) != nil, "\(use)")
        }
        #expect(IsraelAerodromeSection.groupLabel("elevation_ft") == "elevation")
        #expect(IsraelAerodromeSection.groupLabel("identity") == "position")
    }
}
