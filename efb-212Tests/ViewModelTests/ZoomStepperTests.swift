//
//  ZoomStepperTests.swift
//  efb-212Tests
//
//  The footer's zoom cells: AppState.mapZoom updates only after the camera settles, so quick
//  taps must add up instead of asking for the same level twice.
//

import Testing
@testable import efb_212

@Suite("Zoom stepper")
struct ZoomStepperTests {

    @Test func quickTapsAddUpBeforeTheCameraReports() {
        var stepper = ZoomStepper()
        #expect(stepper.step(1, from: 10) == 11)
        #expect(stepper.step(1, from: 10) == 12)  // mapZoom still reads 10
    }

    @Test func aReportedZoomStartsTheNextTapFromThere() {
        var stepper = ZoomStepper()
        _ = stepper.step(1, from: 10)
        stepper.reset()                           // the pilot pinched to 7
        #expect(stepper.step(-1, from: 7) == 6)
    }

    @Test func tapsStopAtTheLimits() {
        var stepper = ZoomStepper()
        #expect(stepper.step(1, from: 18) == 18)
        stepper.reset()
        #expect(stepper.step(-1, from: 2) == 2)
    }
}
