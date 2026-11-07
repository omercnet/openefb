//
//  MapGPSRecordingFixesTests.swift
//  efb-212Tests
//
//  Behaviour tests for the T21 fix list: GPS failure causes, clearing Direct-To, the
//  post-stop auto-start gate, speed-only phase inference, and the debrief / discard rules.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

// MARK: - GPS failure cause (efb-77r.27)

@Suite("GPS failure reason")
struct GPSFailureReasonTests {

    @Test func deniedWinsOverUnavailable() {
        let reason = GPSFailureReason.from(authorizationDenied: true, authorizationRestricted: false, locationUnavailable: true)
        #expect(reason == .authorizationDenied)
    }

    @Test func restrictedAndUnavailableAreDistinct() {
        #expect(GPSFailureReason.from(authorizationDenied: false, authorizationRestricted: true, locationUnavailable: false) == .authorizationRestricted)
        #expect(GPSFailureReason.from(authorizationDenied: false, authorizationRestricted: false, locationUnavailable: true) == .locationUnavailable)
    }

    @Test func noFlagsMeansNoExplanation() {
        #expect(GPSFailureReason.from(authorizationDenied: false, authorizationRestricted: false, locationUnavailable: false) == nil)
    }

    @Test func onlyDenialOffersOpenSettings() {
        #expect(GPSFailureReason.authorizationDenied.offersSettings)
        for reason in [GPSFailureReason.authorizationRestricted, .locationUnavailable, .noFixYet, .streamFailed] {
            #expect(!reason.offersSettings)
        }
    }
}

// MARK: - Clear Direct-To (efb-77r.28)

@Suite("Clear Direct-To")
@MainActor
struct ClearDirectToTests {

    @Test func clearRemovesDirectToAndStripValues() {
        let appState = AppState()
        appState.ownshipPosition = CLLocation(latitude: 37.4611, longitude: -122.1150)
        appState.groundSpeed = 90   // knots
        let vm = NearestAirportViewModel(appState: appState, databaseService: NearestAirportViewModelTests.makeMockDB())

        vm.setDirectTo(airport: NearestAirportViewModelTests.ksql)
        #expect(appState.directToAirport?.icao == "KSQL")
        #expect(appState.activeFlightPlan)
        #expect(appState.distanceToNext != nil)
        #expect(appState.estimatedTimeEnroute != nil)
        #expect(FlightLogStrip.routeTitle(for: appState) == "DIRECT KSQL")

        vm.clearDirectTo()

        #expect(appState.directToAirport == nil)
        #expect(!appState.activeFlightPlan)
        #expect(appState.distanceToNext == nil)
        #expect(appState.estimatedTimeEnroute == nil)
        #expect(!appState.hasActiveNavigation)
        #expect(FlightLogStrip.routeTitle(for: appState) == nil)
    }

    @Test func clearAlsoDropsARouteSummary() {
        let appState = AppState()
        appState.activeFlightPlan = true
        appState.activePlanDeparture = "KPAO"
        appState.activePlanDestination = "KSQL"
        appState.distanceToNext = 12
        #expect(FlightLogStrip.routeTitle(for: appState) == "KPAO \u{2192} KSQL")

        appState.clearActiveNavigation()

        #expect(appState.activePlanDeparture == nil)
        #expect(appState.activePlanDestination == nil)
        #expect(!appState.hasActiveNavigation)
    }
}

// MARK: - Auto-start after a manual stop (efb-77r.29)

@Suite("AutoStartGate")
struct AutoStartGateTests {

    @Test func openGateAllowsArmingAtAnySpeed() {
        var gate = AutoStartGate()
        let allowed = gate.update(speedKts: 97, thresholdKts: 15)
        #expect(allowed)
    }

    @Test func manualStopHoldsOffWhileStillMoving() {
        var gate = AutoStartGate()
        gate.manualStop()
        let atCruise = gate.update(speedKts: 97, thresholdKts: 15)   // still at 97 kt: no countdown
        let justAbove = gate.update(speedKts: 16, thresholdKts: 15)
        #expect(!atCruise)
        #expect(!justAbove)
        #expect(gate.isSuppressed)
    }

    @Test func gateReopensOnceBelowThresholdAndStaysOpen() {
        var gate = AutoStartGate()
        gate.manualStop()
        let atThreshold = gate.update(speedKts: 15, thresholdKts: 15)   // at threshold = would not arm = stopped
        let nextTakeoff = gate.update(speedKts: 60, thresholdKts: 15)   // next takeoff arms normally
        #expect(atThreshold)
        #expect(nextTakeoff)
    }

    @Test @MainActor func coordinatorSuppressesAfterManualStopAndFreshCoordinatorDoesNot() async throws {
        let db = try AutoStartTests.makeTempDB()
        let coordinator = RecordingCoordinator(
            recordingDB: db, audioRecorder: MockAudioRecorder(), transcriptionService: MockTranscriptionService()
        )
        _ = try await coordinator.startRecording()
        #expect(await coordinator.isAutoStartSuppressed == false)
        _ = await coordinator.stopRecording()
        #expect(await coordinator.isAutoStartSuppressed)
        #expect(await coordinator.updateAutoStartGate(speed: 97, threshold: 15) == false)
        #expect(await coordinator.updateAutoStartGate(speed: 3, threshold: 15))
        #expect(await coordinator.isAutoStartSuppressed == false)

        // App restart = new coordinator = open gate
        let restarted = RecordingCoordinator(
            recordingDB: db, audioRecorder: MockAudioRecorder(), transcriptionService: MockTranscriptionService()
        )
        #expect(await restarted.isAutoStartSuppressed == false)
    }
}

// MARK: - Phase without altitude (efb-77r.30)

@Suite("FlightPhaseDetector without altitude")
struct PhaseWithoutAltitudeTests {

    private func feed(
        _ detector: inout FlightPhaseDetector, speed: Double, from start: Int, to end: Int, hasAltitude: Bool
    ) -> FlightPhaseType {
        var phase = detector.currentPhase
        for i in start...end {
            let point = FlightPhaseDetectorTests.makePoint(speed: speed, altitude: 0, vsi: 0, secondsFromStart: Double(i))
            phase = detector.process(point, hasAltitude: hasAltitude)
        }
        return phase
    }

    @Test func ninetySevenKnotsWithoutAltitudeIsAirborneNotTaxi() {
        var detector = FlightPhaseDetector()
        #expect(feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: false) == .taxi)
        let phase = feed(&detector, speed: 97, from: 31, to: 80, hasAltitude: false)
        #expect(phase == .departure)
        #expect(phase != .taxi)
    }

    @Test func betweenTaxiAndRotationSpeedIsTakeoffRoll() {
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: false)
        let phase = feed(&detector, speed: 40, from: 31, to: 70, hasAltitude: false)
        #expect(phase == .takeoff)
    }

    @Test func atTaxiSpeedThresholdStaysTaxi() {
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: false)
        let phase = feed(&detector, speed: FlightPhaseDetector.taxiMaxSpeedKts, from: 31, to: 80, hasAltitude: false)
        #expect(phase == .taxi)
    }

    @Test func withAltitudeBelowRotationSpeedLevelStaysTaxi() {
        // Between taxi and rotation speed with a valid altitude, a takeoff needs a climb to be confirmed.
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: true)
        let phase = feed(&detector, speed: 40, from: 31, to: 80, hasAltitude: true)
        #expect(phase == .taxi)
    }

    @Test func withAltitudeAboveRotationSpeedIsAirborneNotTaxiEvenWhenLevel() {
        // efb-77r.36: 97 kt at a steady altitude (no climb seen) is airborne, not Taxi.
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: true)
        let phase = feed(&detector, speed: 97, from: 31, to: 80, hasAltitude: true)
        #expect(phase == .departure)
    }

    @Test func recordingStartedInCruiseAtConstantAltitudeNeverReadsTaxi() {
        // efb-77r.36: first fix is already 97 kt at a constant 4,500 ft MSL.
        var detector = FlightPhaseDetector()
        var seen: Set<FlightPhaseType> = []
        for i in 0...120 {
            let point = FlightPhaseDetectorTests.makePoint(
                speed: 97, altitude: 4500, vsi: 0, secondsFromStart: 1_700_000_000 + Double(i))  // real wall-clock start
            seen.insert(detector.process(point, hasAltitude: true))
        }
        #expect(!seen.contains(.taxi))
        #expect(!seen.contains(.preflight))   // fast from the first fix: never reads Preflight either
        #expect(detector.currentPhase == .cruise)
    }

    @Test func recordingStartedInCruiseWithoutAltitudeNeverReadsTaxi() {
        var detector = FlightPhaseDetector()
        var seen: Set<FlightPhaseType> = []
        for i in 0...120 {
            let point = FlightPhaseDetectorTests.makePoint(
                speed: 97, altitude: 0, vsi: 0, secondsFromStart: 1_700_000_000 + Double(i))
            seen.insert(detector.process(point, hasAltitude: false))
        }
        #expect(!seen.contains(.taxi))
        #expect(detector.currentPhase == .departure)
    }

    @Test func resumedInCruiseAfterTaxiLevelFixesLeavesTaxi() {
        // Recording ran on the ground, then the next fixes are cruise speed at constant altitude.
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: true)
        #expect(detector.currentPhase == .taxi)
        _ = feed(&detector, speed: 110, from: 31, to: 130, hasAltitude: true)
        #expect(detector.currentPhase != .taxi)
        #expect(detector.currentPhase == .cruise || detector.currentPhase == .departure)
    }

    @Test func departureWithoutAltitudeEndsAsLandingWhenSlow() {
        var detector = FlightPhaseDetector()
        _ = feed(&detector, speed: 10, from: 0, to: 30, hasAltitude: false)
        _ = feed(&detector, speed: 97, from: 31, to: 80, hasAltitude: false)
        #expect(detector.currentPhase == .departure)
        let phase = feed(&detector, speed: 8, from: 81, to: 140, hasAltitude: false)
        #expect(phase == .landing)
    }
}

// MARK: - Discarded recording and short-flight debrief (efb-77r.31)

@Suite("Discard notice and debrief eligibility")
struct DiscardAndDebriefTests {

    @Test func discardedEmptyShowsNoticeSavedDoesNot() {
        #expect(RecordingViewModel.shouldShowDiscardedNotice(for: .discardedEmpty))
        #expect(!RecordingViewModel.shouldShowDiscardedNotice(for: .saved))
    }

    @Test func subMinuteWithoutTranscriptIsNotEligible() {
        #expect(FlightDetailView.debriefIneligibleReason(durationSeconds: 48, transcriptSegmentCount: 0) != nil)
    }

    @Test func transcriptOrOneMinuteMakesItEligible() {
        #expect(FlightDetailView.debriefIneligibleReason(durationSeconds: 48, transcriptSegmentCount: 3) == nil)
        #expect(FlightDetailView.debriefIneligibleReason(durationSeconds: 60, transcriptSegmentCount: 0) == nil)
        #expect(FlightDetailView.debriefIneligibleReason(durationSeconds: 59.9, transcriptSegmentCount: 0) != nil)
    }
}
