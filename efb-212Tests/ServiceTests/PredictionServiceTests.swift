//
//  PredictionServiceTests.swift
//  efb-212Tests
//
//  Direction 2 stage 2: the airspace mappers that feed AirspacePredictor and the per-fix wiring
//  that writes AppState.predictedEvents (cleared when off or stale, debounced across fixes).
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

// MARK: - US mapper

struct PredictionUSMapperTests {

    private func airspace(_ classification: AirspaceClass, floor: Int = 0, ceiling: Int = 4000) -> Airspace {
        Airspace(
            classification: classification, name: "Test", floor: floor, ceiling: ceiling,
            geometry: .circle(center: [37.0, -122.0], radiusNM: 5)
        )
    }

    @Test func classesMapToShortNamesAndSeverity() throws {
        let expected: [(AirspaceClass, String, PredictedEvent.Severity)] = [
            (.bravo, "B", .caution), (.charlie, "C", .caution), (.delta, "D", .caution),
            (.restricted, "R", .warning), (.prohibited, "P", .warning), (.moa, "MOA", .caution),
            (.alert, "A", .caution), (.warning, "W", .caution), (.tfr, "TFR", .warning)
        ]
        for (classification, name, severity) in expected {
            let volume = try #require(PredictionService.volume(from: airspace(classification)))
            #expect(volume.shortName == name)
            #expect(volume.severity == severity)
        }
    }

    @Test func classEAndGAreSkipped() {
        #expect(PredictionService.volume(from: airspace(.echo)) == nil)
        #expect(PredictionService.volume(from: airspace(.golf)) == nil)
    }

    @Test func unlimitedCeilingIsNilAndSurfaceFloorIsZero() throws {
        let volume = try #require(PredictionService.volume(from: airspace(.bravo, floor: 0, ceiling: 99999)))
        #expect(volume.floorFeetMSL == 0)
        #expect(volume.ceilingFeetMSL == nil)
        #expect(volume.shape == .circle(center: [37.0, -122.0], radiusNM: 5))
    }

    @Test func polygonBecomesOuterRing() throws {
        let ring = [[37.0, -122.0], [37.1, -122.0], [37.1, -121.9], [37.0, -122.0]]
        let source = Airspace(classification: .delta, name: "D", floor: 0, ceiling: 2500, geometry: .polygon(coordinates: ring))
        let volume = try #require(PredictionService.volume(from: source))
        #expect(volume.shape == .polygon(rings: [ring]))
        #expect(volume.ceilingFeetMSL == 2500)
    }
}

// MARK: - Israel mapper

struct PredictionIsraelMapperTests {

    private func airspace(
        _ kind: IsraelAirspaceKind, code: String?,
        floor: IsraelAirspaceLimit = IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil),
        ceiling: IsraelAirspaceLimit = IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil)
    ) -> IsraelAirspace {
        let ring = [
            CLLocationCoordinate2D(latitude: 32.0, longitude: 34.8),
            CLLocationCoordinate2D(latitude: 32.1, longitude: 34.8),
            CLLocationCoordinate2D(latitude: 32.1, longitude: 34.9),
            CLLocationCoordinate2D(latitude: 32.0, longitude: 34.8)
        ]
        return IsraelAirspace(
            id: 7, kind: kind, code: code, nameEnglish: nil, nameHebrew: nil, label: nil, authority: .civil,
            floor: floor, ceiling: ceiling, polygons: [[ring]]
        )
    }

    @Test func aglFloorReadsAsSurface() throws {
        let volumes = PredictionService.volumes(
            from: airspace(.ctr, code: "LLHA", floor: IsraelAirspaceLimit(feet: 500, reference: .agl, publishedText: nil))
        )
        let volume = try #require(volumes.first)
        #expect(volume.floorFeetMSL == nil)
        #expect(volume.ceilingFeetMSL == 3000)
        #expect(volume.shortName == "CTR LLHA")
        #expect(volume.severity == .caution)
        #expect(volume.shape == .polygon(rings: [[[32.0, 34.8], [32.1, 34.8], [32.1, 34.9], [32.0, 34.8]]]))
    }

    @Test func mslFloorKeptAndNonMSLCeilingUnlimited() throws {
        let volume = try #require(PredictionService.volumes(from: airspace(
            .tma, code: "LLBG",
            floor: IsraelAirspaceLimit(feet: 2500, reference: .msl, publishedText: nil),
            ceiling: IsraelAirspaceLimit(feet: 95, reference: .flightLevel, publishedText: nil)
        )).first)
        #expect(volume.floorFeetMSL == 2500)
        #expect(volume.ceilingFeetMSL == nil)
    }

    @Test func surfaceFloorIsZero() throws {
        let volume = try #require(PredictionService.volumes(from: airspace(.atz, code: "LLHZ")).first)
        #expect(volume.floorFeetMSL == 0)
    }

    @Test func firIsSkipped() {
        #expect(PredictionService.volumes(from: airspace(.fir, code: "LLLL")).isEmpty)
    }

    @Test func prohibitedAndRestrictedAreWarnings() throws {
        let prohibited = try #require(PredictionService.volumes(from: airspace(.prohibited, code: "LLP04")).first)
        #expect(prohibited.shortName == "P 4")
        #expect(prohibited.severity == .warning)
        let restricted = try #require(PredictionService.volumes(from: airspace(.restricted, code: "LLR12")).first)
        #expect(restricted.shortName == "R 12")
        #expect(restricted.severity == .warning)
        let danger = try #require(PredictionService.volumes(from: airspace(.danger, code: "LLD5")).first)
        #expect(danger.shortName == "D 5")
        #expect(danger.severity == .caution)
    }
}

// MARK: - Per-fix wiring

@MainActor
struct PredictionServiceUpdateTests {

    /// Class C 5 NM north of ownship, 2 NM radius, surface to 4,000 ft MSL.
    private let classC = Airspace(
        classification: .charlie, name: "Test C", floor: 0, ceiling: 4000,
        geometry: .circle(center: [37.0 + 5.0 / 60.0, -122.0], radiusNM: 2)
    )

    private func makeAppState() -> AppState {
        let database = MockDatabaseManager()
        database.airspacesData = [classC]
        let appState = AppState()
        appState.region = .us
        appState.getOrCreateDatabaseService(make: { database })
        appState.track = 0            // degrees true, due north
        appState.groundSpeed = 120    // knots: the airspace edge (3 NM) is 90 s ahead
        return appState
    }

    /// 2,000 ft MSL heading north at 120 kt.
    private func fix(secondsAfterStart: TimeInterval, course: Double = 0) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 37.0, longitude: -122.0),
            altitude: 609.6,            // meters (2,000 ft)
            horizontalAccuracy: 5,      // meters
            verticalAccuracy: 5,        // meters
            course: course,             // degrees true
            speed: 61.7,                // meters per second (120 kt)
            timestamp: Date(timeIntervalSince1970: 1_800_000_000 + secondsAfterStart)
        )
    }

    private let placeholder = PredictedEvent(
        volumeID: "x", kind: .lateral, severity: .caution, secondsAhead: 60,
        coordinate: CLLocationCoordinate2D(latitude: 37, longitude: -122), limitFeetMSL: nil,
        title: "C", assumption: "at 000\u{00B0}, level"
    )

    @Test func publishesAStableEventAfterTwoConsistentFixes() throws {
        let appState = makeAppState()
        let service = PredictionService()

        service.update(location: fix(secondsAfterStart: 0), appState: appState, isStale: false, enabled: true)
        #expect(appState.predictedEvents.isEmpty)  // one evaluation is not yet stable

        service.update(location: fix(secondsAfterStart: 1), appState: appState, isStale: false, enabled: true)
        let event = try #require(appState.predictedEvents.first)
        #expect(appState.predictedEvents.count == 1)
        #expect(event.volumeID == "us-\(classC.id.uuidString)")
        #expect(event.severity == .caution)
        #expect(event.secondsAhead > 0 && event.secondsAhead < 180)  // seconds; edge 3 NM ahead at 120 kt
    }

    @Test func disabledClearsEvents() {
        let appState = makeAppState()
        appState.predictedEvents = [placeholder]
        PredictionService().update(location: fix(secondsAfterStart: 0), appState: appState, isStale: false, enabled: false)
        #expect(appState.predictedEvents.isEmpty)
    }

    @Test func staleFixClearsEventsAndRestartsDebounce() {
        let appState = makeAppState()
        let service = PredictionService()
        service.update(location: fix(secondsAfterStart: 0), appState: appState, isStale: false, enabled: true)
        service.update(location: fix(secondsAfterStart: 1), appState: appState, isStale: false, enabled: true)
        #expect(!appState.predictedEvents.isEmpty)

        service.update(location: fix(secondsAfterStart: 2), appState: appState, isStale: true, enabled: true)
        #expect(appState.predictedEvents.isEmpty)

        // After the fix returns, one evaluation is not enough to show the event again.
        service.update(location: fix(secondsAfterStart: 3), appState: appState, isStale: false, enabled: true)
        #expect(appState.predictedEvents.isEmpty)
    }

    @Test func unknownCoursePredictsNothing() {
        let appState = makeAppState()
        let service = PredictionService()
        service.update(location: fix(secondsAfterStart: 0, course: -1), appState: appState, isStale: false, enabled: true)
        service.update(location: fix(secondsAfterStart: 1, course: -1), appState: appState, isStale: false, enabled: true)
        #expect(appState.predictedEvents.isEmpty)
    }
}
