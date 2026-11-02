//
//  ScenarioSmokeUITests.swift
//  efb-212UITests
//
//  SIM-IL (T35). Launches the DEBUG build with a flight scenario from tools/flight-sim and checks that the route
//  bar follows it. No screenshot assertions. The scenario is replayed by ScenarioPlayback through LocationService.
//

import XCTest

final class ScenarioSmokeUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(_ scenario: String, speed: Int, start: Int = 0) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            "-hasSeenOnboarding", "YES",
            "-OpenEFBScenario", scenario,
            "-OpenEFBScenarioSpeed", String(speed),
            "-OpenEFBScenarioStart", String(start),
        ]
        app.launch()
        return app
    }

    /// The route bar shows the next reporting point of the plan the scenario activates.
    @MainActor
    func testNominalScenarioShowsTheNextReportingPoint() throws {
        let app = launch("il-cvfr-llhz-llib-nominal", speed: 20)
        let next = app.staticTexts["israel-route-next-point"]
        XCTAssertTrue(next.waitForExistence(timeout: 60), "route bar did not appear")
        XCTAssertTrue(next.label.hasPrefix("NEXT "), "route bar shows \(next.label)")
        // Sixty seconds of scenario time: the aircraft is still taxiing or climbing out, bound for the first point.
        XCTAssertTrue(next.label.contains("BAZRA"), "first point is BAZRA, bar shows \(next.label)")
        XCTAssertFalse(app.staticTexts["israel-route-altitude-caution"].exists, "nominal flight raised an altitude caution")
    }

    /// Skipping to the leg flown 400 ft high: the altitude caution shows once the 30 s grace has passed (scenario
    /// seconds 1098 to 1212; slow enough that a UI query cannot miss it).
    @MainActor
    func testDeviationScenarioShowsTheAltitudeCaution() throws {
        let app = launch("il-cvfr-llhz-llib-deviations", speed: 5, start: 1060)  // caution shows for ~20 s of wall time
        let caution = app.staticTexts["israel-route-altitude-caution"]
        XCTAssertTrue(caution.waitForExistence(timeout: 90), "no altitude caution on the deviating leg")
        XCTAssertTrue(caution.label.contains("HIGH"), "caution reads \(caution.label)")
    }
}
